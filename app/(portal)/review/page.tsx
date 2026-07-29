import type { Metadata } from 'next';
import Link from 'next/link';
import { requirePrincipal } from '@/lib/auth/guards';
import { reviewQueue } from '@/lib/review/queue';
import { daysUntil } from '@/lib/appeals/workflow';
import { SERVICE_TYPE_LABELS } from '@/lib/denials/upload';
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

export const metadata: Metadata = { title: 'Review queue' };

export default async function ReviewQueuePage() {
  const principal = await requirePrincipal();

  const reviewType =
    principal.platformRole === 'legal_reviewer' ? 'legal' : 'clinical';
  const seeAll = principal.platformRole === 'superadmin';

  if (!seeAll && principal.reviewerOrgIds.length === 0) {
    return (
      <EmptyState
        title="You are not assigned to any organisations"
        body="Reviewers see the queues of the hospitals they are assigned to. Ask the operator to assign you."
      />
    );
  }

  const items = await reviewQueue(principal.reviewerOrgIds, reviewType, seeAll);

  return (
    <div className="px-4 py-5">
      <h1 className="text-lg">
        {reviewType === 'legal' ? 'Legal review' : 'Clinical review'} queue
      </h1>
      <p className="mt-1 text-sm text-ink-2">
        {reviewType === 'legal'
          ? 'Check that every citation resolves and that the decision cited supports the assertion made. This is the last gate before export.'
          : 'Check every clinical assertion against the line of the record it cites.'}
      </p>

      <Panel className="mt-4">
        <PanelHeader title={`${items.length} waiting`} />
        {items.length === 0 ? (
          <EmptyState
            title="Nothing waiting"
            body="Drafts appear here as soon as they pass verification and reach your stage. Ordered by appeal deadline, soonest first."
          />
        ) : (
          <Table>
            <thead>
              <tr>
                <Th>Reference</Th>
                <Th>Organisation</Th>
                <Th>Payer</Th>
                <Th>Service</Th>
                <Th numeric>Amount</Th>
                <Th numeric>Assertions</Th>
                <Th>Gaps</Th>
                <Th>Deadline</Th>
              </tr>
            </thead>
            <tbody>
              {items.map((item) => {
                const days = daysUntil(item.appealDeadline);
                const urgent = days !== null && days <= 7;
                return (
                  <tr key={item.draftId} className="hover:bg-paper">
                    <Td>
                      <Link href={`/review/${item.draftId}`} className="id">
                        {item.internalRef}
                      </Link>
                      <span className="id ml-1.5 text-xs text-ink-2">
                        v{item.version}
                      </span>
                    </Td>
                    <Td>{item.organizationName}</Td>
                    <Td>{item.payerName}</Td>
                    <Td>{SERVICE_TYPE_LABELS[item.serviceType] ?? item.serviceType}</Td>
                    <Td numeric>
                      <Money cents={item.claimAmountCents} tone="denied" />
                    </Td>
                    <Td numeric>{item.assertionCount}</Td>
                    <Td>
                      {item.gapCount > 0 ? (
                        <Tag tone="denied">{item.gapCount}</Tag>
                      ) : (
                        <span className="text-ink-2">none</span>
                      )}
                    </Td>
                    <Td>
                      {item.appealDeadline ? (
                        <span className={urgent ? 'text-denied' : ''}>
                          <span className="id">
                            {item.appealDeadline.toISOString().slice(0, 10)}
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
