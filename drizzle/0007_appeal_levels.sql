CREATE TYPE "appeal_level" AS ENUM ('redetermination', 'reconsideration', 'plan_reconsideration', 'independent_review', 'alj', 'council', 'judicial');
--> statement-breakpoint
CREATE TYPE "submission_channel" AS ENUM ('payer_portal', 'clearinghouse', 'esmd', 'fax', 'certified_mail', 'email', 'other');
--> statement-breakpoint
CREATE TYPE "submission_status" AS ENUM ('prepared', 'sending', 'sent', 'acknowledged', 'rejected', 'failed');
--> statement-breakpoint
CREATE TABLE "appeal" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "denial_id" uuid NOT NULL REFERENCES "denial"("id") ON DELETE cascade,
  "level" "appeal_level" NOT NULL,
  "level_ordinal" integer NOT NULL,
  "appeal_draft_id" uuid REFERENCES "appeal_draft"("id"),
  "due_by" timestamp with time zone,
  "filed_at" timestamp with time zone,
  "decided_at" timestamp with time zone,
  "result" "outcome_result",
  "created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX "appeal_level_idx" ON "appeal" ("denial_id", "level_ordinal");
--> statement-breakpoint
CREATE INDEX "appeal_denial_idx" ON "appeal" ("denial_id");
--> statement-breakpoint
CREATE INDEX "appeal_due_idx" ON "appeal" ("due_by");
--> statement-breakpoint
CREATE TABLE "submission_event" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "submission_id" uuid NOT NULL REFERENCES "submission"("id") ON DELETE cascade,
  "at" timestamp with time zone DEFAULT now() NOT NULL,
  "kind" text NOT NULL,
  "detail" text NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE INDEX "submission_event_submission_idx" ON "submission_event" ("submission_id", "at");
--> statement-breakpoint
ALTER TABLE "submission" ADD COLUMN "appeal_id" uuid REFERENCES "appeal"("id") ON DELETE cascade;
--> statement-breakpoint
ALTER TABLE "submission" ADD COLUMN "channel" "submission_channel";
--> statement-breakpoint
-- Existing rows record a filing a person already made, so they are sent.
ALTER TABLE "submission" ADD COLUMN "status" "submission_status" DEFAULT 'sent' NOT NULL;
--> statement-breakpoint
ALTER TABLE "submission" ADD COLUMN "receipt_doc_key" text;
--> statement-breakpoint
ALTER TABLE "submission" ADD COLUMN "acknowledged_at" timestamp with time zone;
--> statement-breakpoint
ALTER TABLE "submission" ADD COLUMN "last_checked_at" timestamp with time zone;
--> statement-breakpoint
ALTER TABLE "submission" ADD COLUMN "failure_reason" text;
--> statement-breakpoint
-- A filing the system makes exists before it has been sent, and is made by no
-- user at all, so neither of these can stay required.
ALTER TABLE "submission" ALTER COLUMN "submitted_at" DROP NOT NULL;
--> statement-breakpoint
ALTER TABLE "submission" ALTER COLUMN "submitted_by" DROP NOT NULL;
--> statement-breakpoint
ALTER TABLE "submission" ALTER COLUMN "method" DROP NOT NULL;
--> statement-breakpoint
CREATE INDEX "submission_appeal_idx" ON "submission" ("appeal_id");
--> statement-breakpoint
CREATE INDEX "submission_status_idx" ON "submission" ("status");
