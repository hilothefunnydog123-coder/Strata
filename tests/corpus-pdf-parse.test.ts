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

/**
 * The guard that would have caught all of this on day one.
 *
 * Every stage behaved correctly on binary input and the corpus still came out
 * empty, because no stage had any idea what text is supposed to look like. The
 * parse stage now asks, once, before storing anything.
 */
describe('refusing to store something that is not text', () => {
  const ratio = (text: string): number => {
    const sample = text.length > 20_000 ? text.slice(0, 20_000) : text;
    return sample.replace(/[^A-Za-z\s]/g, '').length / sample.length;
  };

  it('scores real prose well above the threshold', () => {
    expect(ratio(SENTENCE)).toBeGreaterThan(0.8);
  });

  it('scores a PDF read as UTF-8 far below it', async () => {
    // The exact mistake: 1,302 passages of this went into the database.
    const bytes = await pdfWithText(SENTENCE.repeat(20));

    expect(ratio(bytes.toString('utf8'))).toBeLessThan(0.5);
  });

  it('still passes a document that is mostly numbers', async () => {
    // The threshold has to tolerate a rate table or a fee schedule, which is
    // legitimate content and is nothing like as dense as compressed bytes. A
    // guard that rejected those would be worse than the bug it replaces.
    const table = Array.from(
      { length: 40 },
      (_, i) => `Rate year ${2000 + i} payment ${i * 170}.50 adjusted ${i * 185}.75`,
    ).join('\n');

    expect(ratio(table)).toBeGreaterThan(0.5);
  });
});

/**
 * A built-in pdf.js needs and this runtime does not have.
 *
 * Math.sumPrecise is a stage 3 proposal present in newer V8 than Node 22
 * carries. pdf.js calls it during text layout and catches the TypeError, so
 * extraction survives, and it logged the same warning sixty seven times in a
 * single run. What it could not compute is the quantity that decides where
 * spaces fall between runs of glyphs, so the cost is words running together
 * inside passages, and then inside quotes drawn from them.
 */
describe('the summation pdf.js expects', () => {
  it('exists once the module is loaded', () => {
    expect(typeof (Math as { sumPrecise?: unknown }).sumPrecise).toBe('function');
  });

  it('adds exactly, which is the point of the name', () => {
    // Left to right addition loses the small terms entirely here. The proposal
    // exists because that is the wrong answer.
    const sum = (Math as unknown as { sumPrecise: (v: number[]) => number }).sumPrecise;

    const values = [1e20, 0.1, -1e20, 0.1, 0.1];

    expect(sum(values)).toBeCloseTo(0.3, 10);
    // Left to right loses a third of the total: the first 0.1 vanishes into
    // 1e20 and never comes back when the 1e20 is subtracted again.
    expect(values.reduce((a, b) => a + b, 0)).toBeCloseTo(0.2, 10);
  });

  it('sums an empty list to zero', () => {
    const sum = (Math as unknown as { sumPrecise: (v: number[]) => number }).sumPrecise;
    expect(sum([])).toBe(0);
  });
});

describe('choosing between two readers of the same file', () => {
  // The rule this replaces was "whichever answered first, if it answered at
  // all". That is wrong in a way nothing downstream can see: a chapter where a
  // few pages use a standard font and the rest carry their own character maps
  // hands the cheap reader a handful of fragments, the fragments are more than
  // nothing, so they win and the engine that could read the whole document
  // never runs. What comes out is a chapter that parsed successfully and
  // produced no passages.
  const PROSE =
    'Skilled nursing care must be needed and provided on a daily basis for the stay ' +
    'to be covered under the extended care benefit, and the need must be documented ' +
    'in the medical record by the attending physician.';

  it('keeps the whole document over a handful of fragments', async () => {
    const { preferReadable } = await import('@/lib/denials/pdf');

    // What a partially readable chapter gives the cheap reader: real words,
    // one line at a time, never joined into anything a span could be made of.
    const fragments = 'Chapter 9\nCoverage of\nHospice\nServices\nUnder\nHospital\nInsurance';

    expect(preferReadable(fragments, PROSE)).toBe(PROSE);
  });

  it('keeps prose over debris that happens to be longer', async () => {
    const { preferReadable } = await import('@/lib/denials/pdf');

    // Length alone is the wrong measure. A mis-decoded font produces plenty of
    // characters and none of them are words.
    const debris = '�'.repeat(400);

    expect(preferReadable(debris, PROSE)).toBe(PROSE);
  });

  it('keeps the cheap reader when the engine cannot open the file', async () => {
    const { preferReadable } = await import('@/lib/denials/pdf');

    expect(preferReadable(PROSE, '')).toBe(PROSE);
  });

  it('returns something rather than nothing when neither could read it', async () => {
    const { preferReadable } = await import('@/lib/denials/pdf');

    // So the diagnostic downstream has something to quote. An empty string is
    // the message that misdiagnosed eleven machine readable chapters as scans.
    expect(preferReadable('Chapter 9', '')).toBe('Chapter 9');
    expect(preferReadable('', 'Chapter 9')).toBe('Chapter 9');
    expect(preferReadable('', '')).toBe('');
  });

  it('still reads an ordinary PDF end to end', async () => {
    // The regression that matters: a denial letter exported from a word
    // processor must come through exactly as before.
    const bytes = await pdfWithText(SENTENCE);

    expect(await extractPdfText(bytes)).toContain('skilled nursing care');
  });
});
