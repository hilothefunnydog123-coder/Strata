/**
 * Database client.
 *
 * Two drivers, chosen by connection string. Neon's serverless HTTP driver is
 * what runs in production on Vercel; node-postgres is what runs against a local
 * PostgreSQL instance in development and in CI. Drizzle presents the same API
 * over both, so nothing downstream cares which is active.
 */
import { drizzle as drizzleNeon } from 'drizzle-orm/neon-http';
import { drizzle as drizzlePg } from 'drizzle-orm/node-postgres';
import { neon } from '@neondatabase/serverless';
import { Pool } from 'pg';
import { env } from '@/lib/env';
import * as schema from './schema';

const isNeon = /neon\.tech|neon\.build/.test(env.DATABASE_URL);

function createClient() {
  if (isNeon) {
    return drizzleNeon(neon(env.DATABASE_URL), { schema });
  }
  const pool = new Pool({ connectionString: env.DATABASE_URL, max: 10 });
  return drizzlePg(pool, { schema });
}

type Client = ReturnType<typeof createClient>;

declare global {
  var __strataDb: Client | undefined;
}

// Next.js reloads modules on every edit in development, which would otherwise
// open a new pool each time until Postgres refuses connections.
export const db: Client = globalThis.__strataDb ?? createClient();
if (env.NODE_ENV !== 'production') globalThis.__strataDb = db;

export { schema };
