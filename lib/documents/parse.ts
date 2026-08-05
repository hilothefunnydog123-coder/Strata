/**
 * Turning an uploaded or fetched document into located passages.
 *
 * Everything downstream of this file addresses text by character offset into a
 * span, so this is where the product's ability to say "here, this line" comes
 * from. Two properties matter more than anything else:
 *
 *   1. Offsets are into the extracted plain text, and that text is stored, so a
 *      quote can always be re-located later. The original bytes are kept
 *      separately and never mutated.
 *   2. Page numbers survive. A reviewer checking a manual citation needs a page,
 *      not a character index into a 400 page PDF.
 *
 * Splitting is by paragraph rather than by sentence or by a fixed window. A
 * paragraph is the unit a legal quotation is drawn from and the unit a reader
 * needs to see for context, so it is the unit the source panel opens to.
 */

export interface ParsedSpan {
  ordinal: number;
  page: number | null;
  charStart: number;
  charEnd: number;
  text: string;
  headingPath: string[];
}

export interface ParsedDocument {
  /** The full extracted text. Offsets in every span index into this. */
  text: string;
  spans: ParsedSpan[];
  pageCount: number | null;
}

/** A page break marker inserted by the PDF extractor, invisible in the text. */
export const PAGE_BREAK = '\f';

/**
 * Headings in the documents this product reads: numbered sections, lettered
 * subsections, all caps titles, and the manual's own numbering.
 */
const HEADING_PATTERNS: ReadonlyArray<{ level: number; re: RegExp }> = [
  // "30.2 - Skilled Nursing Facility Level of Care" as CMS manuals number.
  { level: 1, re: /^\d{1,3}(?:\.\d{1,3})?\s*[-\u2013\u2014]\s*\S.{0,110}$/ },
  // "§ 409.31 Level of care requirement." as the CFR numbers.
  { level: 1, re: /^§+\s*\d+\.\d+.{0,110}$/ },
  // "II. Applicable Law" or "IV. Analysis" as decisions number.
  { level: 1, re: /^[IVXLC]{1,6}\.\s+\S.{0,110}$/ },
  // "A. The plan's criteria" one level down.
  { level: 2, re: /^[A-Z]\.\s+\S.{0,110}$/ },
  // A short all-caps line: "ANALYSIS", "FINDINGS OF FACT".
  { level: 1, re: /^[A-Z][A-Z\s,'()-]{3,60}$/ },
];

function headingLevel(line: string): number | null {
  const trimmed = line.trim();
  if (trimmed.length === 0 || trimmed.length > 120) return null;
  // A line ending in a full stop mid-sentence is prose, not a heading, unless it
  // is a numbered section title where the stop follows the number.
  for (const { level, re } of HEADING_PATTERNS) {
    if (re.test(trimmed)) return level;
  }
  return null;
}

/** Spans shorter than this are page furniture: numbers, running heads, rules. */
const MINIMUM_SPAN_CHARS = 40;

/**
 * Split plain text into located spans.
 *
 * `text` must be the exact string that will be stored, because the offsets are
 * only meaningful against it.
 */
export function spanify(text: string): ParsedSpan[] {
  const spans: ParsedSpan[] = [];
  const headingStack: string[] = [];

  let page = text.includes(PAGE_BREAK) ? 1 : 0;
  let ordinal = 0;
  let cursor = 0;

  // Paragraphs are separated by a blank line. A page break also ends one,
  // because a paragraph continuing across a page is still two locations.
  const blocks = splitKeepingOffsets(text);

  for (const block of blocks) {
    if (block.isPageBreak) {
      page += 1;
      cursor = block.end;
      continue;
    }

    const trimmed = block.text.trim();
    if (trimmed.length === 0) {
      cursor = block.end;
      continue;
    }

    const level = headingLevel(trimmed);
    if (level !== null) {
      headingStack.length = Math.max(0, level - 1);
      headingStack.push(trimmed);
      // A heading is recorded in the trail rather than emitted as a span: it is
      // not a passage anybody quotes on its own.
      cursor = block.end;
      continue;
    }

    if (trimmed.length < MINIMUM_SPAN_CHARS) {
      cursor = block.end;
      continue;
    }

    // Trim the offsets to the non-whitespace content so a highlight does not
    // start on a blank line.
    const leading = block.text.length - block.text.trimStart().length;
    const trailing = block.text.length - block.text.trimEnd().length;

    ordinal += 1;
    spans.push({
      ordinal,
      page: page > 0 ? page : null,
      charStart: block.start + leading,
      charEnd: block.end - trailing,
      text: trimmed,
      headingPath: [...headingStack],
    });

    cursor = block.end;
  }

  void cursor;
  return spans;
}

interface Block {
  text: string;
  start: number;
  end: number;
  isPageBreak: boolean;
}

/** Split on blank lines and page breaks while tracking offsets exactly. */
function splitKeepingOffsets(text: string): Block[] {
  const blocks: Block[] = [];
  const separator = /\f|\n[ \t]*\n+/g;

  let last = 0;
  let match: RegExpExecArray | null;

  while ((match = separator.exec(text)) !== null) {
    if (match.index > last) {
      blocks.push({
        text: text.slice(last, match.index),
        start: last,
        end: match.index,
        isPageBreak: false,
      });
    }
    if (match[0] === PAGE_BREAK) {
      blocks.push({
        text: '',
        start: match.index,
        end: match.index + 1,
        isPageBreak: true,
      });
    }
    last = match.index + match[0].length;
  }

  if (last < text.length) {
    blocks.push({ text: text.slice(last), start: last, end: text.length, isPageBreak: false });
  }

  return blocks;
}

/* ─── Extraction by content type ──────────────────────────────────────────── */

/**
 * Normalise line endings and strip the artefacts every extractor leaves.
 *
 * Applied before spanning so that offsets refer to cleaned text. This is the
 * only place text is altered; after this it is immutable, because a later
 * alteration would silently invalidate every stored offset.
 */
export function cleanExtractedText(raw: string): string {
  return (
    raw
      // PostgreSQL cannot store a NUL byte in a text column: it rejects the
      // whole insert with "invalid byte sequence for encoding UTF8: 0x00", and
      // the failure surfaces at the database rather than at the extractor, so
      // it reads as a database problem rather than a document problem. PDFs
      // produced by a scanner or a government publishing pipeline carry NULs
      // routinely, inside font tables and object padding, and enough of them
      // survive text extraction to poison a document.
      //
      // Dropped rather than replaced with a space, because a NUL is not a
      // character anyone wrote. The other C0 controls go too, except the tab,
      // newline and the form feed the page break marker uses.
      .replace(/[\u0000-\u0008\u000B\u000E-\u001F\u007F]/g, '')
      .replace(/\r\n?/g, '\n')
      // Trailing spaces before a newline are extractor noise.
      .replace(/[ \t]+\n/g, '\n')
      // More than two consecutive blank lines carry no structure.
      .replace(/\n{4,}/g, '\n\n\n')
      .trim()
  );
}

export function parseText(raw: string): ParsedDocument {
  const text = cleanExtractedText(raw);
  const pageCount = text.includes(PAGE_BREAK)
    ? text.split(PAGE_BREAK).length
    : null;
  return { text, spans: spanify(text), pageCount };
}

/**
 * The named entities government markup actually uses.
 *
 * Not the full HTML set. These are the ones that appear in eCFR XML and on CMS
 * pages, and an unknown entity is left exactly as written rather than guessed
 * at, so it shows up in a quote where someone can see it.
 */
const NAMED_ENTITIES: Readonly<Record<string, string>> = {
  amp: '&',
  lt: '<',
  gt: '>',
  quot: '"',
  apos: "'",
  nbsp: ' ',
  ndash: '\u2013',
  mdash: '\u2014',
  lsquo: '‘',
  rsquo: '’',
  ldquo: '“',
  rdquo: '”',
  hellip: '…',
  sect: '§',
  para: '¶',
  deg: '°',
  bull: '•',
};

/**
 * Turn character references into the characters they stand for.
 *
 * Hex references were the bug. The decoder handled `&#8217;` and not
 * `&#x2019;`, and eCFR XML is written almost entirely in the hex form: section
 * signs are `&#xA7;`, the dash in "PART 409-HOSPITAL INSURANCE BENEFITS" is
 * `&#x2014;`, and every quoted term in the regulations is wrapped in `&#x201C;`
 * and `&#x201D;`.
 *
 * What makes this worth care rather than a patch: verification cannot catch it.
 * A quote is checked by finding it in the parsed document, so a quote reading
 * `requires &#x201C;skilled&#x201D; care` is found in a document that says the
 * same thing, passes, is marked verified, and goes into a letter to a hospital
 * exactly like that. Every downstream check agrees, because they all read the
 * same corrupted parse. The regulations had never been fetched, so no run had
 * ever put this in front of anyone.
 *
 * One pass, because two are wrong: decoding `&amp;` and then `&lt;` turns the
 * literal text `&amp;lt;` into a `<` that nobody wrote.
 */
export function decodeEntities(text: string): string {
  return text.replace(/&(#[Xx][0-9A-Fa-f]+|#\d+|[A-Za-z][A-Za-z0-9]{1,10});/g, (whole, body: string) => {
    if (body.startsWith('#')) {
      const isHex = body[1] === 'x' || body[1] === 'X';
      const code = Number.parseInt(isHex ? body.slice(2) : body.slice(1), isHex ? 16 : 10);

      // Surrogates and out of range values are not characters. Leaving the
      // reference visible is better than emitting a replacement character that
      // reads as if the document contained one.
      if (!Number.isFinite(code) || code <= 0 || code > 0x10ffff) return whole;
      if (code >= 0xd800 && code <= 0xdfff) return whole;

      return String.fromCodePoint(code);
    }

    return NAMED_ENTITIES[body.toLowerCase()] ?? whole;
  });
}

/**
 * Strip tags from an HTML document, keeping block structure as blank lines.
 *
 * Deliberately not a full HTML parser. The documents this reads are government
 * pages and decision text, and what matters is that block elements become
 * paragraph breaks so spanning lands where a reader would expect.
 */
export function parseHtml(html: string): ParsedDocument {
  const text = html
    .replace(/<script\b[\s\S]*?<\/script>/gi, '')
    .replace(/<style\b[\s\S]*?<\/style>/gi, '')
    .replace(/<\/(p|div|section|article|li|tr|h[1-6]|blockquote)>/gi, '\n\n')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<[^>]+>/g, '');

  return parseText(decodeEntities(text));
}

/**
 * Extract text from eCFR XML.
 *
 * The eCFR structure is regular: sections carry a heading and paragraphs, and
 * the heading trail is what makes a citation readable. Section boundaries
 * become blank lines so the spanner sees them.
 */
export function parseEcfrXml(xml: string): ParsedDocument {
  const text = xml
    .replace(/<\?xml[\s\S]*?\?>/g, '')
    // Comments before tags, because a comment may contain a ">" and the tag
    // stripper below would then end it early and spill markup into the text.
    .replace(/<!--[\s\S]*?-->/g, '')
    .replace(/<HEAD>([\s\S]*?)<\/HEAD>/gi, '\n\n$1\n\n')
    .replace(/<\/(P|DIV\d?|SECTION|HEAD)>/gi, '\n\n')
    .replace(/<[^>]+>/g, '');

  return parseText(decodeEntities(text));
}
