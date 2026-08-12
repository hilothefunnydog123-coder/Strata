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

/**
 * The envelope taken loosely, each fact inside it strictly.
 *
 * The third time this codebase has met the same failure and the second time it
 * has been fixed by copying lib/corpus/extract.ts. Asking Zod for an array of
 * facts means one malformed entry discards the batch, and on the first real run
 * two facts arrived without spanOrdinal or factType, which threw away the four
 * good ones beside them and ended the appeal.
 *
 * A fact that does not parse is dropped exactly like a fact whose quote is not
 * in the span it cites, and for the same reason. Dropping its neighbours as
 * well buys nothing. What stays strict is each fact, because each one becomes a
 * clinical assertion in a letter that a reviewer checks against the chart.
 */
export const factExtractionSchema = z.preprocess((raw) => {
  if (Array.isArray(raw)) return { facts: raw };

  if (raw && typeof raw === 'object') {
    const object = raw as Record<string, unknown>;
    if (Array.isArray(object.facts)) return { facts: object.facts };

    const arrays = Object.values(object).filter(Array.isArray);
    if (arrays.length === 1) return { facts: arrays[0] };

    if ('verbatimQuote' in object) return { facts: [object] };
  }

  return { facts: [] };
}, z.object({ facts: z.array(z.unknown()) }));

export interface ExtractedFacts {
  facts: ExtractedFact[];
  /** Why entries were dropped, so a run reports rather than silently thins. */
  discarded: string[];
}

/** Keep the facts that parse; say what was wrong with the rest. */
export function parseFacts(entries: readonly unknown[]): ExtractedFacts {
  const facts: ExtractedFact[] = [];
  const discarded: string[] = [];

  for (const entry of entries) {
    const parsed = clinicalFactSchema.safeParse(entry);
    if (parsed.success) {
      facts.push(parsed.data);
      continue;
    }

    discarded.push(
      parsed.error.issues
        .map((issue) => `${issue.path.join('.') || '(root)'}: ${issue.message}`)
        .slice(0, 3)
        .join('; '),
    );
  }

  return { facts, discarded };
}

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
  options: { containsPhi: boolean; denialId: string; model?: string },
): Promise<LlmResponse<{ facts: unknown[] }>> {
  return complete({
    stage: 'fact_extract',
    system: FACT_EXTRACTION_SYSTEM_PROMPT,
    user: buildFactExtractionPrompt(criteria, spans),
    model: options.model,
    schema: factExtractionSchema as z.ZodType<{ facts: unknown[] }>,
    containsPhi: options.containsPhi,
    denialId: options.denialId,
    // Not 8192, which is what this reserved and what got it refused outright.
    //
    // A provider bills a request against its per request limit counting the
    // completion cap as though it will be used in full, so an 8192 reservation
    // is most of a free tier's allowance before a word of the record is added
    // to it. lib/corpus/extract.ts found this first and its comment says so at
    // length; extraction came down to 2048 and has been fine there ever since.
    //
    // 2048 is generous for what comes back here too. Facts are short: a quote,
    // a type, and a normalised sentence each. A record yielding more than about
    // twenty of them is unusual, and the envelope drops what does not parse
    // rather than failing, so a cut off answer costs the tail of a list instead
    // of the appeal.
    maxTokens: 2048,
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
