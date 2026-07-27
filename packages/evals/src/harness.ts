import { readFileSync } from "node:fs";
import { join } from "node:path";
import { parseHtmlToSpans } from "@assent/parse";
import { loadFixtureRawDocuments } from "@assent/ingest";
import {
  extractDocument,
  diffVersions,
  loadGoldenExtractions,
  makePolicyDocId,
  makeSpanId,
  findFixturesDir,
  type GoldenSpanEntry,
} from "@assent/extract";
import type { DocumentSpan } from "@assent/core";
import { scoreExtraction, scoreDiff, type ScoredCriterion, type ExtractionMetrics, type DiffMetrics } from "./score";

process.env.PIPELINE_MODE ??= "fixture";

interface BuiltDoc {
  source: string;
  externalId: string;
  version: number;
  spans: DocumentSpan[];
}

function buildDoc(source: string, externalId: string, version: number): BuiltDoc {
  const raw = loadFixtureRawDocuments(source).find((d) => d.externalId === externalId && d.version === version);
  if (!raw) throw new Error(`fixture not found: ${source} ${externalId} v${version}`);
  const html = new TextDecoder().decode(raw.bytes);
  const parsed = parseHtmlToSpans(html);
  const docId = makePolicyDocId(source, externalId, version);
  const spans: DocumentSpan[] = parsed.spans.map((s) => ({
    id: makeSpanId(docId, s.ordinal),
    policyDocumentId: docId,
    ordinal: s.ordinal,
    pageNumber: s.pageNumber,
    charStart: s.charStart,
    charEnd: s.charEnd,
    text: s.text,
    headingPath: s.headingPath,
  }));
  return { source, externalId, version, spans };
}

const docCtx = (d: BuiltDoc) => ({
  source: d.source,
  externalId: d.externalId,
  version: d.version,
  documentTitle: `${d.source} ${d.externalId}`,
  model: "fixture",
  resolveCode: (c: string) => `CODE:${c}`,
});

export interface ExtractionEvalResult extends ExtractionMetrics {
  spansExamined: number;
  rejectionRate: number;
  stanceCount: number;
  docs: number;
}

export async function runExtractionEval(): Promise<ExtractionEvalResult> {
  const golden = loadGoldenExtractions();
  const docKeys = new Map<string, { source: string; externalId: string; version: number }>();
  for (const g of golden) docKeys.set(`${g.source}|${g.externalId}|${g.version}`, g);

  const predicted: ScoredCriterion[] = [];
  const gold: ScoredCriterion[] = [];
  let spansExamined = 0;
  let rejectionTotal = 0;
  let claimTotal = 0;
  let stanceCount = 0;

  for (const key of docKeys.values()) {
    const doc = buildDoc(key.source, key.externalId, key.version);
    const spanById = new Map(doc.spans.map((s) => [s.id, s]));
    const result = await extractDocument(doc.spans, docCtx(doc));
    spansExamined += doc.spans.length;
    stanceCount += result.stances.length;
    rejectionTotal += result.rejections.length;
    claimTotal += result.criteria.length + result.stances.length + result.rejections.length;

    for (const c of result.criteria) {
      predicted.push({ spanId: c.spanId, spanText: spanById.get(c.spanId)!.text, kind: c.kind, verbatimQuote: c.verbatimQuote });
    }
    // Gold from the labeled entries for this doc.
    const docId = makePolicyDocId(key.source, key.externalId, key.version);
    for (const entry of golden.filter((g) => g.source === key.source && g.externalId === key.externalId && g.version === key.version)) {
      const spanId = makeSpanId(docId, entry.ordinal);
      const span = spanById.get(spanId);
      if (!span) continue;
      for (const c of (entry as GoldenSpanEntry).criteria) {
        gold.push({ spanId, spanText: span.text, kind: c.kind, verbatimQuote: c.verbatimQuote });
      }
    }
  }

  const metrics = scoreExtraction(predicted, gold);
  return {
    ...metrics,
    spansExamined,
    stanceCount,
    docs: docKeys.size,
    rejectionRate: claimTotal === 0 ? 0 : rejectionTotal / claimTotal,
  };
}

export interface DiffEvalResult extends DiffMetrics {
  added: number;
  removed: number;
}

export async function runDiffEval(): Promise<DiffEvalResult> {
  const v1 = buildDoc("moldx", "L38045", 1);
  const v2 = buildDoc("moldx", "L38045", 2);
  const r1 = await extractDocument(v1.spans, docCtx(v1));
  const r2 = await extractDocument(v2.spans, docCtx(v2));
  const changes = await diffVersions(r1.criteria, r2.criteria, makePolicyDocId("moldx", "L38045", 2), "fixture");

  const critById = new Map([...r1.criteria, ...r2.criteria].map((c) => [c.id, c]));
  const predicted = changes
    .filter((c) => c.changeType === "tightened" || c.changeType === "loosened" || c.changeType === "clarified")
    .map((c) => ({ key: critById.get(c.toCriterionId!)!.kind, changeType: c.changeType }));

  // Gold diff keyed by kind (see fixtures/golden/diff.json).
  const goldRaw = loadGoldenDiff();
  const metrics = scoreDiff(predicted, goldRaw.map((g) => ({ key: g.kind, changeType: g.changeType })));
  return {
    ...metrics,
    added: changes.filter((c) => c.changeType === "added").length,
    removed: changes.filter((c) => c.changeType === "removed").length,
  };
}

function loadGoldenDiff(): Array<{ kind: string; changeType: string }> {
  return JSON.parse(readFileSync(join(findFixturesDir(), "golden", "diff.json"), "utf8"));
}
