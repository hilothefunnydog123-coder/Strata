import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import {
  DiffClassificationSchema,
  type Criterion,
  type CriterionChange,
  type ChangeType,
} from "@assent/core";
import { findFixturesDir, pipelineMode } from "./paths";
import { cacheKey, readCache, writeCache } from "./cache";
import { EXTRACTION_SYSTEM } from "./prompt";

/**
 * Criterion-level diff (PROMPT §6 Diff). Compare to the superseded version at the
 * criterion level, not the text level. added/removed are structural; tightened vs
 * loosened vs clarified is a separate, cheap classification — an LLM call in live
 * mode with its own golden set, served offline from committed labels.
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
 * across versions (the requirement's identity), so it is weighted heavily; the
 * requirement wording is secondary and can change substantially in a real revision.
 */
function criterionSim(a: { subject: string; requirementText: string }, b: { subject: string; requirementText: string }): number {
  const subjectSim = a.subject.trim().toLowerCase() === b.subject.trim().toLowerCase() ? 1 : overlap(a.subject, b.subject);
  const reqSim = overlap(a.requirementText, b.requirementText);
  return 0.7 * subjectSim + 0.3 * reqSim;
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
    let bestScore = 0.45; // threshold (subject-weighted score)
    toList.forEach((to, j) => {
      if (usedTo.has(j) || to.kind !== from.kind) return;
      const score = criterionSim(from, to);
      if (score > bestScore) { bestScore = score; best = j; }
    });
    if (best >= 0) { usedTo.add(best); pairs.push({ from, to: toList[best]! }); }
    else unmatchedFrom.push(from);
  }
  const added = toList.filter((_, j) => !usedTo.has(j));
  return { pairs, added, removed: unmatchedFrom };
}

interface GoldenDiff {
  kind: string;
  changeType: ChangeType;
  rationale: string;
}

let goldenDiff: GoldenDiff[] | null = null;
function loadGoldenDiff(): GoldenDiff[] {
  if (goldenDiff) return goldenDiff;
  const path = join(findFixturesDir(), "golden", "diff.json");
  goldenDiff = existsSync(path) ? (JSON.parse(readFileSync(path, "utf8")) as GoldenDiff[]) : [];
  return goldenDiff;
}

/** Classify a changed matched pair (tightened/loosened/clarified). */
export async function classifyChange(
  from: Criterion,
  to: Criterion,
  model: string,
): Promise<{ changeType: ChangeType; rationale: string }> {
  if (pipelineMode() === "fixture") {
    const g = loadGoldenDiff().find((d) => d.kind === to.kind);
    if (g) return { changeType: g.changeType, rationale: g.rationale };
    return { changeType: "clarified", rationale: "Wording changed without altering the requirement." };
  }
  const user = `Prior requirement:\n"""${from.requirementText}\nQUOTE: ${from.verbatimQuote}"""\n\nNew requirement:\n"""${to.requirementText}\nQUOTE: ${to.verbatimQuote}"""\n\nClassify the change as tightened (harder to meet), loosened (easier), or clarified (same bar, clearer wording). Return JSON {"changeType": ..., "rationale": ...}.`;
  const key = cacheKey(model, EXTRACTION_SYSTEM + "|diff", user);
  let cached = readCache("diff", key);
  if (!cached) {
    const { callModel } = await import("./anthropic");
    cached = await callModel({ model, system: "You classify coverage-criterion changes. temperature 0. JSON only.", user, maxTokens: 300 });
    writeCache("diff", key, cached);
  }
  const parsed = DiffClassificationSchema.safeParse(JSON.parse(cached.text));
  if (!parsed.success) return { changeType: "clarified", rationale: "Unclassifiable; defaulted." };
  return parsed.data;
}

/** Compute the full criterion-level change list between two versions. */
export async function diffVersions(
  fromCriteria: Criterion[],
  toCriteria: Criterion[],
  toPolicyDocumentId: string,
  model: string,
): Promise<CriterionChange[]> {
  const { pairs, added, removed } = matchCriteria(fromCriteria, toCriteria);
  const changes: CriterionChange[] = [];

  for (const { from, to } of pairs) {
    if (from.verbatimQuote.trim() === to.verbatimQuote.trim()) continue; // unchanged
    const { changeType, rationale } = await classifyChange(from, to, model);
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
