import { NextResponse } from "next/server";
import { sql } from "drizzle-orm";
import { db, schema } from "@/lib/db";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * "Why doesn't my login work?" — answered in one URL, with no shell and no
 * dashboard spelunking.
 *
 * Separate from /healthz on purpose. That probe must stay a pure liveness check:
 * gating it on the database would turn a recoverable data problem into a failed
 * deploy and a crash loop. This endpoint is the opposite — it is allowed to fail,
 * and reports what failed.
 *
 * It is unauthenticated because it is most needed when nobody can authenticate.
 * So it states only whether things exist, never what they are: no email addresses,
 * no hostnames, no connection strings, and database errors reduced to a category
 * rather than the driver's message, which carries the host and user.
 */

type Category = "no_database_url" | "unreachable" | "auth_failed" | "not_migrated" | "unknown";

function categorize(err: unknown): Category {
  const m = err instanceof Error ? err.message : String(err);
  if (/DATABASE_URL is not set/i.test(m)) return "no_database_url";
  if (/ENOTFOUND|ECONNREFUSED|ETIMEDOUT|EHOSTUNREACH|connect_timeout|Connection terminated/i.test(m)) return "unreachable";
  if (/password authentication failed|role .* does not exist|no pg_hba|database .* does not exist/i.test(m)) return "auth_failed";
  if (/relation .* does not exist|column .* does not exist/i.test(m)) return "not_migrated";
  return "unknown";
}

const REMEDY: Record<Category, string> = {
  no_database_url: "DATABASE_URL is not set on the service. Attach the database and redeploy.",
  unreachable:
    "The database host did not answer. On Render's free plan, Postgres instances expire after 30 days — check the database still exists in the dashboard.",
  auth_failed: "The database refused the credentials in DATABASE_URL. Re-copy its connection string.",
  not_migrated: "The schema is missing. Migrations run on boot — check the deploy logs for '[db] migrations applied'.",
  unknown: "See the service logs for the underlying error.",
};

export async function GET() {
  const started = Date.now();
  try {
    // Cheapest possible round trip: proves the connection, not the schema.
    await db().execute(sql`select 1`);
  } catch (err) {
    const category = categorize(err);
    return NextResponse.json(
      {
        ok: false,
        database: { reachable: false, category, remedy: REMEDY[category] },
        hint: "The marketing site works without a database; the console does not.",
      },
      { status: 503 },
    );
  }

  // Reachable. Now: is it usable, and is the founder actually provisioned?
  try {
    const [users] = await db()
      .select({
        total: sql<number>`count(*)::int`,
        admins: sql<number>`count(*) filter (where ${schema.appUser.role} = 'admin')::int`,
        enrolled: sql<number>`count(*) filter (where ${schema.appUser.totpEnrolled})::int`,
      })
      .from(schema.appUser);
    const [docs] = await db()
      .select({
        total: sql<number>`count(*)::int`,
        real: sql<number>`count(*) filter (where ${schema.policyDocument.provenance} = 'fetched')::int`,
      })
      .from(schema.policyDocument);

    const accountsProvisioned = users?.total ?? 0;
    return NextResponse.json({
      ok: accountsProvisioned > 0,
      database: { reachable: true, latencyMs: Date.now() - started },
      accounts: {
        provisioned: accountsProvisioned,
        admins: users?.admins ?? 0,
        awaitingEnrollment: Math.max(0, accountsProvisioned - (users?.enrolled ?? 0)),
      },
      corpus: { documents: docs?.total ?? 0, real: docs?.real ?? 0, sample: (docs?.total ?? 0) - (docs?.real ?? 0) },
      remedy:
        accountsProvisioned > 0
          ? null
          : "The database is up but no account exists — the boot bootstrap did not run. Check the deploy logs for '[founder]'.",
    });
  } catch (err) {
    const category = categorize(err);
    return NextResponse.json(
      { ok: false, database: { reachable: true, category, remedy: REMEDY[category] } },
      { status: 503 },
    );
  }
}
