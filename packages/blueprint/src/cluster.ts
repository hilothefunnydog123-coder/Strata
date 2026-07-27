import type { Criterion, RequirementCluster, ClusterCitation, CriterionKind } from "@assent/core";
import { embed, cosine } from "./embed";

/** A verified criterion tagged with the payer that asserts it. */
export interface EnrichedCriterion extends Criterion {
  payerId: string;
}

export type MergeVerifier = (a: EnrichedCriterion, b: EnrichedCriterion) => boolean | Promise<boolean>;

function tokenSet(s: string): Set<string> {
  return new Set(s.toLowerCase().replace(/[^a-z0-9 ]/g, " ").split(/\s+/).filter((w) => w.length > 2));
}
function tokenOverlap(a: string, b: string): number {
  const ta = tokenSet(a);
  const tb = tokenSet(b);
  if (!ta.size || !tb.size) return 0;
  let hit = 0;
  for (const t of ta) if (tb.has(t)) hit++;
  return hit / Math.min(ta.size, tb.size);
}

/** Combined similarity: embedding cosine + subject token overlap. */
export function similarity(a: EnrichedCriterion, b: EnrichedCriterion): number {
  const emb = cosine(embed(`${a.subject} ${a.requirementText}`), embed(`${b.subject} ${b.requirementText}`));
  const subj = tokenOverlap(a.subject, b.subject);
  return 0.5 * emb + 0.5 * subj;
}

class UnionFind {
  private parent: number[];
  constructor(n: number) {
    this.parent = Array.from({ length: n }, (_, i) => i);
  }
  find(x: number): number {
    while (this.parent[x] !== x) {
      this.parent[x] = this.parent[this.parent[x]!]!;
      x = this.parent[x]!;
    }
    return x;
  }
  union(a: number, b: number): void {
    this.parent[this.find(a)] = this.find(b);
  }
}

export interface ClusterOptions {
  threshold?: number;
  /** Confirm that two similar criteria really are the same requirement (LLM in live mode). */
  verifyMerge?: MergeVerifier;
}

/**
 * Cluster semantically equivalent criteria across payers (PROMPT §6.3). Two payers
 * demanding prospective validation in different words is ONE requirement, not two.
 * Clustering is within-kind, by similarity, confirmed by a merge-verification pass.
 * Every constituent citation stays attached to its cluster.
 */
export async function clusterCriteria(
  criteria: EnrichedCriterion[],
  opts: ClusterOptions = {},
): Promise<RequirementCluster[]> {
  const threshold = opts.threshold ?? 0.5;
  const verify = opts.verifyMerge ?? (() => true);

  const byKind = new Map<CriterionKind, EnrichedCriterion[]>();
  for (const c of criteria) (byKind.get(c.kind) ?? byKind.set(c.kind, []).get(c.kind)!).push(c);

  const clusters: RequirementCluster[] = [];
  let clusterN = 0;

  for (const [kind, items] of byKind) {
    const uf = new UnionFind(items.length);
    for (let i = 0; i < items.length; i++) {
      for (let j = i + 1; j < items.length; j++) {
        if (similarity(items[i]!, items[j]!) >= threshold && (await verify(items[i]!, items[j]!))) {
          uf.union(i, j);
        }
      }
    }
    const groups = new Map<number, EnrichedCriterion[]>();
    items.forEach((c, i) => {
      const root = uf.find(i);
      (groups.get(root) ?? groups.set(root, []).get(root)!).push(c);
    });

    for (const group of groups.values()) {
      clusters.push(makeCluster(`cl_${kind}_${clusterN++}`, kind, group));
    }
  }
  // Largest (most payers) first is a sensible default order.
  clusters.sort((a, b) => b.payerCount - a.payerCount);
  return clusters;
}

function makeCluster(id: string, kind: CriterionKind, group: EnrichedCriterion[]): RequirementCluster {
  const payerIds = [...new Set(group.map((c) => c.payerId))];
  const citations: ClusterCitation[] = group.map((c) => ({
    criterionId: c.id,
    policyDocumentId: c.policyDocumentId,
    payerId: c.payerId,
    spanId: c.spanId,
    verbatimQuote: c.verbatimQuote,
  }));
  // Canonical label: most frequent subject, tie-broken by shortest.
  const counts = new Map<string, number>();
  for (const c of group) counts.set(c.subject, (counts.get(c.subject) ?? 0) + 1);
  const label = [...counts.entries()].sort((a, b) => b[1] - a[1] || a[0].length - b[0].length)[0]![0];

  return {
    id,
    kind,
    label: label.charAt(0).toUpperCase() + label.slice(1),
    payerIds,
    payerCount: payerIds.length,
    livesCovered: 0, // filled by lives weighting
    strictness: 0, // filled by strictness
    citations,
  };
}
