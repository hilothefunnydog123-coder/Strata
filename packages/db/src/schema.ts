import {
  pgTable,
  pgEnum,
  text,
  integer,
  doublePrecision,
  timestamp,
  date,
  jsonb,
  boolean,
  index,
  uniqueIndex,
  primaryKey,
} from "drizzle-orm/pg-core";
import {
  CRITERION_KINDS,
  CRITERION_OPERATORS,
  COVERAGE_STANCES,
  CHANGE_TYPES,
  PAYER_TYPES,
} from "@assent/core";
import type { EvidenceFacet } from "@assent/core";

/**
 * Server schema (PROMPT §4). A policy is IMMUTABLE and VERSIONED — we never
 * update a policy row; we insert a new version and link it via `supersedesId`.
 *
 * THE CITATION INVARIANT, LEVEL 2 (database): `criterion.span_id` and
 * `criterion.verbatim_quote` are NOT NULL, and `span_id` is a foreign key to
 * `document_span`. Same for `coverage_stance`. The database refuses to store a
 * claim without its source.
 *
 * Enum tuples are imported from @assent/core so the taxonomy has exactly one
 * source of truth. Embeddings are jsonb float arrays (pgvector optional — see
 * README); similarity is computed in-app for the v0 corpus.
 */

// Enums (single source of truth = @assent/core arrays) ────────────────────────
export const payerType = pgEnum("payer_type", PAYER_TYPES);
export const codeSystem = pgEnum("code_system", ["CPT", "HCPCS", "PLA", "ICD10CM"]);
export const codeRelationship = pgEnum("code_relationship", ["covers", "excludes", "mentions"]);
export const criterionKind = pgEnum("criterion_kind", CRITERION_KINDS);
export const criterionOperator = pgEnum("criterion_operator", CRITERION_OPERATORS);
export const coverageStanceEnum = pgEnum("coverage_stance_kind", COVERAGE_STANCES);
export const changeType = pgEnum("change_type", CHANGE_TYPES);
export const accountPlan = pgEnum("account_plan", ["pilot", "standard", "enterprise"]);
export const userRole = pgEnum("user_role", ["admin", "member", "viewer"]);
/**
 * Where a document's bytes came from. `sample` marks reconstructed text used for
 * offline development — it must never be presented as a real payer requirement.
 */
export const provenance = pgEnum("provenance", ["fetched", "sample", "synthetic_scale"]);

export const campaignStage = pgEnum("campaign_stage", [
  "not_engaged",
  "dossier_sent",
  "under_review",
  "covered",
  "appealed",
]);

// ─── Corpus ───────────────────────────────────────────────────────────────────

export const payer = pgTable("payer", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  type: payerType("type").notNull(),
  parentPayerId: text("parent_payer_id"),
});

export const coveredLives = pgTable(
  "covered_lives",
  {
    id: text("id").primaryKey(),
    payerId: text("payer_id")
      .notNull()
      .references(() => payer.id),
    year: integer("year").notNull(),
    segment: text("segment").notNull(),
    livesCount: integer("lives_count").notNull(),
    sourceUrl: text("source_url").notNull(),
    sourceNote: text("source_note").notNull(),
  },
  (t) => [index("covered_lives_payer_idx").on(t.payerId)],
);

export const policyDocument = pgTable(
  "policy_document",
  {
    id: text("id").primaryKey(),
    payerId: text("payer_id")
      .notNull()
      .references(() => payer.id),
    externalId: text("external_id").notNull(),
    title: text("title").notNull(),
    url: text("url").notNull(),
    effectiveDate: date("effective_date").notNull(),
    retrievedAt: timestamp("retrieved_at", { withTimezone: true }).notNull(),
    contentHash: text("content_hash").notNull(),
    supersedesId: text("supersedes_id"),
    rawStoragePath: text("raw_storage_path").notNull(),
    provenance: provenance("provenance").notNull().default("sample"),
  },
  (t) => [
    index("policy_document_payer_idx").on(t.payerId),
    // Idempotency: the same bytes for the same doc never create a second version.
    uniqueIndex("policy_document_identity_idx").on(t.payerId, t.externalId, t.contentHash),
  ],
);

export const documentSpan = pgTable(
  "document_span",
  {
    id: text("id").primaryKey(),
    policyDocumentId: text("policy_document_id")
      .notNull()
      .references(() => policyDocument.id),
    ordinal: integer("ordinal").notNull(),
    pageNumber: integer("page_number").notNull(),
    charStart: integer("char_start").notNull(),
    charEnd: integer("char_end").notNull(),
    text: text("text").notNull(),
    headingPath: jsonb("heading_path").$type<string[]>().notNull().default([]),
    embedding: jsonb("embedding").$type<number[] | null>(),
  },
  (t) => [
    index("document_span_doc_idx").on(t.policyDocumentId),
    uniqueIndex("document_span_ordinal_idx").on(t.policyDocumentId, t.ordinal),
  ],
);

export const code = pgTable(
  "code",
  {
    id: text("id").primaryKey(),
    system: codeSystem("system").notNull(),
    code: text("code").notNull(),
    description: text("description").notNull(),
  },
  (t) => [uniqueIndex("code_identity_idx").on(t.system, t.code)],
);

export const policyCodeLink = pgTable(
  "policy_code_link",
  {
    policyDocumentId: text("policy_document_id")
      .notNull()
      .references(() => policyDocument.id),
    codeId: text("code_id")
      .notNull()
      .references(() => code.id),
    relationship: codeRelationship("relationship").notNull(),
  },
  (t) => [primaryKey({ columns: [t.policyDocumentId, t.codeId, t.relationship] })],
);

export const criterion = pgTable(
  "criterion",
  {
    id: text("id").primaryKey(),
    policyDocumentId: text("policy_document_id")
      .notNull()
      .references(() => policyDocument.id),
    kind: criterionKind("kind").notNull(),
    subject: text("subject").notNull(),
    requirementText: text("requirement_text").notNull(),
    operator: criterionOperator("operator"),
    value: text("value"),
    unit: text("unit"),
    evidence: jsonb("evidence").$type<EvidenceFacet>().notNull().default({}),
    // ── CITATION INVARIANT, LEVEL 2 ──
    spanId: text("span_id")
      .notNull()
      .references(() => documentSpan.id),
    verbatimQuote: text("verbatim_quote").notNull(),
    // ─────────────────────────────────
    confidence: doublePrecision("confidence").notNull(),
    embedding: jsonb("embedding").$type<number[] | null>(),
    extractedByModel: text("extracted_by_model").notNull(),
    extractedAt: timestamp("extracted_at", { withTimezone: true }).notNull(),
  },
  (t) => [
    index("criterion_doc_idx").on(t.policyDocumentId),
    index("criterion_kind_idx").on(t.kind),
    index("criterion_span_idx").on(t.spanId),
  ],
);

export const coverageStance = pgTable(
  "coverage_stance",
  {
    id: text("id").primaryKey(),
    policyDocumentId: text("policy_document_id")
      .notNull()
      .references(() => policyDocument.id),
    codeId: text("code_id")
      .notNull()
      .references(() => code.id),
    stance: coverageStanceEnum("stance").notNull(),
    // ── CITATION INVARIANT, LEVEL 2 ──
    spanId: text("span_id")
      .notNull()
      .references(() => documentSpan.id),
    verbatimQuote: text("verbatim_quote").notNull(),
  },
  (t) => [index("coverage_stance_doc_idx").on(t.policyDocumentId)],
);

export const criterionChange = pgTable(
  "criterion_change",
  {
    id: text("id").primaryKey(),
    fromCriterionId: text("from_criterion_id").references(() => criterion.id),
    toCriterionId: text("to_criterion_id").references(() => criterion.id),
    policyDocumentId: text("policy_document_id")
      .notNull()
      .references(() => policyDocument.id),
    changeType: changeType("change_type").notNull(),
    rationale: text("rationale").notNull(),
  },
  (t) => [index("criterion_change_doc_idx").on(t.policyDocumentId)],
);

export const rejectedExtraction = pgTable("rejected_extraction", {
  id: text("id").primaryKey(),
  spanId: text("span_id")
    .notNull()
    .references(() => documentSpan.id),
  rawModelOutput: text("raw_model_output").notNull(),
  rejectionReason: text("rejection_reason").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull(),
});

export const llmCall = pgTable("llm_call", {
  id: text("id").primaryKey(),
  inputHash: text("input_hash").notNull(),
  model: text("model").notNull(),
  promptTokens: integer("prompt_tokens").notNull(),
  completionTokens: integer("completion_tokens").notNull(),
  latencyMs: integer("latency_ms").notNull(),
  costUsd: doublePrecision("cost_usd").notNull(),
  stage: text("stage").notNull(),
});

// ─── Product / customer ───────────────────────────────────────────────────────

export const account = pgTable("account", {
  id: text("id").primaryKey(),
  orgName: text("org_name").notNull(),
  plan: accountPlan("plan").notNull().default("pilot"),
  seatLimit: integer("seat_limit").notNull().default(3),
  createdByAdmin: text("created_by_admin").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const appUser = pgTable(
  "app_user",
  {
    id: text("id").primaryKey(),
    accountId: text("account_id")
      .notNull()
      .references(() => account.id),
    email: text("email").notNull(),
    role: userRole("role").notNull().default("member"),
    passwordHash: text("password_hash").notNull(),
    totpSecret: text("totp_secret"), // set on first TOTP enrollment
    totpEnrolled: boolean("totp_enrolled").notNull().default(false),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [uniqueIndex("app_user_email_idx").on(t.email)],
);

export const session = pgTable(
  "session",
  {
    id: text("id").primaryKey(), // sha256 of the cookie token
    userId: text("user_id")
      .notNull()
      .references(() => appUser.id),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("session_user_idx").on(t.userId)],
);

/** Device-flow authorization for the desktop app (OAuth device grant). */
export const deviceAuth = pgTable(
  "device_auth",
  {
    id: text("id").primaryKey(),
    deviceCode: text("device_code").notNull(),
    userCode: text("user_code").notNull(),
    userId: text("user_id").references(() => appUser.id),
    approved: boolean("approved").notNull().default(false),
    refreshToken: text("refresh_token"),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex("device_auth_device_code_idx").on(t.deviceCode),
    uniqueIndex("device_auth_user_code_idx").on(t.userCode),
  ],
);

export const asset = pgTable(
  "asset",
  {
    id: text("id").primaryKey(),
    accountId: text("account_id")
      .notNull()
      .references(() => account.id),
    name: text("name").notNull(),
    indication: text("indication").notNull(),
    intendedUse: text("intended_use").notNull(),
    targetCodes: jsonb("target_codes").$type<string[]>().notNull().default([]),
    comparator: text("comparator").notNull().default(""),
    targetPopulation: text("target_population").notNull().default(""),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("asset_account_idx").on(t.accountId)],
);

export const blueprint = pgTable(
  "blueprint",
  {
    id: text("id").primaryKey(),
    assetId: text("asset_id")
      .notNull()
      .references(() => asset.id),
    generatedAt: timestamp("generated_at", { withTimezone: true }).notNull().defaultNow(),
    inputsHash: text("inputs_hash").notNull(),
    payload: jsonb("payload").notNull(),
  },
  (t) => [index("blueprint_asset_idx").on(t.assetId)],
);

export const campaignEntry = pgTable(
  "campaign_entry",
  {
    id: text("id").primaryKey(),
    assetId: text("asset_id")
      .notNull()
      .references(() => asset.id),
    payerId: text("payer_id")
      .notNull()
      .references(() => payer.id),
    stage: campaignStage("stage").notNull().default("not_engaged"),
    owner: text("owner").notNull().default(""),
    notes: text("notes").notNull().default(""),
    nextActionDate: date("next_action_date"),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("campaign_entry_asset_idx").on(t.assetId)],
);

/** Marketing demo-request inbox (PROMPT §11 M5). */
export const demoRequest = pgTable("demo_request", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  email: text("email").notNull(),
  company: text("company").notNull(),
  role: text("role").notNull().default(""),
  message: text("message").notNull().default(""),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  notifiedAt: timestamp("notified_at", { withTimezone: true }),
});

/** Eval run snapshots (PROMPT §9) — regressions must be visible over time. */
export const evalRun = pgTable("eval_run", {
  id: text("id").primaryKey(),
  suite: text("suite").notNull(), // "extraction" | "diff"
  goldenSetHash: text("golden_set_hash").notNull(),
  model: text("model").notNull(),
  metrics: jsonb("metrics").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const schema = {
  payer,
  coveredLives,
  policyDocument,
  documentSpan,
  code,
  policyCodeLink,
  criterion,
  coverageStance,
  criterionChange,
  rejectedExtraction,
  llmCall,
  account,
  appUser,
  session,
  deviceAuth,
  asset,
  blueprint,
  campaignEntry,
  demoRequest,
  evalRun,
};
