/**
 * Assembling everything the denial detail view needs.
 *
 * One place, one query set, because the detail view is three panes that must
 * agree with each other: the case metadata, the letter, and the source panel.
 * If the letter and the sources came from separate loads they could disagree
 * across a regeneration, and the one thing this view must never do is show a
 * sentence next to a source that is not the one it was verified against.
 */
import { and, desc, eq } from 'drizzle-orm';
import { db } from '@/lib/db';
import {
  appealDraft,
  assertion,
  auditLog,
  clinicalFact,
  denial,
  denialDocument,
  denialSpan,
  holding,
  outcome,
  reviewAction,
  sourceDocument,
  sourceSpan,
} from '@/lib/db/schema';
import { verifyQuote } from '@/lib/appeals/verify';

/** A source as the source panel shows it: the whole passage plus the quoted part. */
export interface ResolvedSource {
  kind: 'holding' | 'source_span' | 'clinical_fact';
  id: string;
  /** "DAB No. 3145" or "Nursing note, page 4". */
  label: string;
  /** Where it came from, for the citation appendix. */
  detail: string;
  url: string | null;
  /** The full passage, so the quote can be read in context. */
  passage: string;
  /** Offsets of the quoted characters inside `passage`, for the highlight. */
  highlightStart: number;
  highlightEnd: number;
  page: number | null;
  /**
   * Whether this passage was recognised from a scan rather than read from the
   * file. When true the verification behind the quote is weaker than it looks:
   * the quote was checked against this text, and this text is a reading of an
   * image, so only a person comparing it to the scan closes the loop.
   */
  fromOcr?: boolean;
  ocrConfidence?: number | null;
}

export interface DetailAssertion {
  id: string;
  ordinal: number;
  section: string;
  kind: 'legal' | 'clinical';
  text: string;
  sourceKind: 'holding' | 'source_span' | 'clinical_fact';
  sourceId: string;
  verbatimQuote: string;
  editedAt: Date | null;
}

export interface DenialDetail {
  denial: typeof denial.$inferSelect;
  documents: (typeof denialDocument.$inferSelect)[];
  draft: typeof appealDraft.$inferSelect | null;
  draftHistory: { id: string; version: number; generatedAt: Date; status: string }[];
  assertions: DetailAssertion[];
  sources: Record<string, ResolvedSource>;
  reviews: (typeof reviewAction.$inferSelect)[];
  outcome: typeof outcome.$inferSelect | null;
  timeline: (typeof auditLog.$inferSelect)[];
}

function sourceKey(kind: string, id: string): string {
  return `${kind}:${id}`;
}

/**
 * Resolve one assertion's source into something the panel can show.
 *
 * The highlight offsets are recomputed here rather than stored, deliberately.
 * The quote was verified against this passage at generation time, so it is
 * there; recomputing means the highlight is derived from the same comparison
 * the invariant rests on, and a passage that has somehow changed shows no
 * highlight rather than the wrong one.
 */
function highlightFor(passage: string, quote: string): { start: number; end: number } {
  const result = verifyQuote(quote, passage);
  return result.ok
    ? { start: result.charStart, end: result.charEnd }
    : { start: 0, end: 0 };
}

export async function loadDenialDetail(denialId: string): Promise<DenialDetail | null> {
  const record = await db.query.denial.findFirst({ where: eq(denial.id, denialId) });
  if (!record) return null;

  const [documents, drafts, timeline, recordedOutcome] = await Promise.all([
    db.select().from(denialDocument).where(eq(denialDocument.denialId, denialId)),
    db
      .select()
      .from(appealDraft)
      .where(eq(appealDraft.denialId, denialId))
      .orderBy(desc(appealDraft.version)),
    db
      .select()
      .from(auditLog)
      .where(and(eq(auditLog.entityType, 'denial'), eq(auditLog.entityId, denialId)))
      .orderBy(desc(auditLog.createdAt))
      .limit(50),
    db.query.outcome.findFirst({ where: eq(outcome.denialId, denialId) }),
  ]);

  const current = drafts.find((d) => d.status === 'ready') ?? drafts[0] ?? null;

  if (!current) {
    return {
      denial: record,
      documents,
      draft: null,
      draftHistory: drafts.map((d) => ({
        id: d.id,
        version: d.version,
        generatedAt: d.generatedAt,
        status: d.status,
      })),
      assertions: [],
      sources: {},
      reviews: [],
      outcome: recordedOutcome ?? null,
      timeline,
    };
  }

  const [rows, reviews] = await Promise.all([
    db
      .select()
      .from(assertion)
      .where(eq(assertion.appealDraftId, current.id))
      .orderBy(assertion.ordinal),
    db
      .select()
      .from(reviewAction)
      .where(eq(reviewAction.appealDraftId, current.id))
      .orderBy(desc(reviewAction.createdAt)),
  ]);

  const assertions: DetailAssertion[] = rows.map((r) => ({
    id: r.id,
    ordinal: r.ordinal,
    section: r.section,
    kind: r.kind,
    text: r.text,
    sourceKind: r.sourceKind,
    sourceId: r.sourceId,
    verbatimQuote: r.verbatimQuote,
    editedAt: r.editedAt,
  }));

  const sources: Record<string, ResolvedSource> = {};

  for (const a of assertions) {
    const key = sourceKey(a.sourceKind, a.sourceId);
    if (sources[key]) continue;

    if (a.sourceKind === 'holding') {
      const [row] = await db
        .select({
          citation: sourceDocument.citation,
          title: sourceDocument.title,
          url: sourceDocument.url,
          issue: holding.issue,
          ruleApplied: holding.ruleApplied,
          passage: sourceSpan.text,
          page: sourceSpan.page,
        })
        .from(holding)
        .innerJoin(sourceDocument, eq(holding.sourceDocumentId, sourceDocument.id))
        .innerJoin(sourceSpan, eq(holding.spanId, sourceSpan.id))
        .where(eq(holding.id, a.sourceId))
        .limit(1);

      if (row) {
        const h = highlightFor(row.passage, a.verbatimQuote);
        sources[key] = {
          kind: 'holding',
          id: a.sourceId,
          label: row.citation,
          detail: row.title,
          url: row.url,
          passage: row.passage,
          highlightStart: h.start,
          highlightEnd: h.end,
          page: row.page,
        };
      }
      continue;
    }

    if (a.sourceKind === 'source_span') {
      const [row] = await db
        .select({
          citation: sourceDocument.citation,
          title: sourceDocument.title,
          url: sourceDocument.url,
          passage: sourceSpan.text,
          page: sourceSpan.page,
          headingPath: sourceSpan.headingPath,
        })
        .from(sourceSpan)
        .innerJoin(sourceDocument, eq(sourceSpan.sourceDocumentId, sourceDocument.id))
        .where(eq(sourceSpan.id, a.sourceId))
        .limit(1);

      if (row) {
        const h = highlightFor(row.passage, a.verbatimQuote);
        sources[key] = {
          kind: 'source_span',
          id: a.sourceId,
          label: row.citation,
          detail:
            row.headingPath.length > 0 ? row.headingPath.join(' > ') : row.title,
          url: row.url,
          passage: row.passage,
          highlightStart: h.start,
          highlightEnd: h.end,
          page: row.page,
        };
      }
      continue;
    }

    const [row] = await db
      .select({
        passage: denialSpan.text,
        page: denialSpan.page,
        factType: clinicalFact.factType,
        filename: denialDocument.filename,
        textSource: denialDocument.textSource,
        ocrConfidence: denialDocument.ocrConfidence,
      })
      .from(clinicalFact)
      .innerJoin(denialSpan, eq(clinicalFact.spanId, denialSpan.id))
      .innerJoin(denialDocument, eq(denialSpan.denialDocumentId, denialDocument.id))
      .where(eq(clinicalFact.id, a.sourceId))
      .limit(1);

    if (row) {
      const h = highlightFor(row.passage, a.verbatimQuote);
      sources[key] = {
        kind: 'clinical_fact',
        id: a.sourceId,
        label: row.filename,
        detail: `${row.factType.replace(/_/g, ' ')}${row.page ? `, page ${row.page}` : ''}`,
        url: null,
        passage: row.passage,
        highlightStart: h.start,
        highlightEnd: h.end,
        page: row.page,
        // Carried to the reviewer because the passage above is a machine's
        // reading of an image. Verification compared the quote against this
        // text, and this text is itself the thing that might be wrong.
        fromOcr: row.textSource === 'ocr',
        ocrConfidence: row.ocrConfidence,
      };
    }
  }

  return {
    denial: record,
    documents,
    draft: current,
    draftHistory: drafts.map((d) => ({
      id: d.id,
      version: d.version,
      generatedAt: d.generatedAt,
      status: d.status,
    })),
    assertions,
    sources,
    reviews,
    outcome: recordedOutcome ?? null,
    timeline,
  };
}

export { sourceKey };
