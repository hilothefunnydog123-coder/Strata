import { drizzle } from "drizzle-orm/postgres-js";
import { migrate } from "drizzle-orm/postgres-js/migrator";
import postgres from "postgres";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import { databaseUrl } from "./client";

/**
 * Apply all generated migrations. Idempotent: drizzle tracks applied migrations
 * in its own journal table, so re-running is safe (PROMPT §10).
 */
async function main() {
  const url = databaseUrl();
  const here = dirname(fileURLToPath(import.meta.url));
  const migrationsFolder = resolve(here, "../drizzle");
  const client = postgres(url, { max: 1, onnotice: () => {} });
  const db = drizzle(client);
  console.log(`[db] applying migrations from ${migrationsFolder}`);
  await migrate(db, { migrationsFolder });
  await client.end();
  console.log("[db] migrations applied cleanly");
}

main().catch((err) => {
  console.error("[db] migration failed:", err);
  process.exit(1);
});
