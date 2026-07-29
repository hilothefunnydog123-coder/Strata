/**
 * Apply checked-in migrations.
 *
 * Runs against whatever DATABASE_URL points at. Used in development, in CI
 * before the test suite, and as the first half of the production start command.
 *
 * Plain JavaScript on purpose, run by node rather than tsx. This is the only
 * script that has to work in a production runtime, where the TypeScript loader
 * is a development dependency that may not have been installed. It imports
 * nothing from the application: drizzle and pg are runtime dependencies, and
 * everything else here is node itself.
 *
 * Idempotent. Drizzle records each applied migration in __drizzle_migrations
 * and skips the ones already there, so running it on every boot costs one
 * query against that table and changes nothing.
 */
import { drizzle } from 'drizzle-orm/node-postgres';
import { migrate } from 'drizzle-orm/node-postgres/migrator';
import pg from 'pg';

async function main() {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error('DATABASE_URL is required to run migrations.');

  const pool = new pg.Pool({ connectionString: url, max: 1 });
  try {
    await migrate(drizzle(pool), { migrationsFolder: './drizzle' });
    process.stdout.write('migrations applied\n');
  } finally {
    await pool.end();
  }
}

main().catch((error) => {
  // The connection string can carry a password, so report the message rather
  // than the error object, which some drivers decorate with connection detail.
  const message = error instanceof Error ? error.message : String(error);
  process.stderr.write(`migration failed: ${message}\n`);
  process.exit(1);
});
