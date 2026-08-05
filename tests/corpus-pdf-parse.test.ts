/**
 * A PDF has to be extracted before it is a document.
 *
 * The corpus parse stage had no branch for PDFs. It read the bytes as UTF-8,
 * which turns a compressed object stream into replacement characters, and
 * handed the result to the paragraph splitter. Benefit Policy Manual chapter 8
 * went into the database as 1,302 passages of binary, one of which reads
 * "endstream endobj 25 0 obj <</Filter/FlateDecode".
 *
 * Nothing downstream noticed, and nothing downstream could have. The screen
 * threw away 1,019 of those passages as unreadable furniture, which was the
 * correct call on that input. The 279 it sent produced no holdings, which was
 * also correct: there was nothing in them to find. The extractor, the screen
 * and verification all behaved exactly as designed, and the answer was still an
 * empty corpus, because none of them knows what text is supposed to look like.
 *
 * So this checks the one thing that does: that a PDF arrives as words.
 */
import { describe, expect, it } from 'vitest';
import { PDFDocument, StandardFonts } from 'pdf-lib';
import { extractPdfText } from '@/lib/denials/pdf';
import { parseText } from '@/lib/documents/parse';

const SENTENCE =
  'The physician must certify that the services were required to be given on an ' +
  'inpatient basis because the beneficiary needed skilled nursing care.';

async function pdfWithText(text: string): Promise<Buffer> {
  const pdf = await PDFDocument.create();
  const font = await pdf.embedFont(StandardFonts.Helvetica);
  const page = pdf.addPage([612, 792]);
  page.drawText(text, { x: 40, y: 700, size: 11, font, maxWidth: 520, lineHeight: 14 });
  return Buffer.from(await pdf.save());
}

/** The magic bytes, which is how the parse stage decides. */
function isPdf(bytes: Buffer): boolean {
  return bytes.subarray(0, 5).toString('latin1') === '%PDF-';
}

describe('a PDF reaching the corpus parser', () => {
  it('is recognised by its bytes, not its file extension', async () => {
    // Both directions matter. The one CMS chapter that works is served at
    // bp102c08pdf.pdf, and a URL ending .pdf can answer with an HTML error
    // page instead. The first five bytes settle it.
    const bytes = await pdfWithText(SENTENCE);

    expect(isPdf(bytes)).toBe(true);
    expect(isPdf(Buffer.from('<html><body>Not found</body></html>'))).toBe(false);
  });

  it('comes back as the words that are in it', async () => {
    const bytes = await pdfWithText(SENTENCE);
    const text = await extractPdfText(bytes);

    expect(text).toContain('physician must certify');
    expect(text).toContain('skilled nursing care');
  });

  it('read as UTF-8 instead, it is binary, which is what happened', async () => {
    // The failure stated as a test, because "PDFs need extracting" is obvious
    // in hindsight and was not obvious for a week of green runs. Reading the
    // bytes directly produces a string that contains PDF structure and none of
    // the words, and every stage downstream accepts it.
    const bytes = await pdfWithText(SENTENCE);
    const wrong = bytes.toString('utf8');

    expect(wrong).not.toContain('physician must certify');
    expect(wrong).toMatch(/obj|endstream|FlateDecode/);
  });

  it('produces passages a person could read once extracted', async () => {
    const bytes = await pdfWithText(SENTENCE);
    const parsed = parseText(await extractPdfText(bytes));

    expect(parsed.spans.length).toBeGreaterThan(0);
    expect(parsed.spans.map((s) => s.text).join(' ')).toContain('physician must certify');

    // Mostly letters and spaces. Binary is not, which is exactly why the screen
    // classified it as furniture and why that classification was right.
    const all = parsed.spans.map((s) => s.text).join(' ');
    const prose = all.replace(/[^A-Za-z\s]/g, '').length / all.length;
    expect(prose).toBeGreaterThan(0.8);
  });

  it('a PDF with no text layer yields nothing rather than something', async () => {
    // A scan. The corpus must refuse it rather than OCR it: a misrecognised
    // word in a manual becomes a citation that verifies against its own
    // misreading, and no reviewer is shown the page image to catch it.
    const pdf = await PDFDocument.create();
    pdf.addPage([612, 792]);
    const blank = Buffer.from(await pdf.save());

    expect((await extractPdfText(blank)).trim()).toBe('');
  });
});
