import { describe, it, expect } from "vitest";
import { verifyQuote, locateQuote, buildNormalized, makeVerifiedCriterion } from "./citation";
import type { DocumentSpan } from "./types";

const span = (text: string): DocumentSpan => ({
  id: "span_1",
  policyDocumentId: "doc_1",
  ordinal: 0,
  pageNumber: 1,
  charStart: 0,
  charEnd: text.length,
  text,
  headingPath: ["Policy"],
});

describe("verifyQuote", () => {
  const body =
    "The test is considered medically necessary when clinical validity has been " +
    "established in a prospective study with clinical outcomes as the endpoint.";

  it("accepts an exact substring", () => {
    expect(verifyQuote(body, "clinical validity has been established").ok).toBe(true);
  });

  it("accepts across collapsed whitespace and newlines", () => {
    const messy = "clinical   validity\n has  been\testablished";
    expect(verifyQuote(body, messy).ok).toBe(true);
  });

  it("accepts across smart quotes and em-dashes", () => {
    const src = "Coverage requires a “prospective” study—no exceptions.";
    expect(verifyQuote(src, '"prospective" study-no exceptions').ok).toBe(true);
  });

  it("accepts across a non-breaking space", () => {
    const src = "must be prospective";
    expect(verifyQuote(src, "must be prospective").ok).toBe(true);
  });

  it("rejects text that is not present (the whole point)", () => {
    const r = verifyQuote(body, "retrospective chart review is sufficient");
    expect(r.ok).toBe(false);
  });

  it("rejects an empty or trivially short quote", () => {
    expect(verifyQuote(body, "").ok).toBe(false);
    expect(verifyQuote(body, "a").ok).toBe(false);
  });
});

describe("locateQuote", () => {
  it("returns exact original offsets even when whitespace differs", () => {
    const text = "Alpha   beta   gamma delta";
    const loc = locateQuote(text, "beta gamma");
    expect(loc).not.toBeNull();
    expect(text.slice(loc!.start, loc!.end)).toBe("beta   gamma");
  });

  it("maps offsets correctly after a non-breaking space", () => {
    const text = "requires prospective evidence";
    const loc = locateQuote(text, "prospective evidence");
    expect(text.slice(loc!.start, loc!.end)).toBe("prospective evidence");
  });

  it("returns null when the quote is absent", () => {
    expect(locateQuote("nothing to see here", "coverage criteria")).toBeNull();
  });
});

describe("buildNormalized index map", () => {
  it("keeps map length one longer than norm and ends at original length", () => {
    const { norm, map } = buildNormalized("a  b");
    expect(map.length).toBe(norm.length + 1);
    expect(map[map.length - 1]).toBe(4);
  });
});

describe("makeVerifiedCriterion — the guarded constructor", () => {
  const s = span("Documentation of prior anti-EGFR therapy is required for coverage.");
  const meta = { id: "crit_1", extractedByModel: "test", extractedAt: "2026-01-01T00:00:00Z" };

  it("constructs a criterion when the quote verifies", () => {
    const r = makeVerifiedCriterion(
      {
        kind: "prior_therapy",
        subject: "prior anti-EGFR therapy",
        requirementText: "Prior anti-EGFR therapy must be documented.",
        verbatimQuote: "prior anti-EGFR therapy is required",
        confidence: 0.9,
      },
      s,
      meta,
    );
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.value.spanId).toBe("span_1");
      expect(r.value.verbatimQuote).toContain("anti-EGFR");
    }
  });

  it("REJECTS (never repairs) a criterion whose quote is not in the span", () => {
    const r = makeVerifiedCriterion(
      {
        kind: "prior_therapy",
        subject: "prior chemotherapy",
        requirementText: "Two lines of chemotherapy required.",
        verbatimQuote: "two prior lines of systemic chemotherapy are required",
        confidence: 0.95,
      },
      s,
      meta,
    );
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.rejection.spanId).toBe("span_1");
      expect(r.rejection.rejectionReason).toMatch(/not found/);
    }
  });
});
