import type { Asset, BlueprintPayload, Payer, CoveredLives, Criterion } from "@assent/core";
import { clusterCriteria, type EnrichedCriterion, type MergeVerifier } from "./cluster";
import { livesByPayer, sumLives } from "./lives";
import { clusterStrictness } from "./strictness";
import { synthesizeFrontier } from "./frontier";
import { embed, cosine } from "./embed";

export interface BlueprintInput {
  asset: Asset;
  /** Verified criteria enriched with the asserting payer. */
  criteria: EnrichedCriterion[];
  /** policyDocumentId → the codes that policy covers/mentions. */
  codesByDoc: Record<string, string[]>;
  payers: Payer[];
  coveredLives: CoveredLives[];
  verifyMerge?: MergeVerifier;
  generatedByModel?: string;
}

/** Retrieve candidate criteria by code overlap OR indication similarity (PROMPT §6.1). */
export function retrieveCandidates(input: BlueprintInput): EnrichedCriterion[] {
  const target = new Set(input.asset.targetCodes);
  const indicationVec = embed(`${input.asset.indication} ${input.asset.intendedUse}`);
  return input.criteria.filter((c) => {
    if (target.size > 0) {
      const codes = input.codesByDoc[c.policyDocumentId] ?? [];
      if (codes.some((code) => target.has(code))) return true;
    } else {
      return true;
    }
    // Secondary: vector similarity on the requirement text vs the asset indication.
    return cosine(indicationVec, embed(`${c.subject} ${c.requirementText}`)) >= 0.15;
  });
}

/**
 * Build the evidence blueprint for an asset (PROMPT §6 Blueprint / M12). Every
 * requirement traces to at least one verified citation, and the lives math is
 * reproducible by hand: cluster.livesCovered is the sum of covered lives of the
 * requiring payers, and each frontier step's marginal is the lives of the payers
 * it newly unlocks.
 */
export async function buildBlueprint(input: BlueprintInput): Promise<BlueprintPayload> {
  const candidates = retrieveCandidates(input);
  const clusters = await clusterCriteria(candidates, { verifyMerge: input.verifyMerge });

  const { byPayer, total } = livesByPayer(input.payers, input.coveredLives);
  const critById = new Map<string, Criterion>(candidates.map((c) => [c.id, c]));

  for (const cl of clusters) {
    cl.livesCovered = sumLives(cl.payerIds, byPayer);
    const criteria = cl.citations.map((cit) => critById.get(cit.criterionId)).filter((c): c is Criterion => !!c);
    cl.strictness = clusterStrictness(criteria);
  }
  // Re-sort: most lives first is the most useful default for the rail.
  clusters.sort((a, b) => b.livesCovered - a.livesCovered || b.payerCount - a.payerCount);

  const { frontier, narrative } = synthesizeFrontier(clusters, byPayer, total, input.payers);

  return {
    assetId: input.asset.id,
    totalCorpusLives: total,
    clusters,
    frontier,
    narrative,
    generatedByModel: input.generatedByModel ?? "fixture-deterministic",
  };
}
