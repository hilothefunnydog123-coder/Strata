/**
 * The citation invariant, tested from both sides.
 *
 * The tests that matter most are the ones asserting a quote is REJECTED. It is
 * easy to write a comparison lenient enough that everything passes; the whole
 * value of this mechanism is that it says no to a quote the source does not
 * contain. So for every normalisation rule there is a paired test showing it
 * does not also swallow a substantive difference.
 */
import { describe, expect, it } from 'vitest';
import {
  normalizeForComparison,
  verifyDraft,
  verifyQuote,
  type AssertionCandidate,
} from '@/lib/appeals/verify';

const DECISION_TEXT =
  'The Council has consistently held that a Medicare Advantage organization may not ' +
  'apply coverage criteria more restrictive than those used in Traditional Medicare. ' +
  'The plan relied on its internal criteria, which impose a functional improvement ' +
  'requirement found nowhere in the Medicare Benefit Policy Manual. That reliance was ' +
  'error, and the denial is reversed.';

const CHART_TEXT =
  'Nursing note 01/14: Patient requires skilled observation and assessment for ' +
  'anticoagulation management following pulmonary embolism. Daily INR monitoring with ' +
  'dose adjustment per protocol. Wound care to left heel pressure injury, stage 3.';

describe('normalizeForComparison', () => {
  it('is idempotent', () => {
    const once = normalizeForComparison(DECISION_TEXT);
    expect(normalizeForComparison(once)).toBe(once);
  });

  it('folds typographic characters onto their plain equivalents', () => {
    expect(normalizeForComparison('the plan’s criteria')).toBe("the plan's criteria");
    expect(normalizeForComparison('“skilled care”')).toBe('"skilled care"');
    expect(normalizeForComparison('42 CFR 422.101\u2014the rule')).toBe(
      '42 cfr 422.101-the rule',
    );
  });

  it('collapses every kind of whitespace', () => {
    expect(normalizeForComparison('skilled\n\n   nursing\tcare')).toBe(
      'skilled nursing care',
    );
    expect(normalizeForComparison('§ 422.101')).toBe('§ 422.101');
  });

  it('removes zero width characters, which have no reading', () => {
    expect(normalizeForComparison('skil​led')).toBe('skilled');
  });
});

describe('verifyQuote: quotes that should pass', () => {
  it('accepts an exact quote', () => {
    const quote =
      'a Medicare Advantage organization may not apply coverage criteria more restrictive';
    const result = verifyQuote(quote, DECISION_TEXT);
    expect(result.ok).toBe(true);
  });

  it('returns offsets into the original text, not the normalised one', () => {
    const quote = 'apply coverage criteria more restrictive than those used';
    const result = verifyQuote(quote, DECISION_TEXT);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    // The slice of the ORIGINAL string at those offsets is the quoted passage.
    expect(DECISION_TEXT.slice(result.charStart, result.charEnd)).toBe(quote);
  });

  it('accepts a quote broken across a line break, as a PDF extractor leaves it', () => {
    const source = 'The plan relied on its internal\ncriteria, which impose a functional improvement requirement.';
    const quote = 'The plan relied on its internal criteria, which impose a functional improvement';
    expect(verifyQuote(quote, source).ok).toBe(true);
  });

  it('accepts a quote whose apostrophe was straightened in transit', () => {
    const source = 'The organization’s own criteria are more restrictive than Medicare requires.';
    const quote = "The organization's own criteria are more restrictive";
    expect(verifyQuote(quote, source).ok).toBe(true);
  });

  it('accepts a quote that differs only in case', () => {
    const source = 'SKILLED NURSING SERVICES WERE REQUIRED ON A DAILY BASIS throughout the stay.';
    const quote = 'Skilled nursing services were required on a daily basis';
    expect(verifyQuote(quote, source).ok).toBe(true);
  });

  it('accepts a quote with a soft hyphen from a justified line', () => {
    const source = 'The beneficiary required skilled re­habilitation services five days a week.';
    const quote = 'skilled re-habilitation services five days a week';
    expect(verifyQuote(quote, source).ok).toBe(true);
  });
});

describe('verifyQuote: quotes that must be rejected', () => {
  it('rejects a quote the source does not contain', () => {
    const result = verifyQuote(
      'the plan is required to reimburse the provider in full within thirty days',
      DECISION_TEXT,
    );
    expect(result).toEqual({ ok: false, reason: 'not_found_in_source' });
  });

  it('rejects a quote with a word changed, however small', () => {
    // "may not" became "need not". Normalisation must not paper over this.
    const result = verifyQuote(
      'a Medicare Advantage organization need not apply coverage criteria more restrictive',
      DECISION_TEXT,
    );
    expect(result.ok).toBe(false);
  });

  it('rejects a quote with a negation dropped', () => {
    const result = verifyQuote(
      'a Medicare Advantage organization may apply coverage criteria more restrictive',
      DECISION_TEXT,
    );
    expect(result.ok).toBe(false);
  });

  it('rejects a quote that silently elides a qualifying clause', () => {
    const source =
      'The plan may deny coverage where the record shows no skilled need, provided the plan first obtains a physician review.';
    const quote = 'The plan may deny coverage where the record shows no skilled need the plan first obtains';
    expect(verifyQuote(quote, source).ok).toBe(false);
  });

  it('rejects a quote with words reordered', () => {
    const result = verifyQuote(
      'coverage criteria may not apply a Medicare Advantage organization more restrictive',
      DECISION_TEXT,
    );
    expect(result.ok).toBe(false);
  });

  it('rejects a quote too short to be evidence of anything', () => {
    expect(verifyQuote('The plan', DECISION_TEXT)).toEqual({
      ok: false,
      reason: 'quote_too_short',
    });
  });

  it('rejects an empty quote', () => {
    expect(verifyQuote('', DECISION_TEXT)).toEqual({ ok: false, reason: 'empty_quote' });
    expect(verifyQuote('    ', DECISION_TEXT)).toEqual({
      ok: false,
      reason: 'empty_quote',
    });
  });

  it('rejects when the source is empty', () => {
    expect(verifyQuote('a quote long enough to clear the minimum', '')).toEqual({
      ok: false,
      reason: 'source_missing',
    });
  });

  it('rejects a punctuation change that alters the meaning', () => {
    // The source says coverage is denied. The quote says it is not.
    const source = 'Coverage is denied. The appeal fails on the documentation submitted.';
    const quote = 'Coverage is denied the appeal fails on the documentation';
    expect(verifyQuote(quote, source).ok).toBe(false);
  });
});

describe('verifyDraft', () => {
  const SOURCES: Record<string, string> = {
    'holding-1': DECISION_TEXT,
    'fact-1': CHART_TEXT,
  };

  const resolve = (_kind: AssertionCandidate['sourceKind'], id: string) =>
    SOURCES[id] ?? null;

  function candidate(over: Partial<AssertionCandidate> = {}): AssertionCandidate {
    return {
      ordinal: 1,
      kind: 'legal',
      section: 'argument',
      text: 'The plan applied criteria more restrictive than Traditional Medicare.',
      sourceKind: 'holding',
      sourceId: 'holding-1',
      verbatimQuote:
        'may not apply coverage criteria more restrictive than those used in Traditional Medicare',
      ...over,
    };
  }

  it('passes a draft in which every assertion resolves', () => {
    const result = verifyDraft(
      [
        candidate(),
        candidate({
          ordinal: 2,
          kind: 'clinical',
          sourceKind: 'clinical_fact',
          sourceId: 'fact-1',
          verbatimQuote: 'skilled observation and assessment for anticoagulation management',
        }),
      ],
      resolve,
    );

    expect(result.ok).toBe(true);
    expect(result.verified).toHaveLength(2);
    expect(result.rejected).toHaveLength(0);
    expect(result.failureRate).toBe(0);
  });

  it('fails the whole draft when one assertion fails', () => {
    const result = verifyDraft(
      [
        candidate(),
        candidate({ ordinal: 2, verbatimQuote: 'the plan must reimburse within thirty days' }),
      ],
      resolve,
    );

    expect(result.ok).toBe(false);
    expect(result.rejected).toHaveLength(1);
    expect(result.rejected[0]!.ordinal).toBe(2);
    expect(result.failureRate).toBe(0.5);
  });

  it('fails an assertion citing a source that does not exist', () => {
    const result = verifyDraft([candidate({ sourceId: 'holding-does-not-exist' })], resolve);
    expect(result.ok).toBe(false);
    expect(result.rejected[0]!.reason).toBe('source_missing');
  });

  it('does not call an empty draft verified', () => {
    const result = verifyDraft([], resolve);
    expect(result.ok).toBe(false);
  });

  it('never moves a rejected assertion into the verified set', () => {
    const result = verifyDraft(
      [candidate(), candidate({ ordinal: 2, verbatimQuote: 'invented text not in any source' })],
      resolve,
    );
    const verifiedOrdinals = result.verified.map((a) => a.ordinal);
    const rejectedOrdinals = result.rejected.map((a) => a.ordinal);
    expect(verifiedOrdinals).not.toContain(2);
    expect(rejectedOrdinals).toContain(2);
    expect(new Set([...verifiedOrdinals, ...rejectedOrdinals]).size).toBe(2);
  });
});
