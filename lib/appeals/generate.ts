/**
 * Generating an appeal, end to end.
 *
 * Classify, extract facts, retrieve authority, check for gaps, draft, verify,
 * and on failure regenerate. The order is not arbitrary: gaps are found before
 * drafting so the model is told which criteria it must not claim, which is
 * cheaper and more honest than catching an unsupported claim afterwards.
 *
 * The verification step is unconditional and its result is binary. A draft in
 * which any assertion fails is discarded whole. Nothing is repaired: a quote
 * that does not appear in its source is not a formatting problem, it is a
 * fabrication, and a fabrication that gets corrected into something plausible
 * is worse than one that gets thrown away.
 */
import { and, eq, sql } from 'drizzle-orm';
import { db } from '@/lib/db';
import {
  appealDraft,
  assertion as assertionTable,
  clinicalFact,
  denial,
  denialDocument,
  denialSpan,
  holding,
  sourceSpan,
} from '@/lib/db/schema';
import { log } from '@/lib/log';
import { modelName } from '@/lib/llm/client';
import { retrieveAuthority, retrieveControllingAuthority } from '@/lib/corpus/retrieve';
import { formatCents } from '@/components/ui/primitives';
import { assertion, sourceKindMatches, type Section } from './assertion';
import { classifyDenial } from './classify';
import { extractClinicalFacts, findGaps, type DocumentationGap } from './facts';
import { buildDraftPrompt, draftAppeal, type DraftContext } from './draft';
import { verifyDraft, type AssertionCandidate } from './verify';

/** How many times a failing draft is regenerated before a human is told. */
export const MAX_GENERATION_ATTEMPTS = 3;

/**
 * Raised when the corpus holds nothing that governs this denial.
 *
 * Separate from GenerationError because the remedy is different and the
 * operator needs to know which one they are looking at. A GenerationError means
 * the model kept writing quotes that were not in the source. This means the
 * model was never given anything to cite, which is a corpus problem: run the
 * ingestion, then regenerate.
 */
export class NoAuthorityError extends Error {
  constructor(
    readonly serviceType: string,
    readonly denialBasis: string,
  ) {
    super(
      `No regulation, manual section, or decision was found covering a ${serviceType.replace(
        /_/g,
        ' ',
      )} denial on ${denialBasis.replace(/_/g, ' ')} grounds, so there is nothing to ` +
        'argue from. A letter built only on the patient record restates what the payer ' +
        'already has and wins nothing, so none was written. Ingest the corpus and generate ' +
        'again.',
    );
    this.name = 'NoAuthorityError';
  }
}

export class GenerationError extends Error {
  constructor(
    message: string,
    readonly attempts: number,
    readonly lastFailures: string[],
  ) {
    super(message);
    this.name = 'GenerationError';
  }
}

export interface GenerationResult {
  draftId: string;
  version: number;
  assertionCount: number;
  gaps: DocumentationGap[];
  proprietaryCriteriaDetected: boolean;
  attempts: number;
}

/**
 * The criteria a denial is measured against.
 *
 * Taken from the payer's own letter where it names them, because arguing
 * against criteria the payer did not apply is arguing with yourself. Where the
 * letter names none, the statutory criteria for the service type are used.
 */
const STATUTORY_CRITERIA: Record<string, string[]> = {
  skilled_nursing: [
    'The beneficiary required skilled nursing or skilled rehabilitation services on a daily basis',
    'The services required the skills of qualified technical or professional personnel',
    'The services were furnished pursuant to a physician order',
    'As a practical matter, the services could only be provided on an inpatient basis',
    'The services were reasonable and necessary for the treatment of the illness or injury',
  ],
  inpatient_rehab: [
    'The beneficiary required active and ongoing intensive rehabilitation therapy',
    'The beneficiary was able to participate in and benefit from intensive therapy',
    'The beneficiary required physician supervision by a rehabilitation physician',
    'The beneficiary required an intensive and coordinated interdisciplinary team approach',
    'The services were reasonable and necessary',
  ],
};

function criteriaFor(serviceType: string, citedByPayer: readonly string[]): string[] {
  if (citedByPayer.length > 0) return [...citedByPayer];
  return STATUTORY_CRITERIA[serviceType] ?? STATUTORY_CRITERIA.skilled_nursing!;
}

/**
 * Generate a draft for a denial.
 *
 * Assumes the denial's documents have been parsed into spans. Returns the new
 * draft, or throws GenerationError after MAX_GENERATION_ATTEMPTS, which the
 * caller surfaces to the operator console.
 */
export async function generateAppeal(denialId: string): Promise<GenerationResult> {
  const record = await db.query.denial.findFirst({ where: eq(denial.id, denialId) });
  if (!record) throw new Error('That denial does not exist.');

  // In synthetic mode a denial is required to be tagged synthetic at upload,
  // so this is always false there. In live mode it is always true, and the LLM
  // boundary checks the BAA before anything is transmitted.
  const containsPhi = !record.isSynthetic;

  /* 1. Classify the denial letter. */

  const letterSpans = await spansForKind(denialId, 'denial_letter');
  if (letterSpans.length === 0) {
    throw new Error(
      'This denial has no parsed denial letter. Upload one and let parsing finish first.',
    );
  }

  const classification = await classifyDenial(
    record.payerName,
    letterSpans.map((s) => ({ ordinal: s.ordinal, text: s.text })),
    { containsPhi, denialId },
  );

  const serviceType = classification.value.serviceType ?? record.serviceType;
  const criteria = criteriaFor(serviceType, classification.value.criteriaCited);

  // Record what the classification found on the denial itself, so the case
  // metadata reflects what the letter says rather than what was typed at intake.
  await db
    .update(denial)
    .set({
      denialBasis: classification.value.denialBasis,
      denialBasisText: classification.value.statedReason,
      updatedAt: new Date(),
    })
    .where(eq(denial.id, denialId));

  /* 2. Extract clinical facts from the record. */

  const recordSpans = await spansForKind(denialId, 'clinical_record');
  const facts =
    recordSpans.length === 0
      ? { value: { facts: [] } }
      : await extractClinicalFacts(
          criteria,
          recordSpans.map((s) => ({ ordinal: s.ordinal, text: s.text })),
          { containsPhi, denialId },
        );

  const spanByOrdinal = new Map(recordSpans.map((s) => [s.ordinal, s]));

  // Store the facts, keeping only those whose quote is genuinely in the span
  // they cite. Same rule as everywhere else: an unverifiable quote is dropped.
  await db.delete(clinicalFact).where(eq(clinicalFact.denialId, denialId));

  const storedFacts: {
    id: string;
    factType: string;
    supportsCriterion: string | null;
    text: string;
  }[] = [];

  for (const fact of facts.value.facts) {
    const span = spanByOrdinal.get(fact.spanOrdinal);
    if (!span) continue;
    const check = verifyDraft(
      [
        {
          ordinal: 1,
          kind: 'clinical',
          section: 'application',
          text: fact.normalizedValue,
          sourceKind: 'clinical_fact',
          sourceId: 'x',
          verbatimQuote: fact.verbatimQuote,
        },
      ],
      () => span.text,
    );
    if (!check.ok) {
      log.warn('clinical fact discarded: the quote is not in the span it cites', {
        denialId,
        factType: fact.factType,
      });
      continue;
    }

    const [row] = await db
      .insert(clinicalFact)
      .values({
        denialId,
        spanId: span.id,
        verbatimQuote: fact.verbatimQuote,
        factType: fact.factType,
        normalizedValue: fact.normalizedValue,
      })
      .returning({ id: clinicalFact.id });

    storedFacts.push({
      id: row!.id,
      factType: fact.factType,
      supportsCriterion: fact.supportsCriterion,
      text: fact.verbatimQuote,
    });
  }

  /* 3. Gap check, before drafting. */

  const gaps = findGaps(
    criteria,
    facts.value.facts.map((f) => ({ supportsCriterion: f.supportsCriterion })),
  );

  /* 4. Retrieve authority. */

  const retrieved = await retrieveAuthority({
    serviceType,
    payerType: record.planType,
    denialBasis: classification.value.denialBasis,
    text: `${classification.value.statedReason} ${classification.value.verbatimQuote}`,
  });

  const regulations = await retrieveControllingAuthority(serviceType, [
    ...criteria,
    'skilled',
    'daily basis',
    'more restrictive',
    'coverage criteria',
  ]);

  // Nothing to argue from. Drafting anyway produces a letter of clinical
  // assertions with no law behind them, and because every quote in it is real
  // it passes verification cleanly. That is the dangerous case: the invariant
  // says the letter is sound, and the letter is merely a summary of the chart
  // sent to the payer who already read the chart. Refuse instead.
  if (retrieved.length === 0 && regulations.length === 0) {
    throw new NoAuthorityError(serviceType, classification.value.denialBasis);
  }

  /* 5, 6, 7. Draft and verify, regenerating on failure. */

  const context: DraftContext = {
    payerName: record.payerName,
    claimReference: record.internalRef,
    serviceType,
    serviceDates: formatDateRange(record.serviceDateFrom, record.serviceDateTo),
    claimAmount: formatCents(record.claimAmountCents),
    denialBasis: classification.value.denialBasis,
    denialQuote: classification.value.verbatimQuote,
    proprietaryCriteria: {
      detected: classification.value.proprietaryCriteria.detected,
      name: classification.value.proprietaryCriteria.criteriaName,
      quote: classification.value.proprietaryCriteria.verbatimQuote,
    },
    holdings: retrieved.map((h) => ({
      id: h.holdingId,
      citation: h.citation,
      issue: h.issue,
      ruleApplied: h.ruleApplied,
      outcome: h.outcome,
      text: h.spanText,
    })),
    regulations: regulations.map((r) => ({
      id: r.spanId,
      citation: r.citation,
      headingPath: r.headingPath,
      text: r.text,
    })),
    facts: storedFacts,
    criteria,
    gaps,
  };

  // Sources are resolved from the rows we just retrieved rather than by a fresh
  // query, so verification checks the exact text the model was shown.
  const sourceText = new Map<string, string>();
  for (const h of retrieved) sourceText.set(`holding:${h.holdingId}`, h.spanText);
  for (const r of regulations) sourceText.set(`source_span:${r.spanId}`, r.text);
  for (const f of storedFacts) sourceText.set(`clinical_fact:${f.id}`, f.text);

  const resolve = (kind: AssertionCandidate['sourceKind'], id: string) =>
    sourceText.get(`${kind}:${id}`) ?? null;

  const failures: string[] = [];

  for (let attempt = 1; attempt <= MAX_GENERATION_ATTEMPTS; attempt += 1) {
    const drafted = await draftAppeal(context, { containsPhi, denialId });

    const candidates: AssertionCandidate[] = [];
    let ordinal = 0;

    for (const raw of drafted.value.assertions) {
      ordinal += 1;
      // Constructing through assertion() means a draft that somehow arrived
      // without a source or a quote throws here rather than reaching the letter.
      const built = assertion({
        ordinal,
        section: raw.section as Section,
        kind: raw.kind,
        text: raw.text,
        sourceKind: raw.sourceKind,
        sourceId: raw.sourceId,
        verbatimQuote: raw.verbatimQuote,
      });

      if (!sourceKindMatches(built)) {
        // A clinical claim citing a published decision would pass the quote
        // check while citing entirely the wrong kind of document.
        failures.push(
          `assertion ${ordinal}: a ${built.kind} assertion cannot cite a ${built.sourceKind}`,
        );
        continue;
      }

      candidates.push({ ...built });
    }

    const verification = verifyDraft(candidates, resolve);

    if (verification.ok && candidates.length === drafted.value.assertions.length) {
      const version = await nextVersion(denialId);

      const [draftRow] = await db
        .insert(appealDraft)
        .values({
          denialId,
          version,
          bodyJson: JSON.stringify({
            sections: groupBySection(verification.verified),
          }),
          status: 'ready',
          documentationGaps: gaps,
          proprietaryCriteriaFlag: classification.value.proprietaryCriteria.detected,
          verificationFailures: attempt - 1,
          generatedByModel: modelName(),
        })
        .returning({ id: appealDraft.id });

      const draftId = draftRow!.id;

      await db.insert(assertionTable).values(
        verification.verified.map((a) => ({
          appealDraftId: draftId,
          ordinal: a.ordinal,
          section: a.section,
          kind: a.kind,
          text: a.text,
          sourceKind: a.sourceKind,
          sourceId: a.sourceId,
          verbatimQuote: a.verbatimQuote,
        })),
      );

      // Supersede earlier drafts so only one is current.
      await db
        .update(appealDraft)
        .set({ status: 'superseded' })
        .where(
          and(
            eq(appealDraft.denialId, denialId),
            sql`${appealDraft.id} <> ${draftId}`,
            sql`${appealDraft.status} <> 'superseded'`,
          ),
        );

      await db
        .update(denial)
        .set({ status: 'clinical_review', updatedAt: new Date() })
        .where(eq(denial.id, denialId));

      return {
        draftId,
        version,
        assertionCount: verification.verified.length,
        gaps,
        proprietaryCriteriaDetected: classification.value.proprietaryCriteria.detected,
        attempts: attempt,
      };
    }

    for (const rejected of verification.rejected) {
      failures.push(`assertion ${rejected.ordinal}: ${rejected.reason}`);
    }

    log.warn('draft failed verification and will be regenerated', {
      denialId,
      attempt,
      rejectedCount: verification.rejected.length,
      failureRate: verification.failureRate,
    });
  }

  await db
    .update(denial)
    .set({ status: 'ready_for_generation', updatedAt: new Date() })
    .where(eq(denial.id, denialId));

  throw new GenerationError(
    `Three drafts in a row contained an assertion whose quote was not in the source it ` +
      `cited. Nothing was saved. This needs a look at the generation prompt rather than a ` +
      `retry.`,
    MAX_GENERATION_ATTEMPTS,
    failures,
  );
}

/* ─── Helpers ─────────────────────────────────────────────────────────────── */

async function spansForKind(denialId: string, kind: 'denial_letter' | 'clinical_record') {
  return db
    .select({
      id: denialSpan.id,
      ordinal: denialSpan.ordinal,
      text: denialSpan.text,
    })
    .from(denialSpan)
    .innerJoin(denialDocument, eq(denialSpan.denialDocumentId, denialDocument.id))
    .where(and(eq(denialDocument.denialId, denialId), eq(denialDocument.kind, kind)))
    .orderBy(denialSpan.ordinal);
}

async function nextVersion(denialId: string): Promise<number> {
  const [row] = await db
    .select({ max: sql<number>`coalesce(max(${appealDraft.version}), 0)::int` })
    .from(appealDraft)
    .where(eq(appealDraft.denialId, denialId));
  return (row?.max ?? 0) + 1;
}

function groupBySection(
  assertions: readonly { section: string; ordinal: number }[],
): Record<string, number[]> {
  const grouped: Record<string, number[]> = {};
  for (const a of assertions) {
    (grouped[a.section] ??= []).push(a.ordinal);
  }
  return grouped;
}

function formatDateRange(from: Date | null, to: Date | null): string {
  if (!from && !to) return 'not stated';
  const iso = (d: Date) => d.toISOString().slice(0, 10);
  if (from && to) return `${iso(from)} to ${iso(to)}`;
  return iso((from ?? to)!);
}

export { buildDraftPrompt, holding, sourceSpan };
