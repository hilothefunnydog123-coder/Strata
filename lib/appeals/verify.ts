/**
 * The citation invariant.
 *
 *   No assertion in a generated appeal letter may exist without a verbatim
 *   quote from a source that is programmatically verified to contain it.
 *
 * This module is level three of four. Level one is the type system: the
 * constructor in lib/appeals/assertion.ts has no path that omits a source or a
 * quote. Level two is the database: NOT NULL and foreign keys. Level four is
 * the interface, where every assertion is click-to-source.
 *
 * Level three is here, and it is the one that catches a model that made
 * something up.
 *
 * The comparison is not string equality, because a faithful quote can differ
 * from its source in ways that carry no meaning: a PDF extractor turns a
 * typographic quote into an apostrophe, a line break lands mid-sentence, a
 * non-breaking space appears between a section symbol and its number. Those are
 * artefacts of transport, not changes to what was said.
 *
 * What normalisation deliberately does NOT do is repair a quote. Dropping
 * punctuation entirely would let "the plan may not apply criteria" match a
 * source that says "the plan may not apply criteria, unless...". Every rule
 * below either maps a character to its canonical form or collapses whitespace.
 * Nothing is deleted, and word order and word content are untouched.
 *
 * A failure is discarded and logged, never repaired. If any assertion in a
 * draft fails, the whole draft is rejected and regenerated.
 */

/** Characters that mean the same thing but arrive in different shapes. */
const CHARACTER_EQUIVALENTS: ReadonlyArray<[RegExp, string]> = [
  // Quotation marks and apostrophes: curly, straight, and their doubles.
  [/[\u2018\u2019\u201a\u201b\u2032\u00b4`]/g, "'"],
  [/[\u201c\u201d\u201e\u201f\u2033]/g, '"'],
  // Dashes and hyphens of every width, including the soft hyphen a PDF inserts
  // at a line break. Mapped to a plain hyphen rather than removed.
  [/[\u2010\u2011\u2012\u2013\u2014\u2015\u2212\u00ad]/g, '-'],
  // Ellipsis to three stops, which is how a legal quotation elides.
  [/\u2026/g, '...'],
  // Every flavour of space, including non-breaking and the thin spaces a
  // typesetter puts after a section symbol, to a single ordinary space.
  [/[   -   　]/g, ' '],
  // Zero width characters carry no meaning and no width. They are removed
  // because they are not characters in any reading sense.
  [/[​‌‍﻿]/g, ''],
];

/**
 * Put a string into the form both sides are compared in.
 *
 * Unicode NFKC first, so composed and decomposed accents agree and ligatures
 * expand. Then the equivalence table. Then whitespace collapses to single
 * spaces, which is what makes a quote spanning a PDF line break match.
 * Case is folded last: a source that shouts a heading and a quote that does not
 * are the same quote.
 */
export function normalizeForComparison(input: string): string {
  let out = input.normalize('NFKC');
  for (const [pattern, replacement] of CHARACTER_EQUIVALENTS) {
    out = out.replace(pattern, replacement);
  }
  return out.replace(/\s+/g, ' ').trim().toLowerCase();
}

export type VerificationFailure =
  | 'empty_quote'
  | 'quote_too_short'
  | 'source_missing'
  | 'not_found_in_source';

export type VerificationResult =
  | { ok: true; charStart: number; charEnd: number }
  | { ok: false; reason: VerificationFailure };

/**
 * A quote shorter than this is not evidence of anything. "The plan" appears in
 * every decision ever written, so a match on it says nothing about whether the
 * source supports the assertion.
 */
const MINIMUM_QUOTE_CHARS = 24;

/**
 * Verify one quote against one source text.
 *
 * On success the character offsets returned are into the ORIGINAL source
 * string, not the normalised one, so the interface can highlight the real
 * passage. That mapping is the fiddly part and it is why this returns offsets
 * rather than a boolean.
 */
export function verifyQuote(quote: string, sourceText: string): VerificationResult {
  if (!quote || quote.trim().length === 0) {
    return { ok: false, reason: 'empty_quote' };
  }
  if (!sourceText || sourceText.trim().length === 0) {
    return { ok: false, reason: 'source_missing' };
  }
  if (quote.trim().length < MINIMUM_QUOTE_CHARS) {
    return { ok: false, reason: 'quote_too_short' };
  }

  const needle = normalizeForComparison(quote);
  if (needle.length === 0) return { ok: false, reason: 'empty_quote' };

  // Build the normalised source alongside a map from each normalised character
  // back to its index in the original, so a hit can be reported in real offsets.
  const { normalized: haystack, indexMap } = normalizeWithIndexMap(sourceText);

  const at = haystack.indexOf(needle);
  if (at === -1) return { ok: false, reason: 'not_found_in_source' };

  const charStart = indexMap[at] ?? 0;
  const lastNormalizedIndex = at + needle.length - 1;
  const charEnd = (indexMap[lastNormalizedIndex] ?? sourceText.length - 1) + 1;

  return { ok: true, charStart, charEnd };
}

/**
 * Normalise while recording, for each output character, the index of the input
 * character that produced it.
 *
 * Done character by character rather than with the regex table, because a
 * bulk replace loses the correspondence. The two paths must agree, which is
 * why tests/verify.test.ts checks that this function's output matches
 * normalizeForComparison for the same input.
 */
function normalizeWithIndexMap(input: string): {
  normalized: string;
  indexMap: number[];
} {
  const out: string[] = [];
  const indexMap: number[] = [];
  let pendingSpace = false;

  for (let i = 0; i < input.length; i += 1) {
    const original = input[i]!;
    let mapped = original.normalize('NFKC');

    for (const [pattern, replacement] of CHARACTER_EQUIVALENTS) {
      // Fresh regex each time: the shared ones carry the global flag's lastIndex.
      mapped = mapped.replace(new RegExp(pattern.source, 'gu'), replacement);
    }

    if (mapped.length === 0) continue;

    if (/^\s+$/.test(mapped)) {
      pendingSpace = true;
      continue;
    }

    if (pendingSpace) {
      if (out.length > 0) {
        out.push(' ');
        indexMap.push(i);
      }
      pendingSpace = false;
    }

    for (const char of mapped.toLowerCase()) {
      out.push(char);
      indexMap.push(i);
    }
  }

  return { normalized: out.join(''), indexMap };
}

/* ─── Draft level verification ────────────────────────────────────────────── */

export interface AssertionCandidate {
  ordinal: number;
  kind: 'legal' | 'clinical';
  section: string;
  text: string;
  sourceKind: 'holding' | 'source_span' | 'clinical_fact';
  sourceId: string;
  verbatimQuote: string;
}

export interface VerifiedAssertion extends AssertionCandidate {
  charStart: number;
  charEnd: number;
}

export interface RejectedAssertion extends AssertionCandidate {
  reason: VerificationFailure;
}

export interface DraftVerification {
  /** True only when every candidate verified. A draft is all or nothing. */
  ok: boolean;
  verified: VerifiedAssertion[];
  rejected: RejectedAssertion[];
  failureRate: number;
}

/**
 * Verify a whole draft.
 *
 * `resolveSource` returns the text of the source an assertion points at, or
 * null if that source does not exist. A source that cannot be resolved is a
 * failure rather than a skip: an assertion citing a record that is not there is
 * exactly the fabrication this whole mechanism exists to catch.
 */
export function verifyDraft(
  candidates: readonly AssertionCandidate[],
  resolveSource: (kind: AssertionCandidate['sourceKind'], id: string) => string | null,
): DraftVerification {
  const verified: VerifiedAssertion[] = [];
  const rejected: RejectedAssertion[] = [];

  for (const candidate of candidates) {
    const sourceText = resolveSource(candidate.sourceKind, candidate.sourceId);

    if (sourceText === null) {
      rejected.push({ ...candidate, reason: 'source_missing' });
      continue;
    }

    const result = verifyQuote(candidate.verbatimQuote, sourceText);
    if (result.ok) {
      verified.push({ ...candidate, charStart: result.charStart, charEnd: result.charEnd });
    } else {
      rejected.push({ ...candidate, reason: result.reason });
    }
  }

  const total = candidates.length;
  return {
    ok: total > 0 && rejected.length === 0,
    verified,
    rejected,
    failureRate: total === 0 ? 0 : rejected.length / total,
  };
}
