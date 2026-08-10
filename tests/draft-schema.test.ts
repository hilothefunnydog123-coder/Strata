/**
 * Reading a draft the model returned.
 *
 * The first real drafting call came back with eight assertions, every quote
 * good, and no section on any of them. The prompt had never asked for the
 * field: it described what each section of the letter is for under its own
 * heading, and listed the assertion's fields separately without mentioning it.
 * The strict enum then discarded all eight and the appeal was lost.
 *
 * The prompt now asks. These cover the belt, and the thing the belt must not
 * loosen: evidence stays strict.
 */
import { describe, expect, it } from 'vitest';
import { draftAssertionSchema } from '@/lib/appeals/draft';

const sound = {
  section: 'standard',
  kind: 'legal',
  text: 'A Medicare Advantage organisation must comply with Medicare coverage rules.',
  sourceKind: 'source_span',
  sourceId: 'span-1',
  verbatimQuote: 'must comply with general coverage guidelines included in original Medicare manuals',
};

describe('reading one drafted assertion', () => {
  it('keeps the section the model chose', () => {
    const parsed = draftAssertionSchema.parse(sound);
    expect(parsed.section).toBe('standard');
  });

  it('does not lose a verified assertion because the heading is missing', () => {
    const { section: _omitted, ...withoutSection } = sound;
    const parsed = draftAssertionSchema.parse(withoutSection);

    // Legal, so it argues the law. The quote and its source are untouched.
    expect(parsed.section).toBe('argument');
    expect(parsed.verbatimQuote).toBe(sound.verbatimQuote);
    expect(parsed.sourceId).toBe('span-1');
  });

  it('files a clinical assertion under application when the heading is missing', () => {
    const parsed = draftAssertionSchema.parse({
      ...sound,
      section: undefined,
      kind: 'clinical',
      sourceKind: 'clinical_fact',
    });

    expect(parsed.section).toBe('application');
  });

  it('treats a section it does not recognise as one that was not given', () => {
    // A model writing "Legal Standard" is answering correctly in prose, which
    // is the same failure the classifier had.
    const parsed = draftAssertionSchema.parse({ ...sound, section: 'Legal Standard' });
    expect(parsed.section).toBe('argument');
  });

  it('still refuses an assertion whose quote is too short to be evidence', () => {
    // The line the leniency must not cross. A heading is presentation; the
    // quote is what the letter rests on.
    expect(() => draftAssertionSchema.parse({ ...sound, verbatimQuote: 'too short' })).toThrow();
  });

  it('still refuses an assertion with no source to point at', () => {
    expect(() => draftAssertionSchema.parse({ ...sound, sourceId: '' })).toThrow();
  });
});
