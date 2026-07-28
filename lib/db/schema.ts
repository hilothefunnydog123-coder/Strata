/**
 * The complete database schema.
 *
 * Two data classes, per compliance requirement 1:
 *
 *   PUBLIC  Corpus of published government records, platform bookkeeping,
 *           authentication, billing. Safe to join into analytics.
 *   PHI     Anything derived from a hospital's submitted documents. Clinical
 *           text columns use encryptedText, so the bytes at rest are ciphertext
 *           under PHI_ENCRYPTION_KEY. These tables are listed in PHI_TABLES and
 *           are excluded from analytics queries by lib/analytics/guard.ts.
 *
 * Authentication tables (user, session, account, verification, organization,
 * member, invitation, twoFactor) follow better-auth's expected shape so the
 * Drizzle adapter can use them directly. The columns the specification asks for
 * beyond that set, contingency rate and account status, are added to those same
 * tables rather than duplicated into parallel ones.
 */
import { relations, sql } from 'drizzle-orm';
import {
  boolean,
  index,
  integer,
  jsonb,
  pgEnum,
  pgTable,
  real,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';
import { encryptedText } from './crypto';

const now = () => timestamp('created_at', { withTimezone: true }).notNull().defaultNow();

/* ─────────────────────────────────────────────────────────────────────────────
   Enums
   ────────────────────────────────────────────────────────────────────────── */

export const orgStatusEnum = pgEnum('org_status', ['active', 'inactive']);
export const userStatusEnum = pgEnum('user_status', ['active', 'disabled']);

export const roleEnum = pgEnum('role', [
  'superadmin',
  'org_admin',
  'appeal_specialist',
  'readonly',
  'clinical_reviewer',
  'legal_reviewer',
]);

export const sourceTypeEnum = pgEnum('source_type', [
  'dab_decision',
  'regulation',
  'manual',
  'lcd',
  'ncd',
]);

export const holdingOutcomeEnum = pgEnum('holding_outcome', [
  'claimant_favorable',
  'plan_favorable',
  'mixed',
]);

export const serviceTypeEnum = pgEnum('service_type', [
  'skilled_nursing',
  'inpatient_rehab',
  'home_health',
  'long_term_care_hospital',
  'inpatient_acute',
  'outpatient',
  'dme',
  'other',
]);

export const payerTypeEnum = pgEnum('payer_type', [
  'medicare_advantage',
  'traditional_medicare',
  'medicaid_managed_care',
  'commercial',
  'other',
]);

export const denialBasisEnum = pgEnum('denial_basis', [
  'medical_necessity',
  'level_of_care',
  'not_covered_benefit',
  'insufficient_documentation',
  'proprietary_criteria',
  'administrative',
  'other',
]);

export const denialStatusEnum = pgEnum('denial_status', [
  'intake',
  'parsing',
  'ready_for_generation',
  'generating',
  'clinical_review',
  'legal_review',
  'approved',
  'submitted',
  'decided',
  'invoiced',
]);

export const documentKindEnum = pgEnum('document_kind', [
  'denial_letter',
  'clinical_record',
  'eob',
  'other',
]);

export const factTypeEnum = pgEnum('fact_type', [
  'diagnosis',
  'functional_status',
  'therapy_intensity',
  'skilled_service',
  'physician_order',
  'nursing_observation',
  'prior_level_of_function',
  'discharge_plan',
  'vital_sign',
  'medication',
  'other',
]);

export const draftStatusEnum = pgEnum('draft_status', [
  'generating',
  'verification_failed',
  'ready',
  'superseded',
]);

export const assertionKindEnum = pgEnum('assertion_kind', ['legal', 'clinical']);
export const assertionSourceKindEnum = pgEnum('assertion_source_kind', [
  'holding',
  'source_span',
  'clinical_fact',
]);
export const reviewTypeEnum = pgEnum('review_type', ['clinical', 'legal']);
// Named review_verdict rather than review_action so the enum type does not
// collide with the review_action table, which Postgres would reject.
export const reviewActionEnum = pgEnum('review_verdict', [
  'approved',
  'rejected',
  'edited',
]);
export const outcomeResultEnum = pgEnum('outcome_result', [
  'won',
  'lost',
  'partial',
  'withdrawn',
]);
export const invoiceStatusEnum = pgEnum('invoice_status', [
  'draft',
  'issued',
  'paid',
  'void',
]);
export const jobStatusEnum = pgEnum('job_status', [
  'pending',
  'running',
  'done',
  'failed',
]);
export const emailStatusEnum = pgEnum('email_status', [
  'queued',
  'sent',
  'failed',
  'skipped_unsubscribed',
]);
export const demoRequestStatusEnum = pgEnum('demo_request_status', [
  'new',
  'contacted',
  'qualified',
  'closed',
]);

/* ─────────────────────────────────────────────────────────────────────────────
   Authentication and tenancy  (PUBLIC)
   ────────────────────────────────────────────────────────────────────────── */

export const user = pgTable(
  'user',
  {
    id: text('id').primaryKey(),
    name: text('name').notNull(),
    email: text('email').notNull().unique(),
    emailVerified: boolean('email_verified').notNull().default(false),
    image: text('image'),
    /** Set by the twoFactor plugin once enrolment completes. */
    twoFactorEnabled: boolean('two_factor_enabled').notNull().default(false),
    /** Operator controlled. A disabled user cannot hold a session. */
    status: userStatusEnum('status').notNull().default('active'),
    /** Forces a password change on next sign in. */
    mustChangePassword: boolean('must_change_password').notNull().default(false),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index('user_status_idx').on(t.status)],
);

export const session = pgTable(
  'session',
  {
    id: text('id').primaryKey(),
    token: text('token').notNull().unique(),
    userId: text('user_id')
      .notNull()
      .references(() => user.id, { onDelete: 'cascade' }),
    expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
    ipAddress: text('ip_address'),
    userAgent: text('user_agent'),
    activeOrganizationId: text('active_organization_id'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index('session_user_idx').on(t.userId)],
);

export const account = pgTable(
  'account',
  {
    id: text('id').primaryKey(),
    accountId: text('account_id').notNull(),
    providerId: text('provider_id').notNull(),
    userId: text('user_id')
      .notNull()
      .references(() => user.id, { onDelete: 'cascade' }),
    accessToken: text('access_token'),
    refreshToken: text('refresh_token'),
    idToken: text('id_token'),
    accessTokenExpiresAt: timestamp('access_token_expires_at', { withTimezone: true }),
    refreshTokenExpiresAt: timestamp('refresh_token_expires_at', { withTimezone: true }),
    scope: text('scope'),
    /** The password hash. better-auth owns the hashing scheme. */
    password: text('password'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index('account_user_idx').on(t.userId)],
);

export const verification = pgTable(
  'verification',
  {
    id: text('id').primaryKey(),
    identifier: text('identifier').notNull(),
    value: text('value').notNull(),
    expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index('verification_identifier_idx').on(t.identifier)],
);

export const twoFactor = pgTable(
  'two_factor',
  {
    id: text('id').primaryKey(),
    /** TOTP shared secret. Encrypted at rest with the PHI key. */
    secret: text('secret').notNull(),
    backupCodes: text('backup_codes').notNull(),
    userId: text('user_id')
      .notNull()
      .references(() => user.id, { onDelete: 'cascade' }),
  },
  (t) => [index('two_factor_user_idx').on(t.userId)],
);

export const organization = pgTable(
  'organization',
  {
    id: text('id').primaryKey(),
    name: text('name').notNull(),
    slug: text('slug').notNull().unique(),
    logo: text('logo'),
    metadata: text('metadata'),
    /**
     * Contingency rate in basis points. 1500 means 15 percent of recovered
     * dollars. Integer so no rounding drift ever reaches an invoice.
     */
    contingencyRateBps: integer('contingency_rate_bps').notNull().default(1500),
    status: orgStatusEnum('status').notNull().default('active'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index('organization_status_idx').on(t.status)],
);

/** Membership. One row per user per organisation, carrying the role. */
export const member = pgTable(
  'member',
  {
    id: text('id').primaryKey(),
    organizationId: text('organization_id')
      .notNull()
      .references(() => organization.id, { onDelete: 'cascade' }),
    userId: text('user_id')
      .notNull()
      .references(() => user.id, { onDelete: 'cascade' }),
    role: text('role').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex('member_org_user_idx').on(t.organizationId, t.userId),
    index('member_user_idx').on(t.userId),
  ],
);

export const invitation = pgTable('invitation', {
  id: text('id').primaryKey(),
  organizationId: text('organization_id')
    .notNull()
    .references(() => organization.id, { onDelete: 'cascade' }),
  email: text('email').notNull(),
  role: text('role'),
  status: text('status').notNull().default('pending'),
  expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
  inviterId: text('inviter_id')
    .notNull()
    .references(() => user.id, { onDelete: 'cascade' }),
});

/**
 * Which organisations a reviewer may see. Reviewers are scoped, not global:
 * a clinical reviewer assigned to two hospitals sees exactly those two queues.
 */
export const reviewerAssignment = pgTable(
  'reviewer_assignment',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    userId: text('user_id')
      .notNull()
      .references(() => user.id, { onDelete: 'cascade' }),
    organizationId: text('organization_id')
      .notNull()
      .references(() => organization.id, { onDelete: 'cascade' }),
    createdAt: now(),
  },
  (t) => [
    uniqueIndex('reviewer_assignment_idx').on(t.userId, t.organizationId),
    index('reviewer_assignment_org_idx').on(t.organizationId),
  ],
);

/* ─────────────────────────────────────────────────────────────────────────────
   Corpus  (PUBLIC: published government records)
   ────────────────────────────────────────────────────────────────────────── */

export const sourceDocument = pgTable(
  'source_document',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    sourceType: sourceTypeEnum('source_type').notNull(),
    /** The citation a lawyer would write, for example "DAB No. 3145". */
    citation: text('citation').notNull(),
    title: text('title').notNull(),
    url: text('url').notNull(),
    decidedAt: timestamp('decided_at', { withTimezone: true }),
    retrievedAt: timestamp('retrieved_at', { withTimezone: true }).notNull(),
    /** SHA-256 of the raw bytes. Re-fetching an unchanged document is a no-op. */
    contentHash: text('content_hash').notNull(),
    /** Storage key of the untouched original. Raw bytes are never mutated. */
    rawPath: text('raw_path').notNull(),
    parsedAt: timestamp('parsed_at', { withTimezone: true }),
    extractedAt: timestamp('extracted_at', { withTimezone: true }),
    createdAt: now(),
  },
  (t) => [
    uniqueIndex('source_document_hash_idx').on(t.contentHash),
    uniqueIndex('source_document_citation_idx').on(t.sourceType, t.citation),
    index('source_document_type_idx').on(t.sourceType),
  ],
);

/**
 * A contiguous passage of a source document, with the character offsets that
 * locate it in the parsed text. Every quotation resolves to one of these, which
 * is what makes a citation clickable rather than decorative.
 */
export const sourceSpan = pgTable(
  'source_span',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    sourceDocumentId: uuid('source_document_id')
      .notNull()
      .references(() => sourceDocument.id, { onDelete: 'cascade' }),
    ordinal: integer('ordinal').notNull(),
    page: integer('page'),
    charStart: integer('char_start').notNull(),
    charEnd: integer('char_end').notNull(),
    text: text('text').notNull(),
    /** Section trail, for example ["Analysis", "Skilled care requirement"]. */
    headingPath: jsonb('heading_path').$type<string[]>().notNull().default(sql`'[]'::jsonb`),
    createdAt: now(),
  },
  (t) => [
    uniqueIndex('source_span_ordinal_idx').on(t.sourceDocumentId, t.ordinal),
    index('source_span_document_idx').on(t.sourceDocumentId),
  ],
);

/**
 * One legal proposition drawn from one decision, anchored to the exact words
 * that support it. span_id and verbatim_quote are NOT NULL by design: there is
 * no way to record a holding without the passage it came from.
 */
export const holding = pgTable(
  'holding',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    sourceDocumentId: uuid('source_document_id')
      .notNull()
      .references(() => sourceDocument.id, { onDelete: 'cascade' }),
    spanId: uuid('span_id')
      .notNull()
      .references(() => sourceSpan.id, { onDelete: 'cascade' }),
    verbatimQuote: text('verbatim_quote').notNull(),
    issue: text('issue').notNull(),
    ruleApplied: text('rule_applied').notNull(),
    outcome: holdingOutcomeEnum('outcome').notNull(),
    serviceType: serviceTypeEnum('service_type'),
    payerType: payerTypeEnum('payer_type'),
    denialBasis: denialBasisEnum('denial_basis'),
    /** Set once corpus:verify confirms the span contains the quote. */
    verifiedAt: timestamp('verified_at', { withTimezone: true }),
    /** Cosine similarity is computed in app: pgvector is not assumed present. */
    embedding: real('embedding').array(),
    createdAt: now(),
  },
  (t) => [
    index('holding_document_idx').on(t.sourceDocumentId),
    index('holding_filters_idx').on(t.serviceType, t.payerType, t.denialBasis),
    index('holding_verified_idx').on(t.verifiedAt),
  ],
);

/* ─────────────────────────────────────────────────────────────────────────────
   Cases  (PHI)
   ────────────────────────────────────────────────────────────────────────── */

export const denial = pgTable(
  'denial',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    organizationId: text('organization_id')
      .notNull()
      .references(() => organization.id, { onDelete: 'cascade' }),
    /** The hospital's own reference for the case. */
    internalRef: text('internal_ref').notNull(),
    payerName: text('payer_name').notNull(),
    planType: payerTypeEnum('plan_type').notNull(),
    denialReasonCode: text('denial_reason_code'),
    /** The payer's stated reason, quoted from the letter. Clinical adjacent. */
    denialBasisText: encryptedText('denial_basis_text'),
    denialBasis: denialBasisEnum('denial_basis'),
    serviceType: serviceTypeEnum('service_type').notNull(),
    claimAmountCents: integer('claim_amount_cents').notNull(),
    serviceDateFrom: timestamp('service_date_from', { withTimezone: true }),
    serviceDateTo: timestamp('service_date_to', { withTimezone: true }),
    appealDeadline: timestamp('appeal_deadline', { withTimezone: true }),
    status: denialStatusEnum('status').notNull().default('intake'),
    /**
     * Every case must be declared synthetic while PHI_MODE=synthetic. The
     * upload path rejects anything untagged, and this column records the claim.
     */
    isSynthetic: boolean('is_synthetic').notNull(),
    createdBy: text('created_by')
      .notNull()
      .references(() => user.id),
    createdAt: now(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex('denial_org_ref_idx').on(t.organizationId, t.internalRef),
    index('denial_org_status_idx').on(t.organizationId, t.status),
    index('denial_deadline_idx').on(t.appealDeadline),
  ],
);

export const denialDocument = pgTable(
  'denial_document',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    denialId: uuid('denial_id')
      .notNull()
      .references(() => denial.id, { onDelete: 'cascade' }),
    kind: documentKindEnum('kind').notNull(),
    r2Key: text('r2_key').notNull(),
    filename: text('filename').notNull(),
    byteSize: integer('byte_size').notNull(),
    contentHash: text('content_hash').notNull(),
    parsedAt: timestamp('parsed_at', { withTimezone: true }),
    uploadedBy: text('uploaded_by')
      .notNull()
      .references(() => user.id),
    uploadedAt: timestamp('uploaded_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index('denial_document_denial_idx').on(t.denialId)],
);

/** A located passage of a submitted document. The clinical mirror of sourceSpan. */
export const denialSpan = pgTable(
  'denial_span',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    denialDocumentId: uuid('denial_document_id')
      .notNull()
      .references(() => denialDocument.id, { onDelete: 'cascade' }),
    ordinal: integer('ordinal').notNull(),
    page: integer('page'),
    charStart: integer('char_start').notNull(),
    charEnd: integer('char_end').notNull(),
    text: encryptedText('text').notNull(),
    createdAt: now(),
  },
  (t) => [
    uniqueIndex('denial_span_ordinal_idx').on(t.denialDocumentId, t.ordinal),
    index('denial_span_document_idx').on(t.denialDocumentId),
  ],
);

export const clinicalFact = pgTable(
  'clinical_fact',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    denialId: uuid('denial_id')
      .notNull()
      .references(() => denial.id, { onDelete: 'cascade' }),
    spanId: uuid('span_id')
      .notNull()
      .references(() => denialSpan.id, { onDelete: 'cascade' }),
    verbatimQuote: encryptedText('verbatim_quote').notNull(),
    factType: factTypeEnum('fact_type').notNull(),
    normalizedValue: encryptedText('normalized_value'),
    extractedAt: timestamp('extracted_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index('clinical_fact_denial_idx').on(t.denialId)],
);

/* ─────────────────────────────────────────────────────────────────────────────
   Appeals  (PHI)
   ────────────────────────────────────────────────────────────────────────── */

export const appealDraft = pgTable(
  'appeal_draft',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    denialId: uuid('denial_id')
      .notNull()
      .references(() => denial.id, { onDelete: 'cascade' }),
    version: integer('version').notNull(),
    /** Rendered letter structure. Section headings plus assertion ordinals. */
    bodyJson: encryptedText('body_json').notNull(),
    status: draftStatusEnum('status').notNull().default('generating'),
    /** Criteria with no supporting clinical fact. Surfaced, never papered over. */
    documentationGaps: jsonb('documentation_gaps')
      .$type<{ criterion: string; why: string }[]>()
      .notNull()
      .default(sql`'[]'::jsonb`),
    /** Set when the denial rests on internal plan criteria, not Medicare rules. */
    proprietaryCriteriaFlag: boolean('proprietary_criteria_flag')
      .notNull()
      .default(false),
    verificationFailures: integer('verification_failures').notNull().default(0),
    generatedAt: timestamp('generated_at', { withTimezone: true }).notNull().defaultNow(),
    generatedByModel: text('generated_by_model').notNull(),
  },
  (t) => [
    uniqueIndex('appeal_draft_version_idx').on(t.denialId, t.version),
    index('appeal_draft_denial_idx').on(t.denialId),
  ],
);

/**
 * The citation invariant in table form.
 *
 * sourceId and verbatimQuote are NOT NULL. There is no insert path that omits
 * them, in the type system (lib/appeals/assertion.ts) or here. A row in this
 * table is a claim the product is prepared to defend against its source.
 */
export const assertion = pgTable(
  'assertion',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    appealDraftId: uuid('appeal_draft_id')
      .notNull()
      .references(() => appealDraft.id, { onDelete: 'cascade' }),
    ordinal: integer('ordinal').notNull(),
    section: text('section').notNull(),
    kind: assertionKindEnum('kind').notNull(),
    text: encryptedText('text').notNull(),
    sourceKind: assertionSourceKindEnum('source_kind').notNull(),
    sourceId: uuid('source_id').notNull(),
    verbatimQuote: encryptedText('verbatim_quote').notNull(),
    verifiedAt: timestamp('verified_at', { withTimezone: true }).notNull().defaultNow(),
    /** Set when a reviewer rewrites the sentence. The edit is re-verified. */
    editedByReviewerId: text('edited_by_reviewer_id').references(() => user.id),
    editedAt: timestamp('edited_at', { withTimezone: true }),
  },
  (t) => [
    uniqueIndex('assertion_ordinal_idx').on(t.appealDraftId, t.ordinal),
    index('assertion_draft_idx').on(t.appealDraftId),
  ],
);

/** A reviewer's per-assertion verdict, recorded as they work the checklist. */
export const assertionReview = pgTable(
  'assertion_review',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    assertionId: uuid('assertion_id')
      .notNull()
      .references(() => assertion.id, { onDelete: 'cascade' }),
    reviewerId: text('reviewer_id')
      .notNull()
      .references(() => user.id),
    reviewType: reviewTypeEnum('review_type').notNull(),
    verified: boolean('verified').notNull(),
    notes: encryptedText('notes'),
    createdAt: now(),
  },
  (t) => [
    uniqueIndex('assertion_review_idx').on(t.assertionId, t.reviewerId, t.reviewType),
  ],
);

export const reviewAction = pgTable(
  'review_action',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    appealDraftId: uuid('appeal_draft_id')
      .notNull()
      .references(() => appealDraft.id, { onDelete: 'cascade' }),
    reviewerId: text('reviewer_id')
      .notNull()
      .references(() => user.id),
    reviewType: reviewTypeEnum('review_type').notNull(),
    action: reviewActionEnum('action').notNull(),
    notes: encryptedText('notes'),
    createdAt: now(),
  },
  (t) => [index('review_action_draft_idx').on(t.appealDraftId)],
);

export const submission = pgTable(
  'submission',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    appealDraftId: uuid('appeal_draft_id')
      .notNull()
      .references(() => appealDraft.id, { onDelete: 'cascade' }),
    submittedAt: timestamp('submitted_at', { withTimezone: true }).notNull(),
    submittedBy: text('submitted_by')
      .notNull()
      .references(() => user.id),
    method: text('method').notNull(),
    trackingRef: text('tracking_ref'),
    createdAt: now(),
  },
  (t) => [index('submission_draft_idx').on(t.appealDraftId)],
);

export const outcome = pgTable(
  'outcome',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    denialId: uuid('denial_id')
      .notNull()
      .references(() => denial.id, { onDelete: 'cascade' })
      .unique(),
    result: outcomeResultEnum('result').notNull(),
    decidedAt: timestamp('decided_at', { withTimezone: true }).notNull(),
    amountRecoveredCents: integer('amount_recovered_cents').notNull().default(0),
    evidenceDocKey: text('evidence_doc_key'),
    recordedBy: text('recorded_by')
      .notNull()
      .references(() => user.id),
    /** Set when the outcome has been rolled into an issued invoice. */
    invoiceId: uuid('invoice_id'),
    createdAt: now(),
  },
  (t) => [index('outcome_denial_idx').on(t.denialId)],
);

/* ─────────────────────────────────────────────────────────────────────────────
   Billing  (PUBLIC: money, no clinical content)
   ────────────────────────────────────────────────────────────────────────── */

export const invoice = pgTable(
  'invoice',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    organizationId: text('organization_id')
      .notNull()
      .references(() => organization.id, { onDelete: 'cascade' }),
    number: text('number').notNull().unique(),
    periodStart: timestamp('period_start', { withTimezone: true }).notNull(),
    periodEnd: timestamp('period_end', { withTimezone: true }).notNull(),
    totalRecoveredCents: integer('total_recovered_cents').notNull(),
    contingencyRateBps: integer('contingency_rate_bps').notNull(),
    feeCents: integer('fee_cents').notNull(),
    status: invoiceStatusEnum('status').notNull().default('draft'),
    issuedAt: timestamp('issued_at', { withTimezone: true }),
    createdAt: now(),
  },
  (t) => [
    index('invoice_org_idx').on(t.organizationId),
    uniqueIndex('invoice_org_period_idx').on(t.organizationId, t.periodStart, t.periodEnd),
  ],
);

/* ─────────────────────────────────────────────────────────────────────────────
   Platform  (PUBLIC)
   ────────────────────────────────────────────────────────────────────────── */

/**
 * Append only. There is no update or delete path in the application, and
 * lib/audit.ts exposes writes and reads but no mutation. Compliance
 * requirement 3.
 */
export const auditLog = pgTable(
  'audit_log',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    userId: text('user_id').references(() => user.id, { onDelete: 'set null' }),
    organizationId: text('organization_id'),
    action: text('action').notNull(),
    entityType: text('entity_type').notNull(),
    entityId: text('entity_id'),
    /** True when the touched record was in a PHI table. */
    phi: boolean('phi').notNull().default(false),
    ip: text('ip'),
    userAgent: text('user_agent'),
    createdAt: now(),
  },
  (t) => [
    index('audit_log_user_idx').on(t.userId),
    index('audit_log_entity_idx').on(t.entityType, t.entityId),
    index('audit_log_created_idx').on(t.createdAt),
  ],
);

export const llmCall = pgTable(
  'llm_call',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    stage: text('stage').notNull(),
    model: text('model').notNull(),
    /** SHA-256 of the prompt. The prompt itself is never stored. */
    inputHash: text('input_hash').notNull(),
    denialId: uuid('denial_id').references(() => denial.id, { onDelete: 'set null' }),
    promptTokens: integer('prompt_tokens').notNull(),
    completionTokens: integer('completion_tokens').notNull(),
    costCents: integer('cost_cents').notNull(),
    latencyMs: integer('latency_ms').notNull(),
    ok: boolean('ok').notNull().default(true),
    createdAt: now(),
  },
  (t) => [
    index('llm_call_stage_idx').on(t.stage),
    index('llm_call_created_idx').on(t.createdAt),
  ],
);

export const job = pgTable(
  'job',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    kind: text('kind').notNull(),
    payload: jsonb('payload').$type<Record<string, unknown>>().notNull(),
    status: jobStatusEnum('status').notNull().default('pending'),
    attempts: integer('attempts').notNull().default(0),
    maxAttempts: integer('max_attempts').notNull().default(5),
    runAfter: timestamp('run_after', { withTimezone: true }).notNull().defaultNow(),
    lastError: text('last_error'),
    createdAt: now(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index('job_drain_idx').on(t.status, t.runAfter)],
);

export const contact = pgTable(
  'contact',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    email: text('email').notNull().unique(),
    firstName: text('first_name'),
    lastName: text('last_name'),
    title: text('title'),
    orgName: text('org_name'),
    source: text('source').notNull().default('manual'),
    unsubscribedAt: timestamp('unsubscribed_at', { withTimezone: true }),
    /** Random token in the unsubscribe link, so the link needs no session. */
    unsubscribeToken: text('unsubscribe_token').notNull().unique(),
    createdAt: now(),
  },
  (t) => [index('contact_unsubscribed_idx').on(t.unsubscribedAt)],
);

export const campaign = pgTable('campaign', {
  id: uuid('id').primaryKey().defaultRandom(),
  name: text('name').notNull(),
  subject: text('subject').notNull(),
  body: text('body').notNull(),
  /** A campaign cannot send until the operator has sent a test to themselves. */
  testSentAt: timestamp('test_sent_at', { withTimezone: true }),
  startedAt: timestamp('started_at', { withTimezone: true }),
  createdBy: text('created_by')
    .notNull()
    .references(() => user.id),
  createdAt: now(),
});

export const emailSend = pgTable(
  'email_send',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    contactId: uuid('contact_id').references(() => contact.id, { onDelete: 'cascade' }),
    campaignId: uuid('campaign_id').references(() => campaign.id, { onDelete: 'cascade' }),
    toEmail: text('to_email').notNull(),
    subject: text('subject').notNull(),
    body: text('body').notNull(),
    status: emailStatusEnum('status').notNull().default('queued'),
    providerId: text('provider_id'),
    error: text('error'),
    sentAt: timestamp('sent_at', { withTimezone: true }),
    createdAt: now(),
  },
  (t) => [
    index('email_send_contact_idx').on(t.contactId),
    index('email_send_campaign_idx').on(t.campaignId),
    index('email_send_sent_idx').on(t.sentAt),
  ],
);

export const demoRequest = pgTable(
  'demo_request',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    name: text('name').notNull(),
    email: text('email').notNull(),
    orgName: text('org_name').notNull(),
    title: text('title').notNull(),
    message: text('message'),
    annualDenialVolume: text('annual_denial_volume').notNull(),
    status: demoRequestStatusEnum('status').notNull().default('new'),
    ip: text('ip'),
    notifiedAt: timestamp('notified_at', { withTimezone: true }),
    createdAt: now(),
  },
  (t) => [index('demo_request_created_idx').on(t.createdAt)],
);

/**
 * Requests to erase an organisation's data, and the record that it happened.
 * Compliance requirement 6. The deletion itself cascades through the foreign
 * keys above; this row plus the audit entry survive it.
 */
export const deletionRequest = pgTable('deletion_request', {
  id: uuid('id').primaryKey().defaultRandom(),
  organizationId: text('organization_id').notNull(),
  organizationName: text('organization_name').notNull(),
  requestedBy: text('requested_by').notNull(),
  reason: text('reason'),
  /** Counts by table, so the erasure can be evidenced after the rows are gone. */
  deletedCounts: jsonb('deleted_counts').$type<Record<string, number>>(),
  requestedAt: timestamp('requested_at', { withTimezone: true }).notNull().defaultNow(),
  completedAt: timestamp('completed_at', { withTimezone: true }),
});

/* ─────────────────────────────────────────────────────────────────────────────
   Data classification
   ────────────────────────────────────────────────────────────────────────── */

/**
 * Tables that hold content derived from a hospital's submitted documents.
 * lib/analytics/guard.ts refuses to build a query that touches any of these,
 * which is how requirement 1's "never joined into analytics" is enforced rather
 * than merely intended.
 */
export const PHI_TABLES = [
  'denial',
  'denial_document',
  'denial_span',
  'clinical_fact',
  'appeal_draft',
  'assertion',
  'assertion_review',
  'review_action',
  'submission',
  'outcome',
] as const;

export type PhiTable = (typeof PHI_TABLES)[number];

export function isPhiTable(name: string): boolean {
  return (PHI_TABLES as readonly string[]).includes(name);
}

/* ─────────────────────────────────────────────────────────────────────────────
   Relations
   ────────────────────────────────────────────────────────────────────────── */

export const organizationRelations = relations(organization, ({ many }) => ({
  members: many(member),
  denials: many(denial),
  invoices: many(invoice),
  reviewerAssignments: many(reviewerAssignment),
}));

export const userRelations = relations(user, ({ many }) => ({
  memberships: many(member),
  reviewerAssignments: many(reviewerAssignment),
}));

export const memberRelations = relations(member, ({ one }) => ({
  organization: one(organization, {
    fields: [member.organizationId],
    references: [organization.id],
  }),
  user: one(user, { fields: [member.userId], references: [user.id] }),
}));

export const reviewerAssignmentRelations = relations(reviewerAssignment, ({ one }) => ({
  user: one(user, { fields: [reviewerAssignment.userId], references: [user.id] }),
  organization: one(organization, {
    fields: [reviewerAssignment.organizationId],
    references: [organization.id],
  }),
}));

export const sourceDocumentRelations = relations(sourceDocument, ({ many }) => ({
  spans: many(sourceSpan),
  holdings: many(holding),
}));

export const sourceSpanRelations = relations(sourceSpan, ({ one, many }) => ({
  document: one(sourceDocument, {
    fields: [sourceSpan.sourceDocumentId],
    references: [sourceDocument.id],
  }),
  holdings: many(holding),
}));

export const holdingRelations = relations(holding, ({ one }) => ({
  document: one(sourceDocument, {
    fields: [holding.sourceDocumentId],
    references: [sourceDocument.id],
  }),
  span: one(sourceSpan, { fields: [holding.spanId], references: [sourceSpan.id] }),
}));

export const denialRelations = relations(denial, ({ one, many }) => ({
  organization: one(organization, {
    fields: [denial.organizationId],
    references: [organization.id],
  }),
  documents: many(denialDocument),
  facts: many(clinicalFact),
  drafts: many(appealDraft),
  outcome: one(outcome, { fields: [denial.id], references: [outcome.denialId] }),
}));

export const denialDocumentRelations = relations(denialDocument, ({ one, many }) => ({
  denial: one(denial, { fields: [denialDocument.denialId], references: [denial.id] }),
  spans: many(denialSpan),
}));

export const denialSpanRelations = relations(denialSpan, ({ one, many }) => ({
  document: one(denialDocument, {
    fields: [denialSpan.denialDocumentId],
    references: [denialDocument.id],
  }),
  facts: many(clinicalFact),
}));

export const clinicalFactRelations = relations(clinicalFact, ({ one }) => ({
  denial: one(denial, { fields: [clinicalFact.denialId], references: [denial.id] }),
  span: one(denialSpan, { fields: [clinicalFact.spanId], references: [denialSpan.id] }),
}));

export const appealDraftRelations = relations(appealDraft, ({ one, many }) => ({
  denial: one(denial, { fields: [appealDraft.denialId], references: [denial.id] }),
  assertions: many(assertion),
  reviewActions: many(reviewAction),
  submissions: many(submission),
}));

export const assertionRelations = relations(assertion, ({ one, many }) => ({
  draft: one(appealDraft, {
    fields: [assertion.appealDraftId],
    references: [appealDraft.id],
  }),
  reviews: many(assertionReview),
}));

export const outcomeRelations = relations(outcome, ({ one }) => ({
  denial: one(denial, { fields: [outcome.denialId], references: [denial.id] }),
}));

export const invoiceRelations = relations(invoice, ({ one }) => ({
  organization: one(organization, {
    fields: [invoice.organizationId],
    references: [organization.id],
  }),
}));

export const contactRelations = relations(contact, ({ many }) => ({
  sends: many(emailSend),
}));

export const emailSendRelations = relations(emailSend, ({ one }) => ({
  contact: one(contact, { fields: [emailSend.contactId], references: [contact.id] }),
  campaign: one(campaign, { fields: [emailSend.campaignId], references: [campaign.id] }),
}));
