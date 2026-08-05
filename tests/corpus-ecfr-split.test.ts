/**
 * Cutting four parts out of a title that is only published whole.
 *
 * govinfo does not publish per part files. Asked for title 42 it lists exactly
 * `ECFR-title42.xml` and `ECFR-title42-graphics.zip`, which a live run
 * established after the code went looking for `ECFR-title42-part409.xml` and
 * found nothing.
 *
 * The uncomfortable part: the previous selector had six passing unit tests. They
 * were written against a fixture invented from the same assumption as the code,
 * so they proved the two agreed with each other and nothing about govinfo. That
 * is why the tests below lean on chunk boundaries and ordering rather than on a
 * tidy document: the failures that matter are the ones a neat fixture hides.
 */
import { describe, expect, it } from 'vitest';
import { asStandaloneXml, splitTitleIntoParts } from '@/lib/corpus/ecfr-split';

/** Feed a string through as one chunk. */
async function* whole(text: string): AsyncIterable<string> {
  yield text;
}

/** Feed a string through in fixed size pieces, tags be damned. */
async function* sliced(text: string, size: number): AsyncIterable<string> {
  for (let i = 0; i < text.length; i += size) yield text.slice(i, i + size);
}

const TITLE = `<?xml version="1.0" encoding="UTF-8"?>
<ECFR>
<DIV5 N="400" TYPE="PART"><HEAD>PART 400</HEAD><P>Introduction and definitions.</P></DIV5>
<DIV5 N="405" TYPE="PART"><HEAD>PART 405</HEAD>
  <DIV8 N="405.942" TYPE="SECTION"><HEAD>&#xA7; 405.942 Time frame for filing.</HEAD>
  <P>A party must file a request for redetermination within 120 calendar days.</P></DIV8>
</DIV5>
<DIV5 N="409" TYPE="PART"><HEAD>PART 409</HEAD>
  <DIV8 N="409.31" TYPE="SECTION"><HEAD>&#xA7; 409.31 Level of care requirement.</HEAD>
  <P>Skilled nursing care must be needed on a daily basis.</P></DIV8>
</DIV5>
<DIV5 N="410" TYPE="PART"><HEAD>PART 410</HEAD><P>Supplementary medical insurance.</P></DIV5>
</ECFR>`;

const WANTED = ['405', '409', '412', '422'];

describe('taking the parts we argue from', () => {
  it('captures a wanted part whole, tags included', async () => {
    const { parts } = await splitTitleIntoParts(whole(TITLE), WANTED);

    const part409 = parts.get('409')!;
    expect(part409.startsWith('<DIV5')).toBe(true);
    expect(part409.endsWith('</DIV5>')).toBe(true);
    expect(part409).toContain('Skilled nursing care must be needed on a daily basis');
    expect(part409).toContain('409.31');
  });

  it('leaves the parts nobody asked for behind', async () => {
    const { parts } = await splitTitleIntoParts(whole(TITLE), WANTED);

    expect(parts.has('400')).toBe(false);
    expect(parts.has('410')).toBe(false);
    expect(parts.get('409')).not.toContain('Supplementary medical insurance');
    expect(parts.get('405')).not.toContain('Introduction and definitions');
  });

  it('does not bleed one part into the next', async () => {
    // The failure that would poison a citation: text from part 410 stored under
    // part 409 verifies perfectly against the document it was stored in, and
    // says something the regulation does not.
    const { parts } = await splitTitleIntoParts(whole(TITLE), WANTED);

    expect(parts.get('405')).not.toContain('daily basis');
    expect(parts.get('409')).not.toContain('120 calendar days');
  });

  it('survives tags split across chunk boundaries', async () => {
    // The real file arrives in network sized pieces that fall wherever they
    // fall. A part whose opening tag straddles two chunks would silently go
    // missing, which looks exactly like that part not existing.
    for (const size of [1, 7, 13, 64, 500]) {
      const { parts } = await splitTitleIntoParts(sliced(TITLE, size), WANTED);

      expect(parts.get('409')).toContain('Skilled nursing care must be needed on a daily basis');
      expect(parts.get('405')).toContain('120 calendar days');
      expect(parts.has('410')).toBe(false);
    }
  });

  it('reports what it did see, so a miss can be diagnosed', async () => {
    const { parts, seen } = await splitTitleIntoParts(whole(TITLE), ['412']);

    expect(parts.size).toBe(0);
    // Naming what was there is what turned the last failure into a fix in one
    // run rather than a week of guessing.
    expect(seen).toContain('400');
    expect(seen).toContain('409');
  });

  it('stops reading once it has everything it came for', async () => {
    // Title 42 continues for hundreds of megabytes after part 422. Reading on
    // costs the whole download for nothing.
    let delivered = 0;
    async function* counted(): AsyncIterable<string> {
      for (const chunk of [TITLE, '<DIV5 N="999" TYPE="PART">later</DIV5>']) {
        delivered += 1;
        yield chunk;
      }
    }

    await splitTitleIntoParts(counted(), ['405', '409']);

    expect(delivered).toBe(1);
  });

  it('ignores a DIV5 that is not a part', async () => {
    const odd = '<DIV5 N="409" TYPE="APPENDIX"><P>Appendix text.</P></DIV5>';
    const { parts } = await splitTitleIntoParts(whole(odd), ['409']);

    expect(parts.has('409')).toBe(false);
  });

  it('returns nothing rather than guessing when the title is empty', async () => {
    const { parts, seen } = await splitTitleIntoParts(whole(''), WANTED);

    expect(parts.size).toBe(0);
    expect(seen).toEqual([]);
  });
});

describe('what a sliced part is handed to the parser as', () => {
  it('is a document rather than a fragment', async () => {
    const { parts } = await splitTitleIntoParts(whole(TITLE), WANTED);
    const xml = asStandaloneXml(parts.get('409')!);

    expect(xml.startsWith('<?xml')).toBe(true);
    expect(xml).toContain('<DIV5');
  });

  it('still parses as the eCFR XML it is', async () => {
    // The point of slicing rather than converting: what comes out is the same
    // markup the parser already reads, so nothing downstream changes.
    const { parseEcfrXml } = await import('@/lib/documents/parse');
    const { parts } = await splitTitleIntoParts(whole(TITLE), WANTED);

    const parsed = parseEcfrXml(asStandaloneXml(parts.get('409')!));

    expect(parsed.text).toContain('§ 409.31 Level of care requirement.');
    expect(parsed.spans.length).toBeGreaterThan(0);
    expect(parsed.text).not.toMatch(/&#[Xx]?[0-9A-Fa-f]+;/);
  });
});
