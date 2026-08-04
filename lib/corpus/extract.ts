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

/**
 * And how much text, which is the limit that actually binds.
 *
 * A count on its own is unbounded in size. Twenty five spans of a DAB decision
 * is a few thousand characters; twenty five spans of a CMS manual chapter is
 * forty thousand, and the provider refuses the request outright. That is how
 * the first real extraction run died, on an HTTP 413 that read like a rate
 * limit.
 *
 * The number is characters rather than tokens because tokens cannot be counted
 * without the model's tokeniser, and a tokeniser that disagrees with the
 * provider's is worse than an honest approximation. English legal prose runs
 * about 3.6 characters per token, so this is roughly 5,000 tokens, which fits
 * inside the per request allowance of every free tier checked. Raise it for a
 * paid account with a large context, where fewer, larger calls are faster and
 * give the model more of the document at once.
 */
export const CHARS_PER_EXTRACTION_CALL = 18_000;

/**
 * Group spans into calls that respect both limits.
 *
 * A span that exceeds the character budget on its own still gets its own batch
 * rather than being dropped or truncated: truncating would put text in front of
 * the model that does not match the stored span, and every quote drawn from the
 * truncated part would then fail verification for reasons nobody could see.
 * Better to send it and let the provider decide.
 */
export function batchSpans<T extends { text: string }>(
  spans: readonly T[],
  maxSpans = SPANS_PER_EXTRACTION_CALL,
  maxChars = CHARS_PER_EXTRACTION_CALL,
): T[][] {
  const batches: T[][] = [];
  let current: T[] = [];
  let chars = 0;

  for (const span of spans) {
    const cost = span.text.length + 64; // The span's label and separator.

    if (current.length > 0 && (current.length >= maxSpans || chars + cost > maxChars)) {
      batches.push(current);
      current = [];
      chars = 0;
    }

    current.push(span);
    chars += cost;
  }

  if (current.length > 0) batches.push(current);
  return batches;
}

/**
 * Split a batch the provider refused for being too large.
 *
 * Halving rather than dropping to one span at a time: the limit that was hit is
 * unknown, and probing it one span at a time costs a call per span on a tier
 * that is rate limited by the minute. Returns null when there is nothing left
 * to split, which is a single span the provider will not accept at any size.
 */
export function halveBatch<T>(batch: readonly T[]): [T[], T[]] | null {
  if (batch.length < 2) return null;
  const middle = Math.ceil(batch.length / 2);
  return [batch.slice(0, middle), batch.slice(middle)];
}
