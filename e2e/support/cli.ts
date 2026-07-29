/**
 * A small command line surface the end to end tests drive.
 *
 * Playwright's runner cannot import server modules directly without dragging
 * the database driver into the test process, so the tests shell out to this
 * instead. Every command here goes through the same application code a real
 * request would: seeding creates accounts through lib/auth/provision, which is
 * exactly what the operator console calls.
 *
 *   pnpm exec tsx e2e/support/cli.ts <command> '<json arguments>'
 *
 * The result is written to stdout after a __RESULT__ marker, so log lines from
 * anything the command touches do not corrupt the payload.
 */
import 'dotenv/config';
import { count, desc, eq } from 'drizzle-orm';
import { createOrganization, provisionUser } from '../../lib/auth/provision';
import { db } from '../../lib/db';
import {
  auditLog,
  demoRequest,
  denial,
  emailSend,
  job,
  organization,
  user,
} from '../../lib/db/schema';

type Args = Record<string, unknown>;

const commands: Record<string, (args: Args) => Promise<unknown>> = {
  /** One organisation plus one account per role, all through the real path. */
  async seedOrgAndRoles(args) {
    const stamp = String(args.stamp);
    const org = await createOrganization({
      name: `Northgate Regional ${stamp}`,
      slug: `northgate-${stamp}`,
      contingencyRateBps: 1500,
    });

    const users: Record<string, unknown> = {};

    users.org_admin = await provisionUser({
      email: `admin-${stamp}@example.test`,
      name: 'Dana Whitfield',
      membership: { organizationId: org.id, role: 'org_admin' },
    });
    users.appeal_specialist = await provisionUser({
      email: `spec-${stamp}@example.test`,
      name: 'Rosa Petrucci',
      membership: { organizationId: org.id, role: 'appeal_specialist' },
    });
    users.readonly = await provisionUser({
      email: `read-${stamp}@example.test`,
      name: 'Ken Ibarra',
      membership: { organizationId: org.id, role: 'readonly' },
    });
    users.clinical_reviewer = await provisionUser({
      email: `clin-${stamp}@example.test`,
      name: 'Alice Mbeki',
      platformRole: 'clinical_reviewer',
      reviewerOrgIds: [org.id],
    });
    users.legal_reviewer = await provisionUser({
      email: `legal-${stamp}@example.test`,
      name: 'Tomas Berg',
      platformRole: 'legal_reviewer',
      reviewerOrgIds: [org.id],
    });
    users.superadmin = await provisionUser({
      email: `super-${stamp}@example.test`,
      name: 'Operator',
      platformRole: 'superadmin',
    });

    return { orgId: org.id, orgSlug: org.slug, users };
  },

  async provision(args) {
    return provisionUser(args as never);
  },

  async createOrg(args) {
    return createOrganization(args as never);
  },

  /** Recent audit rows, reduced to what the assertions actually check. */
  async recentAudit(args) {
    const rows = await db
      .select()
      .from(auditLog)
      .orderBy(desc(auditLog.createdAt))
      .limit(Number(args.limit ?? 20));
    return rows.map((r) => ({
      action: r.action,
      entityType: r.entityType,
      entityId: r.entityId,
      phi: r.phi,
      hasIp: r.ip !== null,
      hasUserAgent: r.userAgent !== null,
      userId: r.userId,
    }));
  },

  async findDemoRequest(args) {
    const row = await db.query.demoRequest.findFirst({
      where: eq(demoRequest.email, String(args.email)),
    });
    return row ?? null;
  },

  /** Composed messages for one address, whether or not a provider accepted them. */
  async emailsFor(args) {
    const rows = await db.select().from(emailSend).orderBy(desc(emailSend.createdAt));
    const needle = String(args.email);
    return rows
      .filter((r) => r.toEmail === needle || r.body.includes(needle))
      .map((r) => ({
        toEmail: r.toEmail,
        subject: r.subject,
        body: r.body,
        status: r.status,
      }));
  },

  async countRows(args) {
    const table = String(args.table);
    const tables = { auditLog, demoRequest, denial, organization, user } as const;
    const target = tables[table as keyof typeof tables];
    if (!target) throw new Error(`countRows does not know the table ${table}`);
    const [row] = await db.select({ n: count() }).from(target);
    return row?.n ?? 0;
  },

  /**
   * Clear the demo form's rate limit buckets.
   *
   * The form allows five submissions an hour per address, which is right in
   * production and wrong for a suite that runs several times an hour from one
   * address. Tests start from a known state rather than the limit being raised
   * to accommodate them.
   */
  async resetRateLimits() {
    const deleted = await db
      .delete(job)
      .where(eq(job.kind, 'rate_limit'))
      .returning({ id: job.id });
    return deleted.length;
  },

  async setOrgStatus(args) {
    await db
      .update(organization)
      .set({ status: args.status as 'active' | 'inactive' })
      .where(eq(organization.id, String(args.organizationId)));
    return { ok: true };
  },
};

async function main(): Promise<void> {
  const [name, raw] = process.argv.slice(2);
  if (!name) throw new Error('Usage: cli.ts <command> [json]');

  const command = commands[name];
  if (!command) {
    throw new Error(`Unknown command ${name}. Known: ${Object.keys(commands).join(', ')}`);
  }

  const result = await command(raw ? (JSON.parse(raw) as Args) : {});
  process.stdout.write(`__RESULT__${JSON.stringify(result ?? null)}`);
}

main()
  .then(() => process.exit(0))
  .catch((error: unknown) => {
    process.stderr.write(`${(error as Error).stack ?? String(error)}\n`);
    process.exit(1);
  });
