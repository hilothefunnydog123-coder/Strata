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
import { env, envStatus, NotConfiguredError } from '@/lib/env';
import * as schema from './schema';

/**
 * One type for both drivers, with transactions removed.
 *
 * The two `drizzle()` functions return structurally different types even though
 * the query builders are identical in use. Left as a union, every call to
 * `.returning({ ... })` fails to resolve an overload, which would push a cast
 * into hundreds of call sites instead of this one.
 *
 * The cast is only sound where the two drivers agree, and there is exactly one
 * place they do not: the Neon HTTP driver has no interactive transactions and
 * throws "No transactions support in neon-http driver" the moment one is
 * opened. This used to be a sentence in this comment saying the codebase does
 * not use them. It was true when written and stopped being true later, and
 * nothing noticed, because the cast had already told the type checker that a
 * transaction was available and the local test database is node-postgres, where
 * it is. The failure surfaced in production against the only driver that runs
 * there.
 *
 * So the sentence is now an Omit. `db.transaction(...)` is a compile error, and
 * the compile error is the whole point: it fails on the machine writing the
 * code rather than on the one running it.
 *
 * Where atomicity is actually needed, write the sequence so that every
 * interruption point leaves a state a re-run corrects. lib/corpus/pipeline.ts
 * is the worked example: delete, insert, then mark done, so a crash anywhere
 * leaves work that redoes itself rather than work that doubles.
 */
type Client = Omit<NodePgDatabase<typeof schema>, 'transaction'>;

function createClient(): Client {
  const url = env.DATABASE_URL;
  if (/neon\.tech|neon\.build/.test(url)) {
    return drizzleNeon(neon(url), { schema }) as unknown as Client;
  }
  const pool = new Pool({ connectionString: url, max: 10 });
  return drizzlePg(pool, { schema });
}

declare global {
  var __medealDb: Client | undefined;
}

/**
 * The pool, opened once.
 *
 * This module level cache is not an optimisation, it is the thing that stops
 * the process opening a connection pool per query. `client()` runs on every
 * property access through the proxy below, so without somewhere to keep the
 * result, a single request builds several pools of ten connections each and a
 * few page loads exhaust the database. An earlier version cached only in
 * development, on the theory that the development cache existed for hot reload,
 * and production quietly had no cache at all. Measured: ninety six connections
 * from a handful of page views, then refusals.
 */
let cached: Client | undefined;

function client(): Client {
  if (cached) return cached;

  const status = envStatus();
  if (!status.configured) {
    throw new NotConfiguredError('The database', status.missing);
  }

  // Next.js reloads modules on every edit in development, which would otherwise
  // open a new pool each time until Postgres refuses connections. The global
  // survives a reload; the module level cache above does not.
  const existing = globalThis.__medealDb;
  if (existing) {
    cached = existing;
    return cached;
  }

  cached = createClient();
  if (env.NODE_ENV !== 'production') globalThis.__medealDb = cached;
  return cached;
}

/**
 * The client, connected on first use rather than on import.
 *
 * This indirection is load bearing, not decoration. Building the client at
 * module scope means importing this module reads DATABASE_URL, and `next build`
 * imports every route module to collect its metadata. The build would therefore
 * demand a database URL and a full runtime environment in order to emit static
 * assets, which is both wrong in principle and, in practice, the reason a first
 * deploy on a host without preconfigured variables cannot succeed.
 *
 * Importing a module should not open a socket. Now it does not: the first query
 * does.
 *
 * Methods are bound because Drizzle's builders rely on `this`, and an unbound
 * method handed out through a proxy loses it.
 */
export const db: Client = new Proxy({} as Client, {
  get(_target, prop, receiver) {
    const value = Reflect.get(client() as object, prop, receiver);
    return typeof value === 'function' ? value.bind(client()) : value;
  },
  has(_target, prop) {
    return prop in (client() as object);
  },
  ownKeys() {
    return Reflect.ownKeys(client() as object);
  },
  getOwnPropertyDescriptor(_target, prop) {
    const descriptor = Object.getOwnPropertyDescriptor(client() as object, prop);
    // A proxy may not report a property as non-configurable when the target
    // does not have it, which is the case for every property here.
    return descriptor ? { ...descriptor, configurable: true } : undefined;
  },
});

export { schema };
