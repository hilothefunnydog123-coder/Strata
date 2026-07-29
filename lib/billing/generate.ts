/**
 * Issuing an invoice.
 *
 * The calculation lives in lib/billing/invoice.ts, which is pure and heavily
 * tested. This module is the part that touches the database: it gathers the
 * billable outcomes, writes the invoice, and marks those outcomes as billed so
 * they cannot be billed again.
 *
 * The marking is the important bit. An outcome carries the id of the invoice
 * that billed it, and calculateInvoice excludes any outcome that already has
 * one. Double billing is prevented by the data rather than by remembering.
 */
import { and, eq, gte, inArray, lte, sql } from 'drizzle-orm';
import { db } from '@/lib/db';
import { denial, invoice, organization, outcome } from '@/lib/db/schema';
import { calculateInvoice, invoiceNumber, type BillableOutcome } from './invoice';
import { transition } from '@/lib/appeals/workflow';
import { log } from '@/lib/log';

export interface IssuedInvoice {
  invoiceId: string;
  number: string;
  totalRecoveredCents: number;
  feeCents: number;
  lineCount: number;
  excluded: { outcomeId: string; reason: string }[];
}

export class NothingToBillError extends Error {
  constructor(period: { start: Date; end: Date }) {
    super(
      `Nothing recovered between ${period.start.toISOString().slice(0, 10)} and ` +
        `${period.end.toISOString().slice(0, 10)}, so there is no invoice to issue. ` +
        'An empty invoice is not something to send a customer.',
    );
    this.name = 'NothingToBillError';
  }
}

/**
 * Build and issue an invoice for one organisation and one period.
 *
 * Idempotent by period: a second call for the same window finds every outcome
 * already carrying an invoice id and refuses rather than issuing a duplicate.
 */
export async function issueInvoice(
  organizationId: string,
  period: { start: Date; end: Date },
  issuedBy: string,
): Promise<IssuedInvoice> {
  const org = await db.query.organization.findFirst({
    where: eq(organization.id, organizationId),
  });
  if (!org) throw new Error('That organisation does not exist.');

  const rows = await db
    .select({
      outcomeId: outcome.id,
      denialId: outcome.denialId,
      result: outcome.result,
      amountRecoveredCents: outcome.amountRecoveredCents,
      decidedAt: outcome.decidedAt,
      invoiceId: outcome.invoiceId,
    })
    .from(outcome)
    .innerJoin(denial, eq(outcome.denialId, denial.id))
    .where(
      and(
        eq(denial.organizationId, organizationId),
        gte(outcome.decidedAt, period.start),
        lte(outcome.decidedAt, period.end),
      ),
    );

  const billable: BillableOutcome[] = rows.map((r) => ({
    outcomeId: r.outcomeId,
    denialId: r.denialId,
    result: r.result,
    amountRecoveredCents: r.amountRecoveredCents,
    decidedAt: r.decidedAt,
    invoiceId: r.invoiceId,
  }));

  const calculation = calculateInvoice(billable, org.contingencyRateBps, period);

  if (calculation.lines.length === 0) throw new NothingToBillError(period);

  const [sequence] = await db
    .select({ n: sql<number>`count(*)::int` })
    .from(invoice)
    .where(eq(invoice.organizationId, organizationId));

  const number = invoiceNumber(org.slug, period.start, (sequence?.n ?? 0) + 1);

  const [created] = await db
    .insert(invoice)
    .values({
      organizationId,
      number,
      periodStart: period.start,
      periodEnd: period.end,
      totalRecoveredCents: calculation.totalRecoveredCents,
      contingencyRateBps: calculation.contingencyRateBps,
      feeCents: calculation.feeCents,
      status: 'issued',
      issuedAt: new Date(),
    })
    .returning({ id: invoice.id });

  const invoiceId = created!.id;

  // Mark the outcomes billed, so nothing here can be billed twice.
  await db
    .update(outcome)
    .set({ invoiceId })
    .where(
      inArray(
        outcome.id,
        calculation.lines.map((l) => l.outcomeId),
      ),
    );

  // Move each billed case to invoiced, where the state machine allows it.
  for (const line of calculation.lines) {
    try {
      await transition({
        denialId: line.denialId,
        to: 'invoiced',
        userId: issuedBy,
        organizationId,
      });
    } catch (error) {
      // A case that never reached "decided" cannot move to "invoiced". The
      // invoice is still correct; the stage just stays where it was.
      log.warn('billed case could not move to invoiced', {
        denialId: line.denialId,
        error,
      });
    }
  }

  return {
    invoiceId,
    number,
    totalRecoveredCents: calculation.totalRecoveredCents,
    feeCents: calculation.feeCents,
    lineCount: calculation.lines.length,
    excluded: calculation.excluded,
  };
}
