import type { Criterion, CriterionKind } from "@assent/core";

/**
 * A transparent strictness heuristic (0..1) — how demanding a requirement is to
 * satisfy in a trial. The AV/CV/CU triad carries the most weight; prospective /
 * outcomes evidence is stricter than retrospective. A cluster takes the MAX over
 * its constituent phrasings (the strictest wins). Kept simple and inspectable so
 * the blueprint's cost framing is defensible.
 */
const KIND_BASE: Record<CriterionKind, number> = {
  clinical_utility: 0.75,
  clinical_validity: 0.6,
  analytical_validity: 0.55,
  prior_therapy: 0.5,
  clinical_indication: 0.4,
  population: 0.4,
  test_specific_requirement: 0.45,
  frequency_limit: 0.35,
  site_of_service: 0.3,
  ordering_provider: 0.3,
  documentation: 0.3,
  exclusion: 0.4,
};

export function criterionStrictness(c: Criterion): number {
  let s = KIND_BASE[c.kind] ?? 0.4;
  const design = c.evidence.studyDesign;
  if (design === "prospective" || design === "rct") s += 0.2;
  else if (design === "retrospective" || design === "registry") s += 0.05;
  const ep = c.evidence.endpoint;
  if (ep === "clinical_outcomes" || ep === "survival") s += 0.15;
  else if (ep === "change_in_management") s += 0.05;
  if (c.operator === "gte" || c.operator === "lte") s += 0.05;
  return Math.max(0, Math.min(1, s));
}

export function clusterStrictness(criteria: Criterion[]): number {
  return criteria.reduce((m, c) => Math.max(m, criterionStrictness(c)), 0);
}

export function costHint(strictness: number): "low" | "moderate" | "high" {
  if (strictness >= 0.8) return "high";
  if (strictness >= 0.5) return "moderate";
  return "low";
}
