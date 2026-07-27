/**
 * Coverage stance — a payer's position on a code, distinct from a Criterion.
 * Stance drives the Coverage Map colors. Its hues are reserved (see docs/DESIGN.md)
 * and MUST NOT be reused for anything else in the UI. "silent" is deliberately
 * present and expected to dominate: showing that grey honestly is the point.
 */
export const COVERAGE_STANCES = [
  "covered",
  "conditional",
  "investigational",
  "not_covered",
  "silent",
] as const;

export type CoverageStance = (typeof COVERAGE_STANCES)[number];

export const COVERAGE_STANCE_LABEL: Record<CoverageStance, string> = {
  covered: "Covered",
  conditional: "Conditional",
  investigational: "Investigational / experimental",
  not_covered: "Not covered",
  silent: "Silent",
};

/** Ordering from strongest positive coverage to no position. */
export const COVERAGE_STANCE_RANK: Record<CoverageStance, number> = {
  covered: 0,
  conditional: 1,
  investigational: 2,
  not_covered: 3,
  silent: 4,
};

export function isCoverageStance(x: unknown): x is CoverageStance {
  return typeof x === "string" && (COVERAGE_STANCES as readonly string[]).includes(x);
}

/** Change classification for the diff stage. Hues reserved for the diff surface only. */
export const CHANGE_TYPES = ["added", "removed", "tightened", "loosened", "clarified"] as const;
export type ChangeType = (typeof CHANGE_TYPES)[number];

export const CHANGE_TYPE_LABEL: Record<ChangeType, string> = {
  added: "Added",
  removed: "Removed",
  tightened: "Tightened",
  loosened: "Loosened",
  clarified: "Clarified",
};

/** Does this change make coverage harder (tightened/removed) or easier (loosened/added)? */
export function changeDirection(t: ChangeType): "harder" | "easier" | "neutral" {
  switch (t) {
    case "tightened":
    case "removed":
      return "harder";
    case "loosened":
    case "added":
      return "easier";
    case "clarified":
      return "neutral";
  }
}
