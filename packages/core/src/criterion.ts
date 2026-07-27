/**
 * The criterion taxonomy — shipped after reading representative MolDX LCDs and
 * Aetna CPBs. See docs/PRE-BUILD.md §3 for the derivation and the changes from
 * the §4 hypothesis. This is the single source of truth for `kind`.
 *
 * The diagnostics-defining bars are the AV/CV/CU triad; MolDX adjudicates them
 * separately, so they are first-class. `evidence_standard`, `study_design`,
 * `endpoint`, and `comparator` from the §4 hypothesis are NOT kinds — they are
 * facets that describe *how* a bar must be met, and live on the `evidence` field.
 */
export const CRITERION_KINDS = [
  "clinical_indication",
  "prior_therapy",
  "analytical_validity",
  "clinical_validity",
  "clinical_utility",
  "test_specific_requirement",
  "population",
  "frequency_limit",
  "site_of_service",
  "ordering_provider",
  "documentation",
  "exclusion",
] as const;

export type CriterionKind = (typeof CRITERION_KINDS)[number];

/** The three bars that carry the most weight for diagnostics (MolDX's technical assessment). */
export const DIAGNOSTIC_TRIAD: readonly CriterionKind[] = [
  "analytical_validity",
  "clinical_validity",
  "clinical_utility",
];

export const CRITERION_KIND_LABEL: Record<CriterionKind, string> = {
  clinical_indication: "Clinical indication",
  prior_therapy: "Prior therapy",
  analytical_validity: "Analytical validity",
  clinical_validity: "Clinical validity",
  clinical_utility: "Clinical utility",
  test_specific_requirement: "Test-specific requirement",
  population: "Population",
  frequency_limit: "Frequency limit",
  site_of_service: "Site of service",
  ordering_provider: "Ordering provider",
  documentation: "Documentation",
  exclusion: "Exclusion",
};

/** Comparison operators a criterion may encode when it is quantitative. */
export const CRITERION_OPERATORS = [
  "eq",
  "gte",
  "lte",
  "gt",
  "lt",
  "in",
  "exists",
  "not_exists",
] as const;
export type CriterionOperator = (typeof CRITERION_OPERATORS)[number];

/** Study-design facet vocabulary (how a validity/utility bar must be met). */
export const STUDY_DESIGNS = [
  "prospective",
  "retrospective",
  "rct",
  "single_arm",
  "registry",
  "modeling",
  "meta_analysis",
  "unspecified",
] as const;
export type StudyDesign = (typeof STUDY_DESIGNS)[number];

export const ENDPOINT_TYPES = [
  "analytical_concordance",
  "clinical_sensitivity_specificity",
  "change_in_management",
  "clinical_outcomes",
  "survival",
  "cost",
  "unspecified",
] as const;
export type EndpointType = (typeof ENDPOINT_TYPES)[number];

export function isCriterionKind(x: unknown): x is CriterionKind {
  return typeof x === "string" && (CRITERION_KINDS as readonly string[]).includes(x);
}
