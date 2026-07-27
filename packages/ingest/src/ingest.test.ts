import { describe, it, expect, beforeEach } from "vitest";
import { ingestSource, ingestAll } from "./ingest";
import { loadFixtureRawDocuments, loadPayers, loadCoveredLives } from "./fixtures";
import { parseRobots, isAllowed } from "./robots";

beforeEach(() => {
  process.env.PIPELINE_MODE = "fixture";
});

describe("fixture ingest", () => {
  it("loads all 8 sources with committed fixtures", async () => {
    const all = await ingestAll();
    const sources = new Set(all.map((d) => d.source));
    expect(sources.size).toBe(8);
    expect(all.length).toBeGreaterThanOrEqual(9);
  });

  it("preserves raw bytes and computes a content hash", async () => {
    const docs = await ingestSource("moldx");
    expect(docs.length).toBe(2); // v1 + v2
    expect(docs[0]!.contentHash).toMatch(/^[0-9a-f]{64}$/);
    expect(docs[0]!.bytes.byteLength).toBeGreaterThan(100);
  });

  it("links a revised version to the one it supersedes", async () => {
    const docs = await ingestSource("moldx");
    const v2 = docs.find((d) => d.version === 2)!;
    expect(v2.supersedesExternalVersion).toBe(1);
  });

  it("re-ingesting yields identical content hashes (idempotency signal)", async () => {
    const a = loadFixtureRawDocuments("aetna")[0]!;
    const b = loadFixtureRawDocuments("aetna")[0]!;
    expect(a.contentHash).toBe(b.contentHash);
  });

  it("filters by --since on effective date", async () => {
    const recent = await ingestSource("moldx", { since: "2024-01-01" });
    expect(recent.every((d) => d.effectiveDate >= "2024-01-01")).toBe(true);
    expect(recent.length).toBe(1); // only v2 (2024-09-15)
  });

  it("has hand-curated covered lives with source URLs for every payer", () => {
    const payers = loadPayers();
    const lives = loadCoveredLives();
    for (const p of payers) {
      const row = lives.find((l) => l.payerId === p.id);
      expect(row, `covered lives for ${p.id}`).toBeTruthy();
      expect(row!.sourceUrl).toMatch(/^https?:\/\//);
    }
  });
});

describe("live mode guardrails", () => {
  it("refuses live ingest of a commercial payer until its ToS is confirmed", async () => {
    process.env.PIPELINE_MODE = "live";
    await expect(ingestSource("aetna")).rejects.toThrow(/Terms of Use|disabled/i);
    process.env.PIPELINE_MODE = "fixture";
  });
});

describe("robots.txt checker", () => {
  const rules = parseRobots(`
    User-agent: *
    Disallow: /private/
    Allow: /private/public/

    User-agent: AssentBot
    Disallow: /
  `);
  it("applies the most specific agent group (fail-closed for our bot)", () => {
    expect(isAllowed(rules, "AssentBot/0.1", "/anything")).toBe(false);
  });
  it("honors Allow overriding a less specific Disallow for other agents", () => {
    expect(isAllowed(rules, "SomeOtherBot", "/private/public/x")).toBe(true);
    expect(isAllowed(rules, "SomeOtherBot", "/private/secret")).toBe(false);
  });
});
