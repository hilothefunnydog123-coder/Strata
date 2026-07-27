import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { findFixturesDir } from "./paths";
import type { ExtractionCriterion, ExtractionStance } from "@assent/core";

/**
 * The offline model provider. In fixture mode the "model output" for a span is the
 * hand-labeled golden extraction — a real, human-authored label, not a fabrication.
 * Crucially it flows through the SAME schema-parse + verify path as a live model
 * response, so the citation invariant is enforced identically. Spans with no entry
 * yield an empty result, which is the correct answer for most spans.
 */
export interface GoldenSpanEntry {
  source: string;
  externalId: string;
  version: number;
  ordinal: number;
  note?: string;
  criteria: ExtractionCriterion[];
  stances: ExtractionStance[];
}

let cache: Map<string, GoldenSpanEntry> | null = null;

function key(source: string, externalId: string, version: number, ordinal: number): string {
  return `${source}|${externalId}|${version}|${ordinal}`;
}

export function loadGoldenExtractions(dir = findFixturesDir()): GoldenSpanEntry[] {
  const path = join(dir, "golden", "extraction.json");
  if (!existsSync(path)) return [];
  return JSON.parse(readFileSync(path, "utf8")) as GoldenSpanEntry[];
}

export function goldenFor(
  source: string,
  externalId: string,
  version: number,
  ordinal: number,
): { criteria: ExtractionCriterion[]; stances: ExtractionStance[] } {
  if (!cache) {
    cache = new Map();
    for (const e of loadGoldenExtractions()) cache.set(key(e.source, e.externalId, e.version, e.ordinal), e);
  }
  const hit = cache.get(key(source, externalId, version, ordinal));
  return hit ? { criteria: hit.criteria, stances: hit.stances } : { criteria: [], stances: [] };
}

/** Reset the memoized golden cache (tests). */
export function _resetGoldenCache(): void {
  cache = null;
}
