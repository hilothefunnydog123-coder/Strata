import type { Metadata } from 'next';
import { desc } from 'drizzle-orm';
import { assertPlatformOrForbid, requirePrincipal } from '@/lib/auth/guards';
import { analyticsQuery } from '@/lib/analytics/guard';
import { db } from '@/lib/db';
import { demoRequest } from '@/lib/db/schema';
import { VOLUME_LABELS } from '@/lib/validation/demo-request';
import {
  EmptyState,
  Panel,
  PanelHeader,
  Table,
  Tag,
  Td,
  Th,
} from '@/components/ui/primitives';
import { StatusControl } from './client';

export const metadata: Metadata = { title: 'Demo requests' };

export default async function DemoRequestsPage() {
  const principal = await requirePrincipal();
  assertPlatformOrForbid(principal, 'admin:demo_requests');

  const rows = await analyticsQuery(['demo_request'], () =>
    db.select().from(demoRequest).orderBy(desc(demoRequest.createdAt)).limit(200),
  );

  const undelivered = rows.filter((r) => r.notifiedAt === null).length;

  return (
    <div className="px-4 py-5">
      <h1 className="text-lg">Demo requests</h1>

      {undelivered > 0 ? (
        <div className="mt-3 border border-denied/40 bg-denied-wash px-4 py-3 text-sm">
          <p className="font-semibold text-denied">
            {undelivered} {undelivered === 1 ? 'request was' : 'requests were'} stored
            but the notification did not go out
          </p>
          <p className="mt-1 text-ink">
            The lead is safe, it is in the list below. What failed was the email.
            Check that RESEND_API_KEY and EMAIL_FROM are set, then follow up by
            hand: these people are waiting for a reply.
          </p>
        </div>
      ) : null}

      <Panel className="mt-4">
        <PanelHeader title={`${rows.length} ${rows.length === 1 ? 'request' : 'requests'}`} />
        {rows.length === 0 ? (
          <EmptyState
            title="No demo requests yet"
            body="Submissions from the public site land here, and a notification carrying every field goes to the address in DEMO_REQUEST_TO."
          />
        ) : (
          <Table>
            <thead>
              <tr>
                <Th>Received</Th>
                <Th>Name</Th>
                <Th>Organisation</Th>
                <Th>Title</Th>
                <Th>Volume</Th>
                <Th>Notified</Th>
                <Th>Status</Th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => (
                <tr key={row.id} className="align-top hover:bg-paper">
                  <Td>
                    <span className="id text-xs">
                      {row.createdAt.toISOString().slice(0, 10)}
                    </span>
                  </Td>
                  <Td>
                    {row.name}
                    <br />
                    <a href={`mailto:${row.email}`} className="id text-xs">
                      {row.email}
                    </a>
                    {row.message ? (
                      <p className="mt-1 max-w-md text-xs text-ink-2">{row.message}</p>
                    ) : null}
                  </Td>
                  <Td>{row.orgName}</Td>
                  <Td>{row.title}</Td>
                  <Td>{VOLUME_LABELS[row.annualDenialVolume as 'not_sure'] ?? row.annualDenialVolume}</Td>
                  <Td>
                    {row.notifiedAt ? (
                      <Tag tone="recovered">sent</Tag>
                    ) : (
                      <Tag tone="denied">not sent</Tag>
                    )}
                  </Td>
                  <Td>
                    <StatusControl id={row.id} status={row.status} />
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
