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
import { statedOrNull } from '@/lib/llm/lenient';

/**
 * Strict about the evidence, lenient about the description.
 *
 * This schema was strict about both, and it cost the first real generation run
 * before a single word of a letter was written. The model returned
 * `serviceType: "skilled nursing facility care"`, omitted `statedReason`, and
 * omitted the `proprietaryCriteria` object, and Zod threw on all three at once.
 * The quote it returned was fine. The classification it made was correct. The
 * letter was never written, because three labels were shaped wrongly.
 *
 * The corpus extractor met this a long time ago and its schema already reads
 * this way; this one had not been taught. What must stay strict is the quote
 * and the span it came from, because that is the evidence a specialist checks.
 * Everything else here is a label, every one of them has something to fall back
 * on, and none of them is worth losing a letter over.
 */
export const classificationSchema = z.object({
  /**
   * Null when the model does not answer in the vocabulary. The caller falls
   * back to the basis recorded on the denial at intake, which a person typed.
   */
  denialBasis: statedOrNull([
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
  /**
   * One sentence, in the letter's own terms. Empty when the model does not
   * write one: the quote above says the same thing in the payer's words, and
   * every place this is used has the quote beside it.
   */
  statedReason: z.string().catch('').default(''),

  /**
   * Whether the denial rests on criteria the plan brought rather than criteria
   * Medicare sets. This is the 42 CFR 422.101(b) trigger.
   *
   * Absent means not detected, which is the safe direction rather than merely
   * the convenient one. This flag decides whether the letter argues that the
   * plan substituted its own standard, and that argument is worth making only
   * where the letter supports it. A missing object becoming "detected" would
   * put an accusation in a letter on the strength of a model forgetting a
   * field.
   */
  proprietaryCriteria: z
    .object({
      detected: z.boolean().catch(false).default(false),
      /** The named product or standard, if the letter names one. */
      criteriaName: z.string().nullable().catch(null).default(null),
      /** The passage showing internal criteria were applied. Null if not detected. */
      spanOrdinal: z.number().int().positive().nullable().catch(null).default(null),
      verbatimQuote: z.string().nullable().catch(null).default(null),
      reasoning: z.string().catch('').default(''),
    })
    .default({}),

  /**
   * Null when the letter does not say, and also when the model says it in
   * prose. The caller falls back to the service type on the denial record.
   */
  serviceType: statedOrNull([
    'skilled_nursing',
    'inpatient_rehab',
    'home_health',
    'long_term_care_hospital',
    'inpatient_acute',
    'outpatient',
    'dme',
    'other',
  ]),

  /** The criteria the payer says were not met, in the payer's own words. */
  criteriaCited: z.array(z.string()).catch([]).default([]),
});

export type Classification = z.infer<typeof classificationSchema>;

export const CLASSIFICATION_SYSTEM_PROMPT = `You read insurance denial letters for a hospital's appeals team and report what the letter actually says.

You are reading a real denial of a real claim. Everything you report must come from the letter in front of you.

WHAT TO RETURN

One JSON object with exactly these fields:

- denialBasis: one of the values listed in rule 2.
- spanOrdinal: the number of the span your quote came from, exactly as labelled in the input. Each passage is introduced by a line reading "--- span N ---", and N is what goes here.
- verbatimQuote: the payer's own words establishing the basis, copied exactly from that span.
- statedReason: one sentence, in the letter's own terms.
- serviceType: the service denied, or null if the letter does not say.
- criteriaCited: an array, empty if the letter names none.
- proprietaryCriteria: the object described in rule 3.

spanOrdinal and verbatimQuote are the evidence for everything else here, and a
classification without them cannot be used at all. Rule 3 below tells you to
null two fields with those same names: that instruction is about the fields
inside proprietaryCriteria and never about these two.

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

   When detected is false, set proprietaryCriteria.criteriaName, proprietaryCriteria.spanOrdinal, and proprietaryCriteria.verbatimQuote to null, and use reasoning to say what standard the letter did apply. This applies only to the fields inside proprietaryCriteria. The spanOrdinal and verbatimQuote at the top level are always required, whatever this object contains.

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
    // Cast for the same reason the extraction schema needs one: a schema
    // carrying defaults accepts less than it returns, so its input and output
    // types differ and the boundary's signature asks for one type.
    schema: classificationSchema as z.ZodType<Classification>,
    containsPhi: options.containsPhi,
    denialId: options.denialId,
    maxTokens: 4096,
  });
}
