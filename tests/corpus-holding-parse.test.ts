/**
 * A field the document does not state, said in the several ways a model says it.
 *
 * These are the entries a real extraction run produced. Run 19 wrote 31
 * holdings and discarded 74, and the dominant discard reason across seven
 * chapters was `outcome: Invalid enum value, received 'null'`: not JSON null,
 * the four character string, sent by a model correctly reporting that a manual
 * chapter decides nothing. The quotes in those 74 were fine. The corpus threw
 * away more than twice what it kept over a spelling of "not applicable".
 *
 * So the strictness moved to where it earns its keep. The quote must be exact,
 * and it is checked separately against the span it claims to come from. The
 * four enum fields are retrieval hints, deciding which cases a holding surfaces
 * for rather than whether it is true, and an unreadable hint is worth less than
 * the verified authority attached to it.
 */
import { describe, expect, it } from 'vitest';
import { holdingSchema, parseHoldings } from '@/lib/corpus/extract';

/** A holding that is complete apart from whatever the test is varying. */
function holding(overrides: Record<string, unknown> = {}) {
  return {
    spanOrdinal: 3,
    verbatimQuote:
      'The skilled nursing facility benefit requires a qualifying hospital stay of three consecutive days.',
    issue: 'Whether the three day inpatient stay requirement was met',
    ruleApplied: 'A qualifying hospital stay must be three consecutive days, not counting discharge',
    outcome: null,
    serviceType: 'skilled_nursing',
    payerType: 'traditional_medicare',
    denialBasis: 'level_of_care',
    ...overrides,
  };
}

describe('a facet the document does not state', () => {
  it('accepts the string "null", which is how the run actually failed', () => {
    // Verbatim from run 19's discard log, seven chapters over:
    // outcome: Invalid enum value, expected 'claimant_favorable' |
    // 'plan_favorable' | 'mixed', received 'null'.
    const parsed = holdingSchema.safeParse(holding({ outcome: 'null' }));

    expect(parsed.success).toBe(true);
    expect(parsed.success && parsed.data.outcome).toBeNull();
  });

  it.each(['null', 'none', 'N/A', 'n/a', 'NA', '', '   ', 'unknown', 'Unspecified'])(
    'reads %o as "the document is silent"',
    (written) => {
      const parsed = holdingSchema.safeParse(holding({ outcome: written }));

      expect(parsed.success).toBe(true);
      expect(parsed.success && parsed.data.outcome).toBeNull();
    },
  );

  it('still accepts an absent field and a real JSON null', () => {
    expect(holdingSchema.parse(holding({ outcome: null })).outcome).toBeNull();

    const { outcome: _omitted, ...withoutOutcome } = holding();
    expect(holdingSchema.parse(withoutOutcome).outcome).toBeNull();
  });

  it('keeps a value the model wrote in its own casing or spacing', () => {
    // "Claimant Favorable" and "claimant-favorable" are the same answer as
    // claimant_favorable, and discarding them loses a real decision.
    expect(holdingSchema.parse(holding({ outcome: 'Claimant Favorable' })).outcome).toBe(
      'claimant_favorable',
    );
    expect(holdingSchema.parse(holding({ outcome: 'plan-favorable' })).outcome).toBe(
      'plan_favorable',
    );
    expect(holdingSchema.parse(holding({ serviceType: ' Skilled Nursing ' })).serviceType).toBe(
      'skilled_nursing',
    );
  });

  it('drops an unreadable hint rather than the holding carrying it', () => {
    // A quote verified against a CMS manual is authority whatever the model
    // called the payer. Null means "do not use this to filter", which is
    // correct, and is the same thing the field already means.
    const parsed = holdingSchema.safeParse(
      holding({ payerType: 'Medicare', denialBasis: 'because the stay was too short' }),
    );

    expect(parsed.success).toBe(true);
    expect(parsed.success && parsed.data.payerType).toBeNull();
    expect(parsed.success && parsed.data.denialBasis).toBeNull();
  });

  it('applies to every facet, not just the one that was noticed', () => {
    const parsed = holdingSchema.parse(
      holding({
        outcome: 'null',
        serviceType: 'null',
        payerType: 'N/A',
        denialBasis: 'none',
      }),
    );

    expect(parsed).toMatchObject({
      outcome: null,
      serviceType: null,
      payerType: null,
      denialBasis: null,
    });
  });
});

describe('what a soft facet does not excuse', () => {
  it('still refuses a holding with no usable quote', () => {
    // The quote is the whole product. Everything else on a holding describes
    // it; this is the thing a letter cites, and it is checked character for
    // character against its source before it can be used.
    expect(holdingSchema.safeParse(holding({ verbatimQuote: 'See above.' })).success).toBe(false);
    expect(holdingSchema.safeParse(holding({ verbatimQuote: '' })).success).toBe(false);
  });

  it('still refuses a holding that cannot say where it came from', () => {
    expect(holdingSchema.safeParse(holding({ spanOrdinal: 0 })).success).toBe(false);
    expect(holdingSchema.safeParse(holding({ spanOrdinal: 'three' })).success).toBe(false);
    expect(holdingSchema.safeParse(holding({ spanOrdinal: 2.5 })).success).toBe(false);
  });

  it('still refuses a holding that states no rule', () => {
    expect(holdingSchema.safeParse(holding({ ruleApplied: 'n/a' })).success).toBe(false);
    expect(holdingSchema.safeParse(holding({ issue: 'coverage' })).success).toBe(false);
  });
});

describe('a batch where some entries are bad', () => {
  it('keeps the good ones and names what was wrong with the rest', () => {
    const batch = parseHoldings([
      holding({ outcome: 'null' }),
      holding({ verbatimQuote: 'too short' }),
      holding({ payerType: 'Medicare' }),
    ]);

    expect(batch.holdings).toHaveLength(2);
    expect(batch.discarded).toHaveLength(1);
    expect(batch.discarded[0]).toContain('verbatimQuote');
  });

  it('reports nothing discarded when a batch is entirely soft-field noise', () => {
    // The measured case: nine chapters of manual text, every outcome written
    // "null", the whole batch previously lost. Silence in the discard log is
    // the point, because a run that reports 74 discards is a run someone has
    // to read.
    const batch = parseHoldings(
      Array.from({ length: 9 }, (_, i) =>
        holding({ spanOrdinal: i + 1, outcome: 'null', payerType: 'none' }),
      ),
    );

    expect(batch.holdings).toHaveLength(9);
    expect(batch.discarded).toEqual([]);
  });
});
