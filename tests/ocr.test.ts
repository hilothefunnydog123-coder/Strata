/**
 * Reading scanned documents.
 *
 * The fixture is a real scan: two pages of JPEG, no text layer, written by a
 * PDF library that packs its page tree into a compressed object stream, which
 * is what current producers do. Both of those caught bugs when this was built,
 * so the fixture stays a real file rather than a hand written minimal one.
 *
 * The tests that matter most here are the refusals. OCR is the one place in
 * this codebase where the citation invariant does not protect the customer: the
 * recognised text becomes the source, so a misreading verifies against itself.
 * Refusing an uncertain read, and refusing a codec we cannot decode rather than
 * silently returning fewer pages, is what stands in for verification.
 */
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { deflateSync } from 'node:zlib';
import { describe, expect, it } from 'vitest';
import { extractPageImages, UnsupportedImageCodecError } from '@/lib/denials/pdf-images';
import { extractPdfText } from '@/lib/denials/pdf';
import {
  assertConfident,
  CONFIDENCE_FLOOR,
  LowConfidenceScanError,
  ocrPdf,
} from '@/lib/denials/ocr';

const SCAN = readFileSync(path.join(__dirname, 'fixtures', 'scanned-denial.pdf'));

/** A PDF built by hand, so a single structural detail can be put under test. */
function buildPdf(objects: string[]): Buffer {
  let body = '%PDF-1.7\n';
  objects.forEach((object, index) => {
    body += `${index + 1} 0 obj\n${object}\nendobj\n`;
  });
  body += 'trailer\n<< /Root 2 0 R >>\n%%EOF';
  return Buffer.from(body, 'latin1');
}

describe('the fixture is genuinely a scan', () => {
  it('has no text layer at all', async () => {
    // If this ever fails the other tests are measuring the wrong thing: they
    // would be reading the text layer rather than recognising the image.
    expect((await extractPdfText(SCAN)).trim()).toBe('');
  });
});

describe('finding the page images', () => {
  it('extracts one image per page, in page order', () => {
    const images = extractPageImages(SCAN);
    expect(images).toHaveLength(2);
    expect(images.map((i) => i.page)).toEqual([1, 2]);
    expect(images.every((i) => i.format === 'jpeg')).toBe(true);
    expect(images.every((i) => i.bytes.length > 1000)).toBe(true);
  });

  it('reads the page tree out of a compressed object stream', () => {
    // The fixture's pages live inside an ObjStm. Finding two pages at all
    // proves the container was unpacked, because the page objects do not
    // appear in the file body.
    expect(SCAN.toString('latin1')).toContain('/ObjStm');
    expect(extractPageImages(SCAN)).toHaveLength(2);
  });

  it('accepts a name containing characters beyond letters and digits', () => {
    // Real producers emit names like /Image-7098480789 and /Im_0. A pattern
    // allowing only letters and digits matches none of them and reports a
    // document with no images, which reads as a blank scan rather than as a
    // parser bug. That is exactly how this failed the first time.
    const samples = deflateSync(Buffer.alloc(16, 0x40));
    const withAwkwardNames = buildPdf([
      `<< /Type /Pages /Kids [ 3 0 R ] /Count 1 >>`,
      `<< /Type /Catalog /Pages 1 0 R >>`,
      `<< /Type /Page /Parent 1 0 R /Resources << /XObject ` +
        `<< /Image-7098480789 4 0 R /Im_0.a 4 0 R >> >> >>`,
      `<< /Type /XObject /Subtype /Image /Width 4 /Height 4 /ColorSpace /DeviceGray ` +
        `/BitsPerComponent 8 /Filter /FlateDecode /Length ${samples.length} >>\n` +
        `stream\n${samples.toString('latin1')}\nendstream`,
    ]);

    expect(extractPageImages(withAwkwardNames)).toHaveLength(2);
  });

  it('turns raw greyscale samples into a PNG', () => {
    const width = 8;
    const height = 4;
    const samples = deflateSync(Buffer.alloc(width * height, 0x80));
    const pdf = buildPdf([
      `<< /Type /Pages /Kids [ 3 0 R ] /Count 1 >>`,
      `<< /Type /Catalog /Pages 1 0 R >>`,
      `<< /Type /Page /Parent 1 0 R /Resources << /XObject << /Im0 4 0 R >> >> >>`,
      `<< /Type /XObject /Subtype /Image /Width ${width} /Height ${height} ` +
        `/ColorSpace /DeviceGray /BitsPerComponent 8 /Filter /FlateDecode ` +
        `/Length ${samples.length} >>\nstream\n${samples.toString('latin1')}\nendstream`,
    ]);

    const [image] = extractPageImages(pdf);
    expect(image).toBeDefined();
    expect(image!.format).toBe('png');
    // The PNG signature, so this is a real file rather than a relabelled blob.
    expect([...image!.bytes.subarray(0, 8)]).toEqual([137, 80, 78, 71, 13, 10, 26, 10]);
  });

  it('names the codec it cannot read rather than returning nothing', () => {
    const pdf = buildPdf([
      `<< /Type /Pages /Kids [ 3 0 R ] /Count 1 >>`,
      `<< /Type /Catalog /Pages 1 0 R >>`,
      `<< /Type /Page /Parent 1 0 R /Resources << /XObject << /Im0 4 0 R >> >> >>`,
      `<< /Type /XObject /Subtype /Image /Width 100 /Height 100 ` +
        `/Filter /CCITTFaxDecode /Length 4 >>\nstream\nabcd\nendstream`,
    ]);

    // Returning zero images here would look like a blank page, and a partial
    // read of a denial letter is worse than a refusal: the missing paragraph
    // is usually the one that matters.
    expect(() => extractPageImages(pdf)).toThrow(UnsupportedImageCodecError);
    expect(() => extractPageImages(pdf)).toThrow(/fax encoded/i);
  });
});

describe('recognising the text', () => {
  it('recovers both pages, keeping them in order and separated', async () => {
    const result = await ocrPdf(SCAN, 'scanned-denial.pdf');

    expect(result.pageCount).toBe(2);
    const [first, second] = result.text.split('\f');

    expect(first).toContain('NOTICE OF DENIAL OF MEDICARE COVERAGE');
    expect(first).toContain('NG-2026-0031');
    expect(second).toContain('CLINICAL RECORD EXCERPT');
    expect(second).toContain('IV antibiotics daily');

    // Page one's content must not bleed into page two, or a citation would
    // send a reviewer to the wrong page.
    expect(second).not.toContain('NOTICE OF DENIAL');
  }, 120_000);

  it('reads the payer criteria name, which the classifier keys on', async () => {
    // A denial that names proprietary criteria is the strongest kind of case,
    // and detecting it depends on this exact word surviving recognition.
    const result = await ocrPdf(SCAN, 'scanned-denial.pdf');
    expect(result.text).toContain('InterQual');
  }, 120_000);

  it('reports a confidence a caller can act on', async () => {
    const result = await ocrPdf(SCAN, 'scanned-denial.pdf');
    expect(result.confidence).toBeGreaterThan(CONFIDENCE_FLOOR);
    expect(result.confidence).toBeLessThanOrEqual(100);
  }, 120_000);

  it('returns nothing rather than throwing when there are no images', async () => {
    const result = await ocrPdf(Buffer.from('%PDF-1.7\n%%EOF', 'latin1'), 'empty.pdf');
    expect(result.text).toBe('');
    expect(result.pageCount).toBe(0);
  });
});

describe('refusing an uncertain read', () => {
  it('rejects text recognised below the floor', () => {
    expect(() =>
      assertConfident(
        { text: 'the beneficiary now requires skilled care', confidence: 51, pageCount: 1 },
        'fax.pdf',
      ),
    ).toThrow(LowConfidenceScanError);
  });

  it('says what to do about it, in the message', () => {
    try {
      assertConfident({ text: 'something', confidence: 40, pageCount: 1 }, 'fax.pdf');
      expect.unreachable('a 40% read must not be accepted');
    } catch (error) {
      expect(error).toBeInstanceOf(LowConfidenceScanError);
      expect((error as Error).message).toContain('fax.pdf');
      expect((error as Error).message).toContain('300 dpi');
    }
  });

  it('accepts a read at the floor', () => {
    expect(() =>
      assertConfident({ text: 'something', confidence: CONFIDENCE_FLOOR, pageCount: 1 }, 'a.pdf'),
    ).not.toThrow();
  });

  it('does not judge an empty read, which the caller reports differently', () => {
    // Zero confidence on zero text is not a bad scan, it is a blank document,
    // and it deserves the message about blank pages rather than about dpi.
    expect(() => assertConfident({ text: '', confidence: 0, pageCount: 0 }, 'a.pdf')).not.toThrow();
  });
});
