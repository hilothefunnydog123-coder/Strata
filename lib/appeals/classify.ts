/**
 * Reading the denial letter.
 *
 * Two things come out of this: what the payer says it denied the claim for, and
 * whether that reason rests on the plan's own internal criteria rather than on
 * Medicare coverage rules. The second is the one that matters most, because it
 * is what unlocks the strongest argument available in this domain.
 *
 * Both are cited. The classification names the language in the letter that
 * establishes it, so a specialist can check the reasoning rather than take it.
 */
import { z } from 'zod';
import { complete, type LlmResponse } from '@/lib/llm/client';

export const classificationSchema = z.object({
  denialBasis: z.enum([
    'medical_necessity',
    'level_of_care',
    'not_covered_benefit',
    'insufficient_documentation',
    'proprietary_criteria',
    'administrative',
    'other',
  ]),
  /** The span the establishing language came from. */
  spanOrdinal: z.number().int().positive(),
  /** The payer's own words establishing the basis. Verified afterwards. */
  verbatimQuote: z.string().min(24),
  /** One sentence, in the letter's own terms. */
  statedReason: z.string().min(10),

  /**
   * Whether the denial rests on criteria the plan brought rather than criteria
   * Medicare sets. This is the 42 CFR 422.101(b) trigger.
   */
  proprietaryCriteria: z.object({
    detected: z.boolean(),
    /** The named product or standard, if the letter names one. */
    criteriaName: z.string().nullable(),
    /** The passage showing internal criteria were applied. Null if not detected. */
    spanOrdinal: z.number().int().positive().nullable(),
    verbatimQuote: z.string().nullable(),
    reasoning: z.string(),
  }),

  serviceType: z
    .enum([
      'skilled_nursing',
      'inpatient_rehab',
      'home_health',
      'long_term_care_hospital',
      'inpatient_acute',
      'outpatient',
      'dme',
      'other',
    ])
    .nullable(),

  /** The criteria the payer says were not met, in the payer's own words. */
  criteriaCited: z.array(z.string()),
});

export type Classification = z.infer<typeof classificationSchema>;

export const CLASSIFICATION_SYSTEM_PROMPT = `You read insurance denial letters for a hospital's appeals team and report what the letter actually says.

You are reading a real denial of a real claim. Everything you report must come from the letter in front of you.

Rules:

1. Quote exactly. Every verbatimQuote must be a character for character copy of a contiguous passage from the span text given to you, at least 24 characters long. The quote is checked against the source afterwards and a mismatch discards the finding. Do not paraphrase, do not tidy, do not join separate sentences.

2. denialBasis is what the letter gives as the reason:
   - medical_necessity: the service was not medically necessary.
   - level_of_care: care was needed, but at a lower level than billed.
   - not_covered_benefit: the service is excluded from coverage entirely.
   - insufficient_documentation: the record submitted did not establish the claim.
   - proprietary_criteria: the denial rests on the plan's own internal criteria.
   - administrative: timeliness, authorisation, eligibility, or a coding matter.
   - other: none of the above fits.
   Where more than one applies, choose the one the letter leads with.

3. Detect proprietary criteria carefully. Set detected true when the letter applies a coverage standard that is the plan's own rather than Medicare's. Signals: a named commercial criteria product, a reference to the plan's internal policy or medical policy number, a clinical threshold with no counterpart in Medicare rules such as a requirement to demonstrate functional improvement or a minimum therapy minutes floor Medicare does not impose.

   Set detected false when the letter applies Medicare's own standards, even if it applies them wrongly. A plan that misapplies the Medicare skilled care standard is making an error, not substituting its own criteria, and calling it proprietary would be an argument the record does not support.

   When detected is false, set criteriaName, spanOrdinal, and verbatimQuote to null, and use reasoning to say what standard the letter did apply.

4. criteriaCited lists the specific requirements the payer says were not met, quoted or closely paraphrased from the letter. An empty array is correct if the letter names none.

5. Never infer beyond the letter. If it does not identify the service type, serviceType is null.

Return only JSON. No preamble, no commentary, no markdown fence.`;

export interface SpanForClassification {
  ordinal: number;
  text: string;
}

export function buildClassificationPrompt(
  payerName: string,
  spans: readonly SpanForClassification[],
): string {
  const body = spans
    .map((span) => `--- span ${span.ordinal} ---\n${span.text}`)
    .join('\n\n');
  return `Payer: ${payerName}\n\nDenial letter:\n\n${body}`;
}

export async function classifyDenial(
  payerName: string,
  spans: readonly SpanForClassification[],
  options: { containsPhi: boolean; denialId: string },
): Promise<LlmResponse<Classification>> {
  return complete({
    stage: 'denial_classify',
    system: CLASSIFICATION_SYSTEM_PROMPT,
    user: buildClassificationPrompt(payerName, spans),
    schema: classificationSchema,
    containsPhi: options.containsPhi,
    denialId: options.denialId,
    maxTokens: 4096,
  });
}
