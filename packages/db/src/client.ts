import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import { schema } from "./schema";

/**
 * Server database client. One place resolves DATABASE_URL so scripts, the web
 * app, and migrations all agree.
 */
export function databaseUrl(): string {
  const url = process.env.DATABASE_URL;
  if (!url) {
    throw new Error(
      "DATABASE_URL is not set. Copy .env.example to .env (default points at a local Postgres).",
    );
  }
  return url;
}

export type Database = ReturnType<typeof createDb>["db"];

export function createDb(url: string = databaseUrl()) {
  const client = postgres(url, { max: 10, onnotice: () => {} });
  const db = drizzle(client, { schema });
  return { db, client };
}

// A lazily-initialized shared instance for app usage.
let shared: ReturnType<typeof createDb> | null = null;
export function db(): Database {
  if (!shared) shared = createDb();
  return shared.db;
}
