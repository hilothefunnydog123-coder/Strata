import { existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

/** Locate the committed /fixtures directory (env override, else walk up). */
export function findFixturesDir(): string {
  if (process.env.ASSENT_FIXTURES_DIR) return process.env.ASSENT_FIXTURES_DIR;
  const starts = [process.cwd(), dirname(fileURLToPath(import.meta.url))];
  for (const start of starts) {
    let dir = start;
    for (let i = 0; i < 8; i++) {
      if (existsSync(join(dir, "fixtures", "manifest.json"))) return join(dir, "fixtures");
      const parent = dirname(dir);
      if (parent === dir) break;
      dir = parent;
    }
  }
  throw new Error("Could not locate the fixtures/ directory. Set ASSENT_FIXTURES_DIR.");
}

export function pipelineMode(): "fixture" | "live" {
  return process.env.PIPELINE_MODE === "live" ? "live" : "fixture";
}
