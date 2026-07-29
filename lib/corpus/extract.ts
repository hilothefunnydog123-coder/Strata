/**
 * Turning a decision into holdings.
 *
 * A holding is one legal proposition, anchored to the exact words that support
 * it. The extraction prompt below is the most important prose in this codebase
 * after the verification module, because everything the product later asserts
 * about the law comes through it.
 *
 * The prompt's instructions are shaped around one goal: make silence cheaper
 * than invention. A model asked to "extract the holdings" from a document with
 * none will produce some. A model told that returning an empty list is a
 * correct and expected answer will return one.
 */
import { z } from 'zod';
import { complete, type LlmResponse } from '@/lib/llm/client';

export const holdingSchema = z.object({
  /** The ordinal of the span the quote comes from, as given in the prompt. */
  spanOrdinal: z.number().int().positive(),
  verbatimQuote: z
    .string()
    .min(24, 'A quote shorter than 24 characters is not evidence of anything.'),
  issue: z.string().min(10),
  ruleApplied: z.string().min(10),
  outcome: z.enum(['claimant_favorable', 'plan_favorable', 'mixed']),
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
  payerType: z
    .enum([
      'medicare_advantage',
      'traditional_medicare',
      'medicaid_managed_care',
      'commercial',
      'other',
    ])
    .nullable(),
  denialBasis: z
    .enum([
      'medical_necessity',
      'level_of_care',
      'not_covered_benefit',
      'insufficient_documentation',
      'proprietary_criteria',
      'administrative',
      'other',
    ])
    .nullable(),
});

export type ExtractedHolding = z.infer<typeof holdingSchema>;

export const extractionSchema = z.object({
  holdings: z.array(holdingSchema),
});

export const EXTRACTION_SYSTEM_PROMPT = `You extract legal holdings from published Medicare appeal decisions and coverage regulations.

A holding is one proposition the adjudicator actually decided or applied, anchored to the exact words in the document that establish it.

Rules, in order of importance:

1. Return nothing rather than guess. An empty holdings array is a correct and expected answer for a document that decides nothing of general application, such as a dismissal on timeliness or a remand on a procedural point. Do not manufacture a holding to avoid returning an empty list.

2. Quote exactly. verbatimQuote must be a character for character copy of a contiguous passage from the span text you were given. Do not correct spelling, do not expand an abbreviation, do not join two separate sentences, do not paraphrase, do not add or remove a word. The quote is checked against the source afterwards and a mismatch discards the holding.

3. Quote minimally. Take the shortest contiguous passage that establishes the proposition, and at least 24 characters. Do not quote a whole paragraph when one sentence carries the point.

4. Never infer beyond the document text. If the decision does not say what service was at issue, serviceType is null. If it does not identify the payer type, payerType is null. Null is not a failure; it is what you write when the document is silent.

5. issue states the question presented, in one sentence, in the document's own terms.

6. ruleApplied states the rule the adjudicator applied, in one sentence. Cite the regulation or manual section by number if the document names one.

7. outcome is from the appellant's perspective: claimant_favorable when the appellant prevailed, plan_favorable when the plan or contractor prevailed, mixed when relief was partial.

8. spanOrdinal must be the ordinal of the span your quote came from, exactly as labelled in the input. A quote assembled from two spans is not a quote.

Return only JSON of the shape {"holdings": [...]}. No preamble, no commentary, no markdown fence.`;

export interface SpanForExtraction {
  ordinal: number;
  text: string;
  headingPath: string[];
}

/**
 * Build the user message.
 *
 * Spans are labelled with their ordinal so a returned holding can be tied back
 * to a database row, and with their heading trail so the model can tell an
 * analysis section from a recitation of the parties' arguments. That
 * distinction matters: what a party argued is not what the adjudicator held.
 */
export function buildExtractionPrompt(
  citation: string,
  title: string,
  spans: readonly SpanForExtraction[],
): string {
  const body = spans
    .map((span) => {
      const trail = span.headingPath.length > 0 ? ` [${span.headingPath.join(' > ')}]` : '';
      return `--- span ${span.ordinal}${trail} ---\n${span.text}`;
    })
    .join('\n\n');

  return `Document: ${citation}
Title: ${title}

${body}`;
}

export async function extractHoldings(
  citation: string,
  title: string,
  spans: readonly SpanForExtraction[],
): Promise<LlmResponse<z.infer<typeof extractionSchema>>> {
  return complete({
    stage: 'corpus_extract',
    system: EXTRACTION_SYSTEM_PROMPT,
    user: buildExtractionPrompt(citation, title, spans),
    schema: extractionSchema,
    // Published government decisions. There is no patient data in this corpus,
    // which is why extraction can run in synthetic mode.
    containsPhi: false,
    maxTokens: 8192,
  });
}

/**
 * How many spans to send at once.
 *
 * Chosen so a long decision arrives in a handful of calls rather than one
 * enormous one: a model asked to hold 200 spans in view returns holdings
 * anchored to spans it half remembers, and those fail verification.
 */
export const SPANS_PER_EXTRACTION_CALL = 25;

export function batchSpans<T>(spans: readonly T[], size = SPANS_PER_EXTRACTION_CALL): T[][] {
  const batches: T[][] = [];
  for (let i = 0; i < spans.length; i += size) {
    batches.push(spans.slice(i, i + size));
  }
  return batches;
}
