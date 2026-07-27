import { createContext, useContext } from "react";
import type {
  Payer,
  Code,
  PolicyDocument,
  DocumentSpan,
  Criterion,
  CoverageStanceRecord,
  CriterionChange,
  PolicyCodeLink,
  CoveredLives,
  CoverageStance,
} from "@assent/core";
import { COVERAGE_STANCE_RANK } from "@assent/core";

/**
 * THE DATA LAYER (PROMPT §7). Loads the bundled offline corpus once and exposes
 * typed, memoized selectors. Everything is held in memory and searched with plain
 * `.filter` / `.includes` — fine for the ~60-span demo corpus.
 *
 * NOTE: in the shipping desktop app this layer is backed by the SQLite **FTS5**
 * index in `@assent/local-db` (queried Rust-side via a Tauri command — see
 * `src-tauri/src/lib.rs::search_corpus`), not by a JSON blob in the renderer.
 * The selector surface here mirrors what that query layer returns so the UI is
 * identical whether it reads the JSON demo corpus or the on-disk database.
 */

/** The shape of `public/corpus.json` (mirrors the server read models in `@assent/core`). */
export interface Corpus {
  payers: Payer[];
  coveredLives: CoveredLives[];
  codes: Code[];
  documents: PolicyDocument[];
  spans: DocumentSpan[];
  criteria: Criterion[];
  stances: CoverageStanceRecord[];
  changes: CriterionChange[];
  codeLinks: PolicyCodeLink[];
}

export interface SearchHit {
  documents: PolicyDocument[];
  criteria: Criterion[];
}

export interface CorpusApi {
  raw: Corpus;

  // Collections
  payers: Payer[];
  codes: Code[];
  documents: PolicyDocument[]; // all versions, including superseded
  activeDocuments: PolicyDocument[]; // latest version of each policy only
  criteria: Criterion[];
  spans: DocumentSpan[];
  stances: CoverageStanceRecord[];
  changes: CriterionChange[];
  codeLinks: PolicyCodeLink[];
  coveredLives: CoveredLives[];

  // Point lookups
  payerById: (id: string) => Payer | undefined;
  codeById: (id: string) => Code | undefined;
  documentById: (id: string) => PolicyDocument | undefined;
  criterionById: (id: string) => Criterion | undefined;
  spanById: (id: string) => DocumentSpan | undefined;
  payerForDoc: (docId: string) => Payer | undefined;

  // Relations
  spansByDoc: (docId: string) => DocumentSpan[];
  criteriaByDoc: (docId: string) => Criterion[];
  criteriaBySpan: (spanId: string) => Criterion[];
  stancesByDoc: (docId: string) => CoverageStanceRecord[];
  codeLinksForDoc: (docId: string) => PolicyCodeLink[];
  codeIdsForDoc: (docId: string) => string[];
  docsByPayer: (payerId: string) => PolicyDocument[];
  isSuperseded: (docId: string) => boolean;

  // Covered-lives weighting (denominator is always labeled at the call site)
  livesByPayer: Map<string, number>;
  totalCorpusLives: number;
  livesForPayer: (payerId: string) => number;

  // Coverage-map stance, derived from stances[] first, then codeLinks[]
  deriveStance: (payerId: string, codeId: string) => CoverageStance;

  // Full-text filter (in-memory stand-in for the FTS5 index)
  documentMatchesText: (docId: string, query: string) => boolean;
  search: (query: string) => SearchHit;
}

const CorpusContext = createContext<CorpusApi | null>(null);
export const CorpusProvider = CorpusContext.Provider;

export function useCorpus(): CorpusApi {
  const api = useContext(CorpusContext);
  if (!api) throw new Error("useCorpus must be used inside <CorpusProvider>");
  return api;
}

/** Build the memoized selector surface over a loaded corpus. Pure — no React. */
export function buildCorpusApi(raw: Corpus): CorpusApi {
  const payerById = index(raw.payers, (p) => p.id);
  const codeById = index(raw.codes, (c) => c.id);
  const documentById = index(raw.documents, (d) => d.id);
  const criterionById = index(raw.criteria, (c) => c.id);
  const spanById = index(raw.spans, (s) => s.id);

  const spansByDoc = groupBy(raw.spans, (s) => s.policyDocumentId);
  const criteriaByDoc = groupBy(raw.criteria, (c) => c.policyDocumentId);
  const criteriaBySpan = groupBy(raw.criteria, (c) => c.spanId);
  const stancesByDoc = groupBy(raw.stances, (s) => s.policyDocumentId);
  const codeLinksByDoc = groupBy(raw.codeLinks, (l) => l.policyDocumentId);
  const docsByPayer = groupBy(raw.documents, (d) => d.payerId);

  // A document is superseded when a newer version points back at it.
  const supersededIds = new Set(
    raw.documents.map((d) => d.supersedesId).filter((x): x is string => x !== null),
  );
  const activeDocuments = raw.documents.filter((d) => !supersededIds.has(d.id));

  // Latest-year covered lives per payer + the modeled-corpus total.
  const latestLives = new Map<string, CoveredLives>();
  for (const row of raw.coveredLives) {
    const cur = latestLives.get(row.payerId);
    if (!cur || row.year > cur.year) latestLives.set(row.payerId, row);
  }
  const livesByPayer = new Map<string, number>();
  let totalCorpusLives = 0;
  for (const p of raw.payers) {
    const lives = latestLives.get(p.id)?.livesCount ?? 0;
    livesByPayer.set(p.id, lives);
    totalCorpusLives += lives;
  }

  const sortedSpans = (docId: string): DocumentSpan[] =>
    [...(spansByDoc.get(docId) ?? [])].sort((a, b) => a.ordinal - b.ordinal);

  const codeIdsForDoc = (docId: string): string[] =>
    (codeLinksByDoc.get(docId) ?? []).map((l) => l.codeId);

  const activeDocsForPayer = (payerId: string): PolicyDocument[] =>
    (docsByPayer.get(payerId) ?? []).filter((d) => !supersededIds.has(d.id));

  /**
   * The coverage-map stance for one payer on one code. An explicit CoverageStance
   * record (its own verified citation) always wins; the most favorable position is
   * chosen when a payer's active policies disagree. Absent a stance we fall back to
   * the policy↔code relationship, and — honestly — to `silent` when the payer has
   * said nothing about the code at all. Most cells are grey; that is the point.
   */
  const deriveStance = (payerId: string, codeId: string): CoverageStance => {
    const docs = activeDocsForPayer(payerId);
    const found: CoverageStance[] = [];
    for (const d of docs) {
      for (const st of stancesByDoc.get(d.id) ?? []) {
        if (st.codeId === codeId) found.push(st.stance);
      }
    }
    if (found.length > 0) {
      return found.reduce((best, s) =>
        COVERAGE_STANCE_RANK[s] < COVERAGE_STANCE_RANK[best] ? s : best,
      );
    }
    // No explicit stance — read the weaker signal from the code relationship.
    let sawCovers = false;
    let sawMentions = false;
    for (const d of docs) {
      for (const link of codeLinksByDoc.get(d.id) ?? []) {
        if (link.codeId !== codeId) continue;
        if (link.relationship === "excludes") return "not_covered";
        if (link.relationship === "covers") sawCovers = true;
        if (link.relationship === "mentions") sawMentions = true;
      }
    }
    if (sawCovers) return "covered";
    if (sawMentions) return "silent";
    return "silent";
  };

  // ── Full-text filter. Real app: FTS5 in @assent/local-db. Here: substring match. ──
  const docTextCache = new Map<string, string>();
  const docText = (docId: string): string => {
    const cached = docTextCache.get(docId);
    if (cached !== undefined) return cached;
    const doc = documentById.get(docId);
    const payer = doc ? payerById.get(doc.payerId) : undefined;
    const parts: string[] = [];
    if (doc) parts.push(doc.title, doc.externalId);
    if (payer) parts.push(payer.name);
    for (const c of criteriaByDoc.get(docId) ?? []) {
      parts.push(c.subject, c.requirementText, c.verbatimQuote);
    }
    for (const s of spansByDoc.get(docId) ?? []) parts.push(s.text);
    const text = parts.join(" ␟ ").toLowerCase();
    docTextCache.set(docId, text);
    return text;
  };

  const documentMatchesText = (docId: string, query: string): boolean => {
    const q = query.trim().toLowerCase();
    if (!q) return true;
    return docText(docId).includes(q);
  };

  const search = (query: string): SearchHit => {
    const q = query.trim().toLowerCase();
    if (!q) return { documents: [], criteria: [] };
    const documents = raw.documents.filter((d) => docText(d.id).includes(q));
    const criteria = raw.criteria.filter(
      (c) =>
        c.subject.toLowerCase().includes(q) ||
        c.requirementText.toLowerCase().includes(q) ||
        c.verbatimQuote.toLowerCase().includes(q),
    );
    return { documents, criteria };
  };

  return {
    raw,
    payers: raw.payers,
    codes: raw.codes,
    documents: raw.documents,
    activeDocuments,
    criteria: raw.criteria,
    spans: raw.spans,
    stances: raw.stances,
    changes: raw.changes,
    codeLinks: raw.codeLinks,
    coveredLives: raw.coveredLives,

    payerById: (id) => payerById.get(id),
    codeById: (id) => codeById.get(id),
    documentById: (id) => documentById.get(id),
    criterionById: (id) => criterionById.get(id),
    spanById: (id) => spanById.get(id),
    payerForDoc: (docId) => {
      const doc = documentById.get(docId);
      return doc ? payerById.get(doc.payerId) : undefined;
    },

    spansByDoc: sortedSpans,
    criteriaByDoc: (docId) => criteriaByDoc.get(docId) ?? [],
    criteriaBySpan: (spanId) => criteriaBySpan.get(spanId) ?? [],
    stancesByDoc: (docId) => stancesByDoc.get(docId) ?? [],
    codeLinksForDoc: (docId) => codeLinksByDoc.get(docId) ?? [],
    codeIdsForDoc,
    docsByPayer: (payerId) => docsByPayer.get(payerId) ?? [],
    isSuperseded: (docId) => supersededIds.has(docId),

    livesByPayer,
    totalCorpusLives,
    livesForPayer: (payerId) => livesByPayer.get(payerId) ?? 0,

    deriveStance,
    documentMatchesText,
    search,
  };
}

// ── tiny grouping helpers (kept local; noUncheckedIndexedAccess-safe) ──────────
function index<T>(rows: T[], key: (row: T) => string): Map<string, T> {
  const m = new Map<string, T>();
  for (const row of rows) m.set(key(row), row);
  return m;
}

function groupBy<T>(rows: T[], key: (row: T) => string): Map<string, T[]> {
  const m = new Map<string, T[]>();
  for (const row of rows) {
    const k = key(row);
    const bucket = m.get(k);
    if (bucket) bucket.push(row);
    else m.set(k, [row]);
  }
  return m;
}
