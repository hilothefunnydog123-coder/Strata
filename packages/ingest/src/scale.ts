import { sha256 } from "@assent/parse";
import type { RawDocument } from "./types";
import { allSourceIds } from "./sources";
import { loadPayers } from "./fixtures";

/**
 * Synthesize structurally-real documents to reach corpus scale (PROMPT M9's ≥300
 * documents, M8's search). These are deterministic templated policies clearly
 * marked syntheticScale — they exercise ingest/parse/search/versioning at volume
 * but NEVER enter the golden set.
 */
const TOPICS = [
  ["Comprehensive Genomic Profiling", "81445"],
  ["Circulating Tumor DNA Analysis", "0239U"],
  ["Hereditary Cancer Panel", "81479"],
  ["Minimal Residual Disease Monitoring", "0239U"],
  ["Pharmacogenomic Panel", "81479"],
  ["Solid Tumor Expression Profiling", "81445"],
] as const;

function templateHtml(payerName: string, topic: string, n: number): string {
  return `<html><body><main>
  <h1>${payerName}: ${topic} (Policy S-${n})</h1>
  <h2>Coverage Indications, Limitations, and/or Medical Necessity</h2>
  <p>${topic} is considered medically necessary for members with advanced or metastatic solid tumor cancer when the treating physician will use the result to guide systemic therapy selection.</p>
  <p>Testing must be performed in a CLIA-certified laboratory and is limited to one assay per primary tumor diagnosis absent documented progression.</p>
  <h2>Limitations</h2>
  <p>${topic} is considered investigational when used for screening of asymptomatic individuals, as clinical utility has not been established in prospective studies.</p>
  <h2>Background</h2>
  <p>This background section summarizes representative literature and is provided for context only; it does not establish the coverage criteria above.</p>
  </main></body></html>`;
}

export function generateScaleDocuments(count: number): RawDocument[] {
  const payers = loadPayers();
  const payerById = new Map(payers.map((p) => [p.id, p]));
  const sources = allSourceIds();
  const out: RawDocument[] = [];
  for (let i = 0; i < count; i++) {
    const source = sources[i % sources.length]!;
    const payer = payerById.get(source)!;
    const [topic, code] = TOPICS[i % TOPICS.length]!;
    const html = templateHtml(payer.name, topic, i);
    const bytes = new TextEncoder().encode(html);
    out.push({
      source,
      payerId: source,
      externalId: `S-${1000 + i}`,
      version: 1,
      title: `${payer.name}: ${topic} (S-${1000 + i})`,
      url: `https://example.invalid/${source}/S-${1000 + i}`,
      effectiveDate: "2024-01-01",
      contentType: "html",
      bytes,
      contentHash: sha256(bytes),
      rawStoragePath: `synthetic-scale/${source}/S-${1000 + i}.html`,
      supersedesExternalVersion: null,
      codes: [{ code, relationship: "covers" }],
      syntheticScale: true,
    });
  }
  return out;
}
