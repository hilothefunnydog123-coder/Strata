import type { Payer, CoveredLives } from "@assent/core";

/** Latest-year covered lives per payer, and the modeled-corpus total. */
export function livesByPayer(payers: Payer[], coveredLives: CoveredLives[]): {
  byPayer: Map<string, number>;
  total: number;
} {
  const latest = new Map<string, CoveredLives>();
  for (const row of coveredLives) {
    const cur = latest.get(row.payerId);
    if (!cur || row.year > cur.year) latest.set(row.payerId, row);
  }
  const byPayer = new Map<string, number>();
  let total = 0;
  for (const p of payers) {
    const lives = latest.get(p.id)?.livesCount ?? 0;
    byPayer.set(p.id, lives);
    total += lives;
  }
  return { byPayer, total };
}

export function sumLives(payerIds: Iterable<string>, byPayer: Map<string, number>): number {
  let total = 0;
  for (const id of payerIds) total += byPayer.get(id) ?? 0;
  return total;
}
