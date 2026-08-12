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
import { ZodError } from 'zod';
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
import { env } from '@/lib/env';
import { log } from '@/lib/log';
import {
  ModelMalformedOutputError,
  ModelRateLimitedError,
  ModelRequestTooLargeError,
  modelName,
  withRateLimitPatience,
} from '@/lib/llm/client';
import { retrieveAuthority, retrieveControllingAuthority } from '@/lib/corpus/retrieve';
import { formatCents } from '@/components/ui/primitives';
import { assertion, sourceKindMatches, type Section } from './assertion';
import { classifyDenial } from './classify';
import { extractClinicalFacts, findGaps, parseFacts, type DocumentationGap } from './facts';
import {
  buildDraftPrompt,
  draftAppeal,
  DRAFT_OUTPUT_TOKENS,
  MIN_DRAFT_OUTPUT_TOKENS,
  type DraftContext,
} from './draft';
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
 * What Medicare requires, by service type.
 *
 * The standard an appeal argues from, whatever the denial letter says. See
 * criteriaFor below for why the letter's own list is not used here, which is
 * the opposite of what this comment said until a real letter came out with one
 * sentence in it.
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

/**
 * The criteria this appeal has to show were met. Medicare's, always.
 *
 * This used to prefer whatever the denial letter cited, on the reasoning that
 * arguing against criteria the payer did not apply is arguing with yourself.
 * The reasoning was right and the implementation inverted it, because what a
 * denial letter cites is not a list of criteria. It is a list of findings
 * against the hospital, written in the negative: "no measurable functional
 * improvement has been recorded", "gait distance did not increase".
 *
 * Feeding those in here made them the things the record had to establish. No
 * record establishes an absence, so fact extraction found nothing for any of
 * them, findGaps reported every one as a documentation gap, and the drafting
 * prompt was then told to assert none of them. The application section is
 * exactly the set of criteria the record meets, so it came out empty, and a
 * real run produced a letter with one sentence in it.
 *
 * It also quietly conceded the strongest argument available here. The
 * proprietary criteria argument says the plan applied a standard Medicare does
 * not impose. A letter cannot make that argument while also labouring to
 * satisfy the standard.
 *
 * So the statutory criteria govern and the payer's language goes to the
 * drafting prompt separately, as material to answer.
 */
export function criteriaFor(serviceType: string, denialId: string): string[] {
  const statutory = STATUTORY_CRITERIA[serviceType];
  if (statutory) return [...statutory];

  // Only two service types have their criteria written down here, and this is
  // now the only source of them rather than a fallback behind the payer's list,
  // so a service type that is missing gets the skilled nursing set and that is
  // wrong rather than merely approximate. Loud, because the remedy is domain
  // knowledge somebody has to write down, and silence would leave a home health
  // appeal quietly arguing the wrong standard.
  log.warn('no statutory criteria are recorded for this service type', {
    denialId,
    serviceType,
    using: 'skilled_nursing',
  });
  return [...STATUTORY_CRITERIA.skilled_nursing!];
}


/* ─── Which model answers, when the first choice's allowance is spent ─────── */

/**
 * Models whose allowance this process has already found empty.
 *
 * Sticky across stages and across letters on purpose. Exhausting a bucket is a
 * fact about the provider for the rest of the window, not about the call that
 * discovered it, and re-learning it costs the full rate limit patience per
 * stage: three minutes of spaced refusals to find out what the last stage
 * already knew.
 */
const spentModels = new Set<string>();

/** For tests. A process that generates all day clears naturally by restarting. */
export function forgetSpentModels(): void {
  spentModels.clear();
}

/**
 * Run one stage, moving to a fallback model when the current one's allowance
 * is spent.
 *
 * The same per model metering the corpus rotation exploits, arrived at the
 * same way. A quota belongs to a model on a project rather than to the key, so
 * an account refused on one model has an untouched budget on the next, and a
 * real run proved it the hard way: every request to one model refused for six
 * straight minutes, at sixty second spacing, on an account that could list
 * fifty others it was welcome to use.
 *
 * Rotation triggers only when patience is exhausted or the provider names an
 * interval too long to wait, both of which surface here as
 * ModelRateLimitedError escaping withRateLimitPatience. A throttle that clears
 * inside the patience never rotates, so the preferred model is used whenever
 * using it is possible.
 *
 * undefined asks the stage to use its configured model, so an empty fallback
 * list is exactly the old behaviour.
 */
export async function withModelFallback<T>(
  what: string,
  run: (model?: string) => Promise<T>,
): Promise<T> {
  const fallbacks = env.MODEL_NAME_FALLBACKS.split(',')
    .map((m: string) => m.trim())
    .filter((m: string) => m.length > 0);

  // undefined first: the configured model, whatever modelName resolves it to.
  // Its resolved name is what lands in spentModels if it runs dry, so the
  // skip check below has to resolve it the same way.
  const candidates: (string | undefined)[] = [
    undefined,
    ...fallbacks.filter((m, i, all) => all.indexOf(m) === i),
  ];

  let lastRefusal: unknown;

  for (const candidate of candidates) {
    const resolved = candidate ?? modelName();
    if (spentModels.has(resolved)) continue;

    try {
      return await withRateLimitPatience(what, () => run(candidate));
    } catch (error) {
      // Two failures rotate, for different reasons, and they are remembered
      // differently.
      //
      // An exhausted allowance is a fact about the model for the rest of its
      // window, so it is marked spent and skipped by every later stage.
      //
      // Unparseable JSON that survived the boundary's corrected retries is a
      // fact about this model and this prompt right now: the model was asked,
      // corrected, warmed off temperature zero, and still could not close its
      // brackets. The next model on the list writes different JSON, and a real
      // run died exactly here with two working fallbacks it never tried. Not
      // marked spent, because the same model may write clean JSON for the next
      // stage's very different prompt.
      if (error instanceof ModelRateLimitedError) {
        lastRefusal = error;
        spentModels.add(resolved);
        log.info('model allowance spent, moving to a fallback model', {
          what,
          spent: resolved,
          remaining: candidates.filter(
            (c) => !spentModels.has(c ?? modelName()),
          ).length,
        });
        continue;
      }

      if (error instanceof ModelMalformedOutputError) {
        lastRefusal = error;
        log.info('model could not produce parseable JSON here, trying the next model', {
          what,
          model: resolved,
        });
        continue;
      }

      throw error;
    }
  }

  // Nothing left to rotate to. The last refusal is the truthful error, and if
  // every model on the list refused, the problem is the account rather than a
  // bucket, which the log above now shows model by model.
  throw lastRefusal ?? new Error(`No model was available for ${what}.`);
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

  const classification = await withModelFallback('reading the denial letter', (model) =>
    classifyDenial(
      record.payerName,
      letterSpans.map((s) => ({ ordinal: s.ordinal, text: s.text })),
      { containsPhi, denialId, model },
    ),
  );

  // Both fall back to what a person typed at intake when the letter does not
  // say, or when the model answers in prose rather than in the vocabulary. The
  // classification improves on the intake metadata where it can and never
  // replaces it with nothing.
  const serviceType = classification.value.serviceType ?? record.serviceType;
  const denialBasis = classification.value.denialBasis ?? record.denialBasis;

  // The column is nullable and the rest of the chain is not, so this is where
  // the two meet. Null is written back as null rather than as "other", because
  // recording a basis nobody established would be inventing case metadata; but
  // retrieval and the prompt need a word, and "other" is the one that claims
  // nothing.
  const basis = denialBasis ?? 'other';
  const criteria = criteriaFor(serviceType, denialId);
  // Kept apart from the criteria above and given to the drafter as material to
  // answer. See criteriaFor for what happened when the two were the same list.
  const payerCriteria = classification.value.criteriaCited;

  // Record what the classification found on the denial itself, so the case
  // metadata reflects what the letter says rather than what was typed at intake.
  await db
    .update(denial)
    .set({
      denialBasis,
      denialBasisText: classification.value.statedReason,
      updatedAt: new Date(),
    })
    .where(eq(denial.id, denialId));

  /* 2. Extract clinical facts from the record. */

  const recordSpans = await spansForKind(denialId, 'clinical_record');
  const facts =
    recordSpans.length === 0
      ? { value: { facts: [] } }
      : await withModelFallback('reading the clinical record', (model) =>
          extractClinicalFacts(
            criteria,
            recordSpans.map((s) => ({ ordinal: s.ordinal, text: s.text })),
            { containsPhi, denialId, model },
          ),
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

  const { facts: usable, discarded: unparsable } = parseFacts(facts.value.facts);
  if (unparsable.length > 0) {
    // Reported rather than swallowed: a record that yields fewer facts than it
    // holds produces a thinner letter, and nobody can see that from the letter.
    log.info('clinical facts that did not parse were dropped', {
      denialId,
      dropped: unparsable.length,
      firstReason: unparsable[0],
    });
  }

  for (const fact of usable) {
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

  // From the facts that parsed, not the ones that were returned. A fact that
  // was dropped supports nothing, and counting it here would close a gap the
  // letter cannot actually fill.
  const gaps = findGaps(
    criteria,
    usable.map((f) => ({ supportsCriterion: f.supportsCriterion })),
  );

  /* 4. Retrieve authority. */

  const retrieved = await retrieveAuthority({
    serviceType,
    payerType: record.planType,
    denialBasis: basis,
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
    throw new NoAuthorityError(serviceType, basis);
  }

  /* 5, 6, 7. Draft and verify, regenerating on failure. */

  const context: DraftContext = {
    payerName: record.payerName,
    claimReference: record.internalRef,
    serviceType,
    serviceDates: formatDateRange(record.serviceDateFrom, record.serviceDateTo),
    claimAmount: formatCents(record.claimAmountCents),
    denialBasis: basis,
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
    payerCriteria: [...payerCriteria],
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

  // What the provider has already refused, remembered across attempts.
  //
  // This used to live inside the loop, so every regeneration started again at
  // the full reservation and the full set of authorities and rediscovered the
  // same two refusals. A real run shows the pair "reserving less output 4096 to
  // 2048" and "citing less 22 to 11" five times over, each one a request sent
  // in the certain knowledge that it would be rejected.
  //
  // On a metered provider that is worse than untidy. Every rediscovery is
  // charged against the same per minute allowance the letter needs, so the
  // attempts spent the minute learning and then waited 53 seconds, then 31,
  // then 8, for the room to try again. The size a request has to be is a fact
  // about the provider, not about the attempt that happened to find it.
  const allowance = initialAllowance(context);

  for (let attempt = 1; attempt <= MAX_GENERATION_ATTEMPTS; attempt += 1) {
    // A draft that does not parse is a failed attempt, not a failed generation.
    //
    // The model is asked for assertions that each carry their own source, and
    // on the first real run three of eight came back with a null sourceId and
    // no quote: sentences with nothing behind them, in the introduction and the
    // ask, which is exactly where a writer reaches for unsupported connective
    // prose. The design already refuses those. What it did not do was survive
    // them, because the schema error left this loop through the model boundary
    // and ended the case before the second attempt existed.
    //
    // Dropping the three and keeping the five is the tempting repair and it is
    // the wrong one. This function discards a draft whole rather than mending
    // it, deliberately, and five assertions with the introduction and the ask
    // missing is a mended draft that nobody downstream can tell was mended.
    // Regenerating is the response this loop was built for.
    let drafted;
    try {
      drafted = await withModelFallback('writing the appeal', (model) =>
        draftWithinTheLimit(context, { containsPhi, denialId, model }, allowance),
      );
    } catch (error) {
      if (!(error instanceof ZodError)) throw error;

      // Named by position and field, because "assertions.0.sourceId" is the
      // difference between a prompt that needs fixing and a model having a bad
      // day, and the specialist sees these if all three attempts fail.
      for (const issue of error.issues.slice(0, 6)) {
        failures.push(`draft attempt ${attempt}: ${issue.path.join('.')}: ${issue.message}`);
      }

      log.warn('the drafted assertions did not parse and will be regenerated', {
        denialId,
        attempt,
        issues: error.issues.length,
      });
      continue;
    }

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
    `Three drafts in a row could not be used: either an assertion quoted something that ` +
      `was not in the source it cited, or the draft came back without the source and quote ` +
      `every assertion has to carry. Nothing was saved. The failures below say which, and ` +
      `both point at the generation prompt rather than at a retry.`,
    MAX_GENERATION_ATTEMPTS,
    failures,
  );
}

/* ─── Helpers ─────────────────────────────────────────────────────────────── */

/**
 * The fewest authorities a letter is still worth writing from.
 *
 * Below this the argument is too thin to be worth the paper, and failing with
 * the provider's own message is more use than a letter citing one regulation
 * because that was all that fitted.
 */
const MIN_AUTHORITIES = 3;

/**
 * Draft, and if the request is refused for size, cite less and draft again.
 *
 * The drafting call is the largest request the product makes: the denial
 * quote, every clinical fact, up to twelve holdings and ten regulation
 * passages, each carrying the full text of the passage so the model can quote
 * it exactly. On a free tier that exceeds the per request limit, and the first
 * real run was refused here after everything before it had succeeded.
 *
 * The corpus extractor answers this by halving its batch, and this is the same
 * remedy shaped for a different job. A batch of passages can be split because
 * each half is still a whole unit of work. A letter cannot: half a letter is
 * not a letter. What can be reduced is how much authority is offered, and
 * retrieval already returns it in descending order of relevance, so dropping
 * from the end sheds the weakest support first.
 *
 * This narrows the argument, which is a real cost and is why it stops at
 * MIN_AUTHORITIES rather than shrinking until something fits. A letter that
 * cites the three strongest holdings is a good letter. A letter that cites one
 * because the other eleven did not fit is a worse argument wearing the same
 * invariant, and nobody reading it would know.
 *
 * The reservation goes first, and for a long time it did not go at all.
 *
 * A request is its prompt plus the room it reserves for an answer, and a
 * provider charges the reservation against the limit in full whether it is used
 * or not. This shed authorities and left the reservation alone, which meant the
 * one part of the request that was over the limit on its own was the one part
 * that never came down. A real run walked twenty two authorities down to two
 * and was refused at every step, because the floor was never the authorities.
 *
 * So the reservation is reduced first. It is the right order on the merits and
 * not merely because it was the bug: room for an answer nobody needs costs
 * nothing to give up, and every authority given up costs the argument.
 */
/**
 * How much a drafting request is currently allowed to be.
 *
 * Carried across regeneration attempts rather than rebuilt for each one, so a
 * size the provider has already refused is refused once.
 */
export interface DraftAllowance {
  maxTokens: number;
  holdings: number;
  regulations: number;
}

/** Everything retrieval found, and room for the answer a letter needs. */
export function initialAllowance(context: DraftContext): DraftAllowance {
  return {
    maxTokens: DRAFT_OUTPUT_TOKENS,
    holdings: context.holdings.length,
    regulations: context.regulations.length,
  };
}

/**
 * Fewer authorities, keeping the mix retrieval chose. False when already at the
 * floor, which is the caller's signal to stop and report.
 */
function citeLess(allowance: DraftAllowance, denialId: string): boolean {
  const total = allowance.holdings + allowance.regulations;
  if (total <= MIN_AUTHORITIES) return false;

  // Halved, but never past the floor.
  //
  // Halving each list separately overshoots: four authorities became two, below
  // the floor this function's caller says in its own comment that it stops at.
  // The floor is a judgment about when an argument is too thin to send, and a
  // rounding rule is not entitled to overrule it.
  const target = Math.max(MIN_AUTHORITIES, Math.ceil(total / 2));
  const keepHoldings = Math.min(
    allowance.holdings,
    Math.max(1, Math.round((allowance.holdings / total) * target)),
  );
  const keepRegulations = Math.min(allowance.regulations, Math.max(0, target - keepHoldings));

  if (keepHoldings + keepRegulations >= total) return false;

  allowance.holdings = keepHoldings;
  allowance.regulations = keepRegulations;

  log.info('the drafting request was refused as too large, citing less', {
    denialId,
    from: total,
    to: keepHoldings + keepRegulations,
  });
  return true;
}

export async function draftWithinTheLimit(
  context: DraftContext,
  options: { containsPhi: boolean; denialId: string; model?: string },
  allowance: DraftAllowance = initialAllowance(context),
): Promise<Awaited<ReturnType<typeof draftAppeal>>> {
  for (;;) {
    const holdings = context.holdings.slice(0, allowance.holdings);
    const regulations = context.regulations.slice(0, allowance.regulations);

    try {
      return await draftAppeal(
        { ...context, holdings, regulations },
        { ...options, maxTokens: allowance.maxTokens },
      );
    } catch (error) {
      // The answer did not fit in the room reserved for it.
      //
      // The opposite complaint to the one below, and it has to be, because a
      // request is a prompt plus a reservation and this is the only place that
      // decides how a fixed budget is divided between them. Shrinking the
      // reservation is the answer to a request that is too large and it is the
      // cause of a completion that is cut off, so a ladder with one move has
      // the wrong move half the time. A real run met exactly that: refused at a
      // 4096 reservation, truncated at 2048, and ended the case with no letter
      // because the only lever it had was already at the bottom.
      //
      // Room for the answer has to come from the prompt instead. Authorities go
      // and the reservation is restored, which is the same trade the ladder
      // below makes, made in the other direction.
      if (error instanceof ModelMalformedOutputError) {
        if (!citeLess(allowance, options.denialId)) throw error;

        allowance.maxTokens = DRAFT_OUTPUT_TOKENS;
        log.info('the drafted answer was cut off, taking the room back from the prompt', {
          denialId: options.denialId,
          maxTokens: allowance.maxTokens,
          authorities: allowance.holdings + allowance.regulations,
        });
        continue;
      }

      if (!(error instanceof ModelRequestTooLargeError)) throw error;

      // Cheapest concession first: room for an answer larger than a letter.
      if (allowance.maxTokens > MIN_DRAFT_OUTPUT_TOKENS) {
        const was = allowance.maxTokens;
        allowance.maxTokens = Math.max(
          MIN_DRAFT_OUTPUT_TOKENS,
          Math.floor(allowance.maxTokens / 2),
        );
        log.info('the drafting request was refused as too large, reserving less output', {
          denialId: options.denialId,
          from: was,
          to: allowance.maxTokens,
        });
        continue;
      }

      if (!citeLess(allowance, options.denialId)) throw error;
    }
  }
}

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
