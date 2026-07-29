/**
 * The contingency fee calculation.
 *
 * This is the billing system, so a bug here is a customer being overcharged or
 * an invoice that does not reconcile against their own remittance advice.
 * The tests are written around the three things that would actually go wrong:
 * float arithmetic creeping into money, rounding going the wrong way, and an
 * outcome being billed twice.
 */
import { describe, expect, it } from 'vitest';
import {
  BPS_DENOMINATOR,
  calculateInvoice,
  feeForRecovery,
  formatRate,
  InvalidRateError,
  invoiceNumber,
  type BillableOutcome,
} from '@/lib/billing/invoice';

const PERIOD = {
  start: new Date('2026-01-01T00:00:00Z'),
  end: new Date('2026-01-31T23:59:59Z'),
};

function outcome(over: Partial<BillableOutcome> = {}): BillableOutcome {
  return {
    outcomeId: 'o1',
    denialId: 'd1',
    result: 'won',
    amountRecoveredCents: 1_842_000,
    decidedAt: new Date('2026-01-15T00:00:00Z'),
    invoiceId: null,
    ...over,
  };
}

describe('feeForRecovery', () => {
  it('computes a plain percentage', () => {
    // $18,420.00 recovered at 15 percent is $2,763.00.
    expect(feeForRecovery(1_842_000, 1500)).toBe(276_300);
  });

  it('handles a fractional rate exactly', () => {
    // 12.5 percent of $1,000.00 is $125.00, with no float drift.
    expect(feeForRecovery(100_000, 1250)).toBe(12_500);
  });

  it('rounds toward the customer on a half cent', () => {
    // 15 percent of 1 cent is 0.15 of a cent. The customer keeps it.
    expect(feeForRecovery(1, 1500)).toBe(0);
    // 15 percent of 7 cents is 1.05 cents, floored to 1.
    expect(feeForRecovery(7, 1500)).toBe(1);
    // 50 percent of 3 cents is exactly 1.5 cents, floored to 1, not 2.
    expect(feeForRecovery(3, 5000)).toBe(1);
  });

  it('never charges more than was recovered', () => {
    expect(feeForRecovery(100_000, BPS_DENOMINATOR)).toBe(100_000);
  });

  it('charges nothing at a zero rate', () => {
    expect(feeForRecovery(1_842_000, 0)).toBe(0);
  });

  it('charges nothing on a zero or negative recovery', () => {
    expect(feeForRecovery(0, 1500)).toBe(0);
    // A takeback is not something we bill a fee on.
    expect(feeForRecovery(-50_000, 1500)).toBe(0);
  });

  it('refuses a rate outside the range', () => {
    expect(() => feeForRecovery(100_000, -1)).toThrow(InvalidRateError);
    expect(() => feeForRecovery(100_000, 10_001)).toThrow(InvalidRateError);
    expect(() => feeForRecovery(100_000, 15.5)).toThrow(InvalidRateError);
  });

  it('refuses a non-integer amount, because money is never a float', () => {
    expect(() => feeForRecovery(1000.5, 1500)).toThrow(/integer number of cents/);
  });

  it('stays exact on an amount that would drift in floating point', () => {
    // 0.1 + 0.2 style drift would show up here if cents were ever a float.
    expect(feeForRecovery(1_000_003, 1500)).toBe(150_000);
    expect(feeForRecovery(999_999_999, 1234)).toBe(
      Math.floor((999_999_999 * 1234) / 10_000),
    );
  });
});

describe('calculateInvoice', () => {
  it('bills a single win at the organisation rate', () => {
    const result = calculateInvoice([outcome()], 1500, PERIOD);
    expect(result.totalRecoveredCents).toBe(1_842_000);
    expect(result.feeCents).toBe(276_300);
    expect(result.lines).toHaveLength(1);
    expect(result.excluded).toHaveLength(0);
  });

  it('bills a partial recovery on what was actually recovered', () => {
    const result = calculateInvoice(
      [outcome({ result: 'partial', amountRecoveredCents: 500_000 })],
      1500,
      PERIOD,
    );
    expect(result.totalRecoveredCents).toBe(500_000);
    expect(result.feeCents).toBe(75_000);
  });

  it('bills nothing for a loss or a withdrawal', () => {
    const result = calculateInvoice(
      [
        outcome({ outcomeId: 'lost', result: 'lost', amountRecoveredCents: 0 }),
        outcome({ outcomeId: 'gone', result: 'withdrawn', amountRecoveredCents: 0 }),
      ],
      1500,
      PERIOD,
    );
    expect(result.totalRecoveredCents).toBe(0);
    expect(result.feeCents).toBe(0);
    expect(result.lines).toHaveLength(0);
    expect(result.excluded).toHaveLength(2);
    expect(result.excluded[0]!.reason).toContain('nothing is owed');
  });

  it('never bills an outcome twice', () => {
    const result = calculateInvoice(
      [
        outcome({ outcomeId: 'fresh' }),
        outcome({ outcomeId: 'already', invoiceId: 'inv-2025-12' }),
      ],
      1500,
      PERIOD,
    );
    expect(result.lines).toHaveLength(1);
    expect(result.lines[0]!.outcomeId).toBe('fresh');
    expect(result.excluded[0]!.reason).toContain('already billed');
  });

  it('excludes outcomes decided outside the period', () => {
    const result = calculateInvoice(
      [
        outcome({ outcomeId: 'inside' }),
        outcome({ outcomeId: 'before', decidedAt: new Date('2025-12-20T00:00:00Z') }),
        outcome({ outcomeId: 'after', decidedAt: new Date('2026-02-03T00:00:00Z') }),
      ],
      1500,
      PERIOD,
    );
    expect(result.lines.map((l) => l.outcomeId)).toEqual(['inside']);
    expect(result.excluded).toHaveLength(2);
  });

  it('excludes a win that recovered nothing', () => {
    const result = calculateInvoice(
      [outcome({ result: 'won', amountRecoveredCents: 0 })],
      1500,
      PERIOD,
    );
    expect(result.lines).toHaveLength(0);
    expect(result.excluded[0]!.reason).toBe('no dollars recovered');
  });

  it('totals exactly equal the sum of the lines', () => {
    // Amounts chosen so per-line flooring differs from flooring the total,
    // which is the case that produces an invoice that does not add up.
    const result = calculateInvoice(
      [
        outcome({ outcomeId: 'a', amountRecoveredCents: 333 }),
        outcome({ outcomeId: 'b', amountRecoveredCents: 333 }),
        outcome({ outcomeId: 'c', amountRecoveredCents: 333 }),
      ],
      1500,
      PERIOD,
    );

    const summedLines = result.lines.reduce((s, l) => s + l.feeCents, 0);
    expect(result.feeCents).toBe(summedLines);

    // Each line is floor(333 * 0.15) = 49, so 147 total. Applying the rate to
    // the summed 999 would give 149, which is the wrong answer to show.
    expect(result.feeCents).toBe(147);
    expect(result.totalRecoveredCents).toBe(999);
  });

  it('orders lines by when they were decided', () => {
    const result = calculateInvoice(
      [
        outcome({ outcomeId: 'later', decidedAt: new Date('2026-01-28T00:00:00Z') }),
        outcome({ outcomeId: 'earlier', decidedAt: new Date('2026-01-04T00:00:00Z') }),
      ],
      1500,
      PERIOD,
    );
    expect(result.lines.map((l) => l.outcomeId)).toEqual(['earlier', 'later']);
  });

  it('produces an empty invoice rather than throwing when there is nothing to bill', () => {
    const result = calculateInvoice([], 1500, PERIOD);
    expect(result.feeCents).toBe(0);
    expect(result.totalRecoveredCents).toBe(0);
    expect(result.lines).toHaveLength(0);
  });

  it('uses the rate it was given, not a default', () => {
    const at10 = calculateInvoice([outcome()], 1000, PERIOD);
    const at20 = calculateInvoice([outcome()], 2000, PERIOD);
    expect(at10.feeCents).toBe(184_200);
    expect(at20.feeCents).toBe(368_400);
    expect(at10.contingencyRateBps).toBe(1000);
  });
});

describe('formatRate', () => {
  it('renders whole percentages without a decimal', () => {
    expect(formatRate(1500)).toBe('15%');
    expect(formatRate(2000)).toBe('20%');
    expect(formatRate(0)).toBe('0%');
  });

  it('renders fractional percentages', () => {
    expect(formatRate(1250)).toBe('12.5%');
    expect(formatRate(1234)).toBe('12.34%');
    expect(formatRate(1205)).toBe('12.05%');
  });
});

describe('invoiceNumber', () => {
  it('does not collide between organisations whose slugs share a prefix', () => {
    // The slug is unique, so using all of it makes the number unique too. An
    // earlier version truncated to eight characters and these two collided.
    const a = invoiceNumber('northgate-regional', new Date('2026-01-01T00:00:00Z'), 1);
    const b = invoiceNumber('northgate-southside', new Date('2026-01-01T00:00:00Z'), 1);
    expect(a).not.toBe(b);
  });

  it('is readable and sorts by period', () => {
    expect(invoiceNumber('northgate', new Date('2026-01-01T00:00:00Z'), 1)).toBe(
      'NORTHGATE-202601-001',
    );
    expect(invoiceNumber('mercy', new Date('2026-11-01T00:00:00Z'), 42)).toBe(
      'MERCY-202611-042',
    );
  });
});
