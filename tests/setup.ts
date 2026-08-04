/**
 * Test environment.
 *
 * Values are set before any module reads them so lib/env.ts validates cleanly.
 * The database points at medeal_test, which CI creates and migrates fresh.
 */
import { config } from 'dotenv';
import { randomBytes } from 'node:crypto';

config({ path: '.env.test', override: false, quiet: true });
config({ path: '.env.local', override: false, quiet: true });

process.env.DATABASE_URL ??= 'postgres://medeal:medeal@127.0.0.1:5432/medeal_test';
process.env.BETTER_AUTH_SECRET ??= randomBytes(32).toString('hex');
process.env.BETTER_AUTH_URL ??= 'http://localhost:3000';
process.env.APP_URL ??= 'http://localhost:3000';
process.env.DEMO_REQUEST_TO ??= 'demo@example.com';
process.env.PHI_MODE ??= 'synthetic';
process.env.PHI_ENCRYPTION_KEY ??= randomBytes(32).toString('base64');
process.env.LOCAL_STORAGE_DIR ??= '.storage-test';

/**
 * Refuse to run against anything that is not obviously a test database.
 *
 * The integration suites truncate whole tables to measure their own run:
 * tests/corpus-pipeline.test.ts and tests/generation-chain.test.ts both delete
 * every row of holding, source_span and source_document with no scoping. That
 * is correct against a scratch database and catastrophic against a real one,
 * and the distance between the two is one stray environment variable. Ingesting
 * the corpus takes hours and a model budget; deleting it takes one command run
 * in the wrong shell.
 *
 * So the name must say test. A production connection string cannot satisfy this
 * by accident, and a developer who genuinely wants to point the suite somewhere
 * else has to rename the database and mean it.
 */
const url = process.env.DATABASE_URL;
const databaseName = url.split('/').pop()?.split('?')[0] ?? '';

if (!/test/i.test(databaseName)) {
  throw new Error(
    `Refusing to run tests against the database "${databaseName}". The test suite ` +
      'truncates the corpus tables, so it only runs against a database whose name ' +
      'contains "test". Point DATABASE_URL at a scratch database, for example ' +
      'medeal_test, and run again. Nothing was touched.',
  );
}
