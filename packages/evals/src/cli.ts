import { createHash } from "node:crypto";
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { findFixturesDir } from "@assent/extract";
import { runExtractionEval, runDiffEval } from "./harness";
import { runDiffPairsEval } from "./diff-pairs";

/**
 * `pnpm eval` — reports precision, recall, F1 on criterion detection; accuracy on
 * kind; citation verification pass rate; and the hallucination rate, which MUST be
 * 0. Also scores the diff classifier. Snapshots every run so regressions are
 * visible over time (PROMPT §9). Gate: no ship if hallucination > 0 or precision
 * drops below the floor.
 */

const PRECISION_FLOOR = 0.6; // §5: 60% with perfect traceability is a product
const pct = (x: number) => `${(x * 100).toFixed(1)}%`;

async function main() {
  const ex = await runExtractionEval();
  const diff = await runDiffEval();
  const pairs = runDiffPairsEval();

  console.log("\n═══ Assent evals ═══════════════════════════════════════════\n");
  console.log("EXTRACTION  (@assent/brain — a locally-trained classifier. No LLM,");
  console.log("            no network. Scored against the hand-labeled golden set.)\n");
  console.log(`  docs examined           ${ex.docs}`);
  console.log(`  spans examined          ${ex.spansExamined}`);
  console.log(`  gold criteria           ${ex.goldCount}`);
  console.log(`  predicted criteria      ${ex.predictedCount}   (+${ex.stanceCount} stances)`);
  console.log(`  true / false pos / fn   ${ex.truePositives} / ${ex.falsePositives} / ${ex.falseNegatives}`);
  console.log(`  precision               ${pct(ex.precision)}`);
  console.log(`  recall                  ${pct(ex.recall)}`);
  console.log(`  F1                      ${pct(ex.f1)}`);
  console.log(`  kind accuracy           ${pct(ex.kindAccuracy)}`);
  console.log(`  quote tightness         ${pct(ex.quoteTightness)}   (1.0 = quote is exactly minimal)`);
  console.log(`  citation pass rate      ${pct(ex.citationPassRate)}`);
  console.log(`  rejection rate          ${pct(ex.rejectionRate)}   (M3 gate: < 5%)`);
  console.log(`  HALLUCINATION RATE      ${pct(ex.hallucinationRate)}   (gate: must be 0)`);
  console.log("");
  console.log("DIFF CLASSIFIER\n");
  console.log(`  classified changes      ${diff.total}`);
  console.log(`  accuracy                ${pct(diff.accuracy)}`);
  console.log(`  added / removed         ${diff.added} / ${diff.removed}`);
  console.log("");
  console.log("DIFF CLASSIFIER — golden pairs (§9's second golden set)\n");
  console.log(`  labeled pairs           ${pairs.total}`);
  console.log(`  correct                 ${pairs.correct}`);
  console.log(`  accuracy                ${pct(pairs.accuracy)}`);
  for (const [label, v] of Object.entries(pairs.byLabel)) {
    console.log(`    ${label.padEnd(12)} ${v.correct}/${v.n}`);
  }
  if (pairs.misses.length) {
    console.log("  misclassified:");
    for (const m of pairs.misses) console.log(`    #${m.id} ${m.payer}: expected ${m.expected}, got ${m.got}`);
  }
  console.log("");

  // Snapshot.
  const goldenSetHash = createHash("sha256")
    .update(readFileSync(join(findFixturesDir(), "golden", "extraction.json")))
    .digest("hex")
    .slice(0, 16);
  const snapshot = {
    at: new Date().toISOString(),
    suite: "extraction+diff",
    model: process.env.PIPELINE_MODE === "live" ? (process.env.ASSENT_EXTRACT_MODEL ?? "unknown") : "fixture-golden",
    goldenSetHash,
    extraction: ex,
    diff,
    diffPairs: pairs,
  };
  const outDir = join(dirname(fileURLToPath(import.meta.url)), "..", "eval-runs");
  mkdirSync(outDir, { recursive: true });
  const file = join(outDir, `${snapshot.at.replace(/[:.]/g, "-")}.json`);
  writeFileSync(file, JSON.stringify(snapshot, null, 2));
  console.log(`snapshot → ${file}`);
  await persistEvalRun(snapshot);
  console.log("");

  // Gate.
  const failures: string[] = [];
  if (ex.hallucinationRate > 0) failures.push(`hallucination rate ${pct(ex.hallucinationRate)} > 0`);
  if (ex.precision < PRECISION_FLOOR) failures.push(`precision ${pct(ex.precision)} < floor ${pct(PRECISION_FLOOR)}`);
  if (ex.rejectionRate >= 0.05) failures.push(`rejection rate ${pct(ex.rejectionRate)} >= 5%`);
  if (diff.accuracy < 1) failures.push(`diff accuracy ${pct(diff.accuracy)} < 100% on the golden set`);
  if (pairs.accuracy < 0.9) failures.push(`diff-pair accuracy ${pct(pairs.accuracy)} < 90% on the 20-pair golden set`);

  if (failures.length) {
    console.error("❌ EVAL GATE FAILED:\n  - " + failures.join("\n  - ") + "\n");
    process.exit(1);
  }
  console.log("✅ EVAL GATE PASSED — hallucination 0, citations verified, diff labels matched.\n");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});

/**
 * PROMPT §9: "Snapshot every run to an eval_runs table so regressions are visible
 * over time." Best effort — a missing database must never fail the eval, which has
 * to stay runnable offline with no infrastructure.
 */
async function persistEvalRun(snapshot: Record<string, unknown>): Promise<void> {
  if (!process.env.DATABASE_URL) {
    console.log("  (DATABASE_URL unset — not writing to eval_runs)");
    return;
  }
  try {
    const { createDb, schema } = await import("@assent/db");
    const { db, client } = createDb();
    await db.insert(schema.evalRun).values({
      id: `eval_${String(snapshot.at).replace(/[^0-9]/g, "")}`,
      suite: String(snapshot.suite),
      goldenSetHash: String(snapshot.goldenSetHash),
      model: String(snapshot.model),
      metrics: snapshot,
    });
    await client.end();
    console.log("  → eval_runs table");
  } catch (err) {
    console.warn(`  (could not write eval_runs: ${err instanceof Error ? err.message : err})`);
  }
}
