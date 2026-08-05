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

/**
 * A facet the document may simply not state, taken from a model that has
 * several ways of saying so.
 *
 * Measured on a real run: 74 holdings were discarded across seven chapters, and
 * the dominant reason was `outcome: Invalid enum value, received 'null'`. Not
 * JSON null, the four character string. A model asked for a nullable field
 * writes "null", or "none", or "N/A", or an empty string, or the value with
 * different capitalisation, and every one of those is the model correctly
 * saying the document is silent.
 *
 * An unrecognised value becomes null rather than discarding the holding. These
 * three fields are retrieval hints: they decide which cases a holding surfaces
 * for, not whether it is true. A verified quote from a CMS manual with an
 * unknown payer type is still authority, and throwing it away because the model
 * wrote "Medicare" instead of "traditional_medicare" trades something valuable
 * for nothing. The quote is what must be exact, and it is checked separately
 * against its source.
 */
function statedOrNull<const T extends readonly [string, ...string[]]>(values: T) {
  return z.preprocess((raw) => {
    if (raw === null || raw === undefined) return null;
    if (typeof raw !== 'string') return null;

    const normalised = raw.trim().toLowerCase().replace(/[\s-]+/g, '_');
    if (['', 'null', 'none', 'n/a', 'na', 'unknown', 'unspecified'].includes(normalised)) {
      return null;
    }

    return (values as readonly string[]).includes(normalised) ? normalised : null;
  }, z.enum(values).nullable());
}

export const holdingSchema = z.object({
  /** The ordinal of the span the quote comes from, as given in the prompt. */
  spanOrdinal: z.number().int().positive(),
  verbatimQuote: z
    .string()
    .min(24, 'A quote shorter than 24 characters is not evidence of anything.'),
  issue: z.string().min(10),
  ruleApplied: z.string().min(10),
  /**
   * Which way it went, or null for text that decides nothing.
   *
   * Required until the corpus met a manual. A decision has an outcome; a
   * regulation or a manual chapter states a rule and decides nothing, so
   * demanding one made every passage of the CMS manuals a question with no
   * true answer. The model returned something that failed validation and every
   * batch of nine chapters was discarded whole.
   */
  outcome: statedOrNull(['claimant_favorable', 'plan_favorable', 'mixed']),
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
  payerType: statedOrNull([
    'medicare_advantage',
    'traditional_medicare',
    'medicaid_managed_care',
    'commercial',
    'other',
  ]),
  denialBasis: statedOrNull([
    'medical_necessity',
    'level_of_care',
    'not_covered_benefit',
    'insufficient_documentation',
    'proprietary_criteria',
    'administrative',
    'other',
  ]),
});

export type ExtractedHolding = z.infer<typeof holdingSchema>;

/**
 * The envelope, taken loosely, and the holdings inside it strictly.
 *
 * Two separate jobs that were one. Asking Zod to parse the whole response
 * against an array of holdings means a single malformed entry discards the
 * batch, and a small model produces one of those regularly: eighteen batches
 * of CMS manual text were thrown away entire, on nine documents, because
 * something in each failed validation.
 *
 * That is the wrong shape of strictness. A holding that does not parse is
 * discarded exactly like one whose quote is not in its span, and for the same
 * reason, but discarding its neighbours as well buys nothing.
 *
 * The envelope is loose because models disagree about it and none of the
 * disagreements matter: a bare array, an object under some other key, a single
 * holding returned unwrapped. What must be strict is each holding, because that
 * is what becomes a citation.
 */
export const extractionSchema = z.preprocess((raw) => {
  if (Array.isArray(raw)) return { holdings: raw };

  if (raw && typeof raw === 'object') {
    const object = raw as Record<string, unknown>;
    if (Array.isArray(object.holdings)) return { holdings: object.holdings };

    // One array under a name of its own choosing.
    const arrays = Object.values(object).filter(Array.isArray);
    if (arrays.length === 1) return { holdings: arrays[0] };

    // A single holding, unwrapped.
    if ('verbatimQuote' in object) return { holdings: [object] };
  }

  return { holdings: [] };
}, z.object({ holdings: z.array(z.unknown()) }));

export interface ExtractedBatch {
  holdings: ExtractedHolding[];
  /** Why entries were dropped, so a run reports rather than silently thins. */
  discarded: string[];
}

/** Keep the holdings that parse; say what was wrong with the rest. */
export function parseHoldings(entries: readonly unknown[]): ExtractedBatch {
  const holdings: ExtractedHolding[] = [];
  const discarded: string[] = [];

  for (const entry of entries) {
    const parsed = holdingSchema.safeParse(entry);
    if (parsed.success) {
      holdings.push(parsed.data);
      continue;
    }

    // Named fields rather than a Zod dump: "verbatimQuote too short" is
    // actionable, a serialised issue tree is not.
    const reasons = parsed.error.issues
      .map((issue) => `${issue.path.join('.') || '(root)'}: ${issue.message}`)
      .slice(0, 3);
    discarded.push(reasons.join('; '));
  }

  return { holdings, discarded };
}

export const EXTRACTION_SYSTEM_PROMPT = `You extract legal holdings from published Medicare appeal decisions and coverage regulations.

A holding is one proposition the document establishes, anchored to the exact words that establish it. Two kinds of document arrive here and they are not the same:

- A decision, where a holding is what the adjudicator decided.
- A regulation or a manual chapter, where a holding is a rule the text states: a requirement, a coverage condition, a definition, or an exclusion. Nothing is decided, and nothing is being adjudicated.

Both are worth extracting. A manual passage saying what skilled nursing care means is authority in an appeal, and is a perfectly good holding.

Rules, in order of importance:

1. Return nothing rather than guess. An empty holdings array is a correct and expected answer for a document that decides nothing of general application, such as a dismissal on timeliness or a remand on a procedural point. Do not manufacture a holding to avoid returning an empty list.

2. Quote exactly. verbatimQuote must be a character for character copy of a contiguous passage from the span text you were given. Do not correct spelling, do not expand an abbreviation, do not join two separate sentences, do not paraphrase, do not add or remove a word. The quote is checked against the source afterwards and a mismatch discards the holding.

3. Quote minimally. Take the shortest contiguous passage that establishes the proposition, and at least 24 characters. Do not quote a whole paragraph when one sentence carries the point.

4. Never infer beyond the document text. If the decision does not say what service was at issue, serviceType is null. If it does not identify the payer type, payerType is null. Null is not a failure; it is what you write when the document is silent.

5. issue states the question presented, in one sentence, in the document's own terms.

6. ruleApplied states the rule the adjudicator applied, in one sentence. Cite the regulation or manual section by number if the document names one.

7. outcome is from the appellant's perspective: claimant_favorable when the appellant prevailed, plan_favorable when the plan or contractor prevailed, mixed when relief was partial. Use null for a regulation or a manual, which state a rule and decide nothing. Most passages you are given are rule text, so null is the common answer, not the exception.

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

/**
 * How much room the answer gets.
 *
 * This is not the free parameter it looks like. Providers bill a request
 * against a per minute token allowance before running it, and the reservation
 * counts the completion cap as though it will be used in full: a request is
 * charged prompt plus max_tokens whether or not the model writes a word.
 *
 * That is what actually caused the first live extraction to fail. The cap here
 * was 8192, which on a free tier is most of a minute's entire allowance before
 * a single span of the manual had been added to it. The prompt looked like the
 * problem because it is the part that varies, and halving the batch helped just
 * enough to look like the right fix, but a batch of one span carrying an 8192
 * token reservation was still most of the way to the limit on its own.
 *
 * 2048 is generous for what comes back. A batch yields a handful of holdings,
 * each a quote and three short fields, and the largest real response measured
 * was under 900 tokens. A truncated response is not a silent corruption either:
 * it is unparseable JSON, which fails the batch loudly rather than producing a
 * short list that looks complete.
 */
export const EXTRACTION_MAX_OUTPUT_TOKENS = 2048;

export async function extractHoldings(
  citation: string,
  title: string,
  spans: readonly SpanForExtraction[],
  /** Set when the stage has rotated off a model whose allowance is spent. */
  model?: string,
): Promise<LlmResponse<{ holdings: unknown[] }>> {
  return complete({
    stage: 'corpus_extract',
    model,
    system: EXTRACTION_SYSTEM_PROMPT,
    user: buildExtractionPrompt(citation, title, spans),
    schema: extractionSchema as z.ZodType<{ holdings: unknown[] }>,
    // Published government decisions. There is no patient data in this corpus,
    // which is why extraction can run in synthetic mode.
    containsPhi: false,
    maxTokens: EXTRACTION_MAX_OUTPUT_TOKENS,
  });
}

/**
 * How many spans to send at once.
 *
 * Chosen so a long decision arrives in a handful of calls rather than one
 * enormous one: a model asked to hold 200 spans in view returns holdings
 * anchored to spans it half remembers, and those fail verification.
 */
export const SPANS_PER_EXTRACTION_CALL = 60;

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
 * about 3.6 characters per token, so this is roughly 2,800 tokens.
 *
 * Sized so that the fixed cost of a call is a small share of it, which is the
 * opposite of how it was first set and the correction is worth recording.
 *
 * Every call carries the system prompt and the completion reservation whether
 * it needs them or not, about 2,750 tokens between them. At the first value of
 * 10,000 characters the content was also about 2,750 tokens, so half of every
 * request bought nothing. Measured on a real CMS chapter: 1,302 passages, 52
 * calls, 288,000 tokens charged, of which 143,000 was that overhead. The
 * chapter itself is only about 145,000 tokens of text.
 *
 * The instinct is to size this against the per minute allowance so nothing gets
 * refused, and that instinct is wrong twice over. A refused request costs a
 * round trip and no tokens, and the caller halves the batch and continues, so
 * being refused occasionally is cheap. Being conservative on every call is
 * expensive on all of them. So this is set near the largest a request can be
 * and the splitting is left to find the real ceiling, which differs by provider
 * and by model and is not knowable from here anyway.
 */
export const CHARS_PER_EXTRACTION_CALL = 26_000;

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

/**
 * Roughly what the system prompt above costs, for the estimate command.
 *
 * A constant rather than a measurement because it only moves when that prompt
 * is edited, and being out by fifty tokens does not change any decision the
 * estimate is used to make.
 */
export const EXTRACTION_SYSTEM_TOKENS = Math.ceil(EXTRACTION_SYSTEM_PROMPT.length / 3.6);
