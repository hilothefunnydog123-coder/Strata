import type { RequirementCluster, FrontierStep, Payer } from "@assent/core";
import { formatLives } from "@assent/core";
import { sumLives } from "./lives";
import { costHint } from "./strictness";

/**
 * Synthesize the evidence frontier (PROMPT §6.6). Not a single answer — a path.
 * A payer is unlocked when the design satisfies every requirement cluster that
 * payer demands. We add clusters from most-common/easiest to rarest/hardest and
 * record the marginal lives unlocked at each step where a payer becomes fully
 * covered. The framing converts an unknowable strategic question into a
 * cost/benefit decision a CEO can make.
 */
export interface FrontierResult {
  frontier: FrontierStep[];
  narrative: string;
}

export function synthesizeFrontier(
  clusters: RequirementCluster[],
  byPayer: Map<string, number>,
  totalLives: number,
  payers: Payer[],
): FrontierResult {
  const payerName = new Map(payers.map((p) => [p.id, p.name]));
  const allPayerIds = new Set(clusters.flatMap((c) => c.payerIds));

  // What each payer demands.
  const demanded = new Map<string, Set<string>>();
  for (const p of allPayerIds) demanded.set(p, new Set());
  for (const c of clusters) for (const p of c.payerIds) demanded.get(p)!.add(c.id);

  // Order: common & easy first, rare & hard last.
  const order = [...clusters].sort(
    (a, b) => b.payerCount - a.payerCount || a.strictness - b.strictness || b.livesCovered - a.livesCovered,
  );

  const design = new Set<string>();
  const unlocked = new Set<string>();
  const pending: RequirementCluster[] = [];
  let cumulative = 0;
  const frontier: FrontierStep[] = [];

  for (const c of order) {
    design.add(c.id);
    pending.push(c);
    const newly = [...allPayerIds].filter(
      (p) => !unlocked.has(p) && [...demanded.get(p)!].every((cid) => design.has(cid)),
    );
    if (newly.length === 0) continue;

    const marginal = sumLives(newly, byPayer);
    cumulative += marginal;
    const maxStrict = pending.reduce((m, x) => Math.max(m, x.strictness), 0);
    frontier.push({
      label: pending.map((x) => x.label).join(", "),
      clusterIds: pending.map((x) => x.id),
      livesUnlocked: marginal,
      cumulativeLives: cumulative,
      cumulativePct: totalLives > 0 ? cumulative / totalLives : 0,
      costHint: costHint(maxStrict),
    });
    for (const p of newly) unlocked.add(p);
    pending.length = 0;
  }

  return { frontier, narrative: narrate(frontier, totalLives, payerName, demanded, clusters) };
}

function pct(x: number): string {
  return `${Math.round(x * 100)}%`;
}

function narrate(
  frontier: FrontierStep[],
  totalLives: number,
  _payerName: Map<string, string>,
  _demanded: Map<string, Set<string>>,
  _clusters: RequirementCluster[],
): string {
  if (frontier.length === 0) return "No requirement clusters were found for this asset's codes.";
  const first = frontier[0]!;
  const parts: string[] = [
    `Meeting the common requirements (${first.label}) unlocks ${pct(first.cumulativePct)} of covered lives (${formatLives(first.cumulativeLives)}).`,
  ];
  if (frontier.length > 1) {
    const second = frontier[1]!;
    parts.push(
      `Adding ${second.label.toLowerCase()} takes you to ${pct(second.cumulativePct)}.`,
    );
  }
  const last = frontier[frontier.length - 1]!;
  if (frontier.length > 2) {
    parts.push(
      `The remaining ${pct(1 - frontier[frontier.length - 2]!.cumulativePct)} needs ${last.label.toLowerCase()} — the ${last.costHint}-cost work.`,
    );
  }
  return parts.join(" ");
}
