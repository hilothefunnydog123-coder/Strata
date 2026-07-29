/**
 * Database client.
 *
 * Two drivers, chosen by connection string. Neon's serverless HTTP driver is
 * what runs in production on Vercel; node-postgres is what runs against a local
 * PostgreSQL instance in development and in CI. Drizzle presents the same API
 * over both, so nothing downstream cares which is active.
 */
import { drizzle as drizzleNeon } from 'drizzle-orm/neon-http';
import {
  drizzle as drizzlePg,
  type NodePgDatabase,
} from 'drizzle-orm/node-postgres';
import { neon } from '@neondatabase/serverless';
import { Pool } from 'pg';
import { env } from '@/lib/env';
import * as schema from './schema';

/**
 * One type for both drivers.
 *
 * The two `drizzle()` functions return structurally different types even though
 * the query builders are identical in use. Left as a union, every call to
 * `.returning({ ... })` fails to resolve an overload, which would push a cast
 * into hundreds of call sites instead of this one. The cast is sound: the Neon
 * HTTP driver implements the same PgDatabase surface, minus interactive
 * transactions, which this codebase does not use.
 */
type Client = NodePgDatabase<typeof schema>;

const isNeon = /neon\.tech|neon\.build/.test(env.DATABASE_URL);

function createClient(): Client {
  if (isNeon) {
    return drizzleNeon(neon(env.DATABASE_URL), { schema }) as unknown as Client;
  }
  const pool = new Pool({ connectionString: env.DATABASE_URL, max: 10 });
  return drizzlePg(pool, { schema });
}

declare global {
  var __medealDb: Client | undefined;
}

// Next.js reloads modules on every edit in development, which would otherwise
// open a new pool each time until Postgres refuses connections.
export const db: Client = globalThis.__medealDb ?? createClient();
if (env.NODE_ENV !== 'production') globalThis.__medealDb = db;

export { schema };
