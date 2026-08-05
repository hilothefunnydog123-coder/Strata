/**
 * Taking four parts out of a title that is only published whole.
 *
 * govinfo does not publish per part files. Asked for title 42 it lists exactly
 * two things, `ECFR-title42.xml` and `ECFR-title42-graphics.zip`, and that was
 * measured from a runner rather than assumed: the code looked for
 * `ECFR-title42-part409.xml`, found nothing, and said so with the listing
 * attached. The unit tests for that selector passed against a fixture invented
 * from the same wrong assumption, which is worth remembering. A test can only
 * check consistency with what its author believed.
 *
 * So the title is fetched whole and cut down. The objection recorded when this
 * refused to fall back to the title was never "do not download it", it was "do
 * not put the whole of title 42 in the corpus to reach four parts", and cutting
 * satisfies both: one download, four documents, nothing else stored.
 *
 * Streamed rather than read into a string. Title 42 is hundreds of megabytes,
 * V8 has a maximum string length, and a parser that works on a small fixture
 * and throws on the real file is worse than one that never worked at all: it
 * looks finished.
 */

/** A part heading, wherever the attributes fall in the tag. */
const DIV5_OPEN = /<DIV5\b[^>]*>/i;
const DIV5_CLOSE = /<\/DIV5\s*>/i;

/** The part number out of an opening tag: N="409". */
function partOf(tag: string): string | null {
  return /\bN\s*=\s*"([^"]+)"/i.exec(tag)?.[1]?.trim() ?? null;
}

function isPart(tag: string): boolean {
  return /\bTYPE\s*=\s*"PART"/i.test(tag);
}

/**
 * The longest a single tag can be, and so how much of the previous chunk has to
 * be kept in case a tag straddles the boundary between two.
 *
 * A DIV5 opening tag carries a handful of short attributes and is nowhere near
 * this. Generous because being wrong here means silently missing a part whose
 * tag happened to land on a chunk boundary, which would look exactly like that
 * part not existing.
 */
const MAX_TAG_LENGTH = 4096;

export interface SplitResult {
  /** Part number to the XML of its DIV5 element, inclusive of the tags. */
  parts: Map<string, string>;
  /** Every part number seen, so a miss can say what was actually in there. */
  seen: string[];
}

/**
 * Pull the named parts out of an eCFR title.
 *
 * Takes an async iterable of strings so the caller decides where the bytes come
 * from: a network response in production, an array in a test. Nothing here ever
 * holds more than the wanted parts plus one chunk.
 */
export async function splitTitleIntoParts(
  chunks: AsyncIterable<string>,
  wanted: readonly string[],
): Promise<SplitResult> {
  const want = new Set(wanted);
  const parts = new Map<string, string>();
  const seen: string[] = [];

  let buffer = '';
  /** The part currently being captured, or null when between parts. */
  let capturing: string | null = null;
  let captured = '';

  for await (const chunk of chunks) {
    buffer += chunk;

    // Consume as much of the buffer as can be decided on now, leaving behind
    // only a tail short enough that no complete tag can hide in it.
    for (;;) {
      if (capturing === null) {
        const open = DIV5_OPEN.exec(buffer);
        if (!open) break;

        const tag = open[0];
        const at = open.index;
        buffer = buffer.slice(at + tag.length);

        const part = partOf(tag);
        if (part !== null && isPart(tag)) {
          seen.push(part);
          if (want.has(part)) {
            capturing = part;
            captured = tag;
          }
        }
        continue;
      }

      const close = DIV5_CLOSE.exec(buffer);
      if (!close) break;

      captured += buffer.slice(0, close.index + close[0].length);
      buffer = buffer.slice(close.index + close[0].length);
      parts.set(capturing, captured);
      capturing = null;
      captured = '';
    }

    // Whatever is left is either mid-part text worth keeping, or a tail that
    // might be the front of a tag split across the boundary. Either way a tail
    // stays in the buffer.
    //
    // Flushing all of it while capturing was the first bug here, and it only
    // showed up under small chunks: a closing tag arriving as "</DIV" then "5>"
    // put its first half beyond reach of the next search, so the part was never
    // closed and came out undefined. The real file arrives in network sized
    // pieces that fall wherever they fall, so this is the normal case rather
    // than an edge one.
    if (buffer.length > MAX_TAG_LENGTH) {
      const safe = buffer.length - MAX_TAG_LENGTH;
      if (capturing !== null) captured += buffer.slice(0, safe);
      buffer = buffer.slice(safe);
    }

    // Nothing more to look for once every wanted part is captured. The rest of
    // title 42 is hundreds of megabytes of parts nobody asked for.
    if (parts.size === want.size) break;
  }

  return { parts, seen };
}

/**
 * The header a sliced part needs to stand on its own.
 *
 * The parser downstream reads eCFR XML, and a DIV5 lifted out of its title is
 * still eCFR XML. This only restores the declaration, so the fragment is a
 * document rather than a fragment.
 */
export function asStandaloneXml(partXml: string): string {
  return `<?xml version="1.0" encoding="UTF-8"?>\n${partXml}\n`;
}
