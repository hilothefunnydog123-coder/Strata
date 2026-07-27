import type { CriterionKind, CriterionOperator, StudyDesign, EndpointType } from "./criterion.js";
import type { CoverageStance, ChangeType } from "./stance.js";
import type { PayerType } from "./lives.js";

/**
 * Shared domain vocabulary. These mirror the server schema (packages/db) and the
 * desktop mirror (packages/local-db) but are the types the whole app speaks.
 *
 * THE CITATION INVARIANT, LEVEL 1 (types): `Criterion` and `CoverageStanceRecord`
 * have `spanId` and `verbatimQuote` as required, non-nullable fields. There is no
 * way to name a claim in this type system without its source. Construction goes
 * through `makeVerifiedCriterion` (see citation.ts), never a bare object literal.
 */

export type CodeSystem = "CPT" | "HCPCS" | "PLA" | "ICD10CM";

export interface Payer {
  id: string;
  name: string;
  type: PayerType;
  parentPayerId: string | null;
}

export interface CoveredLives {
  payerId: string;
  year: number;
  segment: string;
  livesCount: number;
  sourceUrl: string;
  sourceNote: string;
}

export interface PolicyDocument {
  id: string;
  payerId: string;
  externalId: string; // e.g. "L38045", "0140" (Aetna CPB), "NCD 90.2"
  title: string;
  url: string;
  effectiveDate: string; // ISO date
  retrievedAt: string; // ISO datetime
  contentHash: string; // sha256 of raw bytes
  supersedesId: string | null; // prior version this replaces
  rawStoragePath: string;
}

export interface DocumentSpan {
  id: string;
  policyDocumentId: string;
  ordinal: number;
  pageNumber: number;
  charStart: number;
  charEnd: number;
  text: string;
  headingPath: string[]; // section context, root → leaf
}

export interface Code {
  id: string;
  system: CodeSystem;
  code: string;
  description: string;
}

export type PolicyCodeRelationship = "covers" | "excludes" | "mentions";

export interface PolicyCodeLink {
  policyDocumentId: string;
  codeId: string;
  relationship: PolicyCodeRelationship;
}

/** Structured facets describing HOW a validity/utility bar must be met (see PRE-BUILD §3). */
export interface EvidenceFacet {
  studyDesign?: StudyDesign;
  endpoint?: EndpointType;
  comparator?: string; // free text, e.g. "standard of care", "Oncotype DX"
}

/**
 * A single binding requirement extracted from one span. Every field that ties it
 * to source (`spanId`, `verbatimQuote`) is required. `confidence` is the model's,
 * but a criterion only exists if its quote verified — see RejectedExtraction for the rest.
 */
export interface Criterion {
  id: string;
  policyDocumentId: string;
  kind: CriterionKind;
  subject: string; // what the requirement is about, normalized
  requirementText: string; // the requirement stated plainly (may paraphrase for readability)
  operator: CriterionOperator | null;
  value: string | null;
  unit: string | null;
  evidence: EvidenceFacet;
  spanId: string; // INVARIANT: required, FK to DocumentSpan
  verbatimQuote: string; // INVARIANT: required, verified substring of the span text
  confidence: number; // 0..1
  extractedByModel: string;
  extractedAt: string; // ISO datetime
}

/** A payer's stance on a code, with its own required citation. */
export interface CoverageStanceRecord {
  id: string;
  policyDocumentId: string;
  codeId: string;
  stance: CoverageStance;
  spanId: string; // INVARIANT
  verbatimQuote: string; // INVARIANT
}

export interface CriterionChange {
  id: string;
  fromCriterionId: string | null; // null when added
  toCriterionId: string | null; // null when removed
  policyDocumentId: string;
  changeType: ChangeType;
  rationale: string;
}

export interface RejectedExtraction {
  id: string;
  spanId: string;
  rawModelOutput: string;
  rejectionReason: string;
  createdAt: string;
}

export interface LlmCall {
  id: string;
  inputHash: string;
  model: string;
  promptTokens: number;
  completionTokens: number;
  latencyMs: number;
  costUsd: number;
  stage: string;
}

// ─── Product-side (customer) entities ───────────────────────────────────────

export type AccountPlan = "pilot" | "standard" | "enterprise";
export type UserRole = "admin" | "member" | "viewer";

export interface Account {
  id: string;
  orgName: string;
  plan: AccountPlan;
  seatLimit: number;
  createdByAdmin: string;
}

export interface User {
  id: string;
  accountId: string;
  email: string;
  role: UserRole;
  // totpSecret is never included in read models sent to the client.
}

export interface Asset {
  id: string;
  accountId: string;
  name: string;
  indication: string;
  intendedUse: string;
  targetCodes: string[];
  comparator: string;
  targetPopulation: string;
}

export interface Blueprint {
  id: string;
  assetId: string;
  generatedAt: string;
  inputsHash: string;
  payload: BlueprintPayload;
}

export type CampaignStage =
  | "not_engaged"
  | "dossier_sent"
  | "under_review"
  | "covered"
  | "appealed";

export interface CampaignEntry {
  id: string;
  assetId: string;
  payerId: string;
  stage: CampaignStage;
  owner: string;
  notes: string;
  nextActionDate: string | null;
}

// ─── Blueprint payload (the frontier) ───────────────────────────────────────

export interface ClusterCitation {
  criterionId: string;
  policyDocumentId: string;
  payerId: string;
  spanId: string;
  verbatimQuote: string;
}

export interface RequirementCluster {
  id: string;
  kind: CriterionKind;
  label: string; // canonical phrasing of the shared requirement
  payerIds: string[]; // payers demanding this cluster
  livesCovered: number; // sum of covered lives across requiring payers
  payerCount: number;
  strictness: number; // 0..1 aggregate, how demanding the strictest phrasing is
  citations: ClusterCitation[]; // every constituent citation stays attached
}

export interface FrontierStep {
  label: string; // e.g. "add a head-to-head arm"
  clusterIds: string[]; // clusters this step satisfies
  livesUnlocked: number; // marginal lives added by taking this step
  cumulativeLives: number;
  cumulativePct: number; // against the modeled corpus denominator
  costHint: "low" | "moderate" | "high"; // relative build cost of this design decision
}

export interface BlueprintPayload {
  assetId: string;
  totalCorpusLives: number;
  clusters: RequirementCluster[];
  frontier: FrontierStep[];
  narrative: string; // the frontier framing sentence(s)
  generatedByModel: string;
}
