import { describe, it, expect, beforeAll } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { parseHtmlToSpans } from "@assent/parse";
import type { DocumentSpan } from "@assent/core";
import { extractDocument, diffVersions } from "./index";
import { makePolicyDocId, makeSpanId } from "./identity";
import { findFixturesDir } from "./paths";

process.env.PIPELINE_MODE = "fixture";

function spansFor(source: string, file: string, externalId: string, version: number): {
  spans: DocumentSpan[];
  ctx: { source: string; externalId: string; version: number; documentTitle: string; resolveCode: (c: string) => string; documentCodes: string[] };
} {
  const dir = findFixturesDir();
  const html = readFileSync(join(dir, file), "utf8");
  const parsed = parseHtmlToSpans(html);
  const docId = makePolicyDocId(source, externalId, version);
  const spans: DocumentSpan[] = parsed.spans.map((s) => ({
    id: makeSpanId(docId, s.ordinal),
    policyDocumentId: docId,
    ordinal: s.ordinal,
    pageNumber: s.pageNumber,
    charStart: s.charStart,
    charEnd: s.charEnd,
    text: s.text,
    headingPath: s.headingPath,
  }));
  return {
    spans,
    ctx: { source, externalId, version, documentTitle: "Test", resolveCode: (c: string) => `CODE:${c}`, documentCodes: ["81445"] },
  };
}

describe("extractDocument (MolDX L38045 v1)", () => {
  const { spans, ctx } = spansFor("moldx", "moldx/L38045-v1.html", "L38045", 1);
  let result: Awaited<ReturnType<typeof extractDocument>>;
  beforeAll(async () => { result = await extractDocument(spans, ctx); });

  it("extracts the AV/CV/CU triad plus indication and exclusions", () => {
    const kinds = new Set(result.criteria.map((c) => c.kind));
    for (const k of ["analytical_validity", "clinical_validity", "clinical_utility", "clinical_indication", "exclusion"]) {
      expect(kinds.has(k as never), `missing ${k}`).toBe(true);
    }
  });

  it("EVERY extracted criterion carries a verified quote — rejection rate is 0", () => {
    expect(result.rejections).toHaveLength(0);
    expect(result.rejectionRate).toBe(0);
    for (const c of result.criteria) {
      const span = spans.find((s) => s.id === c.spanId)!;
      expect(span.text.includes(c.verbatimQuote) || span.text.replace(/\s+/g, " ").includes(c.verbatimQuote)).toBe(true);
    }
  });

  it("does not over-extract from background / lead-in spans", () => {
    const background = spans.find((s) => s.headingPath.includes("Background"))!;
    expect(result.criteria.some((c) => c.spanId === background.id)).toBe(false);
  });

  it("captures a conditional coverage stance with its citation", () => {
    expect(result.stances.length).toBeGreaterThanOrEqual(1);
    expect(result.stances[0]!.stance).toBe("conditional");
    expect(result.stances[0]!.verbatimQuote.length).toBeGreaterThan(5);
  });
});

describe("diffVersions (L38045 v1 → v2)", () => {
  it("produces all five change types with the labeled directions", async () => {
    const v1 = spansFor("moldx", "moldx/L38045-v1.html", "L38045", 1);
    const v2 = spansFor("moldx", "moldx/L38045-v2.html", "L38045", 2);
    const r1 = await extractDocument(v1.spans, v1.ctx);
    const r2 = await extractDocument(v2.spans, v2.ctx);
    const changes = await diffVersions(r1.criteria, r2.criteria, makePolicyDocId("moldx", "L38045", 2), "fixture");
    const byType = new Map(changes.map((c) => [c.changeType, c]));

    expect(byType.get("tightened")).toBeTruthy();
    expect(byType.get("loosened")).toBeTruthy();
    expect(byType.get("clarified")).toBeTruthy();
    expect(byType.get("added")).toBeTruthy();
    expect(byType.get("removed")).toBeTruthy();

    // Sanity: the tightened change is clinical utility; the loosened one is the frequency limit.
    // (found by matching the criterion each change points at)
    const tightenedTo = r2.criteria.find((c) => c.id === byType.get("tightened")!.toCriterionId);
    expect(tightenedTo!.kind).toBe("clinical_utility");
    const removedFrom = r1.criteria.find((c) => c.id === byType.get("removed")!.fromCriterionId);
    expect(removedFrom!.kind).toBe("exclusion");
  });
});
