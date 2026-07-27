CREATE TYPE "public"."provenance" AS ENUM('fetched', 'sample', 'synthetic_scale');--> statement-breakpoint
ALTER TABLE "policy_document" ADD COLUMN "provenance" "provenance" DEFAULT 'sample' NOT NULL;