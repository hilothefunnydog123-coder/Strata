/** A span before it is assigned ids / persisted. */
export interface ParsedSpan {
  ordinal: number;
  pageNumber: number;
  charStart: number;
  charEnd: number;
  text: string;
  headingPath: string[];
}

export interface ParsedDocument {
  /** The reconstructed plain-text document (spans joined) — the "stored source". */
  fullText: string;
  spans: ParsedSpan[];
}
