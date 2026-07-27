/** The M1–M8 module registry — the single source the rail, topbar and command
 *  palette all read, so nav stays consistent. M7/M8 ship disabled (PROMPT §7). */
export interface ModuleDef {
  id: string;
  num: string;
  path: string;
  label: string;
  blurb: string;
  enabled: boolean;
}

export const MODULES: ModuleDef[] = [
  { id: "corpus", num: "M1", path: "/corpus", label: "Corpus", blurb: "Every policy, one dense index", enabled: true },
  { id: "criteria", num: "M2", path: "/criteria", label: "Criteria Rail", blurb: "Source document ↔ extracted criteria", enabled: true },
  { id: "asset", num: "M3", path: "/asset", label: "Asset Workspace", blurb: "Define the program you are modeling", enabled: true },
  { id: "coverage", num: "M4", path: "/coverage", label: "Coverage Map", blurb: "Every payer, weighted by covered lives", enabled: true },
  { id: "blueprint", num: "M5", path: "/blueprint", label: "Evidence Blueprint", blurb: "Requirement clusters and the lives they unlock", enabled: true },
  { id: "changes", num: "M6", path: "/changes", label: "Change Watch", blurb: "Criterion-level policy diffs", enabled: true },
  { id: "library", num: "M7", path: "/library", label: "Evidence Library", blurb: "Your studies, mapped to requirements", enabled: false },
  { id: "campaign", num: "M8", path: "/campaign", label: "Campaign Board", blurb: "Payer engagement pipeline", enabled: false },
];

export function moduleForPath(pathname: string): ModuleDef | undefined {
  // Longest-prefix match so /criteria/:docId still resolves to the M2 module.
  return [...MODULES]
    .filter((m) => pathname === m.path || pathname.startsWith(m.path + "/"))
    .sort((a, b) => b.path.length - a.path.length)[0];
}
