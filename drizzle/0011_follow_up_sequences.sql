CREATE TYPE "enrollment_status" AS ENUM ('active', 'replied', 'unsubscribed', 'completed', 'stopped');
--> statement-breakpoint
CREATE TABLE "sequence" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "name" text NOT NULL UNIQUE,
  "steps" jsonb DEFAULT '[]'::jsonb NOT NULL,
  "created_by" text NOT NULL REFERENCES "user"("id"),
  "created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "sequence_enrollment" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "sequence_id" uuid NOT NULL REFERENCES "sequence"("id") ON DELETE cascade,
  "contact_id" uuid NOT NULL REFERENCES "contact"("id") ON DELETE cascade,
  "status" "enrollment_status" DEFAULT 'active' NOT NULL,
  "steps_sent" integer DEFAULT 0 NOT NULL,
  "next_run_at" timestamp with time zone,
  "enrolled_at" timestamp with time zone DEFAULT now() NOT NULL,
  "replied_at" timestamp with time zone,
  "stopped_reason" text,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX "sequence_enrollment_unique_idx" ON "sequence_enrollment" ("sequence_id", "contact_id");
--> statement-breakpoint
CREATE INDEX "sequence_enrollment_due_idx" ON "sequence_enrollment" ("status", "next_run_at");
