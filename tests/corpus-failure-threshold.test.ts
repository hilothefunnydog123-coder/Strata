/**
 * When a verification failure rate is evidence of a broken extractor.
 *
 * The 5 percent target is not in question here. What is in question is how many
 * holdings you have to look at before a ratio means anything. A bare
 * `failed / total > 0.05` answers that with "one", which is how a run of 23
 * holdings well inside the established rate stopped the line on 2026-08-06.
 *
 * The numbers below are the real ones from that night and the two runs that set
 * the baseline before it.
 */
import { describe, expect, it } from 'vitest';
import { exceedsFailureThreshold } from '@/lib/corpus/pipeline';

describe('a rate that only looks bad because the sample is small', () => {
  it('does not fail the run on 3 discards in 23', () => {
    // 13.0 percent by the old arithmetic, and the run that stopped the corpus
    // overnight. The lower bound of what 3 in 23 supports is 4.5 percent, which
    // does not clear 5, so this is a batch inside the baseline having bad luck.
    expect(exceedsFailureThreshold(3, 23)).toBe(false);
  });

  it('does not fail the run on a single discard in a tiny batch', () => {
    // 1 in 12 is 8.3 percent and says nothing whatever about the extractor.
    expect(exceedsFailureThreshold(1, 12)).toBe(false);
  });

  it('does not fail the run on the batches that set the baseline', () => {
    // The two large runs the 5 percent figure came from: 4.9 and 4.5 percent.
    expect(exceedsFailureThreshold(5, 102)).toBe(false);
    expect(exceedsFailureThreshold(6, 132)).toBe(false);
  });
});

describe('a rate that is bad on any reading', () => {
  it('fails the run when a small batch is genuinely broken', () => {
    // 8 in 23 is 34.8 percent, and even at this sample size the lower bound is
    // 18.8 percent. Being small is not an excuse, which is the whole risk of
    // putting a floor under the check.
    expect(exceedsFailureThreshold(8, 23)).toBe(true);
  });

  it('fails the run when a large batch drifts past the target', () => {
    // 15 percent over 200 holdings is the case the threshold exists for.
    expect(exceedsFailureThreshold(30, 200)).toBe(true);
  });

  it('fails the run when nearly everything is discarded', () => {
    expect(exceedsFailureThreshold(9, 10)).toBe(true);
  });
});

describe('the edges', () => {
  it('is not tripped by a run with nothing to verify', () => {
    expect(exceedsFailureThreshold(0, 0)).toBe(false);
  });

  it('is not tripped by a clean run', () => {
    expect(exceedsFailureThreshold(0, 500)).toBe(false);
  });

  it('is monotonic in the failure count at a fixed size', () => {
    // More failures out of the same batch can never be better news.
    let previous = false;
    for (let failed = 0; failed <= 40; failed += 1) {
      const now = exceedsFailureThreshold(failed, 40);
      if (previous) expect(now).toBe(true);
      previous = now;
    }
  });
});
