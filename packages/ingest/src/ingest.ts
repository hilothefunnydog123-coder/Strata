import type { RawDocument } from "./types";
import { pipelineMode } from "./types";
import { requireSource, allSourceIds } from "./sources";
import { loadFixtureRawDocuments } from "./fixtures";

/** v0 scope filter: molecular oncology diagnostics (PROMPT §2). */
export const MOLECULAR_ONCOLOGY =
  /sequenc|genomic|molecular|biomarker|oncolog|tumor|cancer|neoplas|gene panel|circulating tumor/i;

export interface IngestOptions {
  since?: string; // ISO date; keep docs with effectiveDate >= since
}

/**
 * Ingest one source. In fixture mode this reads committed snapshots (zero network).
 * In live mode it enforces the crawl posture and would fetch the real documents;
 * commercial sources are gated behind liveAllowed and fail loudly until enabled
 * (never silently mocked — PROMPT §10).
 */
export async function ingestSource(sourceId: string, opts: IngestOptions = {}): Promise<RawDocument[]> {
  const source = requireSource(sourceId);
  const mode = pipelineMode();

  if (mode === "fixture") {
    let docs = loadFixtureRawDocuments(sourceId);
    if (opts.since) docs = docs.filter((d) => d.effectiveDate >= opts.since!);
    return docs;
  }

  // live mode — CMS is a US government work and needs no licensing review, so it
  // is the source that actually runs today.
  if (sourceId === "cms") {
    const { ingestCms } = await import("./sources/cms");
    return ingestCms({ kind: "ncd", since: opts.since, filter: MOLECULAR_ONCOLOGY });
  }

  if (!source.liveAllowed) {
    throw new Error(
      `Live ingest for "${sourceId}" is disabled. Its Terms of Use must be confirmed to permit ` +
        `automated access before enabling (see PRE-BUILD §2). Set SOURCES.${sourceId}.liveAllowed=true ` +
        `only after that review. Until then this source runs from committed fixtures.`,
    );
  }
  throw new Error(
    `Live crawler for "${sourceId}" is not implemented in this build. The fetch/robots/rate-limit ` +
      `primitives exist (robots.ts, rate-limit.ts); wiring the source's document index is the remaining ` +
      `step. Run in PIPELINE_MODE=fixture for offline development.`,
  );
}

export async function ingestAll(opts: IngestOptions = {}): Promise<RawDocument[]> {
  const out: RawDocument[] = [];
  for (const id of allSourceIds()) {
    if (pipelineMode() === "live" && !requireSource(id).liveAllowed) continue;
    out.push(...(await ingestSource(id, opts)));
  }
  return out;
}
