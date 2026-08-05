/**
 * Choosing regulation parts out of a bulk listing.
 *
 * eCFR's own API is not usable here and that is settled rather than suspected:
 * their robots.txt says "Don't index developer tool links" and disallows
 * /api/versioner/v1/full/ in as many words, the crawler obeys it, and the URL
 * 404s regardless. Both were read off a runner rather than assumed, after a
 * week of every part being silently skipped.
 *
 * govinfo publishes the same regulations for bulk download, permits it, and
 * answers 200. Its listing is JSON. This picks the four parts the product
 * argues from out of that listing, and refuses to fall back to the whole title,
 * which is hundreds of megabytes to reach four parts.
 */
import { describe, expect, it } from 'vitest';
import { selectEcfrParts } from '@/lib/corpus/sources';

/** The shape govinfo's bulk listing uses. */
const LISTING = {
  files: [
    { justFileName: 'ECFR-title42-part405.xml', link: '/bulkdata/ECFR/title-42/ECFR-title42-part405.xml', folder: false },
    { justFileName: 'ECFR-title42-part409.xml', link: '/bulkdata/ECFR/title-42/ECFR-title42-part409.xml', folder: false },
    { justFileName: 'ECFR-title42-part412.xml', link: '/bulkdata/ECFR/title-42/ECFR-title42-part412.xml', folder: false },
    { justFileName: 'ECFR-title42-part422.xml', link: '/bulkdata/ECFR/title-42/ECFR-title42-part422.xml', folder: false },
    { justFileName: 'ECFR-title42-part400.xml', link: '/bulkdata/ECFR/title-42/ECFR-title42-part400.xml', folder: false },
    { justFileName: 'ECFR-title42.xml', link: '/bulkdata/ECFR/title-42/ECFR-title42.xml', folder: false },
    { justFileName: 'subfolder', link: '/bulkdata/ECFR/title-42/subfolder', folder: true },
  ],
};

describe('picking regulation parts out of a bulk listing', () => {
  it('takes exactly the parts the product argues from', () => {
    const parts = selectEcfrParts(LISTING);

    expect(parts.map((p) => p.citation).sort()).toEqual([
      '42 CFR Part 405',
      '42 CFR Part 409',
      '42 CFR Part 412',
      '42 CFR Part 422',
    ]);
  });

  it('leaves the whole title file alone', () => {
    // ECFR-title42.xml is every part of title 42 in one document. Ingesting it
    // to reach four parts is hundreds of megabytes, and every extra part is
    // more surface for a retrieval to wander into.
    const parts = selectEcfrParts(LISTING);

    expect(parts.every((p) => !p.url.endsWith('ECFR-title42.xml'))).toBe(true);
  });

  it('leaves parts nobody asked for alone', () => {
    expect(selectEcfrParts(LISTING).map((p) => p.citation)).not.toContain('42 CFR Part 400');
  });

  it('ignores folders', () => {
    expect(selectEcfrParts(LISTING).every((p) => !p.url.endsWith('subfolder'))).toBe(true);
  });

  it('makes the link absolute, since that is what gets stored and shown', () => {
    expect(
      selectEcfrParts(LISTING).every((p) => p.url.startsWith('https://www.govinfo.gov/')),
    ).toBe(true);
  });

  it('keeps an already absolute link as it is', () => {
    const absolute = {
      files: [
        {
          justFileName: 'ECFR-title42-part422.xml',
          link: 'https://www.govinfo.gov/bulkdata/ECFR/title-42/ECFR-title42-part422.xml',
        },
      ],
    };

    expect(selectEcfrParts(absolute)[0]!.url).toBe(
      'https://www.govinfo.gov/bulkdata/ECFR/title-42/ECFR-title42-part422.xml',
    );
  });

  it('returns nothing for a listing in a shape it does not recognise', () => {
    // The caller turns this into a loud failure naming what was actually
    // listed. A silent empty result reads as "nothing new to fetch", and the
    // regulations would never arrive while every run reported success. That is
    // the exact failure this corpus already had once.
    expect(selectEcfrParts({ items: [] })).toEqual([]);
    expect(selectEcfrParts(null)).toEqual([]);
    expect(selectEcfrParts({ files: 'not an array' })).toEqual([]);
  });

  it('titles each part, because a citation with no subject is not usable', () => {
    const part422 = selectEcfrParts(LISTING).find((p) => p.citation === '42 CFR Part 422');

    expect(part422?.title).toContain('Medicare Advantage');
    expect(part422?.sourceType).toBe('regulation');
  });
});
