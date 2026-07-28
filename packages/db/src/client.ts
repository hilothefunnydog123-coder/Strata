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

/**
 * Managed Postgres (Render, Neon, Supabase, RDS…) requires TLS, and their certs
 * are issued by an intermediate the container does not carry, so full chain
 * verification fails with SELF_SIGNED_CERT_IN_CHAIN. Local development uses no TLS
 * at all. Decide from the URL rather than making every caller remember:
 *
 *   - an explicit `sslmode=` in the URL always wins
 *   - localhost / 127.0.0.1 / a unix socket → no TLS
 *   - anything else → TLS on, without chain verification
 */
export function sslOptionFor(url: string): postgres.Options<{}>["ssl"] {
  const explicit = /[?&]sslmode=([^&]+)/.exec(url)?.[1];
  if (explicit) {
    if (explicit === "disable") return false;
    if (explicit === "require" || explicit === "prefer") return { rejectUnauthorized: false };
    return explicit as never; // verify-ca / verify-full: let postgres.js enforce it
  }
  let host = "";
  try {
    host = new URL(url).hostname;
  } catch {
    return false;
  }
  const isLocal = host === "" || host === "localhost" || host === "127.0.0.1" || host === "::1";
  return isLocal ? false : { rejectUnauthorized: false };
}

export type Database = ReturnType<typeof createDb>["db"];

export function createDb(url: string = databaseUrl()) {
  const client = postgres(url, {
    max: Number(process.env.DATABASE_POOL_MAX ?? 10),
    ssl: sslOptionFor(url),
    onnotice: () => {},
  });
  const db = drizzle(client, { schema });
  return { db, client };
}

// A lazily-initialized shared instance for app usage.
let shared: ReturnType<typeof createDb> | null = null;
export function db(): Database {
  if (!shared) shared = createDb();
  return shared.db;
}
