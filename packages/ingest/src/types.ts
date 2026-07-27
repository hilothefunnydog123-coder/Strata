import type { PolicyCodeRelationship } from "@assent/core";

export type PipelineMode = "fixture" | "live";

export function pipelineMode(): PipelineMode {
  return process.env.PIPELINE_MODE === "live" ? "live" : "fixture";
}

export interface RawCodeLink {
  code: string;
  relationship: PolicyCodeRelationship;
}

/** A fetched document, raw bytes preserved before any processing (PROMPT §6). */
export interface RawDocument {
  source: string;
  payerId: string;
  externalId: string;
  version: number;
  title: string;
  url: string;
  effectiveDate: string;
  contentType: "html" | "pdf";
  bytes: Uint8Array;
  contentHash: string;
  rawStoragePath: string;
  supersedesExternalVersion: number | null;
  codes: RawCodeLink[];
  /** Marks documents synthesized to reach corpus scale (never in the golden set). */
  syntheticScale?: boolean;
}

export type SourceAccess = "structured" | "html" | "pdf" | "mixed";

export interface SourceMeta {
  id: string;
  name: string;
  /** How the live source is reached — informs the fetcher and the crawl posture. */
  access: SourceAccess;
  baseUrl: string;
  /**
   * Live crawling of this source is only allowed after a human confirms its ToS
   * permits it (commercial payers default false). Fixture mode ignores this.
   */
  liveAllowed: boolean;
}
