import { readFileSync, existsSync } from "node:fs";
import { resolve, dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { sha256 } from "@assent/parse";
import type { Payer, CoveredLives, Code } from "@assent/core";
import type { RawDocument, RawCodeLink } from "./types";

export interface ManifestEntry {
  source: string;
  payerId: string;
  externalId: string;
  version: number;
  title: string;
  url: string;
  effectiveDate: string;
  file: string;
  supersedesFile: string | null;
  codes: RawCodeLink[];
}

/** Locate the committed /fixtures directory (env override, else walk up). */
export function findFixturesDir(): string {
  if (process.env.ASSENT_FIXTURES_DIR) return process.env.ASSENT_FIXTURES_DIR;
  const starts = [process.cwd(), dirname(fileURLToPath(import.meta.url))];
  for (const start of starts) {
    let dir = start;
    for (let i = 0; i < 8; i++) {
      const candidate = join(dir, "fixtures", "manifest.json");
      if (existsSync(candidate)) return join(dir, "fixtures");
      const parent = dirname(dir);
      if (parent === dir) break;
      dir = parent;
    }
  }
  throw new Error("Could not locate the fixtures/ directory. Set ASSENT_FIXTURES_DIR.");
}

function readJson<T>(dir: string, name: string): T {
  return JSON.parse(readFileSync(join(dir, name), "utf8")) as T;
}

export function loadManifest(dir = findFixturesDir()): ManifestEntry[] {
  return readJson<ManifestEntry[]>(dir, "manifest.json");
}
export function loadPayers(dir = findFixturesDir()): Payer[] {
  return readJson<Payer[]>(dir, "payers.json");
}
export function loadCoveredLives(dir = findFixturesDir()): CoveredLives[] {
  return readJson<CoveredLives[]>(dir, "covered-lives.json");
}
export function loadCodes(dir = findFixturesDir()): Code[] {
  return readJson<Array<Omit<Code, "id">>>(dir, "codes.json").map((c) => ({
    id: `${c.system}:${c.code}`,
    ...c,
  }));
}

/** Build RawDocuments for a source (or all) from the committed fixtures. */
export function loadFixtureRawDocuments(sourceId?: string, dir = findFixturesDir()): RawDocument[] {
  const manifest = loadManifest(dir);
  const byFile = new Map(manifest.map((m) => [m.file, m]));
  const out: RawDocument[] = [];
  for (const m of manifest) {
    if (sourceId && m.source !== sourceId) continue;
    const path = resolve(dir, m.file);
    const bytes = readFileSync(path);
    const supersedes = m.supersedesFile ? byFile.get(m.supersedesFile) ?? null : null;
    out.push({
      source: m.source,
      payerId: m.payerId,
      externalId: m.externalId,
      version: m.version,
      title: m.title,
      url: m.url,
      effectiveDate: m.effectiveDate,
      contentType: m.file.endsWith(".pdf") ? "pdf" : "html",
      bytes: new Uint8Array(bytes),
      contentHash: sha256(bytes),
      rawStoragePath: path,
      supersedesExternalVersion: supersedes ? supersedes.version : null,
      codes: m.codes,
      // Committed fixtures are reconstructions, never real fetched documents.
      provenance: "sample",
    });
  }
  // Stable order: by source, external id, version.
  out.sort((a, b) =>
    a.source.localeCompare(b.source) ||
    a.externalId.localeCompare(b.externalId) ||
    a.version - b.version,
  );
  return out;
}
