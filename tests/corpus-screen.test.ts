/**
 * Which passages are worth paying a model to read.
 *
 * The extractor used to send every passage of every document. On a CMS manual
 * chapter that is 1,302 passages and more than a day's token allowance on a
 * free account, most of it spent reading contents listings and transmittal
 * notices. This screen runs first, locally, for nothing.
 *
 * The failure this file guards against is not a wrong answer, it is a missing
 * one. A passage that is never sent cannot produce a false holding, and a
 * passage that is sent still has to survive verbatim verification, so the
 * screen cannot make the corpus wrong. It can make it thin, silently, and that
 * is what the keep cases below are for: every one of them is a sentence a real
 * appeal would want to cite.
 */
import { describe, expect, it } from 'vitest';
import { screen } from '@/lib/corpus/screen';

/** Sentences drawn from the shapes CMS manuals and DAB decisions actually use. */
const MUST_KEEP: ReadonlyArray<[string, string]> = [
  [
    'an obligation',
    'The physician must certify that the services were required to be given on an inpatient basis because the beneficiary needed skilled nursing care.',
  ],
  [
    'a prohibition',
    'A Medicare Advantage organization may not apply coverage criteria more restrictive than those of Traditional Medicare.',
  ],
  [
    'a coverage statement',
    'Skilled nursing care is covered when the services are so inherently complex that they can be performed safely only by qualified technical personnel.',
  ],
  [
    'a negative coverage statement',
    'Services are not covered when the documentation in the record does not support the level of care that was billed for the period.',
  ],
  [
    'a definition, which carries no obligation at all',
    'Skilled nursing care means care that requires the skills of qualified technical or professional health personnel to be provided safely and effectively.',
  ],
  [
    'an exclusion phrased as a definition',
    'Custodial care does not include services that require the continued supervision of qualified technical personnel to be safely administered.',
  ],
  [
    'a decision holding with no modal verb',
    'The determination of the Medicare Advantage organization is reversed and coverage of the stay is allowed in full.',
  ],
  [
    'an adjudicative finding',
    'We conclude that the contractor applied a proprietary screening tool in place of the regulatory standard for skilled care.',
  ],
  [
    'a negative requirement, which a careless screen would read as no rule',
    'A beneficiary is not required to show improvement in order to qualify for coverage of skilled maintenance therapy under this section.',
  ],
];

/** The bulk of a manual chapter, and none of it citable. */
const MUST_DROP: ReadonlyArray<[string, string, string]> = [
  [
    'a contents listing',
    '20.1 - Skilled Nursing Facility Level of Care ................................ 14',
    'contents_listing',
  ],
  [
    'a transmittal block',
    'Transmittal 11842, Issued: 02-15-2023, Effective Date: 03-01-2023, Implementation Date: 03-01-2023',
    'revision_notice',
  ],
  [
    'a bare cross reference',
    'See section 30.2 of this chapter for the applicable documentation requirements.',
    'cross_reference_only',
  ],
  [
    'narrative with no rule in it',
    'This chapter was reorganized in 2019 and the section numbering was changed throughout the document at that time.',
    'no_rule_language',
  ],
];

describe('what gets sent to the model', () => {
  for (const [what, text] of MUST_KEEP) {
    it(`keeps ${what}`, () => {
      // A false drop here is authority the product will never be able to cite,
      // and nothing downstream can notice its absence.
      expect(screen(text)).toEqual({ keep: true });
    });
  }

  for (const [what, text, reason] of MUST_DROP) {
    it(`drops ${what}`, () => {
      const verdict = screen(text);
      expect(verdict.keep).toBe(false);
      expect(verdict.reason).toBe(reason);
    });
  }

  it('drops a contents line even though it contains the word criteria', () => {
    // The reason exclusions run before the rule language test. "Coverage
    // criteria" in a table of contents would otherwise be kept by the deontic
    // pattern, and a chapter's contents page is dozens of such lines.
    const verdict = screen('30.4 - Coverage Criteria for Skilled Care ................. 42');

    expect(verdict.keep).toBe(false);
    expect(verdict.reason).toBe('contents_listing');
  });

  it('keeps a long passage that opens with a cross reference', () => {
    // The cross reference rule is bounded by length on purpose. A passage that
    // begins "See section 30" and then states a rule is a rule, and dropping it
    // for its first two words would lose the substance under a formality.
    const text =
      'See section 30 for the general rule. The contractor must nonetheless apply the ' +
      'criteria in this section when the beneficiary was admitted directly from an acute ' +
      'care hospital, and may not substitute a proprietary screening tool for it in any ' +
      'case where the physician certification is present in the record.';

    expect(screen(text)).toEqual({ keep: true });
  });

  it('uses the heading trail, not just the text', () => {
    // A line inside a contents section is furniture whatever it says.
    expect(screen('Skilled Nursing Facility Care', ['Table of Contents']).keep).toBe(false);
  });

  it('drops a row that is mostly numbers', () => {
    // Rate tables and form fields parse as passages and hold no rules.
    expect(screen('2019 2020 2021 2022 170.50 185.50 194.50 200.00 1,364 1,408').keep).toBe(false);
  });
});
