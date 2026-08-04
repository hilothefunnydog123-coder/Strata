/**
 * How much gets sent in one call.
 *
 * This was a count and nothing else, and the count was the wrong unit. Twenty
 * five spans of a Departmental Appeals Board decision is a few thousand
 * characters. Twenty five spans of a CMS manual chapter is forty thousand, and
 * a free tier refuses that outright: the first live extraction run returned
 * HTTP 413 on the first call and never got past it.
 *
 * A count is unbounded in size, so the size has to be the limit, and the count
 * stays as a second ceiling because a model asked to hold too many passages in
 * view starts anchoring quotes to spans it half remembers.
 */
import { describe, expect, it } from 'vitest';
import {
  batchSpans,
  buildExtractionPrompt,
  CHARS_PER_EXTRACTION_CALL,
  halveBatch,
  SPANS_PER_EXTRACTION_CALL,
} from '@/lib/corpus/extract';

/** Spans of a given size, shaped like the rows the pipeline passes in. */
function spans(count: number, chars: number) {
  return Array.from({ length: count }, (_, i) => ({
    ordinal: i + 1,
    text: 'x'.repeat(chars),
    headingPath: [],
  }));
}

function charsIn(batch: { text: string }[]): number {
  return batch.reduce((n, s) => n + s.text.length, 0);
}

describe('batching by size as well as by count', () => {
  it('keeps a batch under the character budget', () => {
    // The case that broke: spans large enough that the old count of 25 was far
    // past any free tier's per request allowance.
    const batches = batchSpans(spans(40, 4_000));

    expect(batches.length).toBeGreaterThan(1);
    for (const batch of batches) {
      expect(charsIn(batch)).toBeLessThanOrEqual(CHARS_PER_EXTRACTION_CALL);
    }
  });

  it('still caps the count when the spans are small', () => {
    // Short spans would otherwise pack hundreds into one call, which is a
    // different failure: the quotes come back anchored to the wrong ordinal.
    const batches = batchSpans(spans(200, 50));

    expect(batches.every((b) => b.length <= SPANS_PER_EXTRACTION_CALL)).toBe(true);
    expect(batches[0]).toHaveLength(SPANS_PER_EXTRACTION_CALL);
  });

  it('loses no span and keeps them in order', () => {
    // Splitting that drops a passage would silently narrow the corpus, and
    // nothing downstream can tell a document with no holdings from a document
    // whose holdings were never looked at.
    const input = spans(97, 1_500);
    const flat = batchSpans(input).flat();

    expect(flat).toHaveLength(97);
    expect(flat.map((s) => s.ordinal)).toEqual(input.map((s) => s.ordinal));
  });

  it('gives an oversized span its own call rather than truncating it', () => {
    // Truncating would put text in front of the model that does not match the
    // stored span, so every quote drawn from the cut part would fail
    // verification for a reason invisible to whoever went looking.
    const input = [
      { ordinal: 1, text: 'a'.repeat(200), headingPath: [] },
      { ordinal: 2, text: 'b'.repeat(CHARS_PER_EXTRACTION_CALL * 2), headingPath: [] },
      { ordinal: 3, text: 'c'.repeat(200), headingPath: [] },
    ];

    const batches = batchSpans(input);

    const alone = batches.find((b) => b.some((s) => s.ordinal === 2));
    expect(alone).toHaveLength(1);
    expect(alone![0]!.text).toHaveLength(CHARS_PER_EXTRACTION_CALL * 2);
  });

  it('counts the labels, not just the text', () => {
    // Each span arrives wrapped in "--- span N [heading] ---", and a batch of
    // small spans is mostly wrapper. Ignoring it puts the real request over a
    // budget the batcher thinks it is under.
    const input = spans(SPANS_PER_EXTRACTION_CALL, 400);
    const [batch] = batchSpans(input);
    const prompt = buildExtractionPrompt('DAB No. 1', 'A decision', batch!);

    expect(prompt.length).toBeLessThanOrEqual(CHARS_PER_EXTRACTION_CALL);
  });
});

describe('halving a batch the provider refused', () => {
  it('splits in two, losing nothing', () => {
    const halves = halveBatch([1, 2, 3, 4, 5]);

    expect(halves).not.toBeNull();
    expect([...halves![0], ...halves![1]]).toEqual([1, 2, 3, 4, 5]);
  });

  it('always makes progress, so the retry loop terminates', () => {
    // A split that returned the original batch on either side would retry the
    // same refused request forever. Against a rate limited provider that is
    // not a hang, it is a hang that bills.
    for (const size of [2, 3, 7, 25]) {
      const batch = Array.from({ length: size }, (_, i) => i);
      const halves = halveBatch(batch)!;

      expect(halves[0].length).toBeGreaterThan(0);
      expect(halves[1].length).toBeGreaterThan(0);
      expect(halves[0].length).toBeLessThan(size);
      expect(halves[1].length).toBeLessThan(size);
    }
  });

  it('reports that a single span cannot be split', () => {
    // The caller has to tell "try again smaller" apart from "this will never
    // fit", because the second one means a passage is being dropped and that
    // has to be said out loud rather than retried.
    expect(halveBatch(['one span'])).toBeNull();
    expect(halveBatch([])).toBeNull();
  });
});
