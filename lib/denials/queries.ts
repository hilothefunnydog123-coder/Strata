/**
 * The figures the client portal shows.
 *
 * Every number here is computed from records. There is no seeded total, no
 * illustrative figure, and nothing that reads well but means nothing. With no
 * appeals, these return zeros and the interface says so in words rather than
 * showing an invented number.
 *
 * These are operational queries, scoped to one organisation, run for people
 * already entitled to read those records, and audited. They are not analytics,
 * which is why they may touch PHI tables. See lib/analytics/guard.ts for the
 * distinction and where the line is drawn.
 */
import { and, asc, count, desc, eq, gte, inArray, isNotNull, lte, sql } from 'drizzle-orm';
import { db } from '@/lib/db';
import { appealDraft, denial, invoice, outcome } from '@/lib/db/schema';

export interface DashboardFigures {
  totalRecoveredCents: number;
  recoveredThisMonthCents: number;
  atRiskCents: number;
  inFlightByStage: { status: string; count: number; amountCents: number }[];
  decided: { won: number; lost: number; partial: number; withdrawn: number };
  winRatePercent: number | null;
  averageDaysToDecision: number | null;
  deadlinesInside7Days: number;
  deadlinesPassed: number;
  totalDenials: number;
  feesBilledCents: number;
}

export async function dashboardFigures(
  organizationId: string,
): Promise<DashboardFigures> {
  const now = new Date();
  const monthStart = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
  const inSevenDays = new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000);

  const [recovered, thisMonth, byStage, results, timing, deadlines, total, fees] =
    await Promise.all([
      db
        .select({ sum: sql<number>`coalesce(sum(${outcome.amountRecoveredCents}), 0)::int` })
        .from(outcome)
        .innerJoin(denial, eq(outcome.denialId, denial.id))
        .where(eq(denial.organizationId, organizationId)),

      db
        .select({ sum: sql<number>`coalesce(sum(${outcome.amountRecoveredCents}), 0)::int` })
        .from(outcome)
        .innerJoin(denial, eq(outcome.denialId, denial.id))
        .where(
          and(
            eq(denial.organizationId, organizationId),
            gte(outcome.decidedAt, monthStart),
          ),
        ),

      db
        .select({
          status: denial.status,
          count: sql<number>`count(*)::int`,
          amountCents: sql<number>`coalesce(sum(${denial.claimAmountCents}), 0)::int`,
        })
        .from(denial)
        .where(eq(denial.organizationId, organizationId))
        .groupBy(denial.status),

      db
        .select({ result: outcome.result, count: sql<number>`count(*)::int` })
        .from(outcome)
        .innerJoin(denial, eq(outcome.denialId, denial.id))
        .where(eq(denial.organizationId, organizationId))
        .groupBy(outcome.result),

      db
        .select({
          averageDays: sql<
            number | null
          >`avg(extract(epoch from (${outcome.decidedAt} - ${denial.createdAt})) / 86400)`,
        })
        .from(outcome)
        .innerJoin(denial, eq(outcome.denialId, denial.id))
        .where(eq(denial.organizationId, organizationId)),

      db
        .select({
          soon: sql<number>`count(*) filter (where ${denial.appealDeadline} between ${now} and ${inSevenDays})::int`,
          passed: sql<number>`count(*) filter (where ${denial.appealDeadline} < ${now})::int`,
        })
        .from(denial)
        .where(
          and(
            eq(denial.organizationId, organizationId),
            isNotNull(denial.appealDeadline),
            // A case already decided or invoiced has no live deadline.
            inArray(denial.status, [
              'intake',
              'parsing',
              'ready_for_generation',
              'generating',
              'clinical_review',
              'legal_review',
              'approved',
            ]),
          ),
        ),

      db
        .select({ n: count() })
        .from(denial)
        .where(eq(denial.organizationId, organizationId)),

      db
        .select({ sum: sql<number>`coalesce(sum(${invoice.feeCents}), 0)::int` })
        .from(invoice)
        .where(eq(invoice.organizationId, organizationId)),
    ]);

  const decided = { won: 0, lost: 0, partial: 0, withdrawn: 0 };
  for (const row of results) {
    decided[row.result as keyof typeof decided] = row.count;
  }

  const decidedTotal = decided.won + decided.lost + decided.partial + decided.withdrawn;
  // A partial recovery is a win: money came back that would not have otherwise.
  const wins = decided.won + decided.partial;

  // Cases still in flight, which is the money at risk right now.
  const openStages = new Set([
    'intake',
    'parsing',
    'ready_for_generation',
    'generating',
    'clinical_review',
    'legal_review',
    'approved',
    'submitted',
  ]);

  return {
    totalRecoveredCents: recovered[0]?.sum ?? 0,
    recoveredThisMonthCents: thisMonth[0]?.sum ?? 0,
    atRiskCents: byStage
      .filter((s) => openStages.has(s.status))
      .reduce((sum, s) => sum + s.amountCents, 0),
    inFlightByStage: byStage,
    decided,
    winRatePercent:
      decidedTotal === 0 ? null : Math.round((wins / decidedTotal) * 100),
    averageDaysToDecision:
      timing[0]?.averageDays == null ? null : Math.round(Number(timing[0].averageDays)),
    deadlinesInside7Days: deadlines[0]?.soon ?? 0,
    deadlinesPassed: deadlines[0]?.passed ?? 0,
    totalDenials: total[0]?.n ?? 0,
    feesBilledCents: fees[0]?.sum ?? 0,
  };
}

export interface DenialListFilters {
  status?: string;
  payer?: string;
  /** 'overdue' | 'week' | 'month' */
  deadlineWindow?: string;
}

export interface DenialListRow {
  id: string;
  internalRef: string;
  payerName: string;
  serviceType: string;
  claimAmountCents: number;
  appealDeadline: Date | null;
  status: string;
  createdAt: Date;
  hasDraft: boolean;
  recoveredCents: number | null;
}

export async function listDenials(
  organizationId: string,
  filters: DenialListFilters = {},
): Promise<DenialListRow[]> {
  const now = new Date();
  const conditions = [eq(denial.organizationId, organizationId)];

  if (filters.status) {
    conditions.push(eq(denial.status, filters.status as 'intake'));
  }
  if (filters.payer) {
    conditions.push(eq(denial.payerName, filters.payer));
  }
  if (filters.deadlineWindow === 'overdue') {
    conditions.push(lte(denial.appealDeadline, now));
  } else if (filters.deadlineWindow === 'week') {
    conditions.push(gte(denial.appealDeadline, now));
    conditions.push(
      lte(denial.appealDeadline, new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000)),
    );
  } else if (filters.deadlineWindow === 'month') {
    conditions.push(gte(denial.appealDeadline, now));
    conditions.push(
      lte(denial.appealDeadline, new Date(now.getTime() + 30 * 24 * 60 * 60 * 1000)),
    );
  }

  const rows = await db
    .select({
      id: denial.id,
      internalRef: denial.internalRef,
      payerName: denial.payerName,
      serviceType: denial.serviceType,
      claimAmountCents: denial.claimAmountCents,
      appealDeadline: denial.appealDeadline,
      status: denial.status,
      createdAt: denial.createdAt,
      draftId: appealDraft.id,
      recoveredCents: outcome.amountRecoveredCents,
    })
    .from(denial)
    .leftJoin(
      appealDraft,
      and(eq(appealDraft.denialId, denial.id), eq(appealDraft.status, 'ready')),
    )
    .leftJoin(outcome, eq(outcome.denialId, denial.id))
    .where(and(...conditions))
    // Soonest deadline first, because that is the order the work gets done in.
    // Nulls last: a case with no deadline is not urgent, it is unscheduled.
    // One fragment rather than asc(...) around it, because wrapping emits
    // "... nulls last asc", which Postgres rejects.
    .orderBy(sql`${denial.appealDeadline} asc nulls last`, desc(denial.createdAt));

  return rows.map((r) => ({
    id: r.id,
    internalRef: r.internalRef,
    payerName: r.payerName,
    serviceType: r.serviceType,
    claimAmountCents: r.claimAmountCents,
    appealDeadline: r.appealDeadline,
    status: r.status,
    createdAt: r.createdAt,
    hasDraft: r.draftId !== null,
    recoveredCents: r.recoveredCents,
  }));
}

/** Distinct payers for this organisation, for the filter control. */
export async function payersFor(organizationId: string): Promise<string[]> {
  const rows = await db
    .selectDistinct({ payerName: denial.payerName })
    .from(denial)
    .where(eq(denial.organizationId, organizationId))
    .orderBy(asc(denial.payerName));
  return rows.map((r) => r.payerName);
}
