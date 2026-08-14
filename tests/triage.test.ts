/**
 * The defect scanner and the winnability score.
 *
 * Everything here is deterministic on purpose, so everything here is testable
 * without a model: whether a letter says "plateau" is a fact, and the scanner
 * that reports it has to report the payer's actual sentence, from the actual
 * span, or a specialist checking the evidence finds a paraphrase where a
 * quote was promised.
 */
import { describe, expect, it } from 'vitest';
import {
  defectRetrievalTerms,
  scanDefects,
  triageDenial,
  type ClassificationForTriage,
  type LetterSpan,
} from '@/lib/appeals/triage';
import { buildDraftPrompt, type DraftContext } from '@/lib/appeals/draft';

/** A classification that found nothing, for tests about the pattern scan. */
const FOUND_NOTHING: ClassificationForTriage = {
  criteriaCited: [],
  proprietaryCriteria: {
    detected: false,
    criteriaName: null,
    spanOrdinal: null,
    verbatimQuote: null,
  },
};

/**
 * A letter that does what a compliant notice does: cites the rule it applied,
 * shows a physician was involved, and describes appeal rights.
 */
const COMPLIANT_SPANS: LetterSpan[] = [
  {
    ordinal: 1,
    text:
      'Our Medical Director reviewed this claim against 42 CFR 409.31 and determined ' +
      'the level of care requirement was not met. You have the right to appeal this ' +
      'decision by requesting a reconsideration within 60 days.',
  },
];

function spans(...texts: string[]): LetterSpan[] {
  return texts.map((text, i) => ({ ordinal: i + 1, text }));
}

describe('the improvement standard scan', () => {
  it('catches a plateau and quotes the sentence that says it', () => {
    const letter = spans(
      'Coverage for the requested stay is denied. You have appeal rights, and a physician reviewed this per 42 CFR 409.31.',
      'Therapy participation has plateaued and no further progress is expected. Continued services are not approved.',
    );

    const defects = scanDefects(letter, FOUND_NOTHING, 'skilled_nursing', 'medical_necessity');
    const found = defects.find((d) => d.id === 'improvement_standard');

    expect(found).toBeDefined();
    expect(found!.spanOrdinal).toBe(2);
    // The evidence has to be a verbatim substring of the span it names, or it
    // cannot be checked by hand and is not evidence.
    expect(letter[1]!.text.includes(found!.evidence!)).toBe(true);
    expect(found!.evidence).toContain('plateaued');
    expect(found!.authority).toContain('Jimmo');
  });

  it('catches care recharacterised as custodial', () => {
    const letter = spans(
      'The services at issue are custodial in nature and therefore not covered. A physician reviewed this claim under 42 CFR 409.31. You may appeal.',
    );

    const defects = scanDefects(letter, FOUND_NOTHING, 'skilled_nursing', 'medical_necessity');
    expect(defects.some((d) => d.id === 'improvement_standard')).toBe(true);
  });

  it('finds nothing to accuse a compliant letter of', () => {
    const defects = scanDefects(
      COMPLIANT_SPANS,
      FOUND_NOTHING,
      'skilled_nursing',
      'medical_necessity',
    );
    expect(defects).toHaveLength(0);
  });
});

describe('the proprietary criteria scan', () => {
  it('prefers the classification finding, quote and span and all', () => {
    const classification: ClassificationForTriage = {
      criteriaCited: ['guideline SNF-104 was not met'],
      proprietaryCriteria: {
        detected: true,
        criteriaName: 'MCG',
        spanOrdinal: 3,
        verbatimQuote: 'does not meet MCG guideline SNF-104 for continued stay',
      },
    };

    const defects = scanDefects(
      COMPLIANT_SPANS,
      classification,
      'skilled_nursing',
      'medical_necessity',
    );
    const found = defects.find((d) => d.id === 'proprietary_criteria');

    expect(found).toBeDefined();
    expect(found!.evidence).toBe('does not meet MCG guideline SNF-104 for continued stay');
    expect(found!.spanOrdinal).toBe(3);
    expect(found!.authority).toContain('422.101');
  });

  it('backstops a classification that missed a product name in plain sight', () => {
    const letter = spans(
      'Per our physician review under InterQual criteria, the stay is denied. Appeal rights under 42 CFR 422.568 are described below.',
    );

    const defects = scanDefects(letter, FOUND_NOTHING, 'skilled_nursing', 'medical_necessity');
    const found = defects.find((d) => d.id === 'proprietary_criteria');

    expect(found).toBeDefined();
    expect(found!.evidence).toContain('InterQual');
  });

  it('does not mistake micrograms for Milliman Care Guidelines', () => {
    const letter = spans(
      'The record shows vancomycin 450 mcg administered daily, reviewed by our physician under 42 CFR 409.31. Appeal rights are enclosed.',
    );

    const defects = scanDefects(letter, FOUND_NOTHING, 'skilled_nursing', 'medical_necessity');
    expect(defects.some((d) => d.id === 'proprietary_criteria')).toBe(false);
  });
});

describe('the therapy threshold scan', () => {
  const LETTER = spans(
    'The member received fewer than 720 minutes of therapy per week, so the skilled level of care is denied. Our physician reviewed this under 42 CFR 409.31. You may appeal.',
  );

  it('flags a minutes floor in a skilled nursing denial', () => {
    const defects = scanDefects(LETTER, FOUND_NOTHING, 'skilled_nursing', 'medical_necessity');
    const found = defects.find((d) => d.id === 'therapy_threshold');

    expect(found).toBeDefined();
    expect(found!.evidence).toContain('720 minutes');
  });

  it('stays out of service types whose criteria it does not know', () => {
    // An IRF denial legitimately talks about therapy intensity, and the rule
    // this scan enforces is written for the SNF criteria alone.
    const defects = scanDefects(LETTER, FOUND_NOTHING, 'inpatient_rehab', 'medical_necessity');
    expect(defects.some((d) => d.id === 'therapy_threshold')).toBe(false);
  });
});

describe('the notice defect scans', () => {
  const BARE_LETTER = spans(
    'Your claim for skilled nursing services is denied because the services were not medically necessary. Payment will not be made.',
  );

  it('flags a notice that discloses no criteria, no reviewer, and no rights', () => {
    const defects = scanDefects(BARE_LETTER, FOUND_NOTHING, 'skilled_nursing', 'medical_necessity');
    const ids = defects.map((d) => d.id);

    expect(ids).toContain('no_criteria_disclosed');
    expect(ids).toContain('no_physician_reviewer');
    expect(ids).toContain('no_appeal_rights');
    // Absence cannot be quoted, and pretending otherwise would fabricate.
    for (const d of defects) expect(d.evidence).toBeNull();
  });

  it('does not demand a physician of an administrative denial', () => {
    const defects = scanDefects(BARE_LETTER, FOUND_NOTHING, 'skilled_nursing', 'administrative');
    const ids = defects.map((d) => d.id);

    expect(ids).not.toContain('no_physician_reviewer');
    expect(ids).not.toContain('no_criteria_disclosed');
    // Appeal rights are owed on every notice, whatever the basis.
    expect(ids).toContain('no_appeal_rights');
  });

  it('treats disclosed proprietary criteria as disclosure, wrong as they are', () => {
    // The plan that cites MCG has told the member what standard it applied.
    // That standard is the defect; the notice is not additionally silent.
    const letter = spans(
      'The stay does not meet MCG guideline SNF-104. Payment is denied.',
    );

    const defects = scanDefects(letter, FOUND_NOTHING, 'skilled_nursing', 'medical_necessity');
    const ids = defects.map((d) => d.id);

    expect(ids).toContain('proprietary_criteria');
    expect(ids).not.toContain('no_criteria_disclosed');
  });
});

describe('the retrieval terms defects add', () => {
  it('sends the drafter authority for each defect it will argue', () => {
    const defects = scanDefects(
      spans('Therapy has plateaued. Denied.'),
      FOUND_NOTHING,
      'skilled_nursing',
      'medical_necessity',
    );

    const terms = defectRetrievalTerms(defects);
    expect(terms).toContain('maintenance');
    // Notice defects were found too, so their authority is searched for.
    expect(terms).toContain('reconsideration');
    // A set, not a list with repeats.
    expect(new Set(terms).size).toBe(terms.length);
  });

  it('adds nothing when nothing was found', () => {
    expect(defectRetrievalTerms([])).toEqual([]);
  });
});

describe('the winnability score', () => {
  const CRITERIA = ['a', 'b', 'c', 'd', 'e'];

  function defect(weight: number): import('@/lib/appeals/triage').DenialDefect {
    return {
      id: 'improvement_standard',
      title: 'Coverage conditioned on improvement',
      authority: 'Jimmo v. Sebelius settlement',
      explanation: 'Coverage turns on the need for skilled care.',
      evidence: 'therapy has plateaued',
      spanOrdinal: 1,
      weight,
    };
  }

  const STRONG_DEFECTS = [defect(20), defect(20)];

  it('recommends taking a supported case with a defective denial', () => {
    const triage = triageDenial({
      defects: STRONG_DEFECTS,
      criteria: CRITERIA,
      gaps: [],
      authorityCount: 12,
      appealDeadline: new Date('2026-09-30T00:00:00Z'),
      now: new Date('2026-08-14T00:00:00Z'),
    });

    expect(triage.score).toBe(100);
    expect(triage.recommendation).toBe('take');
    expect(triage.criteriaSupported).toBe(5);
  });

  it('recommends strengthening a thin record before fighting with it', () => {
    const triage = triageDenial({
      defects: STRONG_DEFECTS.slice(0, 1),
      criteria: CRITERIA,
      gaps: [{ criterion: 'a' }, { criterion: 'b' }, { criterion: 'c' }],
      authorityCount: 12,
      appealDeadline: null,
    });

    // 20 record + 20 defect + 10 authority.
    expect(triage.score).toBe(50);
    expect(triage.recommendation).toBe('strengthen');
    expect(triage.reasons.some((r) => r.includes('Documentation'))).toBe(true);
  });

  it('declines a case with nothing behind it and says why', () => {
    const triage = triageDenial({
      defects: [],
      criteria: CRITERIA,
      gaps: CRITERIA.map((criterion) => ({ criterion })),
      authorityCount: 0,
      appealDeadline: null,
    });

    expect(triage.score).toBe(0);
    expect(triage.recommendation).toBe('decline');
    expect(triage.reasons.some((r) => r.includes('nothing to argue from'))).toBe(true);
  });

  it('declines past the deadline whatever the merits, and says how late', () => {
    const triage = triageDenial({
      defects: STRONG_DEFECTS,
      criteria: CRITERIA,
      gaps: [],
      authorityCount: 12,
      appealDeadline: new Date('2026-08-04T00:00:00Z'),
      now: new Date('2026-08-14T00:00:00Z'),
    });

    expect(triage.recommendation).toBe('decline');
    expect(triage.daysToDeadline).toBe(-10);
    // The score is still shown: it measures what a good cause filing fights for.
    expect(triage.score).toBe(100);
    expect(triage.reasons.some((r) => r.includes('good cause'))).toBe(true);
  });

  it('warns when the deadline is close without changing the answer', () => {
    const triage = triageDenial({
      defects: STRONG_DEFECTS,
      criteria: CRITERIA,
      gaps: [],
      authorityCount: 12,
      appealDeadline: new Date('2026-08-17T00:00:00Z'),
      now: new Date('2026-08-14T00:00:00Z'),
    });

    expect(triage.recommendation).toBe('take');
    expect(triage.reasons.some((r) => r.includes('3 days away'))).toBe(true);
  });

  it('caps what defects alone can contribute', () => {
    // A defective notice for an unsupported claim is a reason to look closely,
    // never a case on its own: every defect in the book plus nothing in the
    // record must not reach the take line.
    const triage = triageDenial({
      defects: [defect(20), defect(20), defect(12), defect(10), defect(8)],
      criteria: CRITERIA,
      gaps: CRITERIA.map((criterion) => ({ criterion })),
      authorityCount: 12,
      appealDeadline: null,
    });

    expect(triage.score).toBe(50);
    expect(triage.recommendation).toBe('strengthen');
  });
});

describe('the drafting prompt, given defects', () => {
  function contextWith(defects: DraftContext['defects']): DraftContext {
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
      criteria: ['The beneficiary required skilled services on a daily basis'],
      payerCriteria: [],
      gaps: [],
      defects,
    };
  }

  it('tells the drafter what to argue and where the citation must come from', () => {
    const prompt = buildDraftPrompt(
      contextWith([
        {
          title: 'Coverage conditioned on improvement',
          authority: 'Jimmo v. Sebelius settlement; Medicare Benefit Policy Manual, ch. 8, sec. 30.2.3.1',
          explanation: 'Coverage turns on the need for skilled care, not on improvement.',
          evidence: 'therapy participation has plateaued',
        },
      ]),
    );

    expect(prompt).toContain('DEFECTS IN THE DENIAL NOTICE');
    expect(prompt).toContain('Coverage conditioned on improvement');
    expect(prompt).toContain('therapy participation has plateaued');
    // The denial letter is not a citable source, and the prompt says so
    // rather than leaving the drafter to invent a sourceKind for it.
    expect(prompt).toContain('The denial letter itself is not a source you can cite');
  });

  it('says nothing about defects when none were found', () => {
    const prompt = buildDraftPrompt(contextWith([]));
    expect(prompt).not.toContain('DEFECTS IN THE DENIAL NOTICE');
  });
});
