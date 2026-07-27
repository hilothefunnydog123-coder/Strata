import { verifyQuote, type CriterionKind } from "@assent/core";

/**
 * Scoring for the extraction eval (PROMPT §9). Detection is matched per span by
 * quote similarity (kind-agnostic), then kind accuracy is measured over the
 * matched detections. The hallucination rate — criteria asserted with no support
 * in the span — is measured directly and MUST be 0.
 */

export interface ScoredCriterion {
  spanId: string;
  spanText: string;
  kind: CriterionKind;
  verbatimQuote: string;
}

function tokens(s: string): Set<string> {
  return new Set(s.toLowerCase().replace(/[^a-z0-9 ]/g, " ").split(/\s+/).filter((w) => w.length > 2));
}
function norm(s: string): string {
  return s.toLowerCase().replace(/\s+/g, " ").trim();
}

/**
 * Do a predicted quote and a gold quote cite the same source sentence?
 *
 * The golden set records A minimal supporting quote. An extractive classifier
 * returns the whole clause it scored, which frequently CONTAINS the gold quote.
 * That is the same citation with a wider span — a correct detection, not a miss.
 * Symmetric overlap would score it as a false positive AND a false negative at
 * once, which measures granularity rather than correctness. So containment counts
 * as a match, and how much wider the span is gets reported separately as quote
 * tightness.
 */
function quoteSim(a: string, b: string): number {
  const na = norm(a);
  const nb = norm(b);
  if (na.length === 0 || nb.length === 0) return 0;
  if (na.includes(nb) || nb.includes(na)) return 1;
  const ta = tokens(a);
  const tb = tokens(b);
  if (ta.size === 0 || tb.size === 0) return 0;
  let hit = 0;
  for (const t of ta) if (tb.has(t)) hit++;
  // Asymmetric: how much of the SMALLER (typically gold) quote is covered.
  return hit / Math.min(ta.size, tb.size);
}

/** Ratio of gold quote length to predicted quote length, averaged over matches. */
function tightness(pred: string, gold: string): number {
  const p = norm(pred).length;
  const g = norm(gold).length;
  if (p === 0) return 0;
  return Math.min(1, g / p);
}

export interface ExtractionMetrics {
  goldCount: number;
  predictedCount: number;
  truePositives: number;
  falsePositives: number;
  falseNegatives: number;
  precision: number;
  recall: number;
  f1: number;
  kindAccuracy: number;
  /** Mean gold/predicted quote-length ratio on matches: 1.0 = perfectly minimal. */
  quoteTightness: number;
  citationPassRate: number;
  hallucinationRate: number;
}

const MATCH_THRESHOLD = 0.6;

export function scoreExtraction(predicted: ScoredCriterion[], gold: ScoredCriterion[]): ExtractionMetrics {
  const bySpanGold = new Map<string, ScoredCriterion[]>();
  const bySpanPred = new Map<string, ScoredCriterion[]>();
  for (const g of gold) (bySpanGold.get(g.spanId) ?? bySpanGold.set(g.spanId, []).get(g.spanId)!).push(g);
  for (const p of predicted) (bySpanPred.get(p.spanId) ?? bySpanPred.set(p.spanId, []).get(p.spanId)!).push(p);

  let tp = 0, fp = 0, fn = 0, kindCorrect = 0;
  let tightSum = 0;
  const spanIds = new Set([...bySpanGold.keys(), ...bySpanPred.keys()]);
  for (const spanId of spanIds) {
    const golds = [...(bySpanGold.get(spanId) ?? [])];
    const preds = [...(bySpanPred.get(spanId) ?? [])];
    const usedPred = new Set<number>();
    for (const g of golds) {
      let best = -1, bestSim = MATCH_THRESHOLD;
      preds.forEach((p, i) => {
        if (usedPred.has(i)) return;
        const sim = quoteSim(g.verbatimQuote, p.verbatimQuote);
        if (sim >= bestSim) { bestSim = sim; best = i; }
      });
      if (best >= 0) {
        usedPred.add(best);
        tp++;
        tightSum += tightness(preds[best]!.verbatimQuote, g.verbatimQuote);
        if (preds[best]!.kind === g.kind) kindCorrect++;
      } else {
        fn++;
      }
    }
    fp += preds.filter((_, i) => !usedPred.has(i)).length;
  }

  // Citation pass rate + hallucination over the predicted set. Post-pipeline these
  // are 100% / 0 by construction (the invariant gates unverified quotes), which is
  // exactly what we assert.
  let verified = 0, hallucinated = 0;
  for (const p of predicted) {
    if (verifyQuote(p.spanText, p.verbatimQuote).ok) verified++;
    else hallucinated++;
  }

  const precision = tp + fp === 0 ? 1 : tp / (tp + fp);
  const recall = tp + fn === 0 ? 1 : tp / (tp + fn);
  const f1 = precision + recall === 0 ? 0 : (2 * precision * recall) / (precision + recall);
  return {
    goldCount: gold.length,
    predictedCount: predicted.length,
    truePositives: tp,
    falsePositives: fp,
    falseNegatives: fn,
    precision,
    recall,
    f1,
    kindAccuracy: tp === 0 ? 1 : kindCorrect / tp,
    quoteTightness: tp === 0 ? 1 : tightSum / tp,
    citationPassRate: predicted.length === 0 ? 1 : verified / predicted.length,
    hallucinationRate: predicted.length === 0 ? 0 : hallucinated / predicted.length,
  };
}

export interface DiffMetrics {
  total: number;
  correct: number;
  accuracy: number;
  confusion: Record<string, Record<string, number>>;
}

/** Score the diff classifier against gold (keyed on the criterion's kind+direction). */
export function scoreDiff(
  predicted: Array<{ key: string; changeType: string }>,
  gold: Array<{ key: string; changeType: string }>,
): DiffMetrics {
  const goldByKey = new Map(gold.map((g) => [g.key, g.changeType]));
  const confusion: Record<string, Record<string, number>> = {};
  let correct = 0, total = 0;
  for (const p of predicted) {
    const expected = goldByKey.get(p.key);
    if (!expected) continue;
    total++;
    (confusion[expected] ??= {})[p.changeType] = ((confusion[expected] ??= {})[p.changeType] ?? 0) + 1;
    if (expected === p.changeType) correct++;
  }
  return { total, correct, accuracy: total === 0 ? 1 : correct / total, confusion };
}
