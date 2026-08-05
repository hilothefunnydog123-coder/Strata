/**
 * Check everything a corpus run depends on, before it starts.
 *
 * Written after four rounds of a run failing on a different layer each time,
 * with the operator having to paste a redacted stack trace and wait for someone
 * to read it. Every one of those failures was knowable in advance and none of
 * them was visible in advance:
 *
 *   a key belonging to a different provider than the base URL
 *   a storage directory that was missing from the environment template
 *   a database missing the migration the code expected
 *   a model id the provider had retired
 *
 * All four present identically once a run is under way: an HTTP status, or a
 * database error, arriving somewhere in the middle. Each one is a single
 * question with a definite answer if asked directly, which is what this does.
 *
 * The rule for every check here: report the thing to go and change, not the
 * thing that went wrong. "MODEL_NAME is a model this provider does not offer"
 * beats "404", and it is the same information.
 */
import { sql } from 'drizzle-orm';
import { db } from '@/lib/db';
import { env, envStatus } from '@/lib/env';
import { probeProvider } from '@/lib/llm/client';

export interface Check {
  name: string;
  ok: boolean;
  detail: string;
  /** Shown under a failure, when there is a list worth seeing. */
  extra?: string[];
}

function checkEnvironment(): Check {
  try {
    const status = envStatus();
    if (!status.configured) {
      return {
        name: 'environment',
        ok: false,
        detail: 'Required variables are missing.',
        extra: [...status.missing],
      };
    }
  } catch (error) {
    // envStatus throws rather than degrading when a database is configured
    // alongside missing secrets, which is the shape a half filled .env takes.
    return { name: 'environment', ok: false, detail: (error as Error).message };
  }

  return { name: 'environment', ok: true, detail: 'All required variables parse.' };
}

async function checkDatabase(): Promise<Check> {
  try {
    await db.execute(sql`select 1`);
  } catch (error) {
    return {
      name: 'database',
      ok: false,
      detail:
        `Could not connect: ${(error as Error).message}. Check DATABASE_URL, and that ` +
        'the server is running if it is a local one.',
    };
  }

  // The migrations the current code needs, by the column each one adds. A
  // database one migration behind fails deep inside a stage with a message
  // about a column, which reads as a code bug rather than a missing command.
  const required: ReadonlyArray<[string, string, string]> = [
    ['source_span', 'extracted_at', '0002_span_extraction_checkpoint'],
    ['source_span', 'screened_out', '0003_span_screening'],
    ['denial_document', 'text_source', '0001_document_text_source'],
  ];

  const missing: string[] = [];
  for (const [table, column, migration] of required) {
    const found = await db.execute(
      sql`select 1 from information_schema.columns where table_name = ${table} and column_name = ${column}`,
    );
    const rows = Array.isArray(found) ? found : ((found as { rows?: unknown[] }).rows ?? []);
    if (rows.length === 0) missing.push(`${migration} (${table}.${column})`);
  }

  if (missing.length > 0) {
    return {
      name: 'database',
      ok: false,
      detail: 'Connected, but behind on migrations. Run: pnpm db:migrate',
      extra: missing,
    };
  }

  return { name: 'database', ok: true, detail: 'Connected and up to date.' };
}

function checkStorage(): Check {
  // Raw bytes are written before anything parses them, so a run with nowhere to
  // put them fails on the first document. This was missing from the environment
  // template once and cost an evening.
  if (env.LOCAL_STORAGE_DIR) {
    return {
      name: 'storage',
      ok: true,
      detail: `Local directory ${env.LOCAL_STORAGE_DIR}. Development only.`,
    };
  }
  if (env.R2_BUCKET) {
    return { name: 'storage', ok: true, detail: `R2 bucket ${env.R2_BUCKET}.` };
  }
  return {
    name: 'storage',
    ok: false,
    detail:
      'No document storage configured. Set LOCAL_STORAGE_DIR for development, or the ' +
      'R2 variables. Fetching writes raw bytes before anything reads them, so this ' +
      'fails on the first document.',
  };
}

async function checkProvider(): Promise<Check> {
  const probe = await probeProvider();
  return {
    name: 'model provider',
    ok: probe.ok,
    detail: probe.ok ? probe.detail : `${probe.detail}\n    ${env.MODEL_BASE_URL}`,
    ...(probe.ok ? {} : { extra: probe.available }),
  };
}

export async function runChecks(): Promise<Check[]> {
  const checks: Check[] = [checkEnvironment()];

  // The database check needs a parseable environment to have a URL at all.
  if (checks[0]!.ok) {
    checks.push(await checkDatabase(), checkStorage());
  }

  // Only worth asking once the basics hold: a provider probe against an
  // unparseable environment reports the environment problem a second time in
  // less useful words.
  if (checks.every((c) => c.ok)) {
    checks.push(await checkProvider());
  }

  return checks;
}
