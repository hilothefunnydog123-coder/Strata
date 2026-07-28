import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { findFixturesDir } from "@assent/extract";
import { classifyChange } from "@assent/extract";
import type { Criterion, ChangeType } from "@assent/core";

/**
 * PROMPT §9's second golden set: labeled before/after requirement pairs for the
 * diff classifier, scored independently of extraction. This measures the one
 * judgement the change feed sells — did the bar get harder or easier — against
 * hand-assigned labels, including cases the heuristic can get wrong.
 */
export interface DiffPair {
  id: number;
  payer: string;
  kind: string;
  from: string;
  to: string;
  label: ChangeType;
}

export function loadDiffPairs(): DiffPair[] {
  const p = join(findFixturesDir(), "golden", "diff-pairs.json");
  if (!existsSync(p)) return [];
  return (JSON.parse(readFileSync(p, "utf8")) as DiffPair[]).filter((d) => d.id > 0);
}

/** Minimal Criterion shaped for classifyChange — only the fields it reads. */
function asCriterion(quote: string, kind: string, id: string): Criterion {
  return {
    id, policyDocumentId: "d", kind: kind as Criterion["kind"], subject: kind,
    requirementText: quote, operator: null, value: null, unit: null, evidence: {},
    spanId: "s", verbatimQuote: quote, confidence: 1,
    extractedByModel: "golden", extractedAt: "2026-01-01T00:00:00Z",
  };
}

export interface DiffPairsReport {
  total: number;
  correct: number;
  accuracy: number;
  byLabel: Record<string, { n: number; correct: number }>;
  misses: Array<{ id: number; payer: string; expected: string; got: string }>;
}

export function runDiffPairsEval(): DiffPairsReport {
  const pairs = loadDiffPairs();
  const byLabel: Record<string, { n: number; correct: number }> = {};
  const misses: DiffPairsReport["misses"] = [];
  let correct = 0;

  for (const p of pairs) {
    const got = classifyChange(asCriterion(p.from, p.kind, "a"), asCriterion(p.to, p.kind, "b")).changeType;
    byLabel[p.label] ??= { n: 0, correct: 0 };
    byLabel[p.label]!.n++;
    if (got === p.label) { correct++; byLabel[p.label]!.correct++; }
    else misses.push({ id: p.id, payer: p.payer, expected: p.label, got });
  }
  return {
    total: pairs.length, correct,
    accuracy: pairs.length === 0 ? 1 : correct / pairs.length,
    byLabel, misses,
  };
}
