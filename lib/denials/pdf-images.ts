/**
 * Pulling the page images out of a scanned PDF.
 *
 * A scan has no text layer. Each page is one raster image wrapped in PDF
 * structure, so before anything can be read the images have to come out in page
 * order. Page order is the whole reason this walks the page tree rather than
 * scanning the file for image objects: a citation has to name a page a reviewer
 * can turn to, and objects are not required to appear in the file in the order
 * the pages present them.
 *
 * What comes out is encoded image bytes, not pixels. A DCTDecode stream already
 * is a JPEG, so it is handed over untouched. A Flate stream is raw samples, so
 * it is wrapped into a PNG here. Anything else is reported by name rather than
 * guessed at, for the same reason the text extractor returns empty rather than
 * mojibake: a document we cannot read is one we cannot cite, and saying which
 * codec stopped us is what lets someone fix it.
 */
import { deflateSync, inflateSync, inflateRawSync, unzipSync } from 'node:zlib';

export interface PageImage {
  /** One based, as a reader counts pages. */
  page: number;
  /** Encoded image bytes, ready for an OCR engine. */
  bytes: Buffer;
  format: 'jpeg' | 'png';
  width: number;
  height: number;
}

export class UnsupportedImageCodecError extends Error {
  constructor(readonly codec: string) {
    super(
      `This PDF stores its pages as ${codec} images, which Medeal cannot read yet. ` +
        'Re-export or re-scan it as a PDF with JPEG images, or run it through OCR ' +
        'before uploading.',
    );
    this.name = 'UnsupportedImageCodecError';
  }
}

/* ─── A very small PDF object reader ──────────────────────────────────────── */

interface PdfObject {
  /** The dictionary text between the outer << and >>, unparsed. */
  dict: string;
  /** Raw stream bytes, before any filter is undone. */
  stream: Buffer | null;
}

/**
 * An index of every `N 0 obj` in the file.
 *
 * Cross reference tables are skipped deliberately. They are the correct way to
 * find an object and they are also the part most often wrong in a file produced
 * by a scanner, and a wrong offset here would lose a page silently. Scanning for
 * the object headers costs one pass and cannot disagree with the file's own
 * contents.
 */
function indexObjects(bytes: Buffer): Map<number, PdfObject> {
  const haystack = bytes.toString('latin1');
  const objects = new Map<number, PdfObject>();
  const header = /(\d+)\s+\d+\s+obj\b/g;

  let match: RegExpExecArray | null;
  while ((match = header.exec(haystack)) !== null) {
    const number = Number(match[1]);
    const bodyStart = match.index + match[0].length;
    const endObj = haystack.indexOf('endobj', bodyStart);
    if (endObj === -1) continue;

    const streamAt = haystack.indexOf('stream', bodyStart);
    const hasStream = streamAt !== -1 && streamAt < endObj;

    const dictEnd = hasStream ? streamAt : endObj;
    const dict = haystack.slice(bodyStart, dictEnd);

    let stream: Buffer | null = null;
    if (hasStream) {
      // "stream" is followed by CRLF or LF, never by CR alone.
      let dataStart = streamAt + 'stream'.length;
      if (haystack[dataStart] === '\r') dataStart += 1;
      if (haystack[dataStart] === '\n') dataStart += 1;

      const endStream = haystack.indexOf('endstream', dataStart);
      if (endStream !== -1) {
        // Length is authoritative when present and sane, because a binary
        // stream can contain the bytes "endstream" by coincidence.
        const declared = /\/Length\s+(\d+)/.exec(dict);
        const byLength = declared ? Number(declared[1]) : null;
        const end =
          byLength !== null && dataStart + byLength <= endStream + 2
            ? dataStart + byLength
            : endStream;
        stream = bytes.subarray(dataStart, end);
      }
    }

    objects.set(number, { dict, stream });
    header.lastIndex = endObj;
  }

  expandObjectStreams(objects);
  return objects;
}

/**
 * Unpack the object streams.
 *
 * Since PDF 1.5 a writer may pack every object that has no stream of its own,
 * which includes the whole page tree, into one compressed container. Skipping
 * these finds the images but never the pages, so the pages come out in file
 * order and the page numbers on citations are a guess. Most current writers do
 * this by default, so it is the normal case rather than an exotic one.
 */
function expandObjectStreams(objects: Map<number, PdfObject>): void {
  for (const [, container] of [...objects]) {
    if (!/\/Type\s*\/ObjStm/.test(container.dict) || !container.stream) continue;

    const decoded = /FlateDecode/.test(container.dict)
      ? inflate(container.stream)
      : container.stream;
    if (!decoded) continue;

    const count = intValue(container.dict, 'N');
    const first = intValue(container.dict, 'First');
    if (count === null || first === null) continue;

    const text = decoded.toString('latin1');
    // The header is `objnum offset` repeated N times, then the bodies.
    const header = text.slice(0, first).trim().split(/\s+/).map(Number);

    for (let index = 0; index < count; index += 1) {
      const number = header[index * 2];
      const offset = header[index * 2 + 1];
      if (number === undefined || offset === undefined) break;

      const start = first + offset;
      const nextOffset = header[index * 2 + 3];
      const end = nextOffset === undefined ? text.length : first + nextOffset;

      // An object already read from the file body is the newer one; a packed
      // copy must not overwrite it.
      if (objects.has(number)) continue;
      objects.set(number, { dict: text.slice(start, end), stream: null });
    }
  }
}

/** `/Key 12 0 R` on a dictionary, as an object number. */
function refValue(dict: string, key: string): number | null {
  const match = new RegExp(`/${key}\\s+(\\d+)\\s+\\d+\\s+R\\b`).exec(dict);
  return match ? Number(match[1]) : null;
}

function intValue(dict: string, key: string): number | null {
  const match = new RegExp(`/${key}\\s+(\\d+)`).exec(dict);
  return match ? Number(match[1]) : null;
}

function nameValue(dict: string, key: string): string | null {
  const match = new RegExp(`/${key}\\s*/([A-Za-z0-9]+)`).exec(dict);
  return match ? match[1]! : null;
}

/** The `[ 3 0 R 7 0 R ]` after a key, as object numbers. */
function refArray(dict: string, key: string): number[] {
  const at = new RegExp(`/${key}\\s*\\[`).exec(dict);
  if (!at) return [];
  const start = at.index + at[0].length;
  const end = dict.indexOf(']', start);
  if (end === -1) return [];
  return [...dict.slice(start, end).matchAll(/(\d+)\s+\d+\s+R/g)].map((m) => Number(m[1]));
}

/**
 * Page objects, in the order a reader meets them.
 *
 * Walks Kids depth first from the catalogue. Falls back to file order only if
 * there is no catalogue to walk, which means a damaged file rather than an
 * unusual one.
 */
function pagesInOrder(objects: Map<number, PdfObject>): PdfObject[] {
  let rootNumber: number | null = null;
  for (const [, object] of objects) {
    if (/\/Type\s*\/Catalog/.test(object.dict)) {
      rootNumber = refValue(object.dict, 'Pages');
      if (rootNumber !== null) break;
    }
  }

  const ordered: PdfObject[] = [];

  if (rootNumber !== null) {
    const seen = new Set<number>();
    const walk = (number: number, inheritedResources: string | null): void => {
      if (seen.has(number)) return;
      seen.add(number);
      const node = objects.get(number);
      if (!node) return;

      // Resources are inheritable, so a page can rely on its parent's.
      const own = /\/Resources/.test(node.dict) ? node.dict : null;
      const resources = own ?? inheritedResources;

      if (/\/Type\s*\/Page\b/.test(node.dict)) {
        ordered.push(resources && resources !== node.dict
          ? { dict: `${node.dict}\n${resources}`, stream: node.stream }
          : node);
        return;
      }
      for (const kid of refArray(node.dict, 'Kids')) walk(kid, resources);
    };
    walk(rootNumber, null);
  }

  if (ordered.length === 0) {
    for (const [, object] of objects) {
      if (/\/Type\s*\/Page\b/.test(object.dict)) ordered.push(object);
    }
  }

  return ordered;
}

/* ─── Decoding one image ──────────────────────────────────────────────────── */

function inflate(raw: Buffer): Buffer | null {
  for (const attempt of [inflateSync, inflateRawSync, unzipSync]) {
    try {
      return attempt(raw);
    } catch {
      // Next variant. Producers disagree about zlib headers.
    }
  }
  return null;
}

function crc32(buffer: Buffer): number {
  let crc = 0xffffffff;
  for (const byte of buffer) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit += 1) {
      crc = crc & 1 ? (crc >>> 1) ^ 0xedb88320 : crc >>> 1;
    }
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function pngChunk(type: string, body: Buffer): Buffer {
  const length = Buffer.alloc(4);
  length.writeUInt32BE(body.length);
  const typed = Buffer.concat([Buffer.from(type, 'latin1'), body]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(typed));
  return Buffer.concat([length, typed, crc]);
}

/**
 * Wrap raw samples into a PNG.
 *
 * Only what a scanner actually emits: 8 bit grey, 8 bit RGB, and 1 bit bilevel,
 * which is expanded to 8 bit grey here because that is what a bilevel scan is
 * and an OCR engine reads it the same way.
 */
function encodePng(
  samples: Buffer,
  width: number,
  height: number,
  channels: 1 | 3,
  bitsPerComponent: number,
  invert: boolean,
): Buffer | null {
  let data = samples;
  let colourType = channels === 1 ? 0 : 2;

  if (bitsPerComponent === 1) {
    if (channels !== 1) return null;
    const rowBytesIn = Math.ceil(width / 8);
    const out = Buffer.alloc(width * height);
    for (let y = 0; y < height; y += 1) {
      for (let x = 0; x < width; x += 1) {
        const byte = samples[y * rowBytesIn + (x >> 3)] ?? 0;
        const bit = (byte >> (7 - (x & 7))) & 1;
        // In DeviceGray a 1 bit is white, which is the opposite of an
        // ImageMask, hence the caller supplied flag.
        out[y * width + x] = (invert ? 1 - bit : bit) ? 255 : 0;
      }
    }
    data = out;
    colourType = 0;
  } else if (bitsPerComponent !== 8) {
    return null;
  }

  const stride = width * channels;
  if (data.length < stride * height) return null;

  // PNG wants a filter byte in front of every scanline. Zero means none.
  const raw = Buffer.alloc((stride + 1) * height);
  for (let y = 0; y < height; y += 1) {
    raw[y * (stride + 1)] = 0;
    data.copy(raw, y * (stride + 1) + 1, y * stride, y * stride + stride);
  }

  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8;
  ihdr[9] = colourType;

  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    pngChunk('IHDR', ihdr),
    pngChunk('IDAT', deflateSync(raw, { level: 6 })),
    pngChunk('IEND', Buffer.alloc(0)),
  ]);
}

/** Every filter named on the dictionary, in application order. */
function filtersOf(dict: string): string[] {
  const array = /\/Filter\s*\[([^\]]*)\]/.exec(dict);
  if (array) return [...array[1]!.matchAll(/\/([A-Za-z0-9]+)/g)].map((m) => m[1]!);
  const single = /\/Filter\s*\/([A-Za-z0-9]+)/.exec(dict);
  return single ? [single[1]!] : [];
}

const UNREADABLE: Record<string, string> = {
  CCITTFaxDecode: 'fax encoded (CCITT G3 or G4)',
  JBIG2Decode: 'JBIG2 compressed',
  JPXDecode: 'JPEG 2000',
};

function decodeImage(object: PdfObject): Omit<PageImage, 'page'> | null {
  const { dict, stream } = object;
  if (!stream) return null;

  const width = intValue(dict, 'Width');
  const height = intValue(dict, 'Height');
  if (!width || !height) return null;

  const filters = filtersOf(dict);

  for (const filter of filters) {
    if (UNREADABLE[filter]) throw new UnsupportedImageCodecError(UNREADABLE[filter]!);
  }

  if (filters.includes('DCTDecode')) {
    // Already a JPEG. Every OCR engine reads one, so nothing to do.
    return { bytes: stream, format: 'jpeg', width, height };
  }

  if (filters.includes('FlateDecode') || filters.length === 0) {
    const samples = filters.includes('FlateDecode') ? inflate(stream) : stream;
    if (!samples) return null;

    const bits = intValue(dict, 'BitsPerComponent') ?? 8;
    const isMask = /\/ImageMask\s+true/.test(dict);
    const colourSpace = nameValue(dict, 'ColorSpace') ?? (isMask ? 'DeviceGray' : 'DeviceGray');
    const channels = colourSpace === 'DeviceRGB' ? 3 : 1;
    if (colourSpace !== 'DeviceRGB' && colourSpace !== 'DeviceGray' && !isMask) return null;

    const png = encodePng(samples, width, height, channels as 1 | 3, bits, isMask);
    return png ? { bytes: png, format: 'png', width, height } : null;
  }

  return null;
}

/* ─── The one exported job ────────────────────────────────────────────────── */

/**
 * Page images, in page order.
 *
 * Throws UnsupportedImageCodecError when a page is stored in a codec we cannot
 * read, because a partial OCR of a denial letter is worse than none: it would
 * produce a case that looks readable and is missing the paragraph that matters.
 */
export function extractPageImages(bytes: Buffer): PageImage[] {
  const objects = indexObjects(bytes);
  const pages = pagesInOrder(objects);
  const images: PageImage[] = [];

  pages.forEach((page, index) => {
    // /XObject << /Im0 8 0 R /Im1 9 0 R >>
    const xobject = /\/XObject\s*<<([\s\S]*?)>>/.exec(page.dict);
    if (!xobject) return;

    // A PDF name is any run of characters that are not whitespace or a
    // delimiter, so real producers emit things like /Image-7098480789 and
    // /Im_0. Matching only letters and digits silently finds no images at all.
    for (const reference of xobject[1]!.matchAll(/\/[^\s/<>[\]()]+\s+(\d+)\s+\d+\s+R/g)) {
      const target = objects.get(Number(reference[1]));
      if (!target || !/\/Subtype\s*\/Image/.test(target.dict)) continue;

      const decoded = decodeImage(target);
      if (decoded) images.push({ page: index + 1, ...decoded });
    }
  });

  return images;
}
