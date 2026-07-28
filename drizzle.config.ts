import { defineConfig } from 'drizzle-kit';

// drizzle-kit runs outside the Next.js runtime and generates SQL without booting
// the app, so it reads the connection string directly rather than through
// lib/env.ts. It is the one sanctioned exception to that rule, and it is a
// build-time tool rather than a shipped code path.
const url = process.env.DATABASE_URL;
if (!url) {
  throw new Error('DATABASE_URL is required to generate or apply migrations.');
}

export default defineConfig({
  schema: './lib/db/schema.ts',
  out: './drizzle',
  dialect: 'postgresql',
  dbCredentials: { url },
  strict: true,
  verbose: true,
});
