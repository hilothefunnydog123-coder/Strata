CREATE TYPE "public"."assertion_kind" AS ENUM('legal', 'clinical');--> statement-breakpoint
CREATE TYPE "public"."assertion_source_kind" AS ENUM('holding', 'source_span', 'clinical_fact');--> statement-breakpoint
CREATE TYPE "public"."demo_request_status" AS ENUM('new', 'contacted', 'qualified', 'closed');--> statement-breakpoint
CREATE TYPE "public"."denial_basis" AS ENUM('medical_necessity', 'level_of_care', 'not_covered_benefit', 'insufficient_documentation', 'proprietary_criteria', 'administrative', 'other');--> statement-breakpoint
CREATE TYPE "public"."denial_status" AS ENUM('intake', 'parsing', 'ready_for_generation', 'generating', 'clinical_review', 'legal_review', 'approved', 'submitted', 'decided', 'invoiced');--> statement-breakpoint
CREATE TYPE "public"."document_kind" AS ENUM('denial_letter', 'clinical_record', 'eob', 'other');--> statement-breakpoint
CREATE TYPE "public"."draft_status" AS ENUM('generating', 'verification_failed', 'ready', 'superseded');--> statement-breakpoint
CREATE TYPE "public"."email_status" AS ENUM('queued', 'sent', 'failed', 'skipped_unsubscribed');--> statement-breakpoint
CREATE TYPE "public"."fact_type" AS ENUM('diagnosis', 'functional_status', 'therapy_intensity', 'skilled_service', 'physician_order', 'nursing_observation', 'prior_level_of_function', 'discharge_plan', 'vital_sign', 'medication', 'other');--> statement-breakpoint
CREATE TYPE "public"."holding_outcome" AS ENUM('claimant_favorable', 'plan_favorable', 'mixed');--> statement-breakpoint
CREATE TYPE "public"."invoice_status" AS ENUM('draft', 'issued', 'paid', 'void');--> statement-breakpoint
CREATE TYPE "public"."job_status" AS ENUM('pending', 'running', 'done', 'failed');--> statement-breakpoint
CREATE TYPE "public"."org_role" AS ENUM('org_admin', 'appeal_specialist', 'readonly');--> statement-breakpoint
CREATE TYPE "public"."org_status" AS ENUM('active', 'inactive');--> statement-breakpoint
CREATE TYPE "public"."outcome_result" AS ENUM('won', 'lost', 'partial', 'withdrawn');--> statement-breakpoint
CREATE TYPE "public"."payer_type" AS ENUM('medicare_advantage', 'traditional_medicare', 'medicaid_managed_care', 'commercial', 'other');--> statement-breakpoint
CREATE TYPE "public"."platform_role" AS ENUM('none', 'superadmin', 'clinical_reviewer', 'legal_reviewer');--> statement-breakpoint
CREATE TYPE "public"."review_verdict" AS ENUM('approved', 'rejected', 'edited');--> statement-breakpoint
CREATE TYPE "public"."review_type" AS ENUM('clinical', 'legal');--> statement-breakpoint
CREATE TYPE "public"."service_type" AS ENUM('skilled_nursing', 'inpatient_rehab', 'home_health', 'long_term_care_hospital', 'inpatient_acute', 'outpatient', 'dme', 'other');--> statement-breakpoint
CREATE TYPE "public"."source_type" AS ENUM('dab_decision', 'regulation', 'manual', 'lcd', 'ncd');--> statement-breakpoint
CREATE TYPE "public"."user_status" AS ENUM('active', 'disabled');--> statement-breakpoint
CREATE TABLE "account" (
	"id" text PRIMARY KEY NOT NULL,
	"account_id" text NOT NULL,
	"provider_id" text NOT NULL,
	"user_id" text NOT NULL,
	"access_token" text,
	"refresh_token" text,
	"id_token" text,
	"access_token_expires_at" timestamp with time zone,
	"refresh_token_expires_at" timestamp with time zone,
	"scope" text,
	"password" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "appeal_draft" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"denial_id" uuid NOT NULL,
	"version" integer NOT NULL,
	"body_json" text NOT NULL,
	"status" "draft_status" DEFAULT 'generating' NOT NULL,
	"documentation_gaps" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"proprietary_criteria_flag" boolean DEFAULT false NOT NULL,
	"verification_failures" integer DEFAULT 0 NOT NULL,
	"generated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"generated_by_model" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE "assertion" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"appeal_draft_id" uuid NOT NULL,
	"ordinal" integer NOT NULL,
	"section" text NOT NULL,
	"kind" "assertion_kind" NOT NULL,
	"text" text NOT NULL,
	"source_kind" "assertion_source_kind" NOT NULL,
	"source_id" uuid NOT NULL,
	"verbatim_quote" text NOT NULL,
	"verified_at" timestamp with time zone DEFAULT now() NOT NULL,
	"edited_by_reviewer_id" text,
	"edited_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "assertion_review" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"assertion_id" uuid NOT NULL,
	"reviewer_id" text NOT NULL,
	"review_type" "review_type" NOT NULL,
	"verified" boolean NOT NULL,
	"notes" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "audit_log" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" text,
	"organization_id" text,
	"action" text NOT NULL,
	"entity_type" text NOT NULL,
	"entity_id" text,
	"phi" boolean DEFAULT false NOT NULL,
	"ip" text,
	"user_agent" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "campaign" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"subject" text NOT NULL,
	"body" text NOT NULL,
	"test_sent_at" timestamp with time zone,
	"started_at" timestamp with time zone,
	"created_by" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "clinical_fact" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"denial_id" uuid NOT NULL,
	"span_id" uuid NOT NULL,
	"verbatim_quote" text NOT NULL,
	"fact_type" "fact_type" NOT NULL,
	"normalized_value" text,
	"extracted_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "contact" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"email" text NOT NULL,
	"first_name" text,
	"last_name" text,
	"title" text,
	"org_name" text,
	"source" text DEFAULT 'manual' NOT NULL,
	"unsubscribed_at" timestamp with time zone,
	"unsubscribe_token" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "contact_email_unique" UNIQUE("email"),
	CONSTRAINT "contact_unsubscribe_token_unique" UNIQUE("unsubscribe_token")
);
--> statement-breakpoint
CREATE TABLE "deletion_request" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" text NOT NULL,
	"organization_name" text NOT NULL,
	"requested_by" text NOT NULL,
	"reason" text,
	"deleted_counts" jsonb,
	"requested_at" timestamp with time zone DEFAULT now() NOT NULL,
	"completed_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "demo_request" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"email" text NOT NULL,
	"org_name" text NOT NULL,
	"title" text NOT NULL,
	"message" text,
	"annual_denial_volume" text NOT NULL,
	"status" "demo_request_status" DEFAULT 'new' NOT NULL,
	"ip" text,
	"notified_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "denial" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" text NOT NULL,
	"internal_ref" text NOT NULL,
	"payer_name" text NOT NULL,
	"plan_type" "payer_type" NOT NULL,
	"denial_reason_code" text,
	"denial_basis_text" text,
	"denial_basis" "denial_basis",
	"service_type" "service_type" NOT NULL,
	"claim_amount_cents" integer NOT NULL,
	"service_date_from" timestamp with time zone,
	"service_date_to" timestamp with time zone,
	"appeal_deadline" timestamp with time zone,
	"status" "denial_status" DEFAULT 'intake' NOT NULL,
	"is_synthetic" boolean NOT NULL,
	"created_by" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "denial_document" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"denial_id" uuid NOT NULL,
	"kind" "document_kind" NOT NULL,
	"r2_key" text NOT NULL,
	"filename" text NOT NULL,
	"byte_size" integer NOT NULL,
	"content_hash" text NOT NULL,
	"parsed_at" timestamp with time zone,
	"uploaded_by" text NOT NULL,
	"uploaded_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "denial_span" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"denial_document_id" uuid NOT NULL,
	"ordinal" integer NOT NULL,
	"page" integer,
	"char_start" integer NOT NULL,
	"char_end" integer NOT NULL,
	"text" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "email_send" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"contact_id" uuid,
	"campaign_id" uuid,
	"to_email" text NOT NULL,
	"subject" text NOT NULL,
	"body" text NOT NULL,
	"status" "email_status" DEFAULT 'queued' NOT NULL,
	"provider_id" text,
	"error" text,
	"sent_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "holding" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"source_document_id" uuid NOT NULL,
	"span_id" uuid NOT NULL,
	"verbatim_quote" text NOT NULL,
	"issue" text NOT NULL,
	"rule_applied" text NOT NULL,
	"outcome" "holding_outcome" NOT NULL,
	"service_type" "service_type",
	"payer_type" "payer_type",
	"denial_basis" "denial_basis",
	"verified_at" timestamp with time zone,
	"embedding" real[],
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "invitation" (
	"id" text PRIMARY KEY NOT NULL,
	"organization_id" text NOT NULL,
	"email" text NOT NULL,
	"role" text,
	"status" text DEFAULT 'pending' NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"inviter_id" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE "invoice" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" text NOT NULL,
	"number" text NOT NULL,
	"period_start" timestamp with time zone NOT NULL,
	"period_end" timestamp with time zone NOT NULL,
	"total_recovered_cents" integer NOT NULL,
	"contingency_rate_bps" integer NOT NULL,
	"fee_cents" integer NOT NULL,
	"status" "invoice_status" DEFAULT 'draft' NOT NULL,
	"issued_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "invoice_number_unique" UNIQUE("number")
);
--> statement-breakpoint
CREATE TABLE "job" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"kind" text NOT NULL,
	"payload" jsonb NOT NULL,
	"status" "job_status" DEFAULT 'pending' NOT NULL,
	"attempts" integer DEFAULT 0 NOT NULL,
	"max_attempts" integer DEFAULT 5 NOT NULL,
	"run_after" timestamp with time zone DEFAULT now() NOT NULL,
	"last_error" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "llm_call" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"stage" text NOT NULL,
	"model" text NOT NULL,
	"input_hash" text NOT NULL,
	"denial_id" uuid,
	"prompt_tokens" integer NOT NULL,
	"completion_tokens" integer NOT NULL,
	"cost_cents" integer NOT NULL,
	"latency_ms" integer NOT NULL,
	"ok" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "member" (
	"id" text PRIMARY KEY NOT NULL,
	"organization_id" text NOT NULL,
	"user_id" text NOT NULL,
	"role" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "organization" (
	"id" text PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"slug" text NOT NULL,
	"logo" text,
	"metadata" text,
	"contingency_rate_bps" integer DEFAULT 1500 NOT NULL,
	"status" "org_status" DEFAULT 'active' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "organization_slug_unique" UNIQUE("slug")
);
--> statement-breakpoint
CREATE TABLE "outcome" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"denial_id" uuid NOT NULL,
	"result" "outcome_result" NOT NULL,
	"decided_at" timestamp with time zone NOT NULL,
	"amount_recovered_cents" integer DEFAULT 0 NOT NULL,
	"evidence_doc_key" text,
	"recorded_by" text NOT NULL,
	"invoice_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "outcome_denial_id_unique" UNIQUE("denial_id")
);
--> statement-breakpoint
CREATE TABLE "rate_limit" (
	"id" text PRIMARY KEY NOT NULL,
	"key" text NOT NULL,
	"count" integer DEFAULT 0 NOT NULL,
	"last_request" bigint NOT NULL
);
--> statement-breakpoint
CREATE TABLE "review_action" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"appeal_draft_id" uuid NOT NULL,
	"reviewer_id" text NOT NULL,
	"review_type" "review_type" NOT NULL,
	"action" "review_verdict" NOT NULL,
	"notes" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "reviewer_assignment" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" text NOT NULL,
	"organization_id" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "session" (
	"id" text PRIMARY KEY NOT NULL,
	"token" text NOT NULL,
	"user_id" text NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"ip_address" text,
	"user_agent" text,
	"active_organization_id" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "session_token_unique" UNIQUE("token")
);
--> statement-breakpoint
CREATE TABLE "source_document" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"source_type" "source_type" NOT NULL,
	"citation" text NOT NULL,
	"title" text NOT NULL,
	"url" text NOT NULL,
	"decided_at" timestamp with time zone,
	"retrieved_at" timestamp with time zone NOT NULL,
	"content_hash" text NOT NULL,
	"raw_path" text NOT NULL,
	"parsed_at" timestamp with time zone,
	"extracted_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "source_span" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"source_document_id" uuid NOT NULL,
	"ordinal" integer NOT NULL,
	"page" integer,
	"char_start" integer NOT NULL,
	"char_end" integer NOT NULL,
	"text" text NOT NULL,
	"heading_path" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "submission" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"appeal_draft_id" uuid NOT NULL,
	"submitted_at" timestamp with time zone NOT NULL,
	"submitted_by" text NOT NULL,
	"method" text NOT NULL,
	"tracking_ref" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "two_factor" (
	"id" text PRIMARY KEY NOT NULL,
	"secret" text NOT NULL,
	"backup_codes" text NOT NULL,
	"verified" boolean DEFAULT false NOT NULL,
	"failed_verification_count" integer DEFAULT 0 NOT NULL,
	"locked_until" timestamp with time zone,
	"user_id" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE "user" (
	"id" text PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"email" text NOT NULL,
	"email_verified" boolean DEFAULT false NOT NULL,
	"image" text,
	"two_factor_enabled" boolean DEFAULT false NOT NULL,
	"status" "user_status" DEFAULT 'active' NOT NULL,
	"platform_role" "platform_role" DEFAULT 'none' NOT NULL,
	"must_change_password" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "user_email_unique" UNIQUE("email")
);
--> statement-breakpoint
CREATE TABLE "verification" (
	"id" text PRIMARY KEY NOT NULL,
	"identifier" text NOT NULL,
	"value" text NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "account" ADD CONSTRAINT "account_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "appeal_draft" ADD CONSTRAINT "appeal_draft_denial_id_denial_id_fk" FOREIGN KEY ("denial_id") REFERENCES "public"."denial"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "assertion" ADD CONSTRAINT "assertion_appeal_draft_id_appeal_draft_id_fk" FOREIGN KEY ("appeal_draft_id") REFERENCES "public"."appeal_draft"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "assertion" ADD CONSTRAINT "assertion_edited_by_reviewer_id_user_id_fk" FOREIGN KEY ("edited_by_reviewer_id") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "assertion_review" ADD CONSTRAINT "assertion_review_assertion_id_assertion_id_fk" FOREIGN KEY ("assertion_id") REFERENCES "public"."assertion"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "assertion_review" ADD CONSTRAINT "assertion_review_reviewer_id_user_id_fk" FOREIGN KEY ("reviewer_id") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "audit_log" ADD CONSTRAINT "audit_log_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "campaign" ADD CONSTRAINT "campaign_created_by_user_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "clinical_fact" ADD CONSTRAINT "clinical_fact_denial_id_denial_id_fk" FOREIGN KEY ("denial_id") REFERENCES "public"."denial"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "clinical_fact" ADD CONSTRAINT "clinical_fact_span_id_denial_span_id_fk" FOREIGN KEY ("span_id") REFERENCES "public"."denial_span"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "denial" ADD CONSTRAINT "denial_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "denial" ADD CONSTRAINT "denial_created_by_user_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "denial_document" ADD CONSTRAINT "denial_document_denial_id_denial_id_fk" FOREIGN KEY ("denial_id") REFERENCES "public"."denial"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "denial_document" ADD CONSTRAINT "denial_document_uploaded_by_user_id_fk" FOREIGN KEY ("uploaded_by") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "denial_span" ADD CONSTRAINT "denial_span_denial_document_id_denial_document_id_fk" FOREIGN KEY ("denial_document_id") REFERENCES "public"."denial_document"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "email_send" ADD CONSTRAINT "email_send_contact_id_contact_id_fk" FOREIGN KEY ("contact_id") REFERENCES "public"."contact"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "email_send" ADD CONSTRAINT "email_send_campaign_id_campaign_id_fk" FOREIGN KEY ("campaign_id") REFERENCES "public"."campaign"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "holding" ADD CONSTRAINT "holding_source_document_id_source_document_id_fk" FOREIGN KEY ("source_document_id") REFERENCES "public"."source_document"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "holding" ADD CONSTRAINT "holding_span_id_source_span_id_fk" FOREIGN KEY ("span_id") REFERENCES "public"."source_span"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "invitation" ADD CONSTRAINT "invitation_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "invitation" ADD CONSTRAINT "invitation_inviter_id_user_id_fk" FOREIGN KEY ("inviter_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "invoice" ADD CONSTRAINT "invoice_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "llm_call" ADD CONSTRAINT "llm_call_denial_id_denial_id_fk" FOREIGN KEY ("denial_id") REFERENCES "public"."denial"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "member" ADD CONSTRAINT "member_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "member" ADD CONSTRAINT "member_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "outcome" ADD CONSTRAINT "outcome_denial_id_denial_id_fk" FOREIGN KEY ("denial_id") REFERENCES "public"."denial"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "outcome" ADD CONSTRAINT "outcome_recorded_by_user_id_fk" FOREIGN KEY ("recorded_by") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "review_action" ADD CONSTRAINT "review_action_appeal_draft_id_appeal_draft_id_fk" FOREIGN KEY ("appeal_draft_id") REFERENCES "public"."appeal_draft"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "review_action" ADD CONSTRAINT "review_action_reviewer_id_user_id_fk" FOREIGN KEY ("reviewer_id") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "reviewer_assignment" ADD CONSTRAINT "reviewer_assignment_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "reviewer_assignment" ADD CONSTRAINT "reviewer_assignment_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "session" ADD CONSTRAINT "session_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "source_span" ADD CONSTRAINT "source_span_source_document_id_source_document_id_fk" FOREIGN KEY ("source_document_id") REFERENCES "public"."source_document"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "submission" ADD CONSTRAINT "submission_appeal_draft_id_appeal_draft_id_fk" FOREIGN KEY ("appeal_draft_id") REFERENCES "public"."appeal_draft"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "submission" ADD CONSTRAINT "submission_submitted_by_user_id_fk" FOREIGN KEY ("submitted_by") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "two_factor" ADD CONSTRAINT "two_factor_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "account_user_idx" ON "account" USING btree ("user_id");--> statement-breakpoint
CREATE UNIQUE INDEX "appeal_draft_version_idx" ON "appeal_draft" USING btree ("denial_id","version");--> statement-breakpoint
CREATE INDEX "appeal_draft_denial_idx" ON "appeal_draft" USING btree ("denial_id");--> statement-breakpoint
CREATE UNIQUE INDEX "assertion_ordinal_idx" ON "assertion" USING btree ("appeal_draft_id","ordinal");--> statement-breakpoint
CREATE INDEX "assertion_draft_idx" ON "assertion" USING btree ("appeal_draft_id");--> statement-breakpoint
CREATE UNIQUE INDEX "assertion_review_idx" ON "assertion_review" USING btree ("assertion_id","reviewer_id","review_type");--> statement-breakpoint
CREATE INDEX "audit_log_user_idx" ON "audit_log" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "audit_log_entity_idx" ON "audit_log" USING btree ("entity_type","entity_id");--> statement-breakpoint
CREATE INDEX "audit_log_created_idx" ON "audit_log" USING btree ("created_at");--> statement-breakpoint
CREATE INDEX "clinical_fact_denial_idx" ON "clinical_fact" USING btree ("denial_id");--> statement-breakpoint
CREATE INDEX "contact_unsubscribed_idx" ON "contact" USING btree ("unsubscribed_at");--> statement-breakpoint
CREATE INDEX "demo_request_created_idx" ON "demo_request" USING btree ("created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "denial_org_ref_idx" ON "denial" USING btree ("organization_id","internal_ref");--> statement-breakpoint
CREATE INDEX "denial_org_status_idx" ON "denial" USING btree ("organization_id","status");--> statement-breakpoint
CREATE INDEX "denial_deadline_idx" ON "denial" USING btree ("appeal_deadline");--> statement-breakpoint
CREATE INDEX "denial_document_denial_idx" ON "denial_document" USING btree ("denial_id");--> statement-breakpoint
CREATE UNIQUE INDEX "denial_span_ordinal_idx" ON "denial_span" USING btree ("denial_document_id","ordinal");--> statement-breakpoint
CREATE INDEX "denial_span_document_idx" ON "denial_span" USING btree ("denial_document_id");--> statement-breakpoint
CREATE INDEX "email_send_contact_idx" ON "email_send" USING btree ("contact_id");--> statement-breakpoint
CREATE INDEX "email_send_campaign_idx" ON "email_send" USING btree ("campaign_id");--> statement-breakpoint
CREATE INDEX "email_send_sent_idx" ON "email_send" USING btree ("sent_at");--> statement-breakpoint
CREATE INDEX "holding_document_idx" ON "holding" USING btree ("source_document_id");--> statement-breakpoint
CREATE INDEX "holding_filters_idx" ON "holding" USING btree ("service_type","payer_type","denial_basis");--> statement-breakpoint
CREATE INDEX "holding_verified_idx" ON "holding" USING btree ("verified_at");--> statement-breakpoint
CREATE INDEX "invoice_org_idx" ON "invoice" USING btree ("organization_id");--> statement-breakpoint
CREATE UNIQUE INDEX "invoice_org_period_idx" ON "invoice" USING btree ("organization_id","period_start","period_end");--> statement-breakpoint
CREATE INDEX "job_drain_idx" ON "job" USING btree ("status","run_after");--> statement-breakpoint
CREATE INDEX "llm_call_stage_idx" ON "llm_call" USING btree ("stage");--> statement-breakpoint
CREATE INDEX "llm_call_created_idx" ON "llm_call" USING btree ("created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "member_org_user_idx" ON "member" USING btree ("organization_id","user_id");--> statement-breakpoint
CREATE INDEX "member_user_idx" ON "member" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "organization_status_idx" ON "organization" USING btree ("status");--> statement-breakpoint
CREATE INDEX "outcome_denial_idx" ON "outcome" USING btree ("denial_id");--> statement-breakpoint
CREATE UNIQUE INDEX "rate_limit_key_idx" ON "rate_limit" USING btree ("key");--> statement-breakpoint
CREATE INDEX "review_action_draft_idx" ON "review_action" USING btree ("appeal_draft_id");--> statement-breakpoint
CREATE UNIQUE INDEX "reviewer_assignment_idx" ON "reviewer_assignment" USING btree ("user_id","organization_id");--> statement-breakpoint
CREATE INDEX "reviewer_assignment_org_idx" ON "reviewer_assignment" USING btree ("organization_id");--> statement-breakpoint
CREATE INDEX "session_user_idx" ON "session" USING btree ("user_id");--> statement-breakpoint
CREATE UNIQUE INDEX "source_document_hash_idx" ON "source_document" USING btree ("content_hash");--> statement-breakpoint
CREATE UNIQUE INDEX "source_document_citation_idx" ON "source_document" USING btree ("source_type","citation");--> statement-breakpoint
CREATE INDEX "source_document_type_idx" ON "source_document" USING btree ("source_type");--> statement-breakpoint
CREATE UNIQUE INDEX "source_span_ordinal_idx" ON "source_span" USING btree ("source_document_id","ordinal");--> statement-breakpoint
CREATE INDEX "source_span_document_idx" ON "source_span" USING btree ("source_document_id");--> statement-breakpoint
CREATE INDEX "submission_draft_idx" ON "submission" USING btree ("appeal_draft_id");--> statement-breakpoint
CREATE INDEX "two_factor_user_idx" ON "two_factor" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "user_status_idx" ON "user" USING btree ("status");--> statement-breakpoint
CREATE INDEX "verification_identifier_idx" ON "verification" USING btree ("identifier");