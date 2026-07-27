import { and, eq, inArray, sql } from "drizzle-orm";
import { createDb, schema } from "@assent/db";
import {
  loadPayers,
  loadCodes,
  loadCoveredLives,
  type RawDocument,
} from "@assent/ingest";
import { makeSpanId } from "@assent/extract";
import type { ParsedSpan } from "@assent/parse";
import type {
  Criterion,
  CoverageStanceRecord,
  RejectedExtraction,
  LlmCall,
  CriterionChange,
  DocumentSpan,
  Payer,
  Code,
  CoveredLives,
  PolicyDocument,
  PolicyCodeLink,
} from "@assent/core";

export type Store = ReturnType<typeof createDb>;

export function openStore(): Store {
  return createDb();
}

/** Seed reference data (payers, codes, covered lives) idempotently from fixtures. */
export async function seedReference(store: Store): Promise<void> {
  const { db } = store;
  const payers = loadPayers();
  const codes = loadCodes();
  const lives = loadCoveredLives();

  if (payers.length)
    await db.insert(schema.payer).values(payers.map((p) => ({ id: p.id, name: p.name, type: p.type, parentPayerId: p.parentPayerId })))
      .onConflictDoNothing();
  if (codes.length)
    await db.insert(schema.code).values(codes).onConflictDoNothing();
  if (lives.length)
    await db.insert(schema.coveredLives).values(lives.map((l, i) => ({
      id: `${l.payerId}-${l.year}-${i}`, payerId: l.payerId, year: l.year, segment: l.segment,
      livesCount: l.livesCount, sourceUrl: l.sourceUrl, sourceNote: l.sourceNote,
    }))).onConflictDoNothing();
}

export async function codeIdMap(store: Store): Promise<Map<string, string>> {
  const rows = await store.db.select().from(schema.code);
  return new Map(rows.map((r) => [r.code, r.id]));
}

/**
 * Upsert a policy document version. Idempotent: the id is deterministic per
 * (source, externalId, version); if the same bytes already exist we record
 * "seen, unchanged" and do not create a duplicate (PROMPT §6 Ingest).
 */
export async function upsertPolicyDocument(
  store: Store,
  raw: RawDocument,
  docId: string,
  supersedesId: string | null,
): Promise<{ id: string; inserted: boolean }> {
  const { db } = store;
  const existing = await db.select({ id: schema.policyDocument.id, hash: schema.policyDocument.contentHash })
    .from(schema.policyDocument).where(eq(schema.policyDocument.id, docId)).limit(1);
  if (existing.length && existing[0]!.hash === raw.contentHash) return { id: docId, inserted: false };

  await db.insert(schema.policyDocument).values({
    id: docId, payerId: raw.payerId, externalId: raw.externalId, title: raw.title, url: raw.url,
    effectiveDate: raw.effectiveDate, retrievedAt: new Date(), contentHash: raw.contentHash,
    supersedesId, rawStoragePath: raw.rawStoragePath,
  }).onConflictDoNothing();

  // Resolve + link codes.
  const codes = await codeIdMap(store);
  const links = raw.codes.map((c) => ({ policyDocumentId: docId, codeId: codes.get(c.code), relationship: c.relationship }))
    .filter((l): l is PolicyCodeLink & { codeId: string } => Boolean(l.codeId));
  if (links.length) await db.insert(schema.policyCodeLink).values(links).onConflictDoNothing();

  return { id: docId, inserted: true };
}

export async function insertSpans(store: Store, docId: string, spans: ParsedSpan[]): Promise<void> {
  if (!spans.length) return;
  await store.db.insert(schema.documentSpan).values(spans.map((s) => ({
    id: makeSpanId(docId, s.ordinal), policyDocumentId: docId, ordinal: s.ordinal, pageNumber: s.pageNumber,
    charStart: s.charStart, charEnd: s.charEnd, text: s.text, headingPath: s.headingPath, embedding: null,
  }))).onConflictDoNothing();
}

export async function docIdsWithSpans(store: Store): Promise<Set<string>> {
  const rows = await store.db.selectDistinct({ id: schema.documentSpan.policyDocumentId }).from(schema.documentSpan);
  return new Set(rows.map((r) => r.id));
}
export async function docIdsWithCriteria(store: Store): Promise<Set<string>> {
  const rows = await store.db.selectDistinct({ id: schema.criterion.policyDocumentId }).from(schema.criterion);
  return new Set(rows.map((r) => r.id));
}

export async function getSpans(store: Store, docId: string): Promise<DocumentSpan[]> {
  const rows = await store.db.select().from(schema.documentSpan)
    .where(eq(schema.documentSpan.policyDocumentId, docId)).orderBy(schema.documentSpan.ordinal);
  return rows.map((r) => ({
    id: r.id, policyDocumentId: r.policyDocumentId, ordinal: r.ordinal, pageNumber: r.pageNumber,
    charStart: r.charStart, charEnd: r.charEnd, text: r.text, headingPath: r.headingPath,
  }));
}

export async function insertExtraction(store: Store, x: {
  criteria: Criterion[]; stances: CoverageStanceRecord[]; rejections: RejectedExtraction[]; llmCalls: LlmCall[];
}): Promise<void> {
  const { db } = store;
  if (x.criteria.length) await db.insert(schema.criterion).values(x.criteria.map((c) => ({
    id: c.id, policyDocumentId: c.policyDocumentId, kind: c.kind, subject: c.subject, requirementText: c.requirementText,
    operator: c.operator, value: c.value, unit: c.unit, evidence: c.evidence, spanId: c.spanId,
    verbatimQuote: c.verbatimQuote, confidence: c.confidence, embedding: null,
    extractedByModel: c.extractedByModel, extractedAt: new Date(c.extractedAt),
  }))).onConflictDoNothing();
  if (x.stances.length) await db.insert(schema.coverageStance).values(x.stances.map((s) => ({
    id: s.id, policyDocumentId: s.policyDocumentId, codeId: s.codeId, stance: s.stance, spanId: s.spanId,
    verbatimQuote: s.verbatimQuote,
  }))).onConflictDoNothing();
  if (x.rejections.length) await db.insert(schema.rejectedExtraction).values(x.rejections.map((r) => ({
    id: r.id, spanId: r.spanId, rawModelOutput: r.rawModelOutput, rejectionReason: r.rejectionReason,
    createdAt: new Date(r.createdAt),
  }))).onConflictDoNothing();
  if (x.llmCalls.length) await db.insert(schema.llmCall).values(x.llmCalls).onConflictDoNothing();
}

export async function getCriteria(store: Store, docId: string): Promise<Criterion[]> {
  const rows = await store.db.select().from(schema.criterion).where(eq(schema.criterion.policyDocumentId, docId));
  return rows.map((r) => ({
    id: r.id, policyDocumentId: r.policyDocumentId, kind: r.kind, subject: r.subject, requirementText: r.requirementText,
    operator: r.operator, value: r.value, unit: r.unit, evidence: r.evidence, spanId: r.spanId,
    verbatimQuote: r.verbatimQuote, confidence: r.confidence, extractedByModel: r.extractedByModel,
    extractedAt: r.extractedAt.toISOString(),
  }));
}

export async function insertChanges(store: Store, changes: CriterionChange[]): Promise<void> {
  if (!changes.length) return;
  await store.db.insert(schema.criterionChange).values(changes.map((c) => ({
    id: c.id, fromCriterionId: c.fromCriterionId, toCriterionId: c.toCriterionId,
    policyDocumentId: c.policyDocumentId, changeType: c.changeType, rationale: c.rationale,
  }))).onConflictDoNothing();
}

/** Read the whole corpus for the desktop SQLite export. */
export async function exportCorpus(store: Store) {
  const { db } = store;
  const [payers, coveredLivesRows, codes, docs, spans, criteria, stances, changes, links] = await Promise.all([
    db.select().from(schema.payer),
    db.select().from(schema.coveredLives),
    db.select().from(schema.code),
    db.select().from(schema.policyDocument),
    db.select().from(schema.documentSpan),
    db.select().from(schema.criterion),
    db.select().from(schema.coverageStance),
    db.select().from(schema.criterionChange),
    db.select().from(schema.policyCodeLink),
  ]);
  return {
    payers: payers as Payer[],
    coveredLives: coveredLivesRows.map((l) => ({
      payerId: l.payerId, year: l.year, segment: l.segment, livesCount: l.livesCount,
      sourceUrl: l.sourceUrl, sourceNote: l.sourceNote,
    })) as CoveredLives[],
    codes: codes as Code[],
    documents: docs.map((d) => ({
      id: d.id, payerId: d.payerId, externalId: d.externalId, title: d.title, url: d.url,
      effectiveDate: d.effectiveDate, retrievedAt: d.retrievedAt.toISOString(), contentHash: d.contentHash,
      supersedesId: d.supersedesId, rawStoragePath: d.rawStoragePath,
    })) as PolicyDocument[],
    spans: spans.map((s) => ({
      id: s.id, policyDocumentId: s.policyDocumentId, ordinal: s.ordinal, pageNumber: s.pageNumber,
      charStart: s.charStart, charEnd: s.charEnd, text: s.text, headingPath: s.headingPath,
    })) as DocumentSpan[],
    criteria: criteria.map((c) => ({
      id: c.id, policyDocumentId: c.policyDocumentId, kind: c.kind, subject: c.subject, requirementText: c.requirementText,
      operator: c.operator, value: c.value, unit: c.unit, evidence: c.evidence, spanId: c.spanId,
      verbatimQuote: c.verbatimQuote, confidence: c.confidence, extractedByModel: c.extractedByModel,
      extractedAt: c.extractedAt.toISOString(),
    })) as Criterion[],
    stances: stances as CoverageStanceRecord[],
    changes: changes as CriterionChange[],
    codeLinks: links as PolicyCodeLink[],
  };
}
