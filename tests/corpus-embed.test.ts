/**
 * Matching a denial to the provision that answers it.
 *
 * The two are written by different people for different purposes and almost
 * never choose the same words. A payer writes "did not require care on a daily
 * basis"; the manual says "skilled services must be needed every day". Those
 * mean the same thing and share, as strings, nearly nothing.
 *
 * The embedding was character trigrams, which scored that pair apart, and
 * similarity carries the second highest weight in retrieval. So the cost landed
 * on every appeal: the provision that actually answered the denial ranked below
 * whatever happened to reuse the denial's vocabulary.
 *
 * These tests are written as comparisons rather than absolute thresholds. A
 * cosine of 0.41 means nothing on its own; "the paraphrase beats the unrelated
 * passage" is the property retrieval depends on, and it survives future tuning
 * of the vocabulary in a way that a magic number would not.
 */
import { describe, expect, it } from 'vitest';
import { cosine, embed, EMBEDDING_VERSION, tokenize } from '@/lib/corpus/embed';

const similarity = (a: string, b: string) => cosine(embed(a), embed(b));

describe('paraphrase, which is the whole point', () => {
  it('matches the denial and the provision that answers it', () => {
    const denial = 'The member did not require skilled care on a daily basis.';
    const provision = 'Skilled nursing services must be needed every day.';
    const unrelated =
      'Durable medical equipment is covered when prescribed for use in the home.';

    expect(similarity(denial, provision)).toBeGreaterThan(similarity(denial, unrelated));
  });

  it('knows the ways this domain says "restrictive"', () => {
    const denial = 'The plan applied stricter rules than Medicare.';
    const holding =
      'A Medicare Advantage organization may not apply more restrictive coverage criteria.';
    const unrelated = 'The beneficiary was discharged to home with family support.';

    expect(similarity(denial, holding)).toBeGreaterThan(similarity(denial, unrelated));
  });

  it('connects a proprietary tool to the criteria argument', () => {
    // The strongest argument available, and the one most likely to be phrased
    // in the payer's own product name rather than in the regulation's words.
    const denial = 'Coverage was denied based on MCG guidelines.';
    const holding =
      'The organization applied a proprietary screening tool in place of the regulatory standard.';
    const unrelated = 'The claim was submitted after the filing deadline had passed.';

    expect(similarity(denial, holding)).toBeGreaterThan(similarity(denial, unrelated));
  });

  it('treats a skilled nursing facility and extended care as one setting', () => {
    expect(similarity('skilled nursing facility stay', 'extended care benefit')).toBeGreaterThan(
      similarity('skilled nursing facility stay', 'outpatient physician visit'),
    );
  });
});

describe('what the tokenizer does', () => {
  it('drops the words that carry no signal', () => {
    expect(tokenize('the care was in the facility')).not.toContain('the');
    expect(tokenize('the care was in the facility')).not.toContain('was');
  });

  it('folds a phrase into the concept it names', () => {
    // One token, not two words plus a leftover.
    expect(tokenize('on a daily basis')).toContain('ζdaily');
    expect(tokenize('every day')).toContain('ζdaily');
    expect(tokenize('each day')).toContain('ζdaily');
  });

  it('stems the endings that make one word look like two', () => {
    expect(tokenize('therapies')).toEqual(tokenize('therapy'));
    expect(tokenize('required')).toEqual(tokenize('require'));
  });

  it('keeps distinctions a real stemmer would destroy', () => {
    // Porter turns "coverage" into "cover" and "certification" into "certif",
    // collapsing terms this domain draws on purpose: coverage of a benefit is
    // not the same question as what a policy covers, and a physician's
    // certification is a specific document. The endings stripped here are only
    // the ones that genuinely produce the same word, so these stay apart.
    expect(tokenize('coverage')).not.toEqual(tokenize('cover'));
    expect(tokenize('certification')).not.toEqual(tokenize('certify'));
  });

  it('keeps some word order through bigrams', () => {
    // Without these, "skilled care not required" and "required care not
    // skilled" are the same vector.
    const tokens = tokenize('skilled nursing care');

    expect(tokens.some((t) => t.includes('·'))).toBe(true);
  });

  it('survives text with nothing in it', () => {
    expect(tokenize('')).toEqual([]);
    expect(tokenize('the of and to')).toEqual([]);
    expect(embed('').every((v) => v === 0)).toBe(true);
  });
});

describe('the properties retrieval assumes', () => {
  it('is deterministic, because a stored vector must still mean something', () => {
    expect(embed('skilled nursing care on a daily basis')).toEqual(
      embed('skilled nursing care on a daily basis'),
    );
  });

  it('is a unit vector, so cosine is a dot product', () => {
    const magnitude = Math.sqrt(
      embed('skilled nursing care').reduce((sum, v) => sum + v * v, 0),
    );

    expect(magnitude).toBeCloseTo(1, 6);
  });

  it('scores a passage against itself at 1', () => {
    const text = 'Skilled nursing care must be needed on a daily basis.';

    expect(similarity(text, text)).toBeCloseTo(1, 6);
  });

  it('does not make long passages look similar to everything', () => {
    const long = 'coverage '.repeat(200);
    const unrelated = 'The physician ordered physical therapy twice weekly.';

    expect(similarity(long, unrelated)).toBeLessThan(0.5);
  });
});

describe('the version stamp', () => {
  it('is a number the embed stage can compare against', () => {
    // The stamp is what stops the corpus holding two embedding spaces at once.
    // A cosine between versions is not a small error, it is noise presented
    // with the same confidence as a real score, and nothing would fail.
    expect(Number.isInteger(EMBEDDING_VERSION)).toBe(true);
    expect(EMBEDDING_VERSION).toBeGreaterThan(1);
  });
});
