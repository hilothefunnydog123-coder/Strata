/**
 * Getting text out of a PDF.
 *
 * pdf-lib, which this project already uses for export, writes PDFs but does not
 * extract text from them. Rather than take another dependency, this reads the
 * content streams directly.
 *
 * What it handles: the text showing operators (Tj, TJ, ', ") in uncompressed
 * and Flate-compressed content streams, which is what a payer's denial letter
 * and a hospital's exported chart note are in practice, because both come out
 * of a word processor or a reporting tool.
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

/** Pull the shown text out of one content stream. */
function textFromContent(content: string): string {
  const out: string[] = [];

  // Tj and ' and " show a single string. TJ shows an array of strings and
  // kerning numbers; a large negative kern is a word space.
  const operators =
    /\((?:[^()\\]|\\.)*\)\s*(?:Tj|')|\[(?:[^\][\\]|\\.)*\]\s*TJ|T\*|\bTd\b|\bTD\b|\bET\b/g;

  let match: RegExpExecArray | null;
  while ((match = operators.exec(content)) !== null) {
    const token = match[0];

    if (/^(T\*|Td|TD|ET)$/.test(token.trim())) {
      out.push('\n');
      continue;
    }

    if (token.trimEnd().endsWith('TJ')) {
      const array = token.slice(token.indexOf('[') + 1, token.lastIndexOf(']'));
      const pieces = array.match(/\((?:[^()\\]|\\.)*\)|-?\d+(?:\.\d+)?/g) ?? [];
      for (const piece of pieces) {
        if (piece.startsWith('(')) {
          out.push(unescapePdfString(piece.slice(1, -1)));
        } else if (Number(piece) < -180) {
          // A kern this wide is a space between words.
          out.push(' ');
        }
      }
      continue;
    }

    const literal = token.slice(token.indexOf('(') + 1, token.lastIndexOf(')'));
    out.push(unescapePdfString(literal));
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
export async function extractPdfText(bytes: Buffer): Promise<string> {
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
