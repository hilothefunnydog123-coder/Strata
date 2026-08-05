/**
 * Character references, and the one class of corruption verification cannot see.
 *
 * The decoder handled `&#8217;` and not `&#x2019;`. eCFR XML is written almost
 * entirely in the hex form: the section sign is `&#xA7;`, the dash in a part
 * heading is `&#x2014;`, and every quoted term in the regulations is wrapped in
 * `&#x201C;` and `&#x201D;`.
 *
 * Why that is worse than it looks. A holding is verified by finding its quote
 * in the parsed document. A quote reading `requires &#x201C;skilled&#x201D;
 * care` is found, character for character, in a document that says the same
 * thing. It passes, it is marked verified, it is embedded, and it goes into a
 * letter to a hospital exactly like that. Every check downstream agrees with
 * every other, because they are all reading the same corrupted parse. The
 * citation invariant proves a quote is in its document; it cannot prove the
 * document was read correctly.
 *
 * Nothing caught it because the regulations had never once been fetched. The
 * manuals are PDFs and take a different path.
 */
import { describe, expect, it } from 'vitest';
import { decodeEntities, parseEcfrXml, parseHtml } from '@/lib/documents/parse';

describe('character references', () => {
  it('decodes the hex form, which is the form eCFR uses', () => {
    expect(decodeEntities('&#x2019;')).toBe('’');
    expect(decodeEntities('&#xA7;')).toBe('§');
    expect(decodeEntities('&#X201C;skilled&#X201D;')).toBe('“skilled”');
  });

  it('still decodes the decimal form', () => {
    expect(decodeEntities('&#8217;')).toBe('’');
    expect(decodeEntities('&#167;')).toBe('§');
  });

  it('decodes the named entities government markup uses', () => {
    expect(decodeEntities('&amp;&lt;&gt;&quot;&apos;')).toBe('&<>"\'');
    expect(decodeEntities('42 CFR &sect; 409.31')).toBe('42 CFR § 409.31');
    expect(decodeEntities('a&nbsp;b')).toBe('a b');
  });

  it('decodes once, not twice', () => {
    // Two passes over the same text turn the literal characters "&lt;" into a
    // "<" nobody wrote: the first pass makes &amp;lt; into &lt;, the second
    // reads that as a tag character. A document quoting markup gets rewritten.
    expect(decodeEntities('&amp;lt;')).toBe('&lt;');
    expect(decodeEntities('&amp;amp;')).toBe('&amp;');
  });

  it('leaves something it does not recognise visible', () => {
    // Guessing produces a plausible wrong character inside a quote. Leaving it
    // alone puts the problem where a person reading the citation will see it.
    expect(decodeEntities('&notanentity;')).toBe('&notanentity;');
    expect(decodeEntities('AT&T and Q&A')).toBe('AT&T and Q&A');
    expect(decodeEntities('&#xD800;')).toBe('&#xD800;');
    expect(decodeEntities('&#1114112;')).toBe('&#1114112;');
  });
});

describe('a part of Title 42 as govinfo publishes it', () => {
  // The structure and the entity spelling are eCFR's, taken from 42 CFR 409.31,
  // which is the level of care rule this product argues from more than any
  // other single section.
  const XML = `<?xml version="1.0" encoding="UTF-8"?>
<DIV5 N="409" TYPE="PART">
<HEAD>PART 409&#x2014;HOSPITAL INSURANCE BENEFITS</HEAD>
<!-- a comment containing a > bracket -->
<DIV8 N="409.31" TYPE="SECTION">
<HEAD>&#xA7; 409.31 Level of care requirement.</HEAD>
<P>(a) The beneficiary&#x2019;s condition requires &#x201C;skilled&#x201D; care that as a practical matter can only be provided on an inpatient basis.</P>
<P>(b) Skilled nursing <I>and</I> skilled rehabilitation services are covered when the conditions in &#xA7; 409.32 &amp; &#xA7; 409.33 are met.</P>
</DIV8>
</DIV5>`;

  const parsed = parseEcfrXml(XML);

  it('leaves no character reference in the text a quote is taken from', () => {
    // The assertion that would have caught this before anything was fetched.
    expect(parsed.text).not.toMatch(/&#[Xx]?[0-9A-Fa-f]+;/);
    expect(parsed.text).not.toMatch(/&[A-Za-z]+;/);
  });

  it('reads the regulation as a person would read it', () => {
    expect(parsed.text).toContain('PART 409\u2014HOSPITAL INSURANCE BENEFITS');
    expect(parsed.text).toContain('§ 409.31 Level of care requirement.');
    expect(parsed.text).toContain('The beneficiary’s condition requires “skilled” care');
    expect(parsed.text).toContain('§ 409.32 & § 409.33');
  });

  it('keeps text inside inline markup', () => {
    expect(parsed.text).toContain('Skilled nursing and skilled rehabilitation services');
  });

  it('drops a comment without spilling the rest of it', () => {
    expect(parsed.text).not.toContain('a comment containing');
    expect(parsed.text).not.toContain('bracket -->');
  });

  it('splits on paragraphs and hangs the section heading over them', () => {
    // The heading is what makes a citation readable: a span saying "(a) The
    // beneficiary's condition..." is only usable if something records that it
    // came from 409.31.
    expect(parsed.spans).toHaveLength(2);
    expect(parsed.spans[0]!.headingPath).toContain('§ 409.31 Level of care requirement.');
    expect(parsed.spans[1]!.headingPath).toContain('§ 409.31 Level of care requirement.');
  });

  it('leaves offsets pointing at the text that was stored', () => {
    // What verification depends on: a span's offsets have to select that span
    // out of the document, or a quote found in a span is not findable in the
    // document it cites. Decoding changes the length of the text, so this is
    // the assertion that catches a decoder applied at the wrong moment.
    for (const span of parsed.spans) {
      expect(parsed.text.slice(span.charStart, span.charEnd)).toBe(span.text);
    }
  });
});

describe('the same treatment for HTML sources', () => {
  it('decodes hex references on a government page', () => {
    const parsed = parseHtml('<p>Medicare &#x2014; coverage of &#x201C;custodial&#x201D; care</p>');

    expect(parsed.text).toBe('Medicare \u2014 coverage of “custodial” care');
  });

  it('does not turn escaped markup back into markup', () => {
    const parsed = parseHtml('<p>Write &amp;lt;p&amp;gt; to show a tag.</p>');

    expect(parsed.text).toBe('Write &lt;p&gt; to show a tag.');
  });
});
