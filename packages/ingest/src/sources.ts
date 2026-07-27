import type { SourceMeta } from "./types";

/**
 * The 8 v0 sources (PROMPT §2), with the crawl posture resolved in PRE-BUILD §1–2.
 * CMS + MolDX are public-domain / structured and safe to ingest broadly. The six
 * commercial payers default to liveAllowed=false: a human must confirm each one's
 * Terms of Use before live crawling; until then they run from committed fixtures.
 */
export const SOURCES: Record<string, SourceMeta> = {
  cms: {
    id: "cms",
    name: "CMS — Medicare Coverage Database (NCD + LCD)",
    access: "structured",
    baseUrl: "https://www.cms.gov/medicare-coverage-database",
    liveAllowed: true,
  },
  moldx: {
    id: "moldx",
    name: "MolDX / Palmetto GBA",
    access: "mixed",
    baseUrl: "https://www.palmettogba.com/moldx",
    liveAllowed: true,
  },
  aetna: { id: "aetna", name: "Aetna (CVS Health)", access: "html", baseUrl: "https://www.aetna.com", liveAllowed: false },
  cigna: { id: "cigna", name: "Cigna", access: "pdf", baseUrl: "https://www.cigna.com", liveAllowed: false },
  uhc: { id: "uhc", name: "UnitedHealthcare", access: "pdf", baseUrl: "https://www.uhcprovider.com", liveAllowed: false },
  elevance: { id: "elevance", name: "Elevance (Anthem)", access: "mixed", baseUrl: "https://www.elevancehealth.com", liveAllowed: false },
  bcbsmi: { id: "bcbsmi", name: "BCBS Michigan", access: "html", baseUrl: "https://www.bcbsm.com", liveAllowed: false },
  humana: { id: "humana", name: "Humana", access: "mixed", baseUrl: "https://www.humana.com", liveAllowed: false },
};

export function allSourceIds(): string[] {
  return Object.keys(SOURCES);
}

export function requireSource(id: string): SourceMeta {
  const s = SOURCES[id];
  if (!s) throw new Error(`Unknown source "${id}". Known: ${allSourceIds().join(", ")}`);
  return s;
}
