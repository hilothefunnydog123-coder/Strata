import type { Criterion, CriterionChange, ChangeType } from "@assent/core";

/**
 * Criterion-level diff (PROMPT §6 Diff) — no language model.
 *
 * added/removed are structural (a criterion appears or disappears between
 * versions). tightened / loosened / clarified is decided by a RESTRICTIVENESS
 * SCORE: an ordered, inspectable ruleset over the two verbatim quotes. Numeric
 * thresholds are compared directly; otherwise the score is the sum of weighted
 * cues for obligation, evidence strength, permission and sufficiency.
 *
 * Rules rather than a model because "did this get harder to satisfy?" is a
 * comparison a reviewer must be able to audit line by line — and because the
 * whole ruleset is scored against a hand-labeled golden set (`pnpm eval`).
 */

function tokens(s: string): Set<string> {
  return new Set(s.toLowerCase().replace(/[^a-z0-9 ]/g, " ").split(/\s+/).filter((w) => w.length > 2));
}
function overlap(a: string, b: string): number {
  const ta = tokens(a);
  const tb = tokens(b);
  if (ta.size === 0 || tb.size === 0) return 0;
  let hit = 0;
  for (const t of ta) if (tb.has(t)) hit++;
  return hit / Math.min(ta.size, tb.size);
}

/**
 * Similarity of two criteria within a kind. The SUBJECT is the stable anchor
 * across versions, so it is weighted heavily; wording can change substantially.
 */
function criterionSim(
  a: { subject: string; requirementText: string },
  b: { subject: string; requirementText: string },
): number {
  const subjectSim =
    a.subject.trim().toLowerCase() === b.subject.trim().toLowerCase() ? 1 : overlap(a.subject, b.subject);
  return 0.7 * subjectSim + 0.3 * overlap(a.requirementText, b.requirementText);
}


export interface MatchedPair {
  from: Criterion;
  to: Criterion;
}
export interface CriterionMatch {
  pairs: MatchedPair[];
  added: Criterion[];
  removed: Criterion[];
}

/** Pair criteria across two versions by kind + subject similarity (greedy best match). */
export function matchCriteria(fromList: Criterion[], toList: Criterion[]): CriterionMatch {
  const pairs: MatchedPair[] = [];
  const usedTo = new Set<number>();
  const unmatchedFrom: Criterion[] = [];
  for (const from of fromList) {
    let best = -1;
    let bestScore = 0.45;
    toList.forEach((to, j) => {
      if (usedTo.has(j) || to.kind !== from.kind) return;
      const score = criterionSim(from, to);
      if (score > bestScore) {
        bestScore = score;
        best = j;
      }
    });
    if (best >= 0) {
      usedTo.add(best);
      pairs.push({ from, to: toList[best]! });
    } else unmatchedFrom.push(from);
  }
  const added = toList.filter((_, j) => !usedTo.has(j));
  return { pairs, added, removed: unmatchedFrom };
}

// ── Restrictiveness scoring ──────────────────────────────────────────────────

interface Cue {
  re: RegExp;
  weight: number;
  why: string;
}

/** Positive weight = harder to satisfy. Negative = easier. */
const CUES: Cue[] = [
  { re: /\bmust\b|\bshall\b|\bis required\b|\brequires\b/i, weight: 2, why: "mandatory obligation" },
  { re: /\bonly\b|\bsolely\b|\bexclusively\b/i, weight: 1.5, why: "narrowed to a single case" },
  { re: /\b(?:are|is) not sufficient\b|\bnot sufficient\b|\balone are not\b|\bdoes not satisfy\b/i, weight: 2.5, why: "explicitly rules evidence insufficient" },
  { re: /\bprospective\b|\brandomized\b|\bcontrolled trial\b/i, weight: 2, why: "demands prospective evidence" },
  { re: /\bclinical outcomes\b|\bsurvival\b/i, weight: 1.5, why: "demands outcome endpoints" },
  { re: /\bpeer-reviewed\b|\bpublished\b/i, weight: 0.5, why: "demands published evidence" },
  { re: /\bmay be considered\b|\bmay be\b|\bcan be\b/i, weight: -1.5, why: "permissive phrasing" },
  { re: /\bis permitted\b|\bare permitted\b|\bis allowed\b|\bmay be repeated\b/i, weight: -2.5, why: "grants permission" },
  { re: /\bsupporting evidence\b|\bsupportive\b/i, weight: -1, why: "accepts weaker evidence as supporting" },
  { re: /\bretrospective\b/i, weight: -1, why: "admits retrospective evidence" },
  { re: /\bnot covered\b|\bis excluded\b|\bnon-?covered\b/i, weight: 2, why: "non-coverage" },
  { re: /\bexcept\b|\bunless\b/i, weight: -0.5, why: "carves out an exception" },
];

export interface Restrictiveness {
  score: number;
  reasons: string[];
  thresholds: number[];
}

export function restrictiveness(text: string): Restrictiveness {
  let score = 0;
  const reasons: string[] = [];
  for (const c of CUES) {
    if (c.re.test(text)) {
      score += c.weight;
      reasons.push(c.why);
    }
  }
  // Numeric thresholds ("at least 95%", "one per", "two prior lines").
  const thresholds: number[] = [];
  const numRe = /(\d+(?:\.\d+)?)\s*%|\bat least\s+(\d+(?:\.\d+)?)\b|\bno more than\s+(\d+(?:\.\d+)?)\b/gi;
  let m: RegExpExecArray | null;
  while ((m = numRe.exec(text)) !== null) {
    const v = Number(m[1] ?? m[2] ?? m[3]);
    if (Number.isFinite(v)) thresholds.push(v);
  }
  return { score, reasons, thresholds };
}

export interface Classification {
  changeType: ChangeType;
  rationale: string;
}

/**
 * Classify a changed pair. Deterministic and explainable: the rationale names the
 * cues that moved the score, so a reviewer can check the call against the quotes.
 */
export function classifyChange(from: Criterion, to: Criterion): Classification {
  const a = restrictiveness(from.verbatimQuote);
  const b = restrictiveness(to.verbatimQuote);

  // A raised numeric threshold is the least ambiguous signal there is.
  if (a.thresholds.length > 0 && b.thresholds.length > 0) {
    const maxA = Math.max(...a.thresholds);
    const maxB = Math.max(...b.thresholds);
    if (maxB > maxA) {
      return { changeType: "tightened", rationale: `Threshold raised from ${maxA} to ${maxB}.` };
    }
    if (maxB < maxA) {
      return { changeType: "loosened", rationale: `Threshold lowered from ${maxA} to ${maxB}.` };
    }
  }

  const delta = b.score - a.score;
  const gained = b.reasons.filter((r) => !a.reasons.includes(r));
  const lost = a.reasons.filter((r) => !b.reasons.includes(r));

  if (delta >= 1) {
    return {
      changeType: "tightened",
      rationale: `Harder to satisfy: ${gained.length ? gained.join("; ") : "stronger obligation"}${
        lost.length ? ` (no longer ${lost.join("; ")})` : ""
      }.`,
    };
  }
  if (delta <= -1) {
    return {
      changeType: "loosened",
      rationale: `Easier to satisfy: ${gained.length ? gained.join("; ") : "weaker obligation"}${
        lost.length ? ` (dropped ${lost.join("; ")})` : ""
      }.`,
    };
  }
  return {
    changeType: "clarified",
    rationale: "Wording changed without altering what must be shown.",
  };
}

/** Compute the full criterion-level change list between two versions. */
export async function diffVersions(
  fromCriteria: Criterion[],
  toCriteria: Criterion[],
  toPolicyDocumentId: string,
  _model?: string,
): Promise<CriterionChange[]> {
  const { pairs, added, removed } = matchCriteria(fromCriteria, toCriteria);
  const changes: CriterionChange[] = [];

  for (const { from, to } of pairs) {
    if (from.verbatimQuote.trim() === to.verbatimQuote.trim()) continue; // unchanged
    const { changeType, rationale } = classifyChange(from, to);
    changes.push({
      id: `chg_${to.id}`,
      fromCriterionId: from.id,
      toCriterionId: to.id,
      policyDocumentId: toPolicyDocumentId,
      changeType,
      rationale,
    });
  }
  for (const a of added) {
    changes.push({
      id: `chg_${a.id}`,
      fromCriterionId: null,
      toCriterionId: a.id,
      policyDocumentId: toPolicyDocumentId,
      changeType: "added",
      rationale: `New requirement: ${a.subject}.`,
    });
  }
  for (const r of removed) {
    changes.push({
      id: `chg_rm_${r.id}`,
      fromCriterionId: r.id,
      toCriterionId: null,
      policyDocumentId: toPolicyDocumentId,
      changeType: "removed",
      rationale: `Requirement removed: ${r.subject}.`,
    });
  }
  return changes;
}
