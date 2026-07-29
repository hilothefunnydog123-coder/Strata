import type { Metadata } from 'next';
import Link from 'next/link';
import { requirePrincipal, type Membership } from '@/lib/auth/guards';
import { can } from '@/lib/auth/roles';
import { listDenials, payersFor } from '@/lib/denials/queries';
import { daysUntil, STATUS_LABELS, STATUSES, type Status } from '@/lib/appeals/workflow';
import { SERVICE_TYPE_LABELS } from '@/lib/denials/upload';
import { ButtonLink } from '@/components/ui/button';
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
import { Filters } from './filters';

export const metadata: Metadata = { title: 'Denials' };

export default async function DenialsPage({
  searchParams,
}: {
  searchParams: Promise<{
    org?: string;
    status?: string;
    payer?: string;
    deadline?: string;
  }>;
}) {
  const principal = await requirePrincipal();
  const params = await searchParams;

  const membership: Membership | undefined =
    principal.memberships.find((m) => m.organizationId === params.org) ??
    principal.memberships[0];

  if (!membership) {
    return (
      <EmptyState
        title="Your account is not attached to an organisation yet"
        body="Ask your administrator to add you to one."
      />
    );
  }

  const [rows, payers] = await Promise.all([
    listDenials(membership.organizationId, {
      ...(params.status ? { status: params.status } : {}),
      ...(params.payer ? { payer: params.payer } : {}),
      ...(params.deadline ? { deadlineWindow: params.deadline } : {}),
    }),
    payersFor(membership.organizationId),
  ]);

  const mayCreate = can(principal.platformRole, membership.role, 'denial:create');
  const filtered = Boolean(params.status || params.payer || params.deadline);

  return (
    <div className="px-4 py-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-lg">Denials</h1>
        {mayCreate ? (
          <ButtonLink href="/app/denials/new" intent="primary" size="sm">
            New denial
          </ButtonLink>
        ) : null}
      </div>

      <Filters
        payers={payers}
        statuses={[...STATUSES]}
        statusLabels={STATUS_LABELS}
        current={{
          status: params.status ?? '',
          payer: params.payer ?? '',
          deadline: params.deadline ?? '',
        }}
      />

      <Panel className="mt-4">
        <PanelHeader title={`${rows.length} ${rows.length === 1 ? 'case' : 'cases'}`} />

        {rows.length === 0 ? (
          <EmptyState
            title={filtered ? 'Nothing matches those filters' : 'No denials yet'}
            body={
              filtered
                ? 'Clear a filter to widen the search.'
                : mayCreate
                  ? 'Upload a denial letter and the record that goes with it, and you get back a drafted appeal with every claim traced to its source.'
                  : 'An appeal specialist at your organisation adds cases here.'
            }
            {...(filtered
              ? { action: { href: '/app/denials', label: 'Clear filters' } }
              : mayCreate
                ? { action: { href: '/app/denials/new', label: 'Add a denial' } }
                : {})}
          />
        ) : (
          <Table>
            <thead>
              <tr>
                <Th>Reference</Th>
                <Th>Payer</Th>
                <Th>Service</Th>
                <Th numeric>Amount</Th>
                <Th>Deadline</Th>
                <Th>Stage</Th>
                <Th numeric>Recovered</Th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => {
                const days = daysUntil(row.appealDeadline);
                const urgent = days !== null && days <= 7;
                return (
                  <tr key={row.id} className="hover:bg-paper">
                    <Td>
                      <Link href={`/app/denials/${row.id}`} className="id">
                        {row.internalRef}
                      </Link>
                    </Td>
                    <Td>{row.payerName}</Td>
                    <Td>{SERVICE_TYPE_LABELS[row.serviceType] ?? row.serviceType}</Td>
                    <Td numeric>
                      <Money cents={row.claimAmountCents} tone="denied" />
                    </Td>
                    <Td>
                      {row.appealDeadline ? (
                        <span className={urgent ? 'text-denied' : ''}>
                          <span className="id">
                            {row.appealDeadline.toISOString().slice(0, 10)}
                          </span>
                          {days !== null ? (
                            <span className="ml-1.5 text-xs">
                              {days < 0
                                ? `${Math.abs(days)}d ago`
                                : days === 0
                                  ? 'today'
                                  : `${days}d`}
                            </span>
                          ) : null}
                        </span>
                      ) : (
                        <span className="text-ink-2">not set</span>
                      )}
                    </Td>
                    <Td>
                      <Tag
                        tone={
                          row.status === 'approved' || row.status === 'invoiced'
                            ? 'recovered'
                            : 'neutral'
                        }
                      >
                        {STATUS_LABELS[row.status as Status]}
                      </Tag>
                    </Td>
                    <Td numeric>
                      {row.recoveredCents === null ? (
                        <span className="text-ink-2">-</span>
                      ) : (
                        <Money cents={row.recoveredCents} tone="recovered" />
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
