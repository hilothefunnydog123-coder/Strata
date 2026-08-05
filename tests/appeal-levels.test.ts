/**
 * The ladder, and the clock on each rung.
 *
 * The product modelled a denial as having one appeal, decided once, and treated
 * a loss as terminal: the case went to invoiced having recovered nothing. That
 * is not how Medicare works and it is not where the money is. Losing at the
 * first level is ordinary, and claims are won at an ALJ hearing every day after
 * being denied twice below.
 *
 * The deadline arithmetic is the part worth testing hardest, because getting it
 * wrong loses a claim on its merits regardless of how good the argument was,
 * and it fails silently: nothing errors, the case simply becomes unappealable
 * while the file still looks healthy.
 */
import { describe, expect, it } from 'vitest';
import {
  canEscalate,
  deadlineForNextLevel,
  ladderFor,
  levelAt,
  levelByKey,
  levelsOf,
  nextLevel,
} from '@/lib/appeals/levels';

describe('which ladder a denial climbs', () => {
  it('sends a Medicare Advantage denial to the plan first', () => {
    const ladder = ladderFor('medicare_advantage')!;

    expect(levelAt(ladder, 1)!.key).toBe('plan_reconsideration');
    expect(levelAt(ladder, 1)!.decidedBy).toContain('Medicare Advantage');
  });

  it('sends a Traditional Medicare denial to the contractor first', () => {
    const ladder = ladderFor('traditional_medicare')!;

    expect(levelAt(ladder, 1)!.key).toBe('redetermination');
  });

  it('converges both ladders on the same forum from the ALJ up', () => {
    // Worth pinning: above the second rung there is one appeal process, and
    // modelling them as separate would duplicate every rule about it.
    for (const ordinal of [3, 4, 5]) {
      expect(levelAt('medicare_advantage', ordinal)!.key).toBe(
        levelAt('traditional_medicare', ordinal)!.key,
      );
    }
  });

  it('declines to guess at a ladder it does not model', () => {
    // A commercial plan and Medicaid managed care have their own processes and
    // their own deadlines. Returning a Medicare ladder for them would produce a
    // confident, wrong filing date, which is worse than admitting ignorance.
    expect(ladderFor('commercial')).toBeNull();
    expect(ladderFor('medicaid_managed_care')).toBeNull();
    expect(ladderFor('other')).toBeNull();
  });
});

describe('the deadline for the next level', () => {
  it('counts from the decision being appealed, not from the denial', () => {
    // The mistake that loses claims. A case reconsidered eight months after the
    // original denial still has its full 60 days to reach an ALJ, and anyone
    // counting from the denial would report it as long expired and close it.
    const reconsideredOn = new Date('2026-08-05T00:00:00Z');
    const next = deadlineForNextLevel('traditional_medicare', 2, reconsideredOn)!;

    expect(next.level.key).toBe('alj');
    expect(next.dueBy.toISOString().slice(0, 10)).toBe('2026-10-04');
  });

  it('gives a redetermination 120 days from the initial determination', () => {
    const denied = new Date('2026-01-01T00:00:00Z');
    const next = deadlineForNextLevel('traditional_medicare', 0, denied)!;

    expect(next.level.key).toBe('redetermination');
    expect(next.dueBy.toISOString().slice(0, 10)).toBe('2026-05-01');
  });

  it('gives a reconsideration 180 days from the redetermination', () => {
    const redetermined = new Date('2026-01-01T00:00:00Z');
    const next = deadlineForNextLevel('traditional_medicare', 1, redetermined)!;

    expect(next.level.key).toBe('reconsideration');
    expect(next.dueBy.toISOString().slice(0, 10)).toBe('2026-06-30');
  });

  it('gives a Medicare Advantage reconsideration 60 days', () => {
    const determined = new Date('2026-03-01T00:00:00Z');
    const next = deadlineForNextLevel('medicare_advantage', 0, determined)!;

    expect(next.level.key).toBe('plan_reconsideration');
    expect(next.dueBy.toISOString().slice(0, 10)).toBe('2026-04-30');
  });

  it('crosses a year boundary without drifting', () => {
    const decided = new Date('2026-12-15T00:00:00Z');
    const next = deadlineForNextLevel('traditional_medicare', 2, decided)!;

    expect(next.dueBy.toISOString().slice(0, 10)).toBe('2027-02-13');
  });

  it('crosses a leap day correctly', () => {
    // 2028 is a leap year. Sixty days from 15 January passes 29 February.
    const decided = new Date('2028-01-15T00:00:00Z');
    const next = deadlineForNextLevel('traditional_medicare', 2, decided)!;

    expect(next.dueBy.toISOString().slice(0, 10)).toBe('2028-03-15');
  });

  it('has no deadline where the escalation is automatic', () => {
    // A Medicare Advantage plan upholding its own denial of a pre-service
    // request must forward the case to the independent review entity itself.
    // There is no window for the provider to miss, and inventing one would put
    // a false alarm on the dashboard.
    expect(deadlineForNextLevel('medicare_advantage', 1, new Date())).toBeNull();
  });

  it('has no deadline at the top of the ladder', () => {
    expect(deadlineForNextLevel('traditional_medicare', 5, new Date())).toBeNull();
    expect(nextLevel('medicare_advantage', 5)).toBeNull();
  });
});

describe('whether a loss is the end', () => {
  it('offers the next rung after a loss below', () => {
    const escalation = canEscalate('traditional_medicare', 1);

    expect(escalation.ok).toBe(true);
    expect(escalation.ok && escalation.level.key).toBe('reconsideration');
  });

  it('says plainly when there is nowhere left to go', () => {
    const escalation = canEscalate('traditional_medicare', 5);

    expect(escalation.ok).toBe(false);
    expect(escalation.ok === false && escalation.reason).toMatch(/last level/i);
  });

  it('flags the levels with an amount in controversy requirement', () => {
    // The thresholds are adjusted annually and are deliberately not hardcoded.
    // A stale figure would silently block an escalation that is allowed, or
    // wave through one that is not, and neither announces itself.
    expect(levelByKey('traditional_medicare', 'alj')!.amountInControversy).toBe(true);
    expect(levelByKey('traditional_medicare', 'judicial')!.amountInControversy).toBe(true);
    expect(levelByKey('traditional_medicare', 'reconsideration')!.amountInControversy).toBe(false);
  });
});

describe('what each level says about itself', () => {
  it('cites where its filing period comes from', () => {
    // So a deadline can be checked against the regulation rather than trusted
    // because it is in a constant somewhere.
    for (const ladder of ['traditional_medicare', 'medicare_advantage'] as const) {
      for (const level of levelsOf(ladder)) {
        expect(level.authority).toMatch(/42 CFR \d+\.\d+/);
      }
    }
  });

  it('numbers each ladder from one with no gaps', () => {
    for (const ladder of ['traditional_medicare', 'medicare_advantage'] as const) {
      const ordinals = levelsOf(ladder).map((l) => l.ordinal);
      expect(ordinals).toEqual([1, 2, 3, 4, 5]);
    }
  });
});
