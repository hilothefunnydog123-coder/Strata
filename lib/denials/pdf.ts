/**
 * Getting text out of a PDF.
 *
 * pdf-lib, which this project already uses for export, writes PDFs but does not
 * extract text from them. Rather than take another dependency, this reads the
 * content streams directly.
 *
 * What it handles: the text showing operators (Tj, TJ, ', ") in uncompressed
 * and Flate-compressed content streams, with strings in either of the two forms
 * PDF allows, (literal) and <hex>. That covers a payer's denial letter and a
 * hospital's exported chart note, because both come out of a word processor or
 * a reporting tool.
 *
 * Hex was missing until a CMS manual chapter extracted as nothing at all. The
 * text was in the file, spelled the other way, and the failure looked exactly
 * like a scanned document: empty text, and a message telling the user to OCR
 * something that was already machine readable.
 *
 * What it does not handle: scanned images, and PDFs using a font with a
 * non-standard encoding map. Both come back as empty text, and the caller turns
 * that into a clear message telling the user the document needs OCR first. That
 * is the right failure: a citation must point at text we can quote, so a
 * document we cannot read is one we cannot use, and saying so is better than
 * producing spans of mojibake that later fail verification for reasons nobody
 * can diagnose.
 */
import { inflateSync, inflateRawSync, unzipSync } from 'node:zlib';
import { extractText, getDocumentProxy } from 'unpdf';

/**
 * Math.sumPrecise, which pdf.js uses and Node 22 does not have.
 *
 * A stage 3 proposal that shipped in newer V8 than this runtime carries. pdf.js
 * calls it while laying out text and catches the TypeError, so extraction
 * survives, but it logged the same warning sixty seven times in one run and the
 * quantity it could not compute is the one that decides where spaces go between
 * runs of glyphs. Missing spaces would land in stored passages and then inside
 * quotes.
 *
 * The proposal specifies exact summation rather than left to right addition,
 * which is the whole point of the name, so this compensates. Neumaier rather
 * than plain Kahan: Kahan loses the correction when the incoming value is much
 * larger than the running total, which is exactly the case a compensated sum is
 * for. Written the other way first, and the test for it failed.
 */
if (typeof (Math as { sumPrecise?: unknown }).sumPrecise !== 'function') {
  (Math as { sumPrecise?: (values: Iterable<number>) => number }).sumPrecise = (values) => {
    let sum = 0;
    let compensation = 0;

    for (const value of values) {
      const next = sum + value;
      compensation +=
        Math.abs(sum) >= Math.abs(value) ? sum - next + value : value - next + sum;
      sum = next;
    }

    return sum + compensation;
  };
}
import { PAGE_BREAK } from '@/lib/documents/parse';

/** Every stream in the file, decompressed where we can manage it. */
function* streams(bytes: Buffer): Generator<Buffer> {
  const haystack = bytes.toString('latin1');
  const pattern = /stream\r?\n?/g;
  let match: RegExpExecArray | null;

  while ((match = pattern.exec(haystack)) !== null) {
    const start = match.index + match[0].length;
    const end = haystack.indexOf('endstream', start);
    if (end === -1) continue;

    const raw = bytes.subarray(start, end);
    // The dictionary immediately before the stream says how it is encoded.
    const dictionaryStart = Math.max(0, haystack.lastIndexOf('<<', match.index));
    const dictionary = haystack.slice(dictionaryStart, match.index);

    if (/FlateDecode/.test(dictionary)) {
      const inflated = tryInflate(raw);
      if (inflated) yield inflated;
    } else if (!/\/(DCTDecode|JPXDecode|CCITTFaxDecode|JBIG2Decode)/.test(dictionary)) {
      yield raw;
    }

    pattern.lastIndex = end;
  }
}

function tryInflate(raw: Buffer): Buffer | null {
  for (const inflate of [inflateSync, inflateRawSync, unzipSync]) {
    try {
      return inflate(raw);
    } catch {
      // Try the next variant. A stream we cannot inflate is skipped rather
      // than failing the whole document, because one broken object should not
      // cost us the other forty pages.
    }
  }
  return null;
}

/** Undo the escapes PDF uses inside a literal string. */
function unescapePdfString(input: string): string {
  return input
    .replace(/\\([nrtbf()\\])/g, (_m, ch: string) => {
      const map: Record<string, string> = {
        n: '\n',
        r: '\r',
        t: '\t',
        b: '\b',
        f: '\f',
        '(': '(',
        ')': ')',
        '\\': '\\',
      };
      return map[ch] ?? ch;
    })
    .replace(/\\([0-7]{1,3})/g, (_m, oct: string) => String.fromCharCode(parseInt(oct, 8)));
}

/**
 * Decode a hex string: <48656C6C6F> is "Hello".
 *
 * PDF allows either form wherever a string is expected, and plenty of producers
 * use hex throughout. This one did not read hex at all, which meant those files
 * extracted as empty and were then reported as needing OCR: the text was right
 * there in the file, in the other of the two spellings the format allows.
 *
 * An odd number of digits is legal and means a trailing zero, per the spec.
 */
function decodeHexString(input: string): string {
  const digits = input.replace(/[^0-9A-Fa-f]/g, '');
  const padded = digits.length % 2 === 1 ? `${digits}0` : digits;

  let out = '';
  for (let i = 0; i < padded.length; i += 2) {
    out += String.fromCharCode(parseInt(padded.slice(i, i + 2), 16));
  }
  return out;
}

/** Pull the shown text out of one content stream. */
function textFromContent(content: string): string {
  const out: string[] = [];

  // Tj and ' and " show a single string. TJ shows an array of strings and
  // kerning numbers; a large negative kern is a word space. A string is either
  // (literal) or <hex>, and both appear in the wild.
  const operators =
    /(?:\((?:[^()\\]|\\.)*\)|<[0-9A-Fa-f\s]*>)\s*(?:Tj|')|\[(?:[^\][\\]|\\.)*\]\s*TJ|T\*|\bTd\b|\bTD\b|\bET\b/g;

  let match: RegExpExecArray | null;
  while ((match = operators.exec(content)) !== null) {
    const token = match[0];

    if (/^(T\*|Td|TD|ET)$/.test(token.trim())) {
      out.push('\n');
      continue;
    }

    if (token.trimEnd().endsWith('TJ')) {
      const array = token.slice(token.indexOf('[') + 1, token.lastIndexOf(']'));
      const pieces =
        array.match(/\((?:[^()\\]|\\.)*\)|<[0-9A-Fa-f\s]*>|-?\d+(?:\.\d+)?/g) ?? [];
      for (const piece of pieces) {
        if (piece.startsWith('(')) {
          out.push(unescapePdfString(piece.slice(1, -1)));
        } else if (piece.startsWith('<')) {
          out.push(decodeHexString(piece.slice(1, -1)));
        } else if (Number(piece) < -180) {
          // A kern this wide is a space between words.
          out.push(' ');
        }
      }
      continue;
    }

    if (token.trimStart().startsWith('<')) {
      out.push(decodeHexString(token.slice(token.indexOf('<') + 1, token.lastIndexOf('>'))));
    } else {
      const literal = token.slice(token.indexOf('(') + 1, token.lastIndexOf(')'));
      out.push(unescapePdfString(literal));
    }
    if (token.trimEnd().endsWith("'")) out.push('\n');
  }

  return out.join('');
}

/**
 * Extract text, with a page break between pages so the spanner can number them.
 *
 * Returns an empty string rather than throwing when nothing readable is found,
 * so the caller can produce a message about OCR instead of a stack trace.
 */
async function extractByContentStreams(bytes: Buffer): Promise<string> {
  const pages: string[] = [];

  for (const stream of streams(bytes)) {
    const content = stream.toString('latin1');
    // A content stream shows text. Anything else is a font, an image, or
    // metadata, and matching on the operators keeps those out.
    if (!/\bTj\b|\bTJ\b/.test(content)) continue;

    const text = textFromContent(content);
    if (text.trim().length > 0) pages.push(text);
  }

  return pages
    .join(PAGE_BREAK)
    .replace(/\r\n?/g, '\n')
    .replace(/[ \t]{2,}/g, ' ')
    .replace(/\n{3,}/g, '\n\n');
}

/**
 * Extract text, falling back to a real PDF engine when the reader above finds
 * nothing.
 *
 * The reader above handles the shape a word processor emits and cost no
 * dependency, which was the right trade while the only PDFs were denial letters
 * exported from Word. It does not handle a document whose fonts carry their own
 * character maps, where a hex string is an index into a CMap rather than
 * character codes, and there is no honest way to resolve that without
 * implementing a large part of the format.
 *
 * Every chapter of the CMS Benefit Policy Manual is that kind of document. All
 * eleven came back empty, and empty was then reported as "this is a scan, find
 * a text edition", about files that are entirely machine readable. A message
 * that confidently misdiagnoses is worse than a stack trace.
 *
 * So pdf.js runs when the cheap path finds nothing. Order matters only for
 * speed: where the simple reader works it is faster and its page breaks are
 * already right, and where it does not, correctness is the only thing that
 * counts.
 */
export async function extractPdfText(bytes: Buffer): Promise<string> {
  const simple = await extractByContentStreams(bytes);
  if (simple.trim().length > 0) return simple;

  try {
    const document = await getDocumentProxy(new Uint8Array(bytes));
    const { text } = await extractText(document, { mergePages: false });
    const pages = (Array.isArray(text) ? text : [String(text)]).map((page) => page.trim());

    // Page breaks are kept so a citation can name a page. A reviewer checking a
    // manual reference needs one; a character offset into a 400 page chapter is
    // not something anyone can act on.
    return pages.filter((page) => page.length > 0).join(PAGE_BREAK);
  } catch {
    // A genuinely unreadable file. The caller says so, and for the corpus that
    // is a refusal rather than an invitation to OCR.
    return '';
  }
}
