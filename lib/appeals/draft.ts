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
import { SECTIONS } from './assertion';

export const draftAssertionSchema = z.object({
  section: z.enum(SECTIONS),
  kind: z.enum(['legal', 'clinical']),
  text: z.string().min(10),
  sourceKind: z.enum(['holding', 'source_span', 'clinical_fact']),
  /** An id from the numbered source list given in the prompt. */
  sourceId: z.string().min(1),
  verbatimQuote: z.string().min(24),
});

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
    outcome: string;
    text: string;
  }[];
  regulations: { id: string; citation: string; headingPath: string[]; text: string }[];
  facts: {
    id: string;
    factType: string;
    supportsCriterion: string | null;
    text: string;
  }[];
  criteria: string[];
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

${context.criteria.map((c, i) => `${i + 1}. ${c}`).join('\n')}`);

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
Outcome: ${h.outcome.replace(/_/g, ' ')}
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

export async function draftAppeal(
  context: DraftContext,
  options: { containsPhi: boolean; denialId: string },
): Promise<LlmResponse<z.infer<typeof draftSchema>>> {
  return complete({
    stage: 'appeal_draft',
    system: DRAFT_SYSTEM_PROMPT,
    user: buildDraftPrompt(context),
    schema: draftSchema,
    containsPhi: options.containsPhi,
    denialId: options.denialId,
    maxTokens: 8192,
  });
}
