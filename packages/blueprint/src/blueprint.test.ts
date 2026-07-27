import { describe, it, expect } from "vitest";
import type { Asset, Payer, CoveredLives } from "@assent/core";
import { buildBlueprint, type EnrichedCriterion } from "./index";

let n = 0;
function crit(payerId: string, kind: string, subject: string, req: string, evidence = {}): EnrichedCriterion {
  const docId = `doc_${payerId}`;
  return {
    id: `c${n++}`, policyDocumentId: docId, kind: kind as never, subject, requirementText: req,
    operator: null, value: null, unit: null, evidence, spanId: `${docId}_s0`,
    verbatimQuote: req, confidence: 0.9, extractedByModel: "t", extractedAt: "2025-01-01T00:00:00Z",
    payerId,
  };
}

const payers: Payer[] = [
  { id: "big", name: "Big", type: "commercial", parentPayerId: null },
  { id: "mid", name: "Mid", type: "commercial", parentPayerId: null },
  { id: "small", name: "Small", type: "mac", parentPayerId: null },
];
const lives: CoveredLives[] = [
  { payerId: "big", year: 2024, segment: "x", livesCount: 40_000_000, sourceUrl: "http://x", sourceNote: "" },
  { payerId: "mid", year: 2024, segment: "x", livesCount: 10_000_000, sourceUrl: "http://x", sourceNote: "" },
  { payerId: "small", year: 2024, segment: "x", livesCount: 200_000, sourceUrl: "http://x", sourceNote: "" },
];
const asset: Asset = {
  id: "a1", accountId: "acc", name: "Test", indication: "advanced solid tumor",
  intendedUse: "guide therapy", targetCodes: ["81445"], comparator: "", targetPopulation: "",
};
const codesByDoc = { doc_big: ["81445"], doc_mid: ["81445"], doc_small: ["81445"] };

const criteria: EnrichedCriterion[] = [
  // clinical_indication: all three payers, worded differently → ONE cluster.
  crit("big", "clinical_indication", "advanced disease", "advanced or metastatic solid tumor cancer"),
  crit("mid", "clinical_indication", "advanced disease", "advanced-stage metastatic solid tumor"),
  crit("small", "clinical_indication", "advanced disease", "Stage III or IV solid tumor"),
  // clinical_utility: big + mid only, worded differently → ONE cluster (the §6.3 case).
  crit("big", "clinical_utility", "prospective clinical utility", "Clinical utility demonstrated in a prospective outcomes study", { studyDesign: "prospective", endpoint: "clinical_outcomes" }),
  crit("mid", "clinical_utility", "prospective clinical utility", "Utility shown prospectively with clinical outcomes", { studyDesign: "prospective", endpoint: "clinical_outcomes" }),
  // test_specific: small (MolDX) only → its own cluster.
  crit("small", "test_specific_requirement", "MolDX Z-code", "registered in MolDX DEX and assigned a Z-code"),
];

describe("buildBlueprint", () => {
  it("clusters differently-worded requirements across payers into one (§6.3)", async () => {
    const bp = await buildBlueprint({ asset, criteria, codesByDoc, payers, coveredLives: lives });
    const indication = bp.clusters.find((c) => c.kind === "clinical_indication")!;
    expect(indication.payerCount).toBe(3);
    expect(indication.citations).toHaveLength(3); // every constituent citation stays attached
    const utility = bp.clusters.find((c) => c.kind === "clinical_utility")!;
    expect(utility.payerCount).toBe(2);
  });

  it("computes lives per cluster reproducibly by hand", async () => {
    const bp = await buildBlueprint({ asset, criteria, codesByDoc, payers, coveredLives: lives });
    expect(bp.totalCorpusLives).toBe(50_200_000);
    const indication = bp.clusters.find((c) => c.kind === "clinical_indication")!;
    expect(indication.livesCovered).toBe(50_200_000); // big + mid + small
    const utility = bp.clusters.find((c) => c.kind === "clinical_utility")!;
    expect(utility.livesCovered).toBe(50_000_000); // big + mid
  });

  it("produces a monotonic frontier reaching 100% with correct marginals", async () => {
    const bp = await buildBlueprint({ asset, criteria, codesByDoc, payers, coveredLives: lives });
    // cumulative lives strictly increases; last step covers the full corpus.
    let prev = 0;
    for (const step of bp.frontier) {
      expect(step.cumulativeLives).toBeGreaterThan(prev);
      prev = step.cumulativeLives;
    }
    const last = bp.frontier[bp.frontier.length - 1]!;
    expect(last.cumulativeLives).toBe(50_200_000);
    expect(Math.round(last.cumulativePct * 100)).toBe(100);
    // The step that unlocks Big+Mid must add exactly 50M.
    expect(bp.frontier.some((s) => s.livesUnlocked === 50_000_000)).toBe(true);
    // The prospective clinical-utility work is high cost.
    const utilityStep = bp.frontier.find((s) => s.label.toLowerCase().includes("prospective"));
    expect(utilityStep!.costHint).toBe("high");
  });

  it("attaches a citation to every requirement (the invariant reaches the blueprint)", async () => {
    const bp = await buildBlueprint({ asset, criteria, codesByDoc, payers, coveredLives: lives });
    for (const cl of bp.clusters) {
      expect(cl.citations.length).toBeGreaterThan(0);
      for (const cite of cl.citations) expect(cite.verbatimQuote.length).toBeGreaterThan(0);
    }
  });
});
