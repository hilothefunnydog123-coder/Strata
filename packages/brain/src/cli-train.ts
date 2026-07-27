import { readFileSync, writeFileSync, existsSync, mkdirSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { parseHtmlToSpans } from "@assent/parse";
import { buildTrainingSet, buildEvalSet, loadGolden, loadTrainingRows, type CorpusSpan } from "./dataset";
import { train, evaluate, tuneThreshold } from "./train";
import { LABELS } from "./labels";

/**
 * `pnpm --filter @assent/brain train`
 *
 * Trains the criterion classifier and reports metrics on a held-out set built
 * from the corpus documents, which contain NO sentence used in training. Writes
 * the weights to `model/model.json` so inference needs no training step.
 */

const here = dirname(fileURLToPath(import.meta.url));

function findFixtures(): string {
  if (process.env.ASSENT_FIXTURES_DIR) return process.env.ASSENT_FIXTURES_DIR;
  let dir = here;
  for (let i = 0; i < 8; i++) {
    if (existsSync(join(dir, "fixtures", "manifest.json"))) return join(dir, "fixtures");
    const parent = dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  throw new Error("could not locate fixtures/");
}

interface ManifestEntry {
  source: string;
  externalId: string;
  version: number;
  file: string;
}

/** Read every corpus document and flatten it to spans keyed for golden lookup. */
function corpusSpans(fixturesDir: string): CorpusSpan[] {
  const manifest = JSON.parse(
    readFileSync(join(fixturesDir, "manifest.json"), "utf8"),
  ) as ManifestEntry[];
  const spans: CorpusSpan[] = [];
  for (const m of manifest) {
    const html = readFileSync(resolve(fixturesDir, m.file), "utf8");
    const parsed = parseHtmlToSpans(html);
    for (const s of parsed.spans) {
      spans.push({
        docKey: `${m.source}|${m.externalId}|${m.version}`,
        ordinal: s.ordinal,
        text: s.text,
        headingPath: s.headingPath,
      });
    }
  }
  return spans;
}

function pct(x: number): string {
  return `${(x * 100).toFixed(1)}%`;
}

function main() {
  const fixturesDir = findFixtures();
  const rows = loadTrainingRows();
  const trainSet = buildTrainingSet(rows);
  const spans = corpusSpans(fixturesDir);
  const golden = loadGolden(fixturesDir);
  const evalSet = buildEvalSet(spans, golden);

  console.log("\n═══ Assent brain — training the criterion classifier ═══════════\n");
  console.log(`  annotated training sentences  ${trainSet.length}`);
  console.log(`  held-out corpus candidates    ${evalSet.length}  (from ${spans.length} real spans)`);
  const posEval = evalSet.filter((e) => e.y !== 0).length;
  console.log(`     of which are criteria      ${posEval}`);
  console.log(`  classes                       ${LABELS.length} (12 kinds + none)\n`);

  const t0 = Date.now();
  const result = train(trainSet, { verbose: true });
  const trainMs = Date.now() - t0;
  console.log(`\n  trained in ${trainMs}ms over ${result.epochsRun} epochs`);

  /**
   * Threshold calibration must happen on data that looks like inference input.
   * The annotated sentences are cleaner than real clause-split candidates, so a
   * threshold tuned on them is over-permissive. We calibrate on two payers'
   * documents and report on the six the model has then never seen in ANY
   * capacity — not in training, not in calibration.
   */
  const CALIBRATION_PAYERS = new Set(["moldx", "aetna"]);
  const calSet = evalSet.filter((e) => CALIBRATION_PAYERS.has(e.group.split("|")[0] ?? ""));
  const testSet = evalSet.filter((e) => !CALIBRATION_PAYERS.has(e.group.split("|")[0] ?? ""));
  const threshold = tuneThreshold(result.model, calSet, 0.95);
  console.log(`  abstention threshold          ${threshold} (calibrated on ${CALIBRATION_PAYERS.size} payers, ${calSet.length} candidates)\n`);

  console.log("  VALIDATION (held-out slice of the annotated set)");
  console.log(`    detection precision         ${pct(result.validation.detectionPrecision)}`);
  console.log(`    detection recall            ${pct(result.validation.detectionRecall)}`);
  console.log(`    kind accuracy               ${pct(result.validation.kindAccuracy)}\n`);

  const calReport = evaluate(result.model, calSet, threshold);
  console.log(`  CALIBRATION PAYERS (${[...CALIBRATION_PAYERS].join(", ")})`);
  console.log(`    detection precision         ${pct(calReport.detectionPrecision)}`);
  console.log(`    detection recall            ${pct(calReport.detectionRecall)}\n`);

  const report = evaluate(result.model, testSet, threshold);
  console.log("  ═══ TEST — 6 UNSEEN PAYERS (no sentence in training, no role in calibration)");
  console.log(`    candidates scored           ${report.total}`);
  console.log(`    detection precision         ${pct(report.detectionPrecision)}`);
  console.log(`    detection recall            ${pct(report.detectionRecall)}`);
  console.log(`    detection F1                ${pct(report.detectionF1)}`);
  console.log(`    kind accuracy               ${pct(report.kindAccuracy)}`);
  console.log(`    false positives             ${report.falsePositives}`);
  console.log(`    overall accuracy            ${pct(report.accuracy)}\n`);

  console.log("  per-kind on the held-out corpus (support > 0 only):");
  for (const c of report.perClass) {
    if (c.support === 0) continue;
    console.log(
      `    ${c.label.padEnd(28)} P ${pct(c.precision).padStart(6)}  R ${pct(c.recall).padStart(6)}  n=${c.support}`,
    );
  }

  const outDir = join(here, "..", "model");
  mkdirSync(outDir, { recursive: true });
  const serialized = result.model.serialize(threshold, LABELS as string[], {
    trainedAt: new Date().toISOString(),
    trainingSentences: trainSet.length,
    epochs: result.epochsRun,
    threshold,
    heldOutCorpusCandidates: report.total,
    heldOutDetectionPrecision: report.detectionPrecision,
    heldOutDetectionRecall: report.detectionRecall,
    heldOutKindAccuracy: report.kindAccuracy,
    architecture: `${result.model.config.inDim}→${result.model.config.hidden.join("→")}→${result.model.config.outDim} MLP, ReLU, dropout ${result.model.config.dropout}`,
  });
  const outPath = join(outDir, "model.json");
  writeFileSync(outPath, JSON.stringify(serialized));
  const kb = Math.round(Buffer.byteLength(JSON.stringify(serialized)) / 1024);
  console.log(`\n  model → ${outPath}  (${kb} KB, no runtime dependencies)\n`);
}

main();
