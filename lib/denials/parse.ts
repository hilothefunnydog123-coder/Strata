/**
 * Parsing an uploaded denial document into located passages.
 *
 * The clinical mirror of the corpus parser. Same spanning logic, because a
 * quote from a chart has to be locatable in exactly the way a quote from a
 * decision is, but the rows land in denial_span, whose text column is encrypted
 * at rest.
 */
import { eq } from 'drizzle-orm';
import { db } from '@/lib/db';
import { denial, denialDocument, denialSpan } from '@/lib/db/schema';
import { log } from '@/lib/log';
import { storage } from '@/lib/storage';
import { parseText } from '@/lib/documents/parse';
import { extractPdfText } from './pdf';
import { assertConfident, ocrImage, ocrPdf, type OcrResult } from './ocr';
import { isImageType } from './upload';

export interface ParseResult {
  documentId: string;
  spanCount: number;
  pageCount: number | null;
  textSource: 'text_layer' | 'ocr';
  /** Mean OCR confidence, 0 to 100. Null when the text came from the file. */
  ocrConfidence: number | null;
}

export class UnparseableDocumentError extends Error {
  constructor(filename: string, reason: string) {
    super(
      `Nothing readable came out of ${filename}. ${reason} Every citation in an appeal has ` +
        'to point at text we can quote, so a document we cannot read is one we cannot use.',
    );
    this.name = 'UnparseableDocumentError';
  }
}

/**
 * Parse one uploaded document.
 *
 * Reads the stored bytes rather than anything held in memory from the upload,
 * so re-parsing after a parser change is the same operation as parsing the
 * first time.
 */
export async function parseDenialDocument(documentId: string): Promise<ParseResult> {
  const document = await db.query.denialDocument.findFirst({
    where: eq(denialDocument.id, documentId),
  });
  if (!document) throw new Error('That document does not exist.');

  const bytes = await storage().get(document.r2Key);

  const isPdf =
    document.filename.toLowerCase().endsWith('.pdf') ||
    bytes.subarray(0, 5).toString('latin1') === '%PDF-';

  let text = '';
  let ocr: OcrResult | null = null;

  if (isImageType(document.filename)) {
    // A photograph or a scan saved as an image. There is no text layer to try.
    ocr = await ocrImage(bytes, document.filename);
    text = ocr.text;
  } else if (isPdf) {
    text = await extractPdfText(bytes);
    if (text.trim().length === 0) {
      // No text layer. Almost always a scan, so read the page images instead of
      // refusing, which is what this used to do.
      log.info('no text layer, falling back to ocr', { documentId });
      ocr = await ocrPdf(bytes, document.filename);
      text = ocr.text;
    }
  } else {
    text = bytes.toString('utf8');
  }

  if (text.trim().length === 0) {
    throw new UnparseableDocumentError(
      document.filename,
      ocr
        ? 'It was read as a scan and no words came out of any page, which usually means the ' +
            'pages are blank, upside down, or far too low resolution.'
        : 'The file has no extractable text and no page images to read.',
    );
  }

  // Only after there is text to judge: uncertain text is worse than none.
  if (ocr) assertConfident(ocr, document.filename);

  const parsed = parseText(text);

  if (parsed.spans.length === 0) {
    throw new UnparseableDocumentError(
      document.filename,
      'The text came out but produced no passages long enough to quote from.',
    );
  }

  // Replace rather than append, so re-parsing leaves one generation of spans.
  await db.delete(denialSpan).where(eq(denialSpan.denialDocumentId, documentId));

  await db.insert(denialSpan).values(
    parsed.spans.map((span) => ({
      denialDocumentId: documentId,
      ordinal: span.ordinal,
      page: span.page,
      charStart: span.charStart,
      charEnd: span.charEnd,
      text: span.text,
    })),
  );

  await db
    .update(denialDocument)
    .set({
      parsedAt: new Date(),
      textSource: ocr ? 'ocr' : 'text_layer',
      ocrConfidence: ocr ? ocr.confidence : null,
    })
    .where(eq(denialDocument.id, documentId));

  log.info('denial document parsed', {
    documentId,
    spanCount: parsed.spans.length,
    pageCount: parsed.pageCount,
    textSource: ocr ? 'ocr' : 'text_layer',
    ocrConfidence: ocr?.confidence ?? null,
  });

  return {
    documentId,
    spanCount: parsed.spans.length,
    pageCount: parsed.pageCount,
    textSource: ocr ? 'ocr' : 'text_layer',
    ocrConfidence: ocr?.confidence ?? null,
  };
}

/**
 * Parse everything unparsed on a denial, and move the case forward if it is
 * ready.
 *
 * A denial is ready to draft once its denial letter has been parsed. The
 * clinical record is not strictly required to reach that state: a case with a
 * letter and no record will surface every criterion as a documentation gap,
 * which is a useful thing to be told rather than an error.
 */
export async function parseDenial(denialId: string): Promise<{
  parsed: ParseResult[];
  ready: boolean;
  failures: { filename: string; reason: string }[];
}> {
  const documents = await db
    .select()
    .from(denialDocument)
    .where(eq(denialDocument.denialId, denialId));

  const parsed: ParseResult[] = [];
  const failures: { filename: string; reason: string }[] = [];

  for (const document of documents) {
    if (document.parsedAt) continue;
    try {
      parsed.push(await parseDenialDocument(document.id));
    } catch (error) {
      failures.push({
        filename: document.filename,
        reason: error instanceof Error ? error.message : 'Parsing failed.',
      });
    }
  }

  const letters = documents.filter((d) => d.kind === 'denial_letter');
  const lettersParsed = await Promise.all(
    letters.map(async (letter) => {
      const [span] = await db
        .select({ id: denialSpan.id })
        .from(denialSpan)
        .where(eq(denialSpan.denialDocumentId, letter.id))
        .limit(1);
      return Boolean(span);
    }),
  );

  const ready = lettersParsed.some(Boolean);

  await db
    .update(denial)
    .set({
      status: ready ? 'ready_for_generation' : 'intake',
      updatedAt: new Date(),
    })
    .where(eq(denial.id, denialId));

  return { parsed, ready, failures };
}
