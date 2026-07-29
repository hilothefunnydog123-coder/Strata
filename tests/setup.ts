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
