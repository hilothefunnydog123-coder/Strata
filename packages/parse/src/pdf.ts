import type { ParsedDocument, ParsedSpan } from "./types";

/**
 * PDF → normalized text + span index. Cigna and UnitedHealthcare publish their
 * medical policies as PDFs, so without this they cannot be ingested at all.
 *
 * Page numbers matter here in a way they do not for HTML: a citation into a payer
 * PDF is only checkable if it names the page, so every span carries its real page.
 * Line grouping is done by vertical position, and headings are detected by font
 * size relative to the document's modal size — PDFs carry no semantic structure,
 * so the visual signal is the only one available.
 */

interface TextItem {
  str: string;
  transform: number[];
  height: number;
  width: number;
}

function isTextItem(x: unknown): x is TextItem {
  return typeof (x as TextItem)?.str === "string" && Array.isArray((x as TextItem)?.transform);
}

export interface PdfParseOptions {
  /** Treat a line as a heading when its height exceeds modal height by this factor. */
  headingRatio?: number;
}

export async function parsePdfToSpans(
  data: Uint8Array,
  opts: PdfParseOptions = {},
): Promise<ParsedDocument> {
  const headingRatio = opts.headingRatio ?? 1.15;
  // Legacy build: no worker, no DOM — correct for Node.
  const pdfjs = await import("pdfjs-dist/legacy/build/pdf.mjs");
  const doc = await pdfjs.getDocument({ data, useSystemFonts: true, isEvalSupported: false }).promise;

  interface Line {
    page: number;
    y: number;
    height: number;
    text: string;
  }
  const lines: Line[] = [];

  for (let pageNo = 1; pageNo <= doc.numPages; pageNo++) {
    const page = await doc.getPage(pageNo);
    const content = await page.getTextContent();
    // Group items into lines by their y position (PDF origin is bottom-left).
    const buckets = new Map<number, TextItem[]>();
    for (const raw of content.items) {
      if (!isTextItem(raw)) continue;
      if (raw.str.trim().length === 0) continue;
      const y = Math.round((raw.transform[5] ?? 0) / 2) * 2; // 2pt tolerance
      const arr = buckets.get(y);
      if (arr) arr.push(raw);
      else buckets.set(y, [raw]);
    }
    // Top of page first.
    const ys = [...buckets.keys()].sort((a, b) => b - a);
    for (const y of ys) {
      const items = buckets.get(y)!.sort((a, b) => (a.transform[4] ?? 0) - (b.transform[4] ?? 0));
      const text = items
        .map((i) => i.str)
        .join(" ")
        .replace(/\s+/g, " ")
        .trim();
      if (!text) continue;
      const height = items.reduce((m, i) => Math.max(m, i.height || 0), 0);
      lines.push({ page: pageNo, y, height, text });
    }
  }
  await doc.destroy();

  // Modal line height → the body text size.
  const heights = lines.map((l) => Math.round(l.height)).filter((h) => h > 0);
  const freq = new Map<number, number>();
  for (const h of heights) freq.set(h, (freq.get(h) ?? 0) + 1);
  let bodyHeight = 0;
  let bodyCount = -1;
  for (const [h, n] of freq) if (n > bodyCount) { bodyCount = n; bodyHeight = h; }

  // Merge consecutive body lines into paragraphs; headings break and set context.
  const spans: ParsedSpan[] = [];
  const parts: string[] = [];
  let cursor = 0;
  let ordinal = 0;
  let headingPath: string[] = [];
  let buffer: { page: number; text: string } | null = null;

  const flush = () => {
    if (!buffer) return;
    const clean = buffer.text.replace(/\s+/g, " ").trim();
    if (clean.length > 0) {
      const sep = parts.length > 0 ? "\n\n" : "";
      const charStart = cursor + sep.length;
      const charEnd = charStart + clean.length;
      parts.push(sep + clean);
      cursor = charEnd;
      spans.push({
        ordinal: ordinal++,
        pageNumber: buffer.page,
        charStart,
        charEnd,
        text: clean,
        headingPath: [...headingPath],
      });
    }
    buffer = null;
  };

  for (const line of lines) {
    const isHeading =
      bodyHeight > 0 && line.height >= bodyHeight * headingRatio && line.text.length < 120;
    // Page furniture: bare page numbers and repeated footers.
    const isFurniture = /^(?:page\s+)?\d+(?:\s+of\s+\d+)?$/i.test(line.text);
    if (isFurniture) continue;

    if (isHeading) {
      flush();
      // Deeper headings are smaller; approximate nesting by relative size.
      const depth = line.height >= bodyHeight * 1.5 ? 0 : 1;
      headingPath = [...headingPath.slice(0, depth), line.text];
      continue;
    }
    if (buffer && buffer.page === line.page) buffer.text += " " + line.text;
    else {
      flush();
      buffer = { page: line.page, text: line.text };
    }
    // A line ending in sentence punctuation closes the paragraph.
    if (/[.:;]$/.test(line.text)) flush();
  }
  flush();

  return { fullText: parts.join(""), spans };
}
