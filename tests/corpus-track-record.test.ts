/**
 * Learning from what actually won.
 *
 * The company bills a percentage of what it recovers, so a win is revenue and a
 * loss is nothing. Outcomes were already being recorded, in the same table the
 * invoice is computed from, and read by nothing else: every appeal was drafted
 * with no memory of the last thousand.
 *
 * The statistics are the part worth testing rather than the plumbing. A holding
 * cited once, in an appeal that happened to win, has a raw win rate of 100
 * percent and has told us almost nothing, and if that outranks a holding that
 * won forty of fifty then the top of every result list is whatever got lucky
 * once. Equally, a holding nobody has cited must not be buried beneath
 * everything that has any history at all, or a corpus that keeps growing keeps
 * hiding its newest and most specific authority.
 */
import { describe, expect, it } from 'vitest';
import { trackRecordReason, trackRecordSignal } from '@/lib/corpus/track-record';

/** The corpus average these are all judged against. */
const BASE = 0.5;

describe('turning a record into a signal', () => {
  it('says nothing about a holding nobody has cited', () => {
    // Exactly zero, not slightly negative. A new holding is judged on its
    // merits, and the newest authority is usually the most specific.
    expect(trackRecordSignal(undefined, BASE)).toBe(0);
    expect(trackRecordSignal({ decided: 0, credit: 0 }, BASE)).toBe(0);
  });

  it('barely moves on a single win', () => {
    // One win out of one is a 100 percent record and almost no evidence.
    const signal = trackRecordSignal({ decided: 1, credit: 1 }, BASE);

    expect(signal).toBeGreaterThan(0);
    expect(signal).toBeLessThan(0.1);
  });

  it('moves a long record much further than a short one', () => {
    // Both are perfect records. Only one of them means anything.
    const once = trackRecordSignal({ decided: 1, credit: 1 }, BASE);
    const often = trackRecordSignal({ decided: 40, credit: 40 }, BASE);

    expect(often).toBeGreaterThan(once * 4);
  });

  it('ranks a strong long record above a perfect short one', () => {
    // The failure this exists to prevent: 40 wins out of 50 is better authority
    // than one win out of one, and a raw win rate says the opposite.
    const lucky = trackRecordSignal({ decided: 1, credit: 1 }, BASE);
    const proven = trackRecordSignal({ decided: 50, credit: 40 }, BASE);

    expect(proven).toBeGreaterThan(lucky);
  });

  it('goes negative for an argument that keeps losing', () => {
    const signal = trackRecordSignal({ decided: 30, credit: 3 }, BASE);

    expect(signal).toBeLessThan(-0.2);
  });

  it('counts a partial recovery as half a win', () => {
    const partials = trackRecordSignal({ decided: 10, credit: 5 }, BASE);
    const wins = trackRecordSignal({ decided: 10, credit: 10 }, BASE);
    const losses = trackRecordSignal({ decided: 10, credit: 0 }, BASE);

    // Ten partials is the corpus average here, so it says nothing either way.
    expect(partials).toBeCloseTo(0, 5);
    expect(wins).toBeGreaterThan(partials);
    expect(partials).toBeGreaterThan(losses);
  });

  it('stays inside the range the weight assumes', () => {
    // The weight is multiplied by this, so a signal outside -1 to 1 would let
    // one term overwhelm every other. Perfect and hopeless records at length.
    const best = trackRecordSignal({ decided: 500, credit: 500 }, BASE);
    const worst = trackRecordSignal({ decided: 500, credit: 0 }, BASE);

    expect(best).toBeLessThanOrEqual(1);
    expect(worst).toBeGreaterThanOrEqual(-1);
  });

  it('has no opinion on day one, when nothing has been decided', () => {
    // With no outcomes at all the base rate is zero and every holding is judged
    // against it, which cancels for all of them. No evidence, no opinion.
    expect(trackRecordSignal({ decided: 0, credit: 0 }, 0)).toBe(0);
  });

  it('judges against the corpus, not against an absolute', () => {
    // A 60 percent record is good in a corpus that wins 30 percent of the time
    // and bad in one that wins 90. Centring on the base rate is what makes the
    // signal mean "better than the alternatives" rather than "good".
    const record = { decided: 50, credit: 30 };

    expect(trackRecordSignal(record, 0.3)).toBeGreaterThan(0);
    expect(trackRecordSignal(record, 0.9)).toBeLessThan(0);
  });
});

describe('what a reviewer is told', () => {
  it('says nothing when there is nothing to say', () => {
    expect(trackRecordReason(undefined)).toBeNull();
    expect(trackRecordReason({ decided: 0, credit: 0 })).toBeNull();
  });

  it('reports the count and the recoveries, not a percentage', () => {
    // A reviewer deciding whether to sign a letter needs to know the record is
    // three appeals rather than three hundred. "67 percent" hides that.
    const said = trackRecordReason({ decided: 3, credit: 2 })!;

    expect(said).toContain('3 decided appeals');
    expect(said).toContain('2');
    expect(said).not.toContain('%');
  });

  it('reads correctly for a single appeal', () => {
    expect(trackRecordReason({ decided: 1, credit: 1 })).toContain('1 decided appeal,');
  });

  it('shows a half where a partial recovery made one', () => {
    expect(trackRecordReason({ decided: 3, credit: 1.5 })).toContain('1.5');
  });
});
