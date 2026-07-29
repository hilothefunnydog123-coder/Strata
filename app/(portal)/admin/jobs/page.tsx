import type { Metadata } from 'next';
import { desc, ne, sql } from 'drizzle-orm';
import { assertPlatformOrForbid, requirePrincipal } from '@/lib/auth/guards';
import { analyticsQuery } from '@/lib/analytics/guard';
import { db } from '@/lib/db';
import { job } from '@/lib/db/schema';
import {
  EmptyState,
  Panel,
  PanelHeader,
  Table,
  Tag,
  Td,
  Th,
} from '@/components/ui/primitives';
import { RetryButton } from './client';

export const metadata: Metadata = { title: 'Job queue' };

export default async function JobsPage() {
  const principal = await requirePrincipal();
  assertPlatformOrForbid(principal, 'admin:jobs');

  const { byStatus, recent } = await analyticsQuery(['job'], async () => {
    const [byStatus, recent] = await Promise.all([
      db
        .select({ status: job.status, count: sql<number>`count(*)::int` })
        .from(job)
        // rate_limit rows use this table as keyed storage and are not work.
        .where(ne(job.kind, 'rate_limit'))
        .groupBy(job.status),
      db
        .select()
        .from(job)
        .where(ne(job.kind, 'rate_limit'))
        .orderBy(desc(job.createdAt))
        .limit(50),
    ]);
    return { byStatus, recent };
  });

  const failed = byStatus.find((s) => s.status === 'failed')?.count ?? 0;

  return (
    <div className="px-4 py-5">
      <h1 className="text-lg">Job queue</h1>
      <p className="mt-1 max-w-3xl text-sm text-ink-2">
        Background work: outbound campaign sends, deadline warnings, and anything
        else that must not happen inside a request. Drained by the cron route,
        which retries a failure with backoff until it runs out of attempts.
      </p>

      <div className="mt-4 grid gap-px border border-rule bg-rule sm:grid-cols-4">
        {(['pending', 'running', 'done', 'failed'] as const).map((status) => {
          const count = byStatus.find((s) => s.status === status)?.count ?? 0;
          return (
            <div key={status} className="bg-paper-2 p-3">
              <p className="text-2xs uppercase tracking-wider text-ink-2">{status}</p>
              <p
                className={`tnum mt-1 text-2xl font-semibold ${
                  status === 'failed' && count > 0 ? 'text-denied' : ''
                }`}
              >
                {count}
              </p>
            </div>
          );
        })}
      </div>

      {failed > 0 ? (
        <div className="mt-4 border border-denied/40 bg-denied-wash px-4 py-3 text-sm">
          <p className="font-semibold text-denied">
            {failed} {failed === 1 ? 'job has' : 'jobs have'} run out of attempts
          </p>
          <p className="mt-1 text-ink">
            Read the error, fix the cause, then retry. Retrying without reading it
            just burns the attempts again.
          </p>
        </div>
      ) : null}

      <Panel className="mt-6">
        <PanelHeader title="Recent jobs" />
        {recent.length === 0 ? (
          <EmptyState
            title="Nothing queued"
            body="Jobs appear here when a campaign starts sending or a deadline warning is scheduled."
          />
        ) : (
          <Table>
            <thead>
              <tr>
                <Th>Kind</Th>
                <Th>Status</Th>
                <Th numeric>Attempts</Th>
                <Th>Run after</Th>
                <Th>Last error</Th>
                <Th>Actions</Th>
              </tr>
            </thead>
            <tbody>
              {recent.map((row) => (
                <tr key={row.id} className="hover:bg-paper">
                  <Td>
                    <span className="id">{row.kind}</span>
                  </Td>
                  <Td>
                    <Tag
                      tone={
                        row.status === 'failed'
                          ? 'denied'
                          : row.status === 'done'
                            ? 'recovered'
                            : 'neutral'
                      }
                    >
                      {row.status}
                    </Tag>
                  </Td>
                  <Td numeric>
                    {row.attempts} of {row.maxAttempts}
                  </Td>
                  <Td>
                    <span className="id text-xs">
                      {row.runAfter.toISOString().slice(0, 16).replace('T', ' ')}
                    </span>
                  </Td>
                  <Td className="max-w-md">
                    {row.lastError ? (
                      <span className="text-xs text-denied">{row.lastError}</span>
                    ) : (
                      <span className="text-ink-2">-</span>
                    )}
                  </Td>
                  <Td>
                    {row.status === 'failed' ? <RetryButton jobId={row.id} /> : null}
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
