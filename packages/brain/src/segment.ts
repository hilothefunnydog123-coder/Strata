/**
 * Candidate generation. A policy span is cut into clause-level candidates, each
 * carrying its exact character offsets into the parent span text.
 *
 * This is the structural half of the citation invariant: because a candidate is
 * literally `spanText.slice(start, end)`, any criterion the classifier accepts
 * already has a verbatim quote that provably exists in the source. There is no
 * generation step that could invent text.
 */

export interface Candidate {
  /** Offsets into the parent span text. */
  start: number;
  end: number;
  /** Exactly spanText.slice(start, end), trimmed to word boundaries. */
  text: string;
  /** 0-based index of this candidate within its span. */
  index: number;
  /** Total candidates in the span (for positional features). */
  total: number;
}

/** Abbreviations that must not end a sentence. */
const ABBREV = /\b(?:e\.g|i\.e|etc|vs|no|approx|fig|dr|inc|ltd|u\.s|c\.f|al)\.$/i;

/**
 * Split a span into sentences, then further split long sentences on clause
 * boundaries that reliably separate distinct requirements in policy prose
 * (";", " and when ", " or when ", " provided that "). Offsets are preserved
 * exactly through every split.
 */
export function segment(spanText: string): Candidate[] {
  const sentences = splitSentences(spanText);
  const parts: Array<{ start: number; end: number }> = [];
  for (const s of sentences) {
    const sub = splitClauses(spanText, s.start, s.end);
    parts.push(...sub);
  }

  const out: Candidate[] = [];
  for (const p of parts) {
    const trimmed = trimToContent(spanText, p.start, p.end);
    if (!trimmed) continue;
    const text = spanText.slice(trimmed.start, trimmed.end);
    // Ignore fragments too short to be a meaningful, checkable requirement.
    if (countWords(text) < 4) continue;
    // Ignore list stems ("…meets all of the following:") — they introduce the
    // requirements rather than stating one, and clause splitting surfaces them.
    if (isStem(text)) continue;
    out.push({ start: trimmed.start, end: trimmed.end, text, index: 0, total: 0 });
  }
  return out.map((c, i) => ({ ...c, index: i, total: out.length }));
}

function splitSentences(text: string): Array<{ start: number; end: number }> {
  const spans: Array<{ start: number; end: number }> = [];
  let start = 0;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i]!;
    if (ch !== "." && ch !== "?" && ch !== "!") continue;
    // Do not split inside a decimal or a numbered reference like "90.2".
    const prev = text[i - 1];
    const next = text[i + 1];
    if (prev && /\d/.test(prev) && next && /\d/.test(next)) continue;
    const head = text.slice(start, i + 1);
    if (ABBREV.test(head.trimEnd())) continue;
    // Require the following character to be whitespace or end-of-text.
    if (next !== undefined && !/\s/.test(next)) continue;
    spans.push({ start, end: i + 1 });
    start = i + 1;
  }
  if (start < text.length) spans.push({ start, end: text.length });
  return spans.filter((s) => text.slice(s.start, s.end).trim().length > 0);
}

/** Clause separators that, in policy prose, usually delimit separate requirements. */
const CLAUSE_PATTERNS: RegExp[] = [
  /;\s+/g,
  /\s+\band when\b\s+/gi,
  /\s+\bor when\b\s+/gi,
  /\s+\bprovided that\b\s+/gi,
];

function splitClauses(text: string, start: number, end: number): Array<{ start: number; end: number }> {
  const slice = text.slice(start, end);
  // Only split long clauses; short sentences are single requirements.
  if (countWords(slice) < 24) return [{ start, end }];

  const cuts: number[] = [];
  for (const re of CLAUSE_PATTERNS) {
    re.lastIndex = 0;
    let m: RegExpExecArray | null;
    while ((m = re.exec(slice)) !== null) {
      cuts.push(start + m.index + m[0].length);
      if (m.index === re.lastIndex) re.lastIndex++;
    }
  }
  if (cuts.length === 0) return [{ start, end }];

  const bounds = [start, ...cuts.sort((a, b) => a - b), end];
  const out: Array<{ start: number; end: number }> = [];
  for (let i = 0; i < bounds.length - 1; i++) {
    const s = bounds[i]!;
    const e = bounds[i + 1]!;
    if (e > s) out.push({ start: s, end: e });
  }
  return out;
}

/** Trim leading/trailing whitespace, punctuation, and list bullets — offsets stay exact. */
function trimToContent(text: string, start: number, end: number): { start: number; end: number } | null {
  let s = start;
  let e = end;
  while (s < e && /[\s.;:,)\]]/.test(text[s]!)) s++;
  // Leading list markers: "1.", "a)", "•", "-"
  const head = text.slice(s, Math.min(e, s + 6));
  const bullet = head.match(/^(?:[•\-–]\s+|\(?[a-z0-9]{1,3}[.)]\s+)/i);
  if (bullet) s += bullet[0].length;
  while (e > s && /[\s.;:,]/.test(text[e - 1]!)) e--;
  if (e <= s) return null;
  return { start: s, end: e };
}

export function countWords(s: string): number {
  const m = s.trim().match(/\S+/g);
  return m ? m.length : 0;
}

/**
 * A "stem" is the clause that introduces a list of requirements rather than
 * stating one ("…when all of the following conditions are met", "the patient has
 * the following"). These are grammatically requirement-shaped, so dropping them
 * here is more reliable than asking the classifier to learn every variant.
 */
const STEM_TAIL = /\b(?:the\s+)?following(?:\s+\w+){0,3}\s*(?:are|is)?\s*(?:met|satisfied|documented|apply|applies)?\s*$/i;

export function isStem(text: string): boolean {
  const t = text.trim();
  if (STEM_TAIL.test(t)) return true;
  // "…meets all of the following:" style, even when the colon was trimmed.
  if (/\b(?:all|any|each|one)\s+of\s+the\s+following\b/i.test(t) && countWords(t) <= 14) return true;
  return false;
}
