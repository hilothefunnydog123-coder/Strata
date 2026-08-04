/**
 * Reading a scanned document.
 *
 * This exists because a large share of denial letters arrive as a fax or a
 * scan, and until now those were refused at the door. The refusal was honest
 * but it excluded exactly the documents a hospital most often has.
 *
 * OCR opens a gap the rest of this codebase does not have, and it is worth
 * naming plainly. Everywhere else, a quote is checked against the source
 * document, so a fabricated quote cannot survive. Here the OCR output becomes
 * the source document. If the engine misreads "no longer requires" as "now
 * requires", the model quotes the misreading, verification compares the quote
 * against the same misreading, and it passes. The invariant holds and the
 * sentence is still wrong.
 *
 * Three things follow from that, and all three are implemented rather than
 * documented:
 *
 *   1. Text that came from OCR is recorded as such on the document, with the
 *      engine's confidence, so nothing downstream can mistake it for text a
 *      person could have read.
 *   2. Below CONFIDENCE_FLOOR the document is refused outright. A poor scan
 *      produces plausible looking words, which is the dangerous failure, not
 *      the obvious one.
 *   3. The reviewer is told, on the page where they approve the letter, that a
 *      quote came from a scan and has to be checked against the image.
 *
 * The engine runs locally as WebAssembly and the language data is vendored in
 * this repository. That is a compliance decision as much as an operational one:
 * sending page images of a patient record to a hosted OCR service would add a
 * subprocessor to every Business Associate Agreement, for a job we can do
 * ourselves.
 */
import os from 'node:os';
import path from 'node:path';
import { createWorker, type Worker } from 'tesseract.js';
import { PAGE_BREAK } from '@/lib/documents/parse';
import { log } from '@/lib/log';
import { extractPageImages, UnsupportedImageCodecError } from './pdf-images';

export { UnsupportedImageCodecError };

/**
 * Mean confidence below which a document is refused.
 *
 * Tesseract reports 0 to 100 per recognised block. Clean printed text on a
 * decent scan lands in the 90s; a bad fax lands in the 50s and 60s and is where
 * words start being invented rather than dropped. 70 is deliberately cautious:
 * refusing a readable document costs an upload, accepting an unreadable one
 * costs a citation that is not in the record.
 */
export const CONFIDENCE_FLOOR = 70;

export interface OcrResult {
  /** Page texts joined by PAGE_BREAK, so the spanner numbers pages as usual. */
  text: string;
  /** Mean confidence across pages, 0 to 100, rounded. */
  confidence: number;
  pageCount: number;
}

export class LowConfidenceScanError extends Error {
  constructor(
    readonly confidence: number,
    filename: string,
  ) {
    super(
      `${filename} was read by OCR at ${confidence}% confidence, below the ${CONFIDENCE_FLOOR}% ` +
        'floor. Text this uncertain produces quotes that look right and are not, so it is ' +
        'refused rather than stored. Rescan at 300 dpi or higher, straighten the page, and ' +
        'avoid photographing a screen.',
    );
    this.name = 'LowConfidenceScanError';
  }
}

/** Where the vendored language data lives, relative to the repository root. */
function langPath(): string {
  return path.join(process.cwd(), 'vendor', 'tessdata');
}

/**
 * One worker, reused across the pages of a document.
 *
 * Starting a worker costs a few hundred milliseconds and loading the language
 * data costs more, so a forty page chart would pay that forty times if this
 * were per page.
 */
async function withWorker<T>(run: (worker: Worker) => Promise<T>): Promise<T> {
  const worker = await createWorker('eng', 1, {
    langPath: langPath(),
    gzip: true,
    // The engine decompresses the language file and caches it. Left alone it
    // writes that copy into the current working directory, which is the
    // repository root in development and a read-only filesystem on a serverless
    // host, where it fails. The system temporary directory is writable in both.
    cachePath: os.tmpdir(),
    // Silence the engine's own progress logging; ours goes through log().
    logger: () => {},
    errorHandler: (error: unknown) => {
      log.warn('ocr engine reported an error', {
        message: error instanceof Error ? error.message : String(error),
      });
    },
  });
  try {
    return await run(worker);
  } finally {
    await worker.terminate();
  }
}

/** Recognise a single encoded image. Exported for the direct image upload path. */
export async function ocrImage(bytes: Buffer, label: string): Promise<OcrResult> {
  return withWorker(async (worker) => {
    const { data } = await worker.recognize(bytes);
    const confidence = Math.round(data.confidence);
    log.info('ocr completed', { label, pages: 1, confidence });
    return { text: data.text.trim(), confidence, pageCount: 1 };
  });
}

/**
 * Recognise every page of a scanned PDF.
 *
 * Pages that produce no text at all are kept as empty pages rather than
 * dropped, because dropping one would renumber every page after it and a
 * citation would then name the wrong page.
 */
export async function ocrPdf(bytes: Buffer, label: string): Promise<OcrResult> {
  const images = extractPageImages(bytes);

  if (images.length === 0) {
    return { text: '', confidence: 0, pageCount: 0 };
  }

  return withWorker(async (worker) => {
    const byPage = new Map<number, string[]>();
    const confidences: number[] = [];

    for (const image of images) {
      const { data } = await worker.recognize(image.bytes);
      const text = data.text.trim();
      if (text.length > 0) {
        const existing = byPage.get(image.page) ?? [];
        existing.push(text);
        byPage.set(image.page, existing);
        // A page of blank paper reports a confidence of zero and would drag the
        // mean down for no reason, so only pages that carried text are scored.
        confidences.push(data.confidence);
      } else if (!byPage.has(image.page)) {
        byPage.set(image.page, []);
      }
    }

    const highestPage = Math.max(...images.map((i) => i.page));
    const pages: string[] = [];
    for (let page = 1; page <= highestPage; page += 1) {
      pages.push((byPage.get(page) ?? []).join('\n'));
    }

    const confidence =
      confidences.length === 0
        ? 0
        : Math.round(confidences.reduce((sum, value) => sum + value, 0) / confidences.length);

    log.info('ocr completed', { label, pages: pages.length, confidence });

    return {
      text: pages.join(PAGE_BREAK).replace(/\n{3,}/g, '\n\n'),
      confidence,
      pageCount: pages.length,
    };
  });
}

/** Throws when a result is too uncertain to build citations on. */
export function assertConfident(result: OcrResult, filename: string): void {
  if (result.text.trim().length === 0) return;
  if (result.confidence < CONFIDENCE_FLOOR) {
    throw new LowConfidenceScanError(result.confidence, filename);
  }
}
