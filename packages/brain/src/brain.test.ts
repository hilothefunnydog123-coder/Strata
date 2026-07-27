import { describe, it, expect } from "vitest";
import { Mlp, softmax, mulberry32 } from "./nn";
import { segment, isStem } from "./segment";
import { featurize, FEATURE_DIM } from "./features";
import { detectStance } from "./stance";
import { CriterionClassifier } from "./predict";
import { LABELS } from "./labels";

describe("the network itself", () => {
  it("softmax is a normalized distribution and is numerically stable", () => {
    const p = softmax(Float64Array.from([1000, 1001, 999]));
    const sum = [...p].reduce((a, b) => a + b, 0);
    expect(sum).toBeCloseTo(1, 10);
    expect(p.every((x) => Number.isFinite(x) && x >= 0)).toBe(true);
  });

  it("actually learns — loss falls on a separable problem", () => {
    const m = new Mlp({ inDim: 4, hidden: [8], outDim: 2, dropout: 0, seed: 7 });
    const data = [
      { x: Float64Array.from([1, 0, 0, 0]), y: 0 },
      { x: Float64Array.from([0.9, 0.1, 0, 0]), y: 0 },
      { x: Float64Array.from([0, 0, 1, 0]), y: 1 },
      { x: Float64Array.from([0, 0, 0.9, 0.1]), y: 1 },
    ];
    const lossOf = () =>
      data.reduce((s, d) => s - Math.log(Math.max(m.predict(d.x)[d.y]!, 1e-12)), 0) / data.length;
    const before = lossOf();
    for (let i = 0; i < 300; i++) {
      for (const d of data) m.backward(m.forward(d.x, true), d.y, 1);
      m.step(0.05, 0, data.length);
    }
    const after = lossOf();
    expect(after).toBeLessThan(before * 0.5);
    for (const d of data) {
      const p = m.predict(d.x);
      expect(p[d.y]!).toBeGreaterThan(0.5);
    }
  });

  it("round-trips through serialization with identical predictions", () => {
    const m = new Mlp({ inDim: 6, hidden: [5], outDim: 3, dropout: 0, seed: 3 });
    const x = Float64Array.from([0.2, 0.4, 0.1, 0.9, 0, 0.3]);
    const before = [...m.predict(x)];
    const after = [...Mlp.deserialize(m.serialize(0.5, ["a", "b", "c"], {})).predict(x)];
    expect(after).toEqual(before);
  });

  it("is deterministic for a fixed seed", () => {
    const r1 = mulberry32(42);
    const r2 = mulberry32(42);
    expect([r1(), r1(), r1()]).toEqual([r2(), r2(), r2()]);
  });
});

describe("segmentation — the structural half of the citation invariant", () => {
  const text =
    "The patient has advanced disease. The laboratory must be CLIA-certified and the test registered.";

  it("every candidate is an EXACT substring at its offsets", () => {
    for (const c of segment(text)) {
      expect(text.slice(c.start, c.end)).toBe(c.text);
    }
  });

  it("drops list stems that introduce requirements rather than stating one", () => {
    expect(isStem("Coverage is available when all of the following are met")).toBe(true);
    expect(isStem("the patient has the following")).toBe(true);
    expect(isStem("The laboratory must hold CLIA certification")).toBe(false);
  });

  it("produces a stable feature vector of the declared width", () => {
    const v = featurize("The laboratory must be CLIA-certified", { headingPath: ["Coverage"], index: 0, total: 1 });
    expect(v.length).toBe(FEATURE_DIM);
    expect(v.every((x) => Number.isFinite(x))).toBe(true);
  });
});

describe("stance detection", () => {
  it("finds a negative stance with exact offsets", () => {
    const t = "The plan considers this assay experimental and investigational for screening.";
    const s = detectStance(t)!;
    expect(s.stance).toBe("investigational");
    expect(t.slice(s.start, s.end)).toBe(s.quote);
  });
  it("finds a conditional stance", () => {
    expect(detectStance("Testing is considered medically necessary for advanced disease.")!.stance)
      .toBe("conditional");
  });
  it("returns null when the span states no position", () => {
    expect(detectStance("This background section reviews the literature.")).toBeNull();
  });
});

describe("the trained model that actually ships", () => {
  it("is committed and loads", () => {
    expect(CriterionClassifier.isTrained()).toBe(true);
    const c = CriterionClassifier.load();
    expect(c.threshold).toBeGreaterThan(0);
  });

  it("CANNOT fabricate — every extracted quote is a literal substring of the span", () => {
    const c = CriterionClassifier.load();
    const span =
      "The laboratory performing the test must hold CLIA certification. Clinical utility must be " +
      "demonstrated through prospective studies with clinical outcomes as the endpoint. This " +
      "background section is provided for context only.";
    const preds = c.extract(span, ["Coverage Indications"]);
    expect(preds.length).toBeGreaterThan(0);
    for (const p of preds) {
      expect(span.includes(p.quote)).toBe(true);
      expect(span.slice(p.start, p.end)).toBe(p.quote);
      expect(LABELS).toContain(p.kind);
    }
  });

  it("recognizes an obvious requirement and ignores obvious background", () => {
    const c = CriterionClassifier.load();
    const hit = c.extract("The laboratory must hold current CLIA certification for high complexity testing.", ["Coverage Criteria"]);
    expect(hit.length).toBeGreaterThan(0);
    const miss = c.extract("This background section summarizes the published literature for context.", ["Background"]);
    expect(miss.length).toBe(0);
  });
});
