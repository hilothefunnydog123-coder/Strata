CREATE TYPE "public"."corpus_provenance" AS ENUM('crawled', 'demo');--> statement-breakpoint
ALTER TABLE "source_document" ADD COLUMN "provenance" "corpus_provenance" DEFAULT 'crawled' NOT NULL;--> statement-breakpoint
-- Backfill, which is the entire point of this migration.
--
-- The column defaults to 'crawled', so without this every row already in every
-- database would claim to be citable, including the four the demonstration
-- seeder wrote into production. Two of those, DEMO-DAB-0001 and DEMO-DAB-0002,
-- were the only holdings the corpus contained, and retrieval had no filter.
--
-- Matched by the seeder's own citations and by the reserved example.invalid
-- domain it uses, rather than by date. A date would catch whatever else
-- happened to be ingested that day.
UPDATE "source_document"
SET "provenance" = 'demo'
WHERE "citation" IN ('42 CFR 422.101(b)', '42 CFR 409.31', 'DEMO-DAB-0001', 'DEMO-DAB-0002')
   OR "url" LIKE '%example.invalid%';
