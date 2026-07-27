import { readFileSync, existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { normalizeQuote } from "@assent/core";
import { segment, type Candidate } from "./segment";
import { featurize, type FeatureContext } from "./features";
import { labelToIndex, type BrainLabel } from "./labels";

/**
 * Dataset assembly.
 *
 *  TRAIN on `data/training.json` — annotated policy sentences written to cover the
 *  way payers actually phrase requirements. Deliberately NOT copied from any
 *  document in the corpus.
 *
 *  EVALUATE on the corpus documents themselves, labeled from the hand-authored
 *  golden set. Because no corpus sentence appears in training, this is an honest
 *  generalization test rather than a memorization check.
 */

const here = dirname(fileURLToPath(import.meta.url));

export interface Example {
  x: Float64Array;
  y: number;
  label: BrainLabel;
  text: string;
  /** Grouping key so splits never leak related sentences across the boundary. */
  group: string;
}

interface TrainingRow {
  text: string;
  kind: BrainLabel;
  heading: string;
}

/**
 * Training rows = the annotated policy sentences plus a hard-negative file.
 * The hard negatives teach the distinctions real documents actually turn on:
 * scope lead-ins and list stems, qualifier sentences that elaborate a
 * requirement without being one, and payer STANCE sentences ("X considers Y
 * medically necessary…") which belong to CoverageStance, not Criterion.
 */
export function loadTrainingRows(): TrainingRow[] {
  const base = JSON.parse(
    readFileSync(join(here, "..", "data", "training.json"), "utf8"),
  ) as TrainingRow[];
  const hardPath = join(here, "..", "data", "hard-negatives.json");
  const hard = existsSync(hardPath)
    ? (JSON.parse(readFileSync(hardPath, "utf8")) as TrainingRow[])
    : [];
  // The hard-negative file carries one `_note` entry documenting the no-leakage
  // rule for future annotators; it is not training data.
  return [...base, ...hard].filter((r) => r.heading !== "_");
}

/** Featurize the annotated training rows. Each row is treated as a single candidate. */
export function buildTrainingSet(rows = loadTrainingRows()): Example[] {
  return rows.map((r, i) => {
    const ctx: FeatureContext = { headingPath: [r.heading], index: 0, total: 1 };
    return {
      x: featurize(r.text, ctx),
      y: labelToIndex(r.kind),
      label: r.kind,
      text: r.text,
      group: `train_${i}`,
    };
  });
}

// ── Evaluation set: real corpus documents + golden labels ────────────────────

export interface GoldenCriterion {
  kind: BrainLabel;
  verbatimQuote: string;
}
export interface GoldenEntry {
  source: string;
  externalId: string;
  version: number;
  ordinal: number;
  criteria: GoldenCriterion[];
}

export interface CorpusSpan {
  docKey: string;
  ordinal: number;
  text: string;
  headingPath: string[];
}

/**
 * Label a candidate against the golden criteria for its span: if the candidate
 * text contains (or is contained by) a golden quote, it takes that kind.
 * Everything else is `none`.
 */
export function labelCandidate(cand: Candidate, golden: GoldenCriterion[]): BrainLabel {
  const c = normalizeQuote(cand.text).toLowerCase();
  if (c.length === 0) return "none";
  for (const g of golden) {
    const q = normalizeQuote(g.verbatimQuote).toLowerCase();
    if (q.length === 0) continue;
    if (c.includes(q) || q.includes(c)) return g.kind;
    // Fall back to strong token overlap for quotes that straddle a clause split.
    if (overlap(c, q) >= 0.75) return g.kind;
  }
  return "none";
}

function overlap(a: string, b: string): number {
  const ta = new Set(a.split(/\s+/).filter((w) => w.length > 3));
  const tb = new Set(b.split(/\s+/).filter((w) => w.length > 3));
  if (ta.size === 0 || tb.size === 0) return 0;
  let hit = 0;
  for (const t of tb) if (ta.has(t)) hit++;
  return hit / tb.size;
}

/** Build the held-out evaluation set from corpus spans + golden labels. */
export function buildEvalSet(spans: CorpusSpan[], golden: GoldenEntry[]): Example[] {
  const byKey = new Map<string, GoldenCriterion[]>();
  for (const g of golden) {
    byKey.set(`${g.source}|${g.externalId}|${g.version}|${g.ordinal}`, g.criteria);
  }
  const out: Example[] = [];
  for (const span of spans) {
    const gold = byKey.get(`${span.docKey}|${span.ordinal}`) ?? [];
    for (const cand of segment(span.text)) {
      const label = labelCandidate(cand, gold);
      const ctx: FeatureContext = {
        headingPath: span.headingPath,
        index: cand.index,
        total: cand.total,
      };
      out.push({
        x: featurize(cand.text, ctx),
        y: labelToIndex(label),
        label,
        text: cand.text,
        group: span.docKey,
      });
    }
  }
  return out;
}

export function goldenPath(fixturesDir: string): string {
  return join(fixturesDir, "golden", "extraction.json");
}

export function loadGolden(fixturesDir: string): GoldenEntry[] {
  const p = goldenPath(fixturesDir);
  if (!existsSync(p)) return [];
  return JSON.parse(readFileSync(p, "utf8")) as GoldenEntry[];
}
