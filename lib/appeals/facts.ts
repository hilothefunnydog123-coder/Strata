/**
 * Reading the clinical record.
 *
 * Extracting facts relevant to the coverage criteria at issue, each anchored to
 * a verbatim quote and a span. The anchoring is the whole point: a clinical
 * assertion in the finished letter resolves to a line in the hospital's own
 * chart, and a reviewer checks it by reading that line.
 *
 * This is the one part of generation that unambiguously handles PHI. Its
 * callers pass containsPhi and the boundary in lib/llm/client.ts refuses the
 * call in synthetic mode if it is true.
 */
import { z } from 'zod';
import { complete, type LlmResponse } from '@/lib/llm/client';

export const clinicalFactSchema = z.object({
  spanOrdinal: z.number().int().positive(),
  verbatimQuote: z.string().min(24),
  factType: z.enum([
    'diagnosis',
    'functional_status',
    'therapy_intensity',
    'skilled_service',
    'physician_order',
    'nursing_observation',
    'prior_level_of_function',
    'discharge_plan',
    'vital_sign',
    'medication',
    'other',
  ]),
  /** A short, normalised statement of what the quote establishes. */
  normalizedValue: z.string().min(3),
  /** Which of the criteria given in the prompt this fact bears on. */
  supportsCriterion: z.string().nullable(),
});

export type ExtractedFact = z.infer<typeof clinicalFactSchema>;

export const factExtractionSchema = z.object({
  facts: z.array(clinicalFactSchema),
});

export const FACT_EXTRACTION_SYSTEM_PROMPT = `You read clinical documentation and pull out the facts that bear on specific Medicare coverage criteria.

You are working from a real patient record. Everything you report must be in the record in front of you.

Rules, in order of importance:

1. Return nothing rather than invent. If the record does not establish a criterion, do not produce a fact for it. An empty facts array is a correct answer for a record that supports none of the criteria, and it is a far better answer than a fabricated one. A missing fact becomes a documentation gap the specialist is told about, which is the outcome we want.

2. Quote exactly. verbatimQuote must be a character for character copy of a contiguous passage from the span text you were given, at least 24 characters long. Do not correct spelling, do not expand an abbreviation, do not join two separate notes, do not summarise. The quote is checked against the record afterwards and a mismatch discards the fact.

3. Quote minimally. Take the shortest contiguous passage that establishes the fact.

4. normalizedValue restates in plain words what the quote establishes, for example "requires maximum assistance for bed mobility" or "receiving 3 hours of therapy 5 days per week". This is for a reader scanning a list. It is not a substitute for the quote and it is never used as evidence.

5. supportsCriterion must be one of the criteria given to you, copied exactly, or null when the fact is relevant background but does not go to any listed criterion.

6. Do not repeat the same fact from several places in the record. Take the clearest single instance.

7. Never state a clinical conclusion the record does not state. If the record says a patient needs assistance transferring, that is what you report. Do not report that the patient therefore requires skilled nursing: that is an argument, and arguments are made elsewhere from the facts you provide.

Return only JSON of the shape {"facts": [...]}. No preamble, no commentary, no markdown fence.`;

export interface SpanForFactExtraction {
  ordinal: number;
  text: string;
}

export function buildFactExtractionPrompt(
  criteria: readonly string[],
  spans: readonly SpanForFactExtraction[],
): string {
  const criteriaList = criteria.map((c, i) => `${i + 1}. ${c}`).join('\n');
  const body = spans
    .map((span) => `--- span ${span.ordinal} ---\n${span.text}`)
    .join('\n\n');

  return `Coverage criteria at issue:

${criteriaList}

Clinical record:

${body}`;
}

export async function extractClinicalFacts(
  criteria: readonly string[],
  spans: readonly SpanForFactExtraction[],
  options: { containsPhi: boolean; denialId: string },
): Promise<LlmResponse<z.infer<typeof factExtractionSchema>>> {
  return complete({
    stage: 'fact_extract',
    system: FACT_EXTRACTION_SYSTEM_PROMPT,
    user: buildFactExtractionPrompt(criteria, spans),
    schema: factExtractionSchema,
    containsPhi: options.containsPhi,
    denialId: options.denialId,
    maxTokens: 8192,
  });
}

/* ─── Gap check ───────────────────────────────────────────────────────────── */

export interface DocumentationGap {
  criterion: string;
  why: string;
}

/**
 * Which coverage criteria have nothing behind them.
 *
 * Deliberately mechanical rather than a model call: a criterion is unsupported
 * when no extracted fact claims to support it, and that is a set difference,
 * not a judgment. Asking a model whether the record "adequately" supports a
 * criterion invites exactly the softening this function exists to prevent.
 *
 * The result is shown to the specialist before drafting. Gaps are stated
 * plainly and never written around.
 */
export function findGaps(
  criteria: readonly string[],
  facts: readonly { supportsCriterion: string | null }[],
): DocumentationGap[] {
  const supported = new Set(
    facts.map((f) => f.supportsCriterion).filter((c): c is string => c !== null),
  );

  return criteria
    .filter((criterion) => !supported.has(criterion))
    .map((criterion) => ({
      criterion,
      why: 'Nothing in the submitted record speaks to this criterion. Adding documentation that does would strengthen the appeal, and asserting it without support would not.',
    }));
}
