/**
 * Covered-lives weighting. A criterion from a payer covering 40M lives is not
 * equal to one covering 200K. The denominator MUST always be labeled — "68% of
 * covered lives" is meaningless without stating which denominator (PROMPT §6).
 */

export const PAYER_TYPES = ["commercial", "mac", "medicaid", "ma"] as const;
export type PayerType = (typeof PAYER_TYPES)[number];

/**
 * The denominator a percentage is computed against. Rendering code must show this
 * label next to any lives percentage.
 */
export const LIVES_DENOMINATORS = [
  "modeled_corpus", // sum of covered lives across the 8 v0 sources
  "us_insured", // all US insured lives (KFF)
  "addressable", // lives whose plan/indication could plausibly use this test
] as const;
export type LivesDenominator = (typeof LIVES_DENOMINATORS)[number];

export const LIVES_DENOMINATOR_LABEL: Record<LivesDenominator, string> = {
  modeled_corpus: "of covered lives in the modeled corpus",
  us_insured: "of all US insured lives",
  addressable: "of the addressable population for this indication",
};

export interface LivesFigure {
  lives: number;
  denominator: LivesDenominator;
  total: number;
}

/** Format a lives figure as a labeled percentage, e.g. "61% of covered lives in the modeled corpus". */
export function formatLivesPct(f: LivesFigure): string {
  const pct = f.total > 0 ? Math.round((f.lives / f.total) * 100) : 0;
  return `${pct}% ${LIVES_DENOMINATOR_LABEL[f.denominator]}`;
}

export function livesPct(lives: number, total: number): number {
  return total > 0 ? lives / total : 0;
}

/** Compact human number: 41200000 → "41.2M", 210000 → "210K". */
export function formatLives(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(n % 1_000_000 === 0 ? 0 : 1)}M`;
  if (n >= 1_000) return `${Math.round(n / 1_000)}K`;
  return `${n}`;
}
