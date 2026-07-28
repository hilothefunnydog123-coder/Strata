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

/**
 * Pair criteria across two versions. Kind is a hard constraint; within a kind we
 * match by similarity — EXCEPT that when a kind has exactly one criterion on each
 * side, they are paired unconditionally. A revision that rewrites the sole
 * frequency-limit rule from "has not been previously tested" to "repeat testing is
 * permitted when…" shares few words but is plainly the same rule changing, and
 * scoring it as an unrelated add + remove would hide the very signal (loosened)
 * that the change feed exists to surface.
 */
export function matchCriteria(fromList: Criterion[], toList: Criterion[]): CriterionMatch {
  const pairs: MatchedPair[] = [];
  const usedTo = new Set<number>();
  const usedFrom = new Set<number>();

  const kinds = new Set([...fromList.map((c) => c.kind), ...toList.map((c) => c.kind)]);
  for (const kind of kinds) {
    const fromIdx = fromList.map((c, i) => [c, i] as const).filter(([c]) => c.kind === kind);
    const toIdx = toList.map((c, i) => [c, i] as const).filter(([c]) => c.kind === kind);

    // Sole-of-its-kind on both sides: the same rule, rewritten.
    if (fromIdx.length === 1 && toIdx.length === 1) {
      const [f, fi] = fromIdx[0]!;
      const [t, ti] = toIdx[0]!;
      usedFrom.add(fi);
      usedTo.add(ti);
      pairs.push({ from: f, to: t });
      continue;
    }

    for (const [from, fi] of fromIdx) {
      let best = -1;
      let bestScore = 0.4;
      for (const [to, ti] of toIdx) {
        if (usedTo.has(ti)) continue;
        const score = criterionSim(from, to);
        if (score > bestScore) {
          bestScore = score;
          best = ti;
        }
      }
      if (best >= 0) {
        usedTo.add(best);
        usedFrom.add(fi);
        pairs.push({ from, to: toList[best]! });
      }
    }
  }

  return {
    pairs,
    added: toList.filter((_, j) => !usedTo.has(j)),
    removed: fromList.filter((_, i) => !usedFrom.has(i)),
  };
}

import { classifyRevision } from "./restrictiveness";

export interface Classification {
  changeType: ChangeType;
  rationale: string;
}

/**
 * Classify a changed pair. The judgement lives in ./restrictiveness, which reads
 * what the revision added and removed in the context of the criterion's kind —
 * a higher number means opposite things for a frequency limit and an evidence
 * threshold, and the same added clause means opposite things joined by "or"
 * versus "and". Scored against §9's 20-pair golden set by `pnpm eval`.
 */
export function classifyChange(from: Criterion, to: Criterion): Classification {
  return classifyRevision(from.verbatimQuote, to.verbatimQuote, to.kind);
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
