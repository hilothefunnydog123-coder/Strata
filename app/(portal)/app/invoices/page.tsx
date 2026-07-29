import type { Metadata } from 'next';
import { desc, eq, sql } from 'drizzle-orm';
import { assertCanOrForbid, requirePrincipal, type Membership } from '@/lib/auth/guards';
import { db } from '@/lib/db';
import { denial, invoice, outcome } from '@/lib/db/schema';
import { formatRate } from '@/lib/billing/invoice';
import {
  EmptyState,
  Money,
  Panel,
  PanelHeader,
  Table,
  Tag,
  Td,
  Th,
} from '@/components/ui/primitives';

export const metadata: Metadata = { title: 'Invoices' };

export default async function InvoicesPage({
  searchParams,
}: {
  searchParams: Promise<{ org?: string }>;
}) {
  const principal = await requirePrincipal();
  const { org } = await searchParams;

  const membership: Membership | undefined =
    principal.memberships.find((m) => m.organizationId === org) ??
    principal.memberships[0];

  if (!membership) {
    return (
      <EmptyState
        title="Your account is not attached to an organisation yet"
        body="Ask your administrator to add you to one."
      />
    );
  }

  assertCanOrForbid(principal, membership.organizationId, 'invoice:read');

  const [invoices, unbilled] = await Promise.all([
    db
      .select()
      .from(invoice)
      .where(eq(invoice.organizationId, membership.organizationId))
      .orderBy(desc(invoice.periodStart)),
    db
      .select({
        recovered: sql<number>`coalesce(sum(${outcome.amountRecoveredCents}), 0)::int`,
        cases: sql<number>`count(*)::int`,
      })
      .from(outcome)
      .innerJoin(denial, eq(outcome.denialId, denial.id))
      .where(
        sql`${denial.organizationId} = ${membership.organizationId} and ${outcome.invoiceId} is null and ${outcome.amountRecoveredCents} > 0`,
      ),
  ]);

  const pendingCents = unbilled[0]?.recovered ?? 0;
  const pendingCases = unbilled[0]?.cases ?? 0;

  return (
    <div className="px-4 py-5">
      <h1 className="text-lg">Invoices</h1>
      <p className="mt-1 max-w-2xl text-sm text-ink-2">
        You pay {formatRate(membership.contingencyRateBps)} of what we recover,
        and nothing otherwise. Every line is computed from an outcome you
        recorded, so the arithmetic can be checked against your own remittance
        advice.
      </p>

      {pendingCases > 0 ? (
        <div className="mt-4 border border-rule bg-paper-2 px-4 py-3 text-sm">
          <p className="font-medium">Not yet invoiced</p>
          <p className="mt-1 text-ink-2">
            <Money cents={pendingCents} tone="recovered" /> recovered across{' '}
            {pendingCases} {pendingCases === 1 ? 'case' : 'cases'}, which will
            appear on the next invoice at {formatRate(membership.contingencyRateBps)}.
          </p>
        </div>
      ) : null}

      <Panel className="mt-4">
        <PanelHeader title={`${invoices.length} ${invoices.length === 1 ? 'invoice' : 'invoices'}`} />
        {invoices.length === 0 ? (
          <EmptyState
            title="No invoices yet"
            body="An invoice is raised once outcomes have been recorded for a period. Nothing recovered means nothing owed, so there is nothing to show."
          />
        ) : (
          <Table>
            <thead>
              <tr>
                <Th>Number</Th>
                <Th>Period</Th>
                <Th numeric>Recovered</Th>
                <Th numeric>Rate</Th>
                <Th numeric>Fee</Th>
                <Th>Status</Th>
              </tr>
            </thead>
            <tbody>
              {invoices.map((row) => (
                <tr key={row.id} className="hover:bg-paper">
                  <Td>
                    <span className="id">{row.number}</span>
                  </Td>
                  <Td>
                    <span className="id text-xs">
                      {row.periodStart.toISOString().slice(0, 10)} to{' '}
                      {row.periodEnd.toISOString().slice(0, 10)}
                    </span>
                  </Td>
                  <Td numeric>
                    <Money cents={row.totalRecoveredCents} tone="recovered" />
                  </Td>
                  <Td numeric>
                    <span className="id">{formatRate(row.contingencyRateBps)}</span>
                  </Td>
                  <Td numeric>
                    <Money cents={row.feeCents} />
                  </Td>
                  <Td>
                    <Tag tone={row.status === 'paid' ? 'recovered' : 'neutral'}>
                      {row.status}
                    </Tag>
                  </Td>
                </tr>
              ))}
            </tbody>
          </Table>
        )}
      </Panel>
    </div>
  );
}
