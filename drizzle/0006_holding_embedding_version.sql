ALTER TABLE "holding" ADD COLUMN "embedding_version" integer;
--> statement-breakpoint
-- Every existing vector was produced by version 1, the character trigram
-- embedding. Stamping them rather than clearing them keeps the corpus
-- retrievable until the embed stage gets to them, and the stage will redo each
-- one because the stamp no longer matches. Clearing here would make every
-- holding unciteable for the gap between this migration and that run.
UPDATE "holding" SET "embedding_version" = 1 WHERE "embedding" IS NOT NULL;
