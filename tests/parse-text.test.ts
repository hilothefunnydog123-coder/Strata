/**
 * Text cleaning, and the one character that can take a whole document down.
 *
 * A NUL byte cannot be stored in a PostgreSQL text column: the insert fails
 * with "invalid byte sequence for encoding UTF8: 0x00". PDFs from scanners and
 * government publishing pipelines carry NULs routinely, and enough survive text
 * extraction to reach the database. When that happened the error surfaced from
 * the database driver, so it read as a database fault rather than as a document
 * that needed cleaning.
 */
import { describe, expect, it } from 'vitest';
import { cleanExtractedText, PAGE_BREAK, parseText } from '@/lib/documents/parse';

const NUL = String.fromCharCode(0);
const BEL = String.fromCharCode(7);
const DEL = String.fromCharCode(127);

describe('control characters', () => {
  it('drops NUL bytes, which PostgreSQL cannot store at all', () => {
    const cleaned = cleanExtractedText(`skilled${NUL}${NUL} nursing`);
    expect(cleaned).not.toContain(NUL);
    expect(cleaned).toBe('skilled nursing');
  });

  it('drops the other C0 controls and DEL', () => {
    expect(cleanExtractedText(`a${BEL}b${DEL}c`)).toBe('abc');
  });

  it('drops rather than substitutes, because a NUL is not a character', () => {
    // Replacing with a space would put a word break where the document has
    // none, and every quote from that passage would then need the same
    // substitution to verify.
    expect(cleanExtractedText(`nurs${NUL}ing`)).toBe('nursing');
  });

  it('keeps the tab, the newline, and the page break', () => {
    const kept = cleanExtractedText(`a\tb\nc${PAGE_BREAK}d`);
    expect(kept).toContain('\t');
    expect(kept).toContain('\n');
    expect(kept).toContain(PAGE_BREAK);
  });

  it('still numbers pages after stripping', () => {
    // The page break is a control character too, and losing it would renumber
    // every citation in the document.
    const long = 'This passage is long enough to survive the minimum span length.';
    const doc = parseText(`${long}${NUL}${PAGE_BREAK}${long} Second page.`);
    expect(doc.pageCount).toBe(2);
    expect(doc.spans.map((s) => s.page)).toEqual([1, 2]);
  });

  it('leaves offsets pointing at the cleaned text', () => {
    // Offsets are into the stored string, so they must be computed after
    // cleaning or every highlight lands a character or two off.
    const long = 'A passage long enough to be kept as a quotable span of text.';
    const doc = parseText(`${NUL}${NUL}${long}`);
    const span = doc.spans[0]!;
    expect(doc.text.slice(span.charStart, span.charEnd)).toBe(span.text);
  });
});
