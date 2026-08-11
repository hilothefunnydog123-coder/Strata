/**
 * Which criteria an appeal argues from, and what the payer's words are for.
 *
 * The first letter this product ever produced against a real model contained
 * one sentence. The token budget got the blame, and the token budget was real,
 * but it was not the reason the letter was empty.
 *
 * The denial named two things: "therapy participation has plateaued and no
 * measurable functional improvement has been recorded" and "the member's
 * recorded gait distance did not increase". Those went in as the criteria the
 * record had to establish. Nothing in a patient record establishes an absence,
 * so no clinical fact supported either, the gap check reported both as
 * documentation gaps, and the drafting prompt was then told to assert neither.
 * The application section is exactly the criteria the record meets, so there
 * was nothing left to put in it.
 *
 * A denial letter states findings, not a standard. These tests hold that line.
 */
import { describe, expect, it } from 'vitest';
import { criteriaFor } from '@/lib/appeals/generate';
import { buildDraftPrompt, type DraftContext } from '@/lib/appeals/draft';

/** The two findings from the run that exposed this, verbatim. */
const PAYER_FINDINGS = [
  'therapy participation has plateaued and no measurable functional improvement has been recorded over three consecutive sessions',
  "member's recorded gait distance did not increase between 19 March and 21 March 2026",
];

function contextWith(overrides: Partial<DraftContext>): DraftContext {
  return {
    payerName: 'Meridian Health Plan',
    claimReference: 'NRMC-2026-0417',
    serviceType: 'skilled_nursing',
    serviceDates: '2026-03-24 to 2026-04-12',
    claimAmount: '$18,420.00',
    denialBasis: 'medical_necessity',
    denialQuote: 'the services were not medically necessary at the level billed',
    proprietaryCriteria: { detected: false, name: null, quote: null },
    holdings: [],
    regulations: [],
    facts: [],
    criteria: criteriaFor('skilled_nursing', 'test'),
    payerCriteria: [],
    gaps: [],
    ...overrides,
  };
}

describe('the criteria an appeal argues from', () => {
  it('are Medicare\'s, for the service type', () => {
    const criteria = criteriaFor('skilled_nursing', 'test');

    expect(criteria.some((c) => /daily basis/.test(c))).toBe(true);
    expect(criteria.some((c) => /reasonable and necessary/.test(c))).toBe(true);
  });

  it('differ by service type rather than being one list', () => {
    const snf = criteriaFor('skilled_nursing', 'test');
    const rehab = criteriaFor('inpatient_rehab', 'test');

    expect(rehab).not.toEqual(snf);
    expect(rehab.some((c) => /intensive rehabilitation therapy/.test(c))).toBe(true);
  });

  it('never include what the payer said was not met', () => {
    // criteriaFor no longer takes the payer's list at all, which is the point:
    // there is no argument shape in which a finding against the hospital is
    // something the hospital must prove. Making it impossible to pass beats
    // making it optional.
    const criteria = criteriaFor('skilled_nursing', 'test');

    for (const finding of PAYER_FINDINGS) {
      expect(criteria).not.toContain(finding);
    }
    expect(criteria.some((c) => /did not increase|has plateaued/.test(c))).toBe(false);
  });
});

describe('the payer\'s own findings in the drafting prompt', () => {
  it('are given as something to answer, not something to satisfy', () => {
    const prompt = buildDraftPrompt(contextWith({ payerCriteria: PAYER_FINDINGS }));

    expect(prompt).toContain('WHAT THE PAYER SAYS WAS NOT MET');
    expect(prompt).toContain('Do not try to establish them');
    for (const finding of PAYER_FINDINGS) {
      expect(prompt).toContain(finding);
    }
  });

  it('are kept out of the section listing what must be shown', () => {
    const prompt = buildDraftPrompt(contextWith({ payerCriteria: PAYER_FINDINGS }));

    const criteriaBlock = prompt.slice(
      prompt.indexOf('COVERAGE CRITERIA AT ISSUE'),
      prompt.indexOf('WHAT THE PAYER SAYS WAS NOT MET'),
    );

    expect(criteriaBlock).toContain('daily basis');
    for (const finding of PAYER_FINDINGS) {
      expect(criteriaBlock).not.toContain(finding);
    }
  });

  it('are left out entirely when the letter names none', () => {
    const prompt = buildDraftPrompt(contextWith({ payerCriteria: [] }));

    expect(prompt).not.toContain('WHAT THE PAYER SAYS WAS NOT MET');
    expect(prompt).toContain('COVERAGE CRITERIA AT ISSUE');
  });
});
