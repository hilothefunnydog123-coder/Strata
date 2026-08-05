/**
 * Finding the manual's chapters, rather than guessing their filenames.
 *
 * The chapter list used to be two hardcoded paths. Chapter 8 was found by hand
 * and is published as bp102c08pdf.pdf; chapter 1 was written by pattern from it
 * as bp102c01pdf.pdf and returned 404 on every run for a week. Reading the real
 * index showed why: almost every chapter is bp102cNN.pdf, and chapters 3 and 8
 * alone carry the doubled "pdf". The single chapter anyone had verified was one
 * of the two exceptions in the set.
 *
 * The fixture below is the shape the live page actually returns, taken from a
 * probe of it rather than imagined, exceptions included.
 */
import { describe, expect, it } from 'vitest';
import { discoverManualChapters } from '@/lib/corpus/sources';

const DOWNLOADS = '/regulations-and-guidance/guidance/manuals/downloads';

/** As published: chapter links, each with a crosswalk beside it. */
const INDEX_HTML = `<!doctype html><html><body>
<ul>
  <li><a href="${DOWNLOADS}/bp102c01.pdf">Chapter 1</a>
      <a href="${DOWNLOADS}/bp102c01crosswalk.pdf">Crosswalk</a></li>
  <li><a href="${DOWNLOADS}/bp102c02.pdf">Chapter 2</a>
      <a href="${DOWNLOADS}/bp102c02crosswalk.pdf">Crosswalk</a></li>
  <li><a href="${DOWNLOADS}/bp102c03pdf.pdf">Chapter 3</a>
      <a href="${DOWNLOADS}/bp102c03crosswalk.pdf">Crosswalk</a></li>
  <li><a href="${DOWNLOADS}/bp102c07.pdf">Chapter 7</a>
      <a href="${DOWNLOADS}/bp102c07crosswalk.pdf">Crosswalk</a></li>
  <li><a href="${DOWNLOADS}/bp102c08pdf.pdf">Chapter 8</a>
      <a href="${DOWNLOADS}/bp102c08crosswalk.pdf">Crosswalk</a></li>
  <li><a href="${DOWNLOADS}/bp102c15.pdf">Chapter 15</a>
      <a href="${DOWNLOADS}/bp102c15crosswalk.pdf">Crosswalk</a></li>
</ul>
</body></html>`;

describe('reading the Benefit Policy Manual index', () => {
  it('takes both filename conventions, because the page uses both', () => {
    // The whole reason this function exists. bp102c01.pdf and bp102c08pdf.pdf
    // are the same kind of thing published under two names, and no rule derived
    // from either one alone finds the other.
    const chapters = discoverManualChapters(INDEX_HTML);

    const urls = chapters.map((c) => c.url);
    expect(urls.some((u) => u.endsWith('bp102c01.pdf'))).toBe(true);
    expect(urls.some((u) => u.endsWith('bp102c08pdf.pdf'))).toBe(true);
  });

  it('leaves the crosswalks alone', () => {
    // Every chapter link has one beside it. A crosswalk is a table of what
    // moved where in a revision: it states no coverage rule, and ingesting it
    // would put a pile of section number pairs through the extractor as though
    // they were law.
    const chapters = discoverManualChapters(INDEX_HTML);

    expect(chapters.every((c) => !/crosswalk/i.test(c.url))).toBe(true);
  });

  it('keeps only the chapters that have been given a title', () => {
    // Chapter 3 is in the fixture and not in the title list, so it is not
    // ingested. A citation reading "Medicare Benefit Policy Manual, Ch. 3" with
    // no idea what chapter 3 covers is not something to put in front of a
    // reviewer.
    //
    // Chapter 3 is also one of the two doubled-pdf exceptions, so this doubles
    // as proof that the title filter and the filename handling are independent:
    // a chapter can be found and still be left out on purpose.
    const chapters = discoverManualChapters(INDEX_HTML);

    expect(chapters.map((c) => c.citation)).not.toContain(
      'Medicare Benefit Policy Manual, Ch. 3',
    );
    expect(chapters.map((c) => c.citation)).toContain('Medicare Benefit Policy Manual, Ch. 8');
  });

  it('numbers the citation the way a person writes it', () => {
    // Ch. 8, not Ch. 08. This string is printed in a letter that goes to a
    // payer.
    const chapters = discoverManualChapters(INDEX_HTML);
    const eight = chapters.find((c) => c.url.includes('c08'));

    expect(eight?.citation).toBe('Medicare Benefit Policy Manual, Ch. 8');
    expect(eight?.title).toContain('Extended Care');
    expect(eight?.sourceType).toBe('manual');
  });

  it('returns an absolute URL, since that is what gets stored and shown', () => {
    const chapters = discoverManualChapters(INDEX_HTML);

    expect(chapters.every((c) => c.url.startsWith('https://www.cms.gov/'))).toBe(true);
  });

  it('finds nothing in a page that no longer lists chapters', () => {
    // The caller turns this into a loud failure rather than a quiet zero. A
    // silent empty result would look identical to CMS having published nothing
    // new, and the corpus would stop growing without anyone noticing.
    expect(discoverManualChapters('<html><body>Page moved.</body></html>')).toEqual([]);
  });
});
