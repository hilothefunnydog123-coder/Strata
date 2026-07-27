CREATE TYPE "public"."account_plan" AS ENUM('pilot', 'standard', 'enterprise');--> statement-breakpoint
CREATE TYPE "public"."campaign_stage" AS ENUM('not_engaged', 'dossier_sent', 'under_review', 'covered', 'appealed');--> statement-breakpoint
CREATE TYPE "public"."change_type" AS ENUM('added', 'removed', 'tightened', 'loosened', 'clarified');--> statement-breakpoint
CREATE TYPE "public"."code_relationship" AS ENUM('covers', 'excludes', 'mentions');--> statement-breakpoint
CREATE TYPE "public"."code_system" AS ENUM('CPT', 'HCPCS', 'PLA', 'ICD10CM');--> statement-breakpoint
CREATE TYPE "public"."coverage_stance_kind" AS ENUM('covered', 'conditional', 'investigational', 'not_covered', 'silent');--> statement-breakpoint
CREATE TYPE "public"."criterion_kind" AS ENUM('clinical_indication', 'prior_therapy', 'analytical_validity', 'clinical_validity', 'clinical_utility', 'test_specific_requirement', 'population', 'frequency_limit', 'site_of_service', 'ordering_provider', 'documentation', 'exclusion');--> statement-breakpoint
CREATE TYPE "public"."criterion_operator" AS ENUM('eq', 'gte', 'lte', 'gt', 'lt', 'in', 'exists', 'not_exists');--> statement-breakpoint
CREATE TYPE "public"."payer_type" AS ENUM('commercial', 'mac', 'medicaid', 'ma');--> statement-breakpoint
CREATE TYPE "public"."user_role" AS ENUM('admin', 'member', 'viewer');--> statement-breakpoint
CREATE TABLE "account" (
	"id" text PRIMARY KEY NOT NULL,
	"org_name" text NOT NULL,
	"plan" "account_plan" DEFAULT 'pilot' NOT NULL,
	"seat_limit" integer DEFAULT 3 NOT NULL,
	"created_by_admin" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "app_user" (
	"id" text PRIMARY KEY NOT NULL,
	"account_id" text NOT NULL,
	"email" text NOT NULL,
	"role" "user_role" DEFAULT 'member' NOT NULL,
	"password_hash" text NOT NULL,
	"totp_secret" text,
	"totp_enrolled" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "asset" (
	"id" text PRIMARY KEY NOT NULL,
	"account_id" text NOT NULL,
	"name" text NOT NULL,
	"indication" text NOT NULL,
	"intended_use" text NOT NULL,
	"target_codes" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"comparator" text DEFAULT '' NOT NULL,
	"target_population" text DEFAULT '' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "blueprint" (
	"id" text PRIMARY KEY NOT NULL,
	"asset_id" text NOT NULL,
	"generated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"inputs_hash" text NOT NULL,
	"payload" jsonb NOT NULL
);
--> statement-breakpoint
CREATE TABLE "campaign_entry" (
	"id" text PRIMARY KEY NOT NULL,
	"asset_id" text NOT NULL,
	"payer_id" text NOT NULL,
	"stage" "campaign_stage" DEFAULT 'not_engaged' NOT NULL,
	"owner" text DEFAULT '' NOT NULL,
	"notes" text DEFAULT '' NOT NULL,
	"next_action_date" date,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "code" (
	"id" text PRIMARY KEY NOT NULL,
	"system" "code_system" NOT NULL,
	"code" text NOT NULL,
	"description" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE "coverage_stance" (
	"id" text PRIMARY KEY NOT NULL,
	"policy_document_id" text NOT NULL,
	"code_id" text NOT NULL,
	"stance" "coverage_stance_kind" NOT NULL,
	"span_id" text NOT NULL,
	"verbatim_quote" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE "covered_lives" (
	"id" text PRIMARY KEY NOT NULL,
	"payer_id" text NOT NULL,
	"year" integer NOT NULL,
	"segment" text NOT NULL,
	"lives_count" integer NOT NULL,
	"source_url" text NOT NULL,
	"source_note" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE "criterion" (
	"id" text PRIMARY KEY NOT NULL,
	"policy_document_id" text NOT NULL,
	"kind" "criterion_kind" NOT NULL,
	"subject" text NOT NULL,
	"requirement_text" text NOT NULL,
	"operator" "criterion_operator",
	"value" text,
	"unit" text,
	"evidence" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"span_id" text NOT NULL,
	"verbatim_quote" text NOT NULL,
	"confidence" double precision NOT NULL,
	"embedding" jsonb,
	"extracted_by_model" text NOT NULL,
	"extracted_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE TABLE "criterion_change" (
	"id" text PRIMARY KEY NOT NULL,
	"from_criterion_id" text,
	"to_criterion_id" text,
	"policy_document_id" text NOT NULL,
	"change_type" "change_type" NOT NULL,
	"rationale" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE "demo_request" (
	"id" text PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"email" text NOT NULL,
	"company" text NOT NULL,
	"role" text DEFAULT '' NOT NULL,
	"message" text DEFAULT '' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"notified_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "device_auth" (
	"id" text PRIMARY KEY NOT NULL,
	"device_code" text NOT NULL,
	"user_code" text NOT NULL,
	"user_id" text,
	"approved" boolean DEFAULT false NOT NULL,
	"refresh_token" text,
	"expires_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "document_span" (
	"id" text PRIMARY KEY NOT NULL,
	"policy_document_id" text NOT NULL,
	"ordinal" integer NOT NULL,
	"page_number" integer NOT NULL,
	"char_start" integer NOT NULL,
	"char_end" integer NOT NULL,
	"text" text NOT NULL,
	"heading_path" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"embedding" jsonb
);
--> statement-breakpoint
CREATE TABLE "eval_run" (
	"id" text PRIMARY KEY NOT NULL,
	"suite" text NOT NULL,
	"golden_set_hash" text NOT NULL,
	"model" text NOT NULL,
	"metrics" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "llm_call" (
	"id" text PRIMARY KEY NOT NULL,
	"input_hash" text NOT NULL,
	"model" text NOT NULL,
	"prompt_tokens" integer NOT NULL,
	"completion_tokens" integer NOT NULL,
	"latency_ms" integer NOT NULL,
	"cost_usd" double precision NOT NULL,
	"stage" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE "payer" (
	"id" text PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"type" "payer_type" NOT NULL,
	"parent_payer_id" text
);
--> statement-breakpoint
CREATE TABLE "policy_code_link" (
	"policy_document_id" text NOT NULL,
	"code_id" text NOT NULL,
	"relationship" "code_relationship" NOT NULL,
	CONSTRAINT "policy_code_link_policy_document_id_code_id_relationship_pk" PRIMARY KEY("policy_document_id","code_id","relationship")
);
--> statement-breakpoint
CREATE TABLE "policy_document" (
	"id" text PRIMARY KEY NOT NULL,
	"payer_id" text NOT NULL,
	"external_id" text NOT NULL,
	"title" text NOT NULL,
	"url" text NOT NULL,
	"effective_date" date NOT NULL,
	"retrieved_at" timestamp with time zone NOT NULL,
	"content_hash" text NOT NULL,
	"supersedes_id" text,
	"raw_storage_path" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE "rejected_extraction" (
	"id" text PRIMARY KEY NOT NULL,
	"span_id" text NOT NULL,
	"raw_model_output" text NOT NULL,
	"rejection_reason" text NOT NULL,
	"created_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE TABLE "session" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "app_user" ADD CONSTRAINT "app_user_account_id_account_id_fk" FOREIGN KEY ("account_id") REFERENCES "public"."account"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "asset" ADD CONSTRAINT "asset_account_id_account_id_fk" FOREIGN KEY ("account_id") REFERENCES "public"."account"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "blueprint" ADD CONSTRAINT "blueprint_asset_id_asset_id_fk" FOREIGN KEY ("asset_id") REFERENCES "public"."asset"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "campaign_entry" ADD CONSTRAINT "campaign_entry_asset_id_asset_id_fk" FOREIGN KEY ("asset_id") REFERENCES "public"."asset"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "campaign_entry" ADD CONSTRAINT "campaign_entry_payer_id_payer_id_fk" FOREIGN KEY ("payer_id") REFERENCES "public"."payer"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "coverage_stance" ADD CONSTRAINT "coverage_stance_policy_document_id_policy_document_id_fk" FOREIGN KEY ("policy_document_id") REFERENCES "public"."policy_document"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "coverage_stance" ADD CONSTRAINT "coverage_stance_code_id_code_id_fk" FOREIGN KEY ("code_id") REFERENCES "public"."code"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "coverage_stance" ADD CONSTRAINT "coverage_stance_span_id_document_span_id_fk" FOREIGN KEY ("span_id") REFERENCES "public"."document_span"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "covered_lives" ADD CONSTRAINT "covered_lives_payer_id_payer_id_fk" FOREIGN KEY ("payer_id") REFERENCES "public"."payer"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "criterion" ADD CONSTRAINT "criterion_policy_document_id_policy_document_id_fk" FOREIGN KEY ("policy_document_id") REFERENCES "public"."policy_document"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "criterion" ADD CONSTRAINT "criterion_span_id_document_span_id_fk" FOREIGN KEY ("span_id") REFERENCES "public"."document_span"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "criterion_change" ADD CONSTRAINT "criterion_change_from_criterion_id_criterion_id_fk" FOREIGN KEY ("from_criterion_id") REFERENCES "public"."criterion"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "criterion_change" ADD CONSTRAINT "criterion_change_to_criterion_id_criterion_id_fk" FOREIGN KEY ("to_criterion_id") REFERENCES "public"."criterion"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "criterion_change" ADD CONSTRAINT "criterion_change_policy_document_id_policy_document_id_fk" FOREIGN KEY ("policy_document_id") REFERENCES "public"."policy_document"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "device_auth" ADD CONSTRAINT "device_auth_user_id_app_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."app_user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "document_span" ADD CONSTRAINT "document_span_policy_document_id_policy_document_id_fk" FOREIGN KEY ("policy_document_id") REFERENCES "public"."policy_document"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "policy_code_link" ADD CONSTRAINT "policy_code_link_policy_document_id_policy_document_id_fk" FOREIGN KEY ("policy_document_id") REFERENCES "public"."policy_document"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "policy_code_link" ADD CONSTRAINT "policy_code_link_code_id_code_id_fk" FOREIGN KEY ("code_id") REFERENCES "public"."code"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "policy_document" ADD CONSTRAINT "policy_document_payer_id_payer_id_fk" FOREIGN KEY ("payer_id") REFERENCES "public"."payer"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "rejected_extraction" ADD CONSTRAINT "rejected_extraction_span_id_document_span_id_fk" FOREIGN KEY ("span_id") REFERENCES "public"."document_span"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "session" ADD CONSTRAINT "session_user_id_app_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."app_user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "app_user_email_idx" ON "app_user" USING btree ("email");--> statement-breakpoint
CREATE INDEX "asset_account_idx" ON "asset" USING btree ("account_id");--> statement-breakpoint
CREATE INDEX "blueprint_asset_idx" ON "blueprint" USING btree ("asset_id");--> statement-breakpoint
CREATE INDEX "campaign_entry_asset_idx" ON "campaign_entry" USING btree ("asset_id");--> statement-breakpoint
CREATE UNIQUE INDEX "code_identity_idx" ON "code" USING btree ("system","code");--> statement-breakpoint
CREATE INDEX "coverage_stance_doc_idx" ON "coverage_stance" USING btree ("policy_document_id");--> statement-breakpoint
CREATE INDEX "covered_lives_payer_idx" ON "covered_lives" USING btree ("payer_id");--> statement-breakpoint
CREATE INDEX "criterion_doc_idx" ON "criterion" USING btree ("policy_document_id");--> statement-breakpoint
CREATE INDEX "criterion_kind_idx" ON "criterion" USING btree ("kind");--> statement-breakpoint
CREATE INDEX "criterion_span_idx" ON "criterion" USING btree ("span_id");--> statement-breakpoint
CREATE INDEX "criterion_change_doc_idx" ON "criterion_change" USING btree ("policy_document_id");--> statement-breakpoint
CREATE UNIQUE INDEX "device_auth_device_code_idx" ON "device_auth" USING btree ("device_code");--> statement-breakpoint
CREATE UNIQUE INDEX "device_auth_user_code_idx" ON "device_auth" USING btree ("user_code");--> statement-breakpoint
CREATE INDEX "document_span_doc_idx" ON "document_span" USING btree ("policy_document_id");--> statement-breakpoint
CREATE UNIQUE INDEX "document_span_ordinal_idx" ON "document_span" USING btree ("policy_document_id","ordinal");--> statement-breakpoint
CREATE INDEX "policy_document_payer_idx" ON "policy_document" USING btree ("payer_id");--> statement-breakpoint
CREATE UNIQUE INDEX "policy_document_identity_idx" ON "policy_document" USING btree ("payer_id","external_id","content_hash");--> statement-breakpoint
CREATE INDEX "session_user_idx" ON "session" USING btree ("user_id");