import type { CoverageStance } from "@assent/core";

/**
 * Stance detection. A payer's position on a service ("X considers Y medically
 * necessary…") is a CoverageStance, not a Criterion — the classifier is trained to
 * label those sentences `none` so the two never double-count.
 *
 * This is deliberately RULES, not a network, and labelled as such: stance language
 * is a small closed set of highly conventional formulas, and a rule that matches a
 * literal phrase gives us an exact offset for the citation. Like the classifier, it
 * is purely extractive — it can only point at text that is already there.
 */

interface StancePattern {
  stance: CoverageStance;
  re: RegExp;
}

/** Order matters: the first match wins, so negative formulas are tested first. */
const PATTERNS: StancePattern[] = [
  {
    stance: "investigational",
    re: /\b(?:experimental and investigational|investigational and experimental|considered investigational|is investigational|unproven and not medically necessary|considered unproven|is unproven)\b[^.]*/i,
  },
  {
    stance: "not_covered",
    re: /\b(?:is not covered|are not covered|does not cover|do not cover|is non-?covered|not medically necessary|not reasonable and necessary|is not established|considered not established|is excluded from coverage)\b[^.]*/i,
  },
  {
    stance: "conditional",
    re: /\b(?:considered medically necessary|is medically necessary|considers[^.]{0,80}?medically necessary|covers[^.]{0,80}?as medically necessary|proven and medically necessary|reasonable and necessary|considered established|considers[^.]{0,80}?established)\b[^.]*/i,
  },
  {
    stance: "covered",
    re: /\b(?:is covered|are covered|will be covered|covers diagnostic[^.]{0,60})\b[^.]*/i,
  },
];

export interface StanceDetection {
  stance: CoverageStance;
  start: number;
  end: number;
  /** Exactly spanText.slice(start, end). */
  quote: string;
}

/**
 * Detect a stance in a span. Returns at most one — a span states one position.
 * Offsets are exact so the quote is a literal substring of the source.
 */
export function detectStance(spanText: string): StanceDetection | null {
  for (const p of PATTERNS) {
    const m = p.re.exec(spanText);
    if (!m || m.index === undefined) continue;
    // Widen left to the start of the clause so the quote reads as a statement.
    let start = m.index;
    const before = spanText.slice(0, start);
    const clauseStart = Math.max(
      before.lastIndexOf(". ") + 2,
      before.lastIndexOf("; ") + 2,
      0,
    );
    if (start - clauseStart < 140) start = clauseStart;
    let end = m.index + m[0].length;
    // Trim trailing whitespace/punctuation; keep offsets exact.
    while (end > start && /[\s.;:,]/.test(spanText[end - 1]!)) end--;
    while (start < end && /\s/.test(spanText[start]!)) start++;
    if (end - start < 8) continue;
    return { stance: p.stance, start, end, quote: spanText.slice(start, end) };
  }
  return null;
}

/** Codes mentioned in a span, so a stance can be attached to what it is about. */
const CODE_RE = /\b(\d{4}[A-Z]|\d{5}|[A-Z]\d{4})\b/g;

export function codesMentioned(spanText: string): string[] {
  const out = new Set<string>();
  let m: RegExpExecArray | null;
  CODE_RE.lastIndex = 0;
  while ((m = CODE_RE.exec(spanText)) !== null) out.add(m[1]!);
  return [...out];
}
