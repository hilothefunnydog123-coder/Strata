import type { Metadata } from 'next';
import Link from 'next/link';
import { and, desc, eq, sql } from 'drizzle-orm';
import { assertPlatformOrForbid, requirePrincipal } from '@/lib/auth/guards';
import { audit } from '@/lib/audit';
import { db } from '@/lib/db';
import { denial, organization, outcome } from '@/lib/db/schema';
import { daysUntil, STATUS_LABELS, STATUSES, type Status } from '@/lib/appeals/workflow';
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

export const metadata: Metadata = { title: 'All appeals' };

/**
 * The operator's view across every organisation.
 *
 * This is the one place a person can see other organisations' cases, which is
 * why it is superadmin only and why reading it writes an audit row like any
 * other read of a clinical record. It deliberately shows metadata and money
 * rather than any clinical content: to read a case the operator opens it, and
 * that read is audited against the case.
 */
export default async function AllAppealsPage({
  searchParams,
}: {
  searchParams: Promise<{ status?: string }>;
}) {
  const principal = await requirePrincipal();
  assertPlatformOrForbid(principal, 'admin:all_appeals');

  const { status } = await searchParams;

  const rows = await db
    .select({
      id: denial.id,
      internalRef: denial.internalRef,
      organizationName: organization.name,
      payerName: denial.payerName,
      claimAmountCents: denial.claimAmountCents,
      appealDeadline: denial.appealDeadline,
      status: denial.status,
      createdAt: denial.createdAt,
      isSynthetic: denial.isSynthetic,
      recoveredCents: outcome.amountRecoveredCents,
    })
    .from(denial)
    .innerJoin(organization, eq(denial.organizationId, organization.id))
    .leftJoin(outcome, eq(outcome.denialId, denial.id))
    .where(status ? and(eq(denial.status, status as 'intake')) : undefined)
    .orderBy(desc(denial.createdAt))
    .limit(500);

  await audit({
    userId: principal.userId,
    organizationId: null,
    action: 'list',
    entityType: 'denial',
    entityId: null,
  });

  return (
    <div className="px-4 py-5">
      <h1 className="text-lg">All appeals</h1>
      <p className="mt-1 max-w-3xl text-sm text-ink-2">
        Every organisation. Metadata and money only: opening a case to read it is
        a separate action and is audited against that case.
      </p>

      <div className="mt-3 flex flex-wrap gap-1.5">
        <Link
          href="/admin/appeals"
          className={`rounded-[2px] border px-2 py-0.5 text-xs no-underline ${
            !status
              ? 'border-action bg-action-wash text-action'
              : 'border-rule-strong bg-paper-2 text-ink'
          }`}
        >
          All
        </Link>
        {STATUSES.map((s) => (
          <Link
            key={s}
            href={`/admin/appeals?status=${s}`}
            className={`rounded-[2px] border px-2 py-0.5 text-xs no-underline ${
              status === s
                ? 'border-action bg-action-wash text-action'
                : 'border-rule-strong bg-paper-2 text-ink'
            }`}
          >
            {STATUS_LABELS[s]}
          </Link>
        ))}
      </div>

      <Panel className="mt-4">
        <PanelHeader title={`${rows.length} ${rows.length === 1 ? 'case' : 'cases'}`} />
        {rows.length === 0 ? (
          <EmptyState
            title={status ? 'Nothing at that stage' : 'No denials on the platform yet'}
            body={
              status
                ? 'Try another stage, or clear the filter.'
                : 'Cases appear here as soon as any customer creates one.'
            }
          />
        ) : (
          <Table>
            <thead>
              <tr>
                <Th>Reference</Th>
                <Th>Organisation</Th>
                <Th>Payer</Th>
                <Th numeric>Amount</Th>
                <Th>Deadline</Th>
                <Th>Stage</Th>
                <Th numeric>Recovered</Th>
                <Th>Data</Th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => {
                const days = daysUntil(row.appealDeadline);
                return (
                  <tr key={row.id} className="hover:bg-paper">
                    <Td>
                      <Link href={`/app/denials/${row.id}`} className="id">
                        {row.internalRef}
                      </Link>
                    </Td>
                    <Td>{row.organizationName}</Td>
                    <Td>{row.payerName}</Td>
                    <Td numeric>
                      <Money cents={row.claimAmountCents} tone="denied" />
                    </Td>
                    <Td>
                      {row.appealDeadline ? (
                        <span className={days !== null && days <= 7 ? 'text-denied' : ''}>
                          <span className="id">
                            {row.appealDeadline.toISOString().slice(0, 10)}
                          </span>
                        </span>
                      ) : (
                        <span className="text-ink-2">not set</span>
                      )}
                    </Td>
                    <Td>
                      <Tag>{STATUS_LABELS[row.status as Status]}</Tag>
                    </Td>
                    <Td numeric>
                      {row.recoveredCents === null ? (
                        <span className="text-ink-2">-</span>
                      ) : (
                        <Money cents={row.recoveredCents} tone="recovered" />
                      )}
                    </Td>
                    <Td>
                      {row.isSynthetic ? (
                        <Tag tone="denied">synthetic</Tag>
                      ) : (
                        <Tag tone="neutral">live</Tag>
                      )}
                    </Td>
                  </tr>
                );
              })}
            </tbody>
          </Table>
        )}
      </Panel>
    </div>
  );
}

export { sql };
