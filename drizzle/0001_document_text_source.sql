CREATE TYPE "public"."text_source" AS ENUM('text_layer', 'ocr');--> statement-breakpoint
ALTER TABLE "denial_document" ADD COLUMN "text_source" text_source DEFAULT 'text_layer' NOT NULL;--> statement-breakpoint
ALTER TABLE "denial_document" ADD COLUMN "ocr_confidence" integer;