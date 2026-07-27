import { describe, it, expect } from "vitest";
import { openLocalDb, loadCorpus, searchCorpus, toFtsQuery, getDocumentSpans, countCorpus } from "./index";
import type { CorpusData } from "./index";

function fixture(): CorpusData {
  return {
    payers: [{ id: "moldx", name: "MolDX", type: "mac", parentPayerId: null }],
    coveredLives: [],
    codes: [{ id: "c1", system: "CPT", code: "81479", description: "Unlisted molecular pathology" }],
    documents: [{
      id: "doc1", payerId: "moldx", externalId: "L38045", title: "MolDX: Test",
      url: "http://x", effectiveDate: "2025-01-01", retrievedAt: "2025-01-01T00:00:00Z",
      contentHash: "h1", supersedesId: null, rawStoragePath: "raw/1",
    }],
    spans: [
      { id: "s1", policyDocumentId: "doc1", ordinal: 0, pageNumber: 1, charStart: 0, charEnd: 60,
        text: "Clinical utility must be demonstrated in a prospective study.", headingPath: ["Coverage"] },
      { id: "s2", policyDocumentId: "doc1", ordinal: 1, pageNumber: 1, charStart: 60, charEnd: 120,
        text: "Analytical validity is established via concordance testing.", headingPath: ["Coverage"] },
    ],
    criteria: [{
      id: "cr1", policyDocumentId: "doc1", kind: "clinical_utility", subject: "clinical utility",
      requirementText: "Clinical utility shown prospectively.", operator: null, value: null, unit: null,
      evidence: { studyDesign: "prospective" }, spanId: "s1",
      verbatimQuote: "Clinical utility must be demonstrated in a prospective study",
      confidence: 0.9, extractedByModel: "test", extractedAt: "2025-01-01T00:00:00Z",
    }],
    stances: [],
    changes: [],
    codeLinks: [{ policyDocumentId: "doc1", codeId: "c1", relationship: "covers" }],
  };
}

describe("local-db", () => {
  it("loads a corpus and counts it", () => {
    const db = openLocalDb();
    loadCorpus(db, fixture());
    expect(countCorpus(db)).toEqual({ documents: 1, spans: 2, criteria: 1 });
  });

  it("searches spans AND criteria by full text", () => {
    const db = openLocalDb();
    loadCorpus(db, fixture());
    const hits = searchCorpus(db, "prospective");
    const types = hits.map((h) => h.sourceType).sort();
    // Both the span and the criterion mention "prospective".
    expect(types).toContain("span");
    expect(types).toContain("criterion");
    expect(hits[0]!.snippet).toContain("⟦");
  });

  it("filters by payer and source type", () => {
    const db = openLocalDb();
    loadCorpus(db, fixture());
    expect(searchCorpus(db, "validity", { sourceType: "span" }).length).toBe(1);
    expect(searchCorpus(db, "validity", { payerId: "nope" }).length).toBe(0);
  });

  it("re-loading the same corpus is idempotent", () => {
    const db = openLocalDb();
    loadCorpus(db, fixture());
    loadCorpus(db, fixture());
    expect(countCorpus(db)).toEqual({ documents: 1, spans: 2, criteria: 1 });
  });

  it("sanitizes FTS queries with punctuation", () => {
    expect(toFtsQuery('anti-EGFR "therapy"')).toBe('"anti-EGFR" AND "therapy"');
    expect(toFtsQuery("MolDX*")).toBe('"MolDX"*');
    const db = openLocalDb();
    loadCorpus(db, fixture());
    // Must not throw on punctuation.
    expect(() => searchCorpus(db, 'utility; (prospective)')).not.toThrow();
  });

  it("reads spans back with heading paths parsed", () => {
    const db = openLocalDb();
    loadCorpus(db, fixture());
    const spans = getDocumentSpans(db, "doc1");
    expect(spans[0]!.headingPath).toEqual(["Coverage"]);
  });
});
