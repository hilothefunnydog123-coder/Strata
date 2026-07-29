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
import { canExport, hasBothApprovals, transition } from '../../lib/appeals/workflow';
import { issueInvoice } from '../../lib/billing/generate';
import { db } from '../../lib/db';
import {
  appealDraft,
  assertion,
  auditLog,
  clinicalFact,
  demoRequest,
  denial,
  denialDocument,
  denialSpan,
  emailSend,
  holding,
  job,
  organization,
  outcome,
  rateLimit,
  reviewAction,
  sourceDocument,
  sourceSpan,
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
    // better-auth's own counters live in the database too, for the reason given
    // in lib/db/schema.ts, which means a suite can start from a known state
    // rather than the product limits being loosened to accommodate it.
    const auth = await db.delete(rateLimit).returning({ id: rateLimit.id });
    return deleted.length + auth.length;
  },

  /**
   * Build a case with a draft that is ready for review.
   *
   * Written through the same tables generation writes to, because generation
   * itself needs a model key this environment does not have. The assertions
   * carry quotes that genuinely appear in the source spans created alongside
   * them, so verification and the source panel behave exactly as they would on
   * a generated draft.
   */
  async seedReviewableDraft(args) {
    const stamp = String(args.stamp);

    const org = await createOrganization({
      name: `Workflow Regional ${stamp}`,
      slug: `workflow-${stamp}`.slice(0, 48),
      contingencyRateBps: 1500,
    });

    const specialist = await provisionUser({
      email: `wf-spec-${stamp}@example.test`,
      name: 'Rosa Petrucci',
      membership: { organizationId: org.id, role: 'appeal_specialist' },
    });
    const clinical = await provisionUser({
      email: `wf-clin-${stamp}@example.test`,
      name: 'Alice Mbeki',
      platformRole: 'clinical_reviewer',
      reviewerOrgIds: [org.id],
    });
    const legal = await provisionUser({
      email: `wf-legal-${stamp}@example.test`,
      name: 'Tomas Berg',
      platformRole: 'legal_reviewer',
      reviewerOrgIds: [org.id],
    });

    const [denialRow] = await db
      .insert(denial)
      .values({
        organizationId: org.id,
        internalRef: `WF-${stamp}`.slice(0, 60),
        payerName: 'Meridian Health',
        planType: 'medicare_advantage',
        serviceType: 'skilled_nursing',
        denialBasis: 'proprietary_criteria',
        claimAmountCents: 1_842_000,
        appealDeadline: new Date(Date.now() + 21 * 24 * 60 * 60 * 1000),
        status: 'clinical_review',
        isSynthetic: true,
        createdBy: specialist.userId,
      })
      .returning({ id: denial.id });
    const denialId = denialRow!.id;

    // A source document and span, so a legal assertion resolves to something.
    const [doc] = await db
      .insert(sourceDocument)
      .values({
        sourceType: 'dab_decision',
        citation: `DAB No. ${stamp}`.slice(0, 40),
        title: 'Fabricated decision used only by the workflow tests',
        url: 'https://example.test/decision',
        retrievedAt: new Date(),
        contentHash: `hash-${stamp}`,
        rawPath: `corpus/test/${stamp}`,
        parsedAt: new Date(),
      })
      .returning({ id: sourceDocument.id });

    const decisionText =
      'The Council has consistently held that a Medicare Advantage organization may ' +
      'not apply coverage criteria more restrictive than those used in Traditional ' +
      'Medicare. The plan relied on its own internal criteria, which impose a ' +
      'functional improvement requirement found nowhere in the Medicare Benefit ' +
      'Policy Manual.';

    const [span] = await db
      .insert(sourceSpan)
      .values({
        sourceDocumentId: doc!.id,
        ordinal: 1,
        page: 4,
        charStart: 0,
        charEnd: decisionText.length,
        text: decisionText,
        headingPath: ['Analysis'],
      })
      .returning({ id: sourceSpan.id });

    const [held] = await db
      .insert(holding)
      .values({
        sourceDocumentId: doc!.id,
        spanId: span!.id,
        verbatimQuote:
          'may not apply coverage criteria more restrictive than those used in Traditional Medicare',
        issue: 'Whether the plan may apply its own criteria in place of Medicare rules.',
        ruleApplied: '42 CFR 422.101(b) requires compliance with Medicare coverage rules.',
        outcome: 'claimant_favorable',
        serviceType: 'skilled_nursing',
        payerType: 'medicare_advantage',
        denialBasis: 'proprietary_criteria',
        verifiedAt: new Date(),
      })
      .returning({ id: holding.id });

    // A clinical document, span, and fact, so a clinical assertion resolves too.
    const [uploaded] = await db
      .insert(denialDocument)
      .values({
        denialId,
        kind: 'clinical_record',
        r2Key: `org/${org.id}/denial/${denialId}/clinical_record/${stamp}`,
        filename: 'nursing-notes.txt',
        byteSize: 512,
        contentHash: `chash-${stamp}`,
        parsedAt: new Date(),
        uploadedBy: specialist.userId,
      })
      .returning({ id: denialDocument.id });

    const chartText =
      'Nursing note: Patient requires skilled observation and assessment for ' +
      'anticoagulation management following pulmonary embolism, with daily INR ' +
      'monitoring and dose adjustment per protocol.';

    const [chartSpan] = await db
      .insert(denialSpan)
      .values({
        denialDocumentId: uploaded!.id,
        ordinal: 1,
        page: 2,
        charStart: 0,
        charEnd: chartText.length,
        text: chartText,
      })
      .returning({ id: denialSpan.id });

    const [fact] = await db
      .insert(clinicalFact)
      .values({
        denialId,
        spanId: chartSpan!.id,
        verbatimQuote:
          'skilled observation and assessment for anticoagulation management',
        factType: 'skilled_service',
        normalizedValue: 'requires skilled observation for anticoagulation management',
      })
      .returning({ id: clinicalFact.id });

    const [draft] = await db
      .insert(appealDraft)
      .values({
        denialId,
        version: 1,
        bodyJson: JSON.stringify({ sections: { argument: [1], application: [2] } }),
        status: 'ready',
        documentationGaps: [],
        proprietaryCriteriaFlag: true,
        generatedByModel: 'test-fixture',
      })
      .returning({ id: appealDraft.id });

    const inserted = await db
      .insert(assertion)
      .values([
        {
          appealDraftId: draft!.id,
          ordinal: 1,
          section: 'argument',
          kind: 'legal',
          text: 'The plan applied criteria more restrictive than Traditional Medicare.',
          sourceKind: 'holding',
          sourceId: held!.id,
          verbatimQuote:
            'may not apply coverage criteria more restrictive than those used in Traditional Medicare',
        },
        {
          appealDraftId: draft!.id,
          ordinal: 2,
          section: 'application',
          kind: 'clinical',
          text: 'The record documents a daily skilled nursing need throughout the stay.',
          sourceKind: 'clinical_fact',
          sourceId: fact!.id,
          verbatimQuote:
            'skilled observation and assessment for anticoagulation management',
        },
      ])
      .returning({ id: assertion.id });

    return {
      orgId: org.id,
      denialId,
      draftId: draft!.id,
      assertionIds: inserted.map((r) => r.id),
      specialist,
      clinical,
      legal,
    };
  },

  /** Whether a draft may be exported, and why not. */
  async exportState(args) {
    const approvals = await hasBothApprovals(String(args.draftId));
    const permitted = await canExport(String(args.denialId), String(args.draftId));
    return {
      clinical: approvals.clinical,
      legal: approvals.legal,
      canExport: permitted.ok,
      reason: permitted.ok ? '' : permitted.reason,
    };
  },

  async denialStatus(args) {
    const row = await db.query.denial.findFirst({
      where: eq(denial.id, String(args.denialId)),
    });
    return row?.status ?? null;
  },

  /**
   * Drive a case from review through to an issued invoice.
   *
   * Every step goes through the real transition guard, so the sequence proves
   * the state machine allows this path and no other.
   */
  async runToInvoice(args) {
    const denialId = String(args.denialId);
    const draftId = String(args.draftId);
    const organizationId = String(args.organizationId);

    const operator = await db.query.user.findFirst();
    const userId = operator!.id;

    const already = await db.query.outcome.findFirst({
      where: eq(outcome.denialId, denialId),
    });

    if (!already) {
      await db.insert(reviewAction).values([
        { appealDraftId: draftId, reviewerId: userId, reviewType: 'clinical', action: 'approved' },
        { appealDraftId: draftId, reviewerId: userId, reviewType: 'legal', action: 'approved' },
      ]);

      await transition({ denialId, to: 'legal_review', userId, organizationId });
      await transition({ denialId, to: 'approved', userId, organizationId });
      await transition({ denialId, to: 'submitted', userId, organizationId });

      await db.insert(outcome).values({
        denialId,
        result: 'won',
        decidedAt: new Date(),
        amountRecoveredCents: Number(args.amountRecoveredCents),
        recordedBy: userId,
      });

      await transition({ denialId, to: 'decided', userId, organizationId });
    }

    const period = {
      start: new Date(Date.now() - 24 * 60 * 60 * 1000),
      end: new Date(Date.now() + 24 * 60 * 60 * 1000),
    };

    try {
      const issued = await issueInvoice(organizationId, period, userId);
      const org = await db.query.organization.findFirst({
        where: eq(organization.id, organizationId),
      });
      return {
        recoveredCents: issued.totalRecoveredCents,
        feeCents: issued.feeCents,
        rateBps: org!.contingencyRateBps,
        number: issued.number,
        lineCount: issued.lineCount,
      };
    } catch (error) {
      if (args.expectFailure) {
        return { error: error instanceof Error ? error.message : String(error) };
      }
      throw error;
    }
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
