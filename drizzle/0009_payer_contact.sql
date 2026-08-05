CREATE TABLE "payer_contact" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "organization_id" text NOT NULL REFERENCES "organization"("id") ON DELETE cascade,
  "payer_name" text NOT NULL,
  "channel" "submission_channel" NOT NULL,
  "destination" text NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX "payer_contact_idx" ON "payer_contact" ("organization_id", "payer_name", "channel");
