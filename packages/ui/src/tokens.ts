import type { CoverageStance, ChangeType } from "@assent/core";

/**
 * The design tokens (docs/DESIGN.md). Color carries meaning and never decorates.
 * These three groups do not overlap: a user can read state from color alone
 * because no hue means two things.
 */

/** Neutral paper + chrome. Carries all decoration. No meaning. */
export const NEUTRAL = {
  paper: "#FBFAF7",
  ink: "#1A1A17",
  chrome900: "#14161A",
  chrome700: "#2A2E35",
  chrome500: "#5B626E",
  chrome300: "#AEB2B9",
  chrome200: "#D9DBDE",
  chrome100: "#E9E9E5",
  chrome050: "#F1F1EE",
} as const;

/** Coverage stance scale — RESERVED. Appears only on stance. */
export const COVERAGE_COLOR: Record<CoverageStance, string> = {
  covered: "#2E7D57",
  conditional: "#B9822B",
  investigational: "#7A5CA8",
  not_covered: "#B23B3B",
  silent: "#9AA0A8",
};

/** Change-direction scale — RESERVED. Appears only on diffs. */
export const CHANGE_COLOR: Record<ChangeType, string> = {
  tightened: "#B23B3B",
  loosened: "#2E7D57",
  added: "#2B5F8A",
  removed: "#5B626E",
  clarified: "#9AA0A8",
};

/** Signature accent — RESERVED for the citation highlight and nothing else. */
export const CITATION = {
  accent: "#2B5F8A",
  wash: "#FFF3C4", // highlighter amber
  washDark: "#6b5a13",
} as const;

export const FONTS = {
  serif: '"Source Serif 4", Georgia, "Times New Roman", serif',
  sans: 'Inter, ui-sans-serif, system-ui, -apple-system, "Segoe UI", sans-serif',
  mono: '"IBM Plex Mono", ui-monospace, "SF Mono", Menlo, Consolas, monospace',
} as const;

/** Emit the token set as CSS custom properties (used by styles.css / :root). */
export function cssVariables(): string {
  const lines: string[] = [];
  for (const [k, v] of Object.entries(NEUTRAL)) lines.push(`  --a-${kebab(k)}: ${v};`);
  for (const [k, v] of Object.entries(COVERAGE_COLOR)) lines.push(`  --a-stance-${k}: ${v};`);
  for (const [k, v] of Object.entries(CHANGE_COLOR)) lines.push(`  --a-change-${k}: ${v};`);
  lines.push(`  --a-citation: ${CITATION.accent};`);
  lines.push(`  --a-citation-wash: ${CITATION.wash};`);
  lines.push(`  --a-font-serif: ${FONTS.serif};`);
  lines.push(`  --a-font-sans: ${FONTS.sans};`);
  lines.push(`  --a-font-mono: ${FONTS.mono};`);
  return `:root {\n${lines.join("\n")}\n}`;
}

function kebab(s: string): string {
  return s.replace(/([a-z])([0-9])/g, "$1-$2").replace(/([A-Z])/g, (m) => `-${m.toLowerCase()}`);
}
