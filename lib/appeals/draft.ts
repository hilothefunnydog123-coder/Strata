/**
 * Drafting the appeal.
 *
 * The model does not write a letter. It writes a list of assertions, each with
 * the identifier of the source it rests on and the exact words it relies on.
 * The letter is rendered from those afterwards, in lib/appeals/render.ts.
 *
 * That ordering is the point. A model asked to write a persuasive letter and
 * cite its sources will write the letter first and attach citations to it. A
 * model asked to produce assertions with sources cannot write a sentence that
 * has no source, because the sentence and its source are the same object.
 */
import { z } from 'zod';
import { complete, type LlmResponse } from '@/lib/llm/client';
import { statedOrNull } from '@/lib/llm/lenient';
import { SECTIONS } from './assertion';

/**
 * One assertion, strict about its evidence and forgiving about its heading.
 *
 * The prompt above did not ask for `section` as a field. It explained what each
 * section of the letter is for, under its own heading, and listed the fields
 * separately without mentioning it. The model did exactly what it was asked:
 * the first real draft came back with eight assertions carrying every named
 * field and no section, and the strict enum discarded all eight. Every quote in
 * them was fine. The prompt is fixed, and this is the belt.
 *
 * Which section a sentence appears under is presentation, not evidence. It
 * decides which heading it is printed beneath, and a reader who disagrees can
 * see the whole letter. Losing a verified argument over a heading is a bad
 * trade, so an unrecognised section falls back by kind: a clinical assertion
 * measures the record against the criteria, and a legal one argues the law.
 *
 * Nothing else here is lenient. The quote, its source, and the source's id stay
 * exactly as strict as they were, because those are what the letter rests on.
 */
export const draftAssertionSchema = z
  .object({
    section: statedOrNull(SECTIONS),
    kind: z.enum(['legal', 'clinical']),
    text: z.string().min(10),
    sourceKind: z.enum(['holding', 'source_span', 'clinical_fact']),
    /** An id from the numbered source list given in the prompt. */
    sourceId: z.string().min(1),
    verbatimQuote: z.string().min(24),
  })
  .transform((a) => ({
    ...a,
    section: a.section ?? (a.kind === 'clinical' ? 'application' : ('argument' as const)),
  }));

export const draftSchema = z.object({
  assertions: z.array(draftAssertionSchema).min(1),
});

export type DraftAssertion = z.infer<typeof draftAssertionSchema>;

export const DRAFT_SYSTEM_PROMPT = `You draft appeals of denied Medicare claims for a hospital's appeals team.

You do not write a letter. You produce a list of assertions. Each assertion is one claim the appeal makes, together with the source it rests on and the exact words from that source that support it. The letter is assembled from your assertions afterwards.

THE RULE THAT MATTERS MOST

Every assertion must rest on a source you were given, and verbatimQuote must be a character for character copy of a contiguous passage from that source. Every quote is checked against its source afterwards. Any assertion whose quote does not appear in its source is discarded, and if any assertion fails, the entire draft is thrown away and regenerated.

You therefore cannot help the hospital by writing a stronger sentence than the sources support. You can only help by writing sentences the sources do support.

Do not paraphrase inside a quote. Do not correct a spelling. Do not join two sentences that are separated in the source. Do not expand an abbreviation. Do not add or remove a word. Copy.

WHAT EACH ASSERTION NEEDS

- section is which part of the letter this assertion belongs in, and must be exactly one of: identification, standard, application, argument, relief. Every assertion carries one. What each section is for is described below.
- sourceKind and sourceId identify the source, taken exactly from the numbered lists you are given.
  - holding: a proposition from a published decision. For legal assertions.
  - source_span: a passage of a regulation or a CMS manual. For legal assertions.
  - clinical_fact: a fact from the patient's record. For clinical assertions.
- kind is legal for assertions about what the law requires, clinical for assertions about what this patient's record shows. A clinical assertion must cite a clinical_fact and nothing else. A legal assertion must cite a holding or a source_span and nothing else.
- text is the sentence the letter will contain. Write it as the hospital's own words, in plain declarative prose.

SECTIONS

- identification: what claim this is and what the payer decided. One or two assertions.
- standard: the coverage standard that governs, with the regulation or manual section that sets it. Legal assertions.
- application: the record measured against each criterion, one assertion per criterion, each citing the clinical fact that establishes it. Clinical assertions.
- argument: why the denial was wrong as a matter of law, with the decisions where the same argument prevailed. Legal assertions.
- relief: what the hospital asks for. One assertion.

WHAT YOU MUST NOT DO

- Do not assert that a criterion is met when no clinical fact establishes it. A criterion with no fact behind it has already been reported to the specialist as a documentation gap. Writing around it would hide from the hospital the one thing it most needs to know, and the payer will notice what you noticed.
- Do not characterise a decision as holding something it does not hold. The quote must carry the proposition on its own.
- Do not write about the patient beyond what the record states.
- Do not use an em dash anywhere in any assertion text.
- Do not write persuasive throat clearing. "As you are no doubt aware" and "we respectfully submit that it is beyond dispute" persuade nobody and dilute what follows. State the point.

TONE

Write the way a hospital's appeals specialist writes to a plan: direct, specific, unfailingly polite, and entirely uninterested in rhetoric. The strongest sentence is the one that states a fact and cites where it comes from.

Return only JSON of the shape {"assertions": [...]}. No preamble, no commentary, no markdown fence.`;

export interface DraftContext {
  payerName: string;
  claimReference: string;
  serviceType: string;
  serviceDates: string;
  claimAmount: string;
  denialBasis: string;
  denialQuote: string;
  proprietaryCriteria: { detected: boolean; name: string | null; quote: string | null };
  holdings: {
    id: string;
    citation: string;
    issue: string;
    ruleApplied: string;
    /** Null for a regulation or a manual, which state a rule and decide nothing. */
    outcome: string | null;
    text: string;
  }[];
  regulations: { id: string; citation: string; headingPath: string[]; text: string }[];
  facts: {
    id: string;
    factType: string;
    supportsCriterion: string | null;
    text: string;
  }[];
  /**
   * The criteria the appeal must show were met. Medicare's, always.
   *
   * Never the payer's. See criteriaFor in lib/appeals/generate.ts for why that
   * distinction is the difference between a letter and an empty one.
   */
  criteria: string[];
  /**
   * What the payer said was not met, in the payer's words.
   *
   * Here to be answered, not to be satisfied. These arrive as findings against
   * the hospital ("no measurable functional improvement has been recorded"),
   * and a finding is not a criterion: there is nothing in a patient record that
   * establishes an absence, so treating one as something to prove produces a
   * documentation gap for every item and an application section with nothing
   * left in it. That is what it produced.
   */
  payerCriteria: string[];
  gaps: { criterion: string; why: string }[];
}

export function buildDraftPrompt(context: DraftContext): string {
  const parts: string[] = [];

  parts.push(`CASE

Payer: ${context.payerName}
Claim reference: ${context.claimReference}
Service: ${context.serviceType.replace(/_/g, ' ')}
Dates of service: ${context.serviceDates}
Amount at issue: ${context.claimAmount}
Stated basis for denial: ${context.denialBasis.replace(/_/g, ' ')}

The payer's own words:
"${context.denialQuote}"`);

  if (context.proprietaryCriteria.detected && context.proprietaryCriteria.quote) {
    parts.push(`PROPRIETARY CRITERIA DETECTED

This denial applies the plan's own coverage criteria${
      context.proprietaryCriteria.name ? ` (${context.proprietaryCriteria.name})` : ''
    } rather than Medicare's.

The passage showing it:
"${context.proprietaryCriteria.quote}"

42 CFR 422.101(b) requires a Medicare Advantage organisation to comply with Medicare coverage rules, and a plan may not apply criteria more restrictive than Traditional Medicare. Build this argument in the argument section, citing the regulation and the decisions below where it prevailed. Cite the payer's own words above as the source for the assertion that internal criteria were applied.`);
  }

  parts.push(`COVERAGE CRITERIA AT ISSUE

These are the Medicare criteria this claim has to meet. Show in the application section that the record meets each one you have a clinical fact for.

${context.criteria.map((c, i) => `${i + 1}. ${c}`).join('\n')}`);

  if (context.payerCriteria.length > 0) {
    parts.push(`WHAT THE PAYER SAYS WAS NOT MET

${context.payerCriteria.map((c) => `- ${c}`).join('\n')}

These are the payer's findings, not the standard. Do not try to establish them and do not treat them as criteria: they are what this appeal answers. Where a clinical fact contradicts one, say so in the argument section and cite the fact. Where the finding applies a requirement Medicare does not impose, say that instead and cite the regulation or decision that governs. Where the record neither contradicts nor supports a finding, leave it alone rather than writing around it.`);
  }

  if (context.gaps.length > 0) {
    parts.push(`CRITERIA WITH NO SUPPORT IN THE RECORD

${context.gaps.map((g) => `- ${g.criterion}`).join('\n')}

Write no assertion claiming any of these is met. There is no clinical fact behind them, so any such assertion would fail verification and discard the whole draft. Leave them out of the application section entirely; the specialist has already been told about them.`);
  }

  parts.push(`AVAILABLE HOLDINGS (sourceKind: holding)

${
    context.holdings.length === 0
      ? '(none retrieved)'
      : context.holdings
          .map(
            (h) => `[${h.id}] ${h.citation}
Issue: ${h.issue}
Rule: ${h.ruleApplied}
${h.outcome ? `Outcome: ${h.outcome.replace(/_/g, ' ')}` : 'This is rule text, not a decision. It states a requirement rather than resolving an appeal, so do not describe anyone as having prevailed on it.'}
Text:
${h.text}`,
          )
          .join('\n\n')
  }`);

  parts.push(`AVAILABLE REGULATION AND MANUAL PASSAGES (sourceKind: source_span)

${
    context.regulations.length === 0
      ? '(none retrieved)'
      : context.regulations
          .map(
            (r) => `[${r.id}] ${r.citation}${
              r.headingPath.length > 0 ? ` > ${r.headingPath.join(' > ')}` : ''
            }
Text:
${r.text}`,
          )
          .join('\n\n')
  }`);

  parts.push(`AVAILABLE CLINICAL FACTS (sourceKind: clinical_fact)

${
    context.facts.length === 0
      ? '(none extracted)'
      : context.facts
          .map(
            (f) => `[${f.id}] ${f.factType.replace(/_/g, ' ')}${
              f.supportsCriterion ? ` (goes to: ${f.supportsCriterion})` : ''
            }
Text:
${f.text}`,
          )
          .join('\n\n')
  }`);

  return parts.join('\n\n');
}

/**
 * What a finished draft actually needs to come back in.
 *
 * Not 8192, which is what this reserved for months and what made the drafting
 * call impossible on a free tier without anyone being able to see why.
 *
 * A provider counts the completion reservation against the request's budget as
 * though it will be used in full, so the reservation is spent before a word of
 * the prompt is added to it. Groq's free allowance for the model this was being
 * run on is 8000 tokens a minute. The reservation on its own was over that, so
 * the request was refused whatever it carried, and the caller's answer to being
 * refused was to cite fewer authorities, which could not help and did not: one
 * real run shed twenty two authorities down to two and was refused every time.
 *
 * This codebase has met this twice before and written it down both times.
 * lib/corpus/extract.ts came down to 2048 and its comment explains the billing
 * at length; lib/appeals/facts.ts came down from this exact number for this
 * exact reason and says so. Drafting is the third and was the one that
 * mattered, because it is the call a letter cannot be produced without.
 *
 * 4096 is sized to the answer rather than to a round number. A draft is a list
 * of assertions, each one a sentence, a quote, an id and two labels, which runs
 * about two hundred tokens. A long letter of fourteen assertions fits inside
 * three thousand.
 */
export const DRAFT_OUTPUT_TOKENS = 4096;

/**
 * The smallest reservation a whole letter still fits in.
 *
 * Below this a draft stops being refused and starts being truncated, which is
 * worse: a cut off completion is invalid JSON, and the remedy for that looks
 * nothing like the remedy for a reservation that is too small.
 */
export const MIN_DRAFT_OUTPUT_TOKENS = 2048;

export async function draftAppeal(
  context: DraftContext,
  options: { containsPhi: boolean; denialId: string; maxTokens?: number; model?: string },
): Promise<LlmResponse<z.infer<typeof draftSchema>>> {
  return complete({
    stage: 'appeal_draft',
    system: DRAFT_SYSTEM_PROMPT,
    user: buildDraftPrompt(context),
    model: options.model,
    // Cast for the reason the other two schemas need one: a schema that fills
    // in a missing section accepts less than it returns, so its input and
    // output types differ and the boundary asks for a single type.
    schema: draftSchema as z.ZodType<z.infer<typeof draftSchema>>,
    containsPhi: options.containsPhi,
    denialId: options.denialId,
    maxTokens: options.maxTokens ?? DRAFT_OUTPUT_TOKENS,
  });
}
