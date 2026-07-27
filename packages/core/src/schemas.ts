import { z } from "zod";
import { CRITERION_KINDS, CRITERION_OPERATORS, STUDY_DESIGNS, ENDPOINT_TYPES } from "./criterion";
import { COVERAGE_STANCES, CHANGE_TYPES } from "./stance";

/**
 * Strict I/O contracts for the LLM stages. The extractor forces the model to
 * emit exactly this shape (temperature 0). Anything off-schema is a rejection,
 * not a repair.
 */

export const EvidenceFacetSchema = z
  .object({
    studyDesign: z.enum(STUDY_DESIGNS).optional(),
    endpoint: z.enum(ENDPOINT_TYPES).optional(),
    comparator: z.string().min(1).max(200).optional(),
  })
  .strict();

export const ExtractionCriterionSchema = z
  .object({
    kind: z.enum(CRITERION_KINDS),
    subject: z.string().min(1).max(400),
    requirementText: z.string().min(1).max(2000),
    operator: z.enum(CRITERION_OPERATORS).nullable().default(null),
    value: z.string().max(200).nullable().default(null),
    unit: z.string().max(60).nullable().default(null),
    evidence: EvidenceFacetSchema.default({}),
    // The invariant reaches into the model contract: a quote is mandatory and
    // must be copied character-for-character from the span, minimal in length.
    verbatimQuote: z.string().min(3).max(1200),
    confidence: z.number().min(0).max(1),
  })
  .strict();

export const ExtractionStanceSchema = z
  .object({
    code: z.string().min(1).max(20), // the code string the stance is about
    stance: z.enum(COVERAGE_STANCES),
    verbatimQuote: z.string().min(3).max(1200),
  })
  .strict();

/**
 * The full per-span extraction result. Returning empty arrays is normal and
 * expected — most spans contain no criteria. The prompt says so explicitly.
 */
export const ExtractionOutputSchema = z
  .object({
    criteria: z.array(ExtractionCriterionSchema),
    stances: z.array(ExtractionStanceSchema).default([]),
  })
  .strict();

export type ExtractionOutput = z.infer<typeof ExtractionOutputSchema>;
export type ExtractionCriterion = z.infer<typeof ExtractionCriterionSchema>;
export type ExtractionStance = z.infer<typeof ExtractionStanceSchema>;

/** Diff classifier output — a separate, cheap, tightened-vs-loosened call. */
export const DiffClassificationSchema = z
  .object({
    changeType: z.enum(CHANGE_TYPES),
    rationale: z.string().min(1).max(600),
  })
  .strict();
export type DiffClassification = z.infer<typeof DiffClassificationSchema>;

/** Blueprint cluster-merge verification — is requirement A the same bar as B? */
export const MergeVerdictSchema = z
  .object({
    sameRequirement: z.boolean(),
    canonicalLabel: z.string().min(1).max(200),
    rationale: z.string().max(600).default(""),
  })
  .strict();
export type MergeVerdict = z.infer<typeof MergeVerdictSchema>;

// ─── Public API contracts (marketing + dashboard) ────────────────────────────

export const DemoRequestSchema = z
  .object({
    name: z.string().min(1).max(120),
    email: z.string().email().max(200),
    company: z.string().min(1).max(160),
    role: z.string().max(120).default(""),
    message: z.string().max(2000).default(""),
  })
  .strict();
export type DemoRequest = z.infer<typeof DemoRequestSchema>;

export const AssetInputSchema = z
  .object({
    name: z.string().min(1).max(160),
    indication: z.string().min(1).max(400),
    intendedUse: z.string().min(1).max(600),
    targetCodes: z.array(z.string().min(1).max(20)).min(1),
    comparator: z.string().max(200).default(""),
    targetPopulation: z.string().max(400).default(""),
  })
  .strict();
export type AssetInput = z.infer<typeof AssetInputSchema>;
