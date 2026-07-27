import Database from "better-sqlite3";
import { readFileSync, mkdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join, resolve } from "node:path";
import type {
  Payer,
  Code,
  PolicyDocument,
  DocumentSpan,
  Criterion,
  CoverageStanceRecord,
  CriterionChange,
  CoveredLives,
  PolicyCodeLink,
} from "@assent/core";

export type LocalDatabase = Database.Database;

const here = dirname(fileURLToPath(import.meta.url));

/** Open (or create) the desktop SQLite store and ensure the schema exists. */
export function openLocalDb(path = ":memory:"): LocalDatabase {
  if (path !== ":memory:") mkdirSync(dirname(resolve(path)), { recursive: true });
  const db = new Database(path);
  db.pragma("journal_mode = WAL");
  db.pragma("foreign_keys = ON");
  applySchema(db);
  return db;
}

export function applySchema(db: LocalDatabase): void {
  const sql = readFileSync(join(here, "schema.sql"), "utf8");
  db.exec(sql);
}

/** The read-only corpus payload a sync pull delivers. */
export interface CorpusData {
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

/**
 * Bulk-load the mirror and rebuild the FTS index, transactionally. Idempotent:
 * INSERT OR REPLACE upserts by id, and the FTS index is rebuilt from the mirror
 * so re-syncing the same corpus is safe.
 */
export function loadCorpus(db: LocalDatabase, data: CorpusData): void {
  const tx = db.transaction((d: CorpusData) => {
    const put = <T extends Record<string, unknown>>(table: string, cols: string[], rows: T[]) => {
      if (rows.length === 0) return;
      const placeholders = cols.map((c) => `@${c}`).join(", ");
      const stmt = db.prepare(
        `INSERT OR REPLACE INTO ${table} (${cols.join(", ")}) VALUES (${placeholders})`,
      );
      for (const r of rows) stmt.run(r);
    };

    put("payer", ["id", "name", "type", "parent_payer_id"], d.payers.map((p) => ({
      id: p.id, name: p.name, type: p.type, parent_payer_id: p.parentPayerId,
    })));
    put("covered_lives", ["id", "payer_id", "year", "segment", "lives_count", "source_url", "source_note"],
      d.coveredLives.map((c, i) => ({
        id: `${c.payerId}-${c.year}-${c.segment}-${i}`, payer_id: c.payerId, year: c.year,
        segment: c.segment, lives_count: c.livesCount, source_url: c.sourceUrl, source_note: c.sourceNote,
      })));
    put("code", ["id", "system", "code", "description"], d.codes.map((c) => ({
      id: c.id, system: c.system, code: c.code, description: c.description,
    })));
    put("policy_document",
      ["id", "payer_id", "external_id", "title", "url", "effective_date", "retrieved_at", "content_hash", "supersedes_id", "raw_storage_path"],
      d.documents.map((p) => ({
        id: p.id, payer_id: p.payerId, external_id: p.externalId, title: p.title, url: p.url,
        effective_date: p.effectiveDate, retrieved_at: p.retrievedAt, content_hash: p.contentHash,
        supersedes_id: p.supersedesId, raw_storage_path: p.rawStoragePath,
      })));
    put("document_span",
      ["id", "policy_document_id", "ordinal", "page_number", "char_start", "char_end", "text", "heading_path"],
      d.spans.map((s) => ({
        id: s.id, policy_document_id: s.policyDocumentId, ordinal: s.ordinal, page_number: s.pageNumber,
        char_start: s.charStart, char_end: s.charEnd, text: s.text, heading_path: JSON.stringify(s.headingPath),
      })));
    put("policy_code_link", ["policy_document_id", "code_id", "relationship"],
      d.codeLinks.map((l) => ({ policy_document_id: l.policyDocumentId, code_id: l.codeId, relationship: l.relationship })));
    put("criterion",
      ["id", "policy_document_id", "kind", "subject", "requirement_text", "operator", "value", "unit", "evidence", "span_id", "verbatim_quote", "confidence", "extracted_by_model", "extracted_at"],
      d.criteria.map((c) => ({
        id: c.id, policy_document_id: c.policyDocumentId, kind: c.kind, subject: c.subject,
        requirement_text: c.requirementText, operator: c.operator, value: c.value, unit: c.unit,
        evidence: JSON.stringify(c.evidence), span_id: c.spanId, verbatim_quote: c.verbatimQuote,
        confidence: c.confidence, extracted_by_model: c.extractedByModel, extracted_at: c.extractedAt,
      })));
    put("coverage_stance",
      ["id", "policy_document_id", "code_id", "stance", "span_id", "verbatim_quote"],
      d.stances.map((s) => ({
        id: s.id, policy_document_id: s.policyDocumentId, code_id: s.codeId, stance: s.stance,
        span_id: s.spanId, verbatim_quote: s.verbatimQuote,
      })));
    put("criterion_change",
      ["id", "from_criterion_id", "to_criterion_id", "policy_document_id", "change_type", "rationale"],
      d.changes.map((c) => ({
        id: c.id, from_criterion_id: c.fromCriterionId, to_criterion_id: c.toCriterionId,
        policy_document_id: c.policyDocumentId, change_type: c.changeType, rationale: c.rationale,
      })));

    rebuildFts(db);
  });
  tx(data);
}

/** Rebuild the FTS index from the mirror tables (spans + criteria). */
export function rebuildFts(db: LocalDatabase): void {
  db.exec("DELETE FROM corpus_fts");
  db.exec(`
    INSERT INTO corpus_fts (text, source_type, source_id, policy_document_id, payer_id, heading)
    SELECT s.text, 'span', s.id, s.policy_document_id, d.payer_id,
           json_extract(s.heading_path, '$[#-1]')
    FROM document_span s JOIN policy_document d ON d.id = s.policy_document_id
  `);
  db.exec(`
    INSERT INTO corpus_fts (text, source_type, source_id, policy_document_id, payer_id, heading)
    SELECT c.requirement_text, 'criterion', c.id, c.policy_document_id, d.payer_id, c.kind
    FROM criterion c JOIN policy_document d ON d.id = c.policy_document_id
  `);
}

// ── Search ────────────────────────────────────────────────────────────────────

export interface SearchHit {
  sourceType: "span" | "criterion";
  sourceId: string;
  policyDocumentId: string;
  payerId: string;
  heading: string | null;
  snippet: string;
  rank: number;
}

export interface SearchOptions {
  limit?: number;
  payerId?: string;
  sourceType?: "span" | "criterion";
}

/**
 * Turn a raw user query into a safe FTS5 MATCH expression. Terms are quoted
 * (so punctuation can't break the parser) and ANDed; a trailing `*` enables
 * prefix search on the last term.
 */
export function toFtsQuery(raw: string): string {
  const terms = raw.trim().split(/\s+/).filter(Boolean);
  if (terms.length === 0) return '""';
  return terms
    .map((t, i) => {
      const prefix = i === terms.length - 1 && t.endsWith("*");
      const bare = t.replace(/\*+$/, "").replace(/"/g, "");
      if (bare.length === 0) return "";
      return prefix ? `"${bare}"*` : `"${bare}"`;
    })
    .filter(Boolean)
    .join(" AND ");
}

/** Full-text search over the mirror. Ordered by bm25 relevance. */
export function searchCorpus(db: LocalDatabase, raw: string, opts: SearchOptions = {}): SearchHit[] {
  const match = toFtsQuery(raw);
  const where: string[] = ["corpus_fts MATCH @match"];
  const params: Record<string, unknown> = { match, limit: opts.limit ?? 50 };
  if (opts.payerId) { where.push("payer_id = @payerId"); params.payerId = opts.payerId; }
  if (opts.sourceType) { where.push("source_type = @sourceType"); params.sourceType = opts.sourceType; }
  const rows = db
    .prepare(
      `SELECT source_type AS sourceType, source_id AS sourceId,
              policy_document_id AS policyDocumentId, payer_id AS payerId, heading,
              snippet(corpus_fts, 0, '⟦', '⟧', '…', 12) AS snippet,
              bm25(corpus_fts) AS rank
       FROM corpus_fts
       WHERE ${where.join(" AND ")}
       ORDER BY rank
       LIMIT @limit`,
    )
    .all(params) as SearchHit[];
  return rows;
}

// ── A few typed readers the desktop UI needs ─────────────────────────────────

export function listPayers(db: LocalDatabase): Payer[] {
  return db.prepare("SELECT id, name, type, parent_payer_id AS parentPayerId FROM payer ORDER BY name").all() as Payer[];
}

export function getDocumentSpans(db: LocalDatabase, policyDocumentId: string): DocumentSpan[] {
  const rows = db
    .prepare(
      `SELECT id, policy_document_id AS policyDocumentId, ordinal, page_number AS pageNumber,
              char_start AS charStart, char_end AS charEnd, text, heading_path AS headingPath
       FROM document_span WHERE policy_document_id = ? ORDER BY ordinal`,
    )
    .all(policyDocumentId) as Array<Omit<DocumentSpan, "headingPath"> & { headingPath: string }>;
  return rows.map((r) => ({ ...r, headingPath: JSON.parse(r.headingPath) as string[] }));
}

export function getCriteriaForDocument(db: LocalDatabase, policyDocumentId: string): Criterion[] {
  const rows = db
    .prepare(
      `SELECT id, policy_document_id AS policyDocumentId, kind, subject,
              requirement_text AS requirementText, operator, value, unit, evidence,
              span_id AS spanId, verbatim_quote AS verbatimQuote, confidence,
              extracted_by_model AS extractedByModel, extracted_at AS extractedAt
       FROM criterion WHERE policy_document_id = ? ORDER BY span_id`,
    )
    .all(policyDocumentId) as Array<Omit<Criterion, "evidence"> & { evidence: string }>;
  return rows.map((r) => ({ ...r, evidence: JSON.parse(r.evidence) }));
}

export function countCorpus(db: LocalDatabase): { documents: number; spans: number; criteria: number } {
  const one = (sql: string) => (db.prepare(sql).get() as { n: number }).n;
  return {
    documents: one("SELECT count(*) AS n FROM policy_document"),
    spans: one("SELECT count(*) AS n FROM document_span"),
    criteria: one("SELECT count(*) AS n FROM criterion"),
  };
}
