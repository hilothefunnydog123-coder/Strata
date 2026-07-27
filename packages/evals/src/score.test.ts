import { describe, it, expect } from "vitest";
import { scoreExtraction, scoreDiff, type ScoredCriterion } from "./score";

const SPAN = "Clinical utility must be demonstrated in a prospective study with clinical outcomes.";
const g = (kind: string, quote: string): ScoredCriterion => ({
  spanId: "s1", spanText: SPAN, kind: kind as never, verbatimQuote: quote,
});

const gold: ScoredCriterion[] = [
  g("clinical_utility", "Clinical utility must be demonstrated in a prospective study"),
  g("clinical_validity", "clinical outcomes"),
];

describe("scoreExtraction discriminates (proves the harness is not a tautology)", () => {
  it("perfect prediction → precision/recall/F1 = 1, hallucination 0", () => {
    const m = scoreExtraction([...gold], gold);
    expect(m.precision).toBe(1);
    expect(m.recall).toBe(1);
    expect(m.f1).toBe(1);
    expect(m.hallucinationRate).toBe(0);
    expect(m.citationPassRate).toBe(1);
  });

  it("a FABRICATED quote is caught — hallucination > 0 and citation pass < 1", () => {
    const fabricated = g("clinical_utility", "retrospective chart review is acceptable evidence");
    const m = scoreExtraction([fabricated], [gold[0]!]);
    expect(m.hallucinationRate).toBeGreaterThan(0);
    expect(m.citationPassRate).toBeLessThan(1);
  });

  it("a missed criterion lowers recall", () => {
    const m = scoreExtraction([gold[0]!], gold);
    expect(m.recall).toBeCloseTo(0.5);
    expect(m.falseNegatives).toBe(1);
  });

  it("an over-extraction lowers precision", () => {
    const extra = g("documentation", "prospective study");
    const m = scoreExtraction([...gold, extra], gold);
    expect(m.precision).toBeLessThan(1);
    expect(m.falsePositives).toBe(1);
  });

  it("a wrong kind (right quote) lowers kind accuracy but not detection", () => {
    const wrongKind = g("documentation", "Clinical utility must be demonstrated in a prospective study");
    const m = scoreExtraction([wrongKind, gold[1]!], gold);
    expect(m.recall).toBe(1); // both detected
    expect(m.kindAccuracy).toBeLessThan(1); // one had the wrong kind
  });
});

describe("scoreDiff", () => {
  it("counts correct vs incorrect change directions", () => {
    const m = scoreDiff(
      [{ key: "clinical_utility", changeType: "tightened" }, { key: "frequency_limit", changeType: "tightened" }],
      [{ key: "clinical_utility", changeType: "tightened" }, { key: "frequency_limit", changeType: "loosened" }],
    );
    expect(m.total).toBe(2);
    expect(m.correct).toBe(1);
    expect(m.accuracy).toBe(0.5);
  });
});
