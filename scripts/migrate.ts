/**
 * Apply checked-in migrations.
 *
 * Runs against whatever DATABASE_URL points at. Used in development, in CI
 * before the test suite, and as the deploy step in production.
 */
import 'dotenv/config';
import { drizzle } from 'drizzle-orm/node-postgres';
import { migrate } from 'drizzle-orm/node-postgres/migrator';
import { Pool } from 'pg';
import { log } from '../lib/log';

async function main(): Promise<void> {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error('DATABASE_URL is required to run migrations.');

  const pool = new Pool({ connectionString: url, max: 1 });
  try {
    await migrate(drizzle(pool), { migrationsFolder: './drizzle' });
    log.info('migrations applied');
  } finally {
    await pool.end();
  }
}

main().catch((error: unknown) => {
  log.error('migration failed', { error });
  process.exitCode = 1;
});
