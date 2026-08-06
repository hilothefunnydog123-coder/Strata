import type { Metadata } from 'next';
import { eq } from 'drizzle-orm';
import { assertCanOrForbid, requirePrincipal, type Membership } from '@/lib/auth/guards';
import { db } from '@/lib/db';
import { organization, payerContact } from '@/lib/db/schema';
import { channelAvailability, channelByKey } from '@/lib/filing/channels';
import { EmptyState, Panel, PanelHeader, Table, Td, Th } from '@/components/ui/primitives';
import { FilingChannelForm } from './filing-channel-form';

export const metadata: Metadata = { title: 'Settings' };

/**
 * Where the filing preset is changed.
 *
 * The preset is set from the filing panel on the first appeal, which is where
 * the question belongs. This page is the other half of that promise: a hospital
 * that ticked the box once has somewhere obvious to untick it, and can see the
 * addresses that have accumulated behind their one click filings rather than
 * discovering a stale fax number the hard way.
 */
export default async function SettingsPage({
  searchParams,
}: {
  searchParams: Promise<{ org?: string }>;
}) {
  const principal = await requirePrincipal();
  const { org } = await searchParams;

  const membership: Membership | undefined =
    principal.memberships.find((m) => m.organizationId === org) ?? principal.memberships[0];

  if (!membership) {
    return (
      <EmptyState
        title="Your account is not attached to an organisation yet"
        body="Ask your administrator to add you to one."
      />
    );
  }

  assertCanOrForbid(principal, membership.organizationId, 'draft:export');

  const [record, contacts] = await Promise.all([
    db.query.organization.findFirst({ where: eq(organization.id, membership.organizationId) }),
    db
      .select()
      .from(payerContact)
      .where(eq(payerContact.organizationId, membership.organizationId))
      .orderBy(payerContact.payerName),
  ]);

  const choices = channelAvailability().map((c) => ({
    key: c.channel.key,
    label: c.channel.label,
    summary: c.channel.summary,
    evidence: c.channel.evidence,
    available: c.available,
    reason: c.reason,
  }));

  return (
    <div className="grid gap-4 p-4 xl:grid-cols-2">
      <Panel>
        <PanelHeader title="How appeals are filed">
          <span className="text-2xs uppercase tracking-wider text-ink-2">
            {membership.organizationName}
          </span>
        </PanelHeader>
        <p className="border-b border-rule px-3 py-2 text-xs text-ink-2">
          Choose one and the File appeal button files that way in a single press. Choose
          ask every time and the panel offers the list on every appeal.
        </p>
        <FilingChannelForm
          organizationId={membership.organizationId}
          choices={choices}
          current={record?.defaultFilingChannel ?? null}
        />
      </Panel>

      <Panel>
        <PanelHeader title="Where each payer takes appeals" />
        {contacts.length === 0 ? (
          <p className="px-3 py-2 text-xs text-ink-2">
            Nothing saved yet. The address you file to is remembered the first time you use
            it, per payer and per channel.
          </p>
        ) : (
          <Table>
            <thead>
              <tr>
                <Th>Payer</Th>
                <Th>Channel</Th>
                <Th>Destination</Th>
              </tr>
            </thead>
            <tbody>
              {contacts.map((c) => (
                <tr key={c.id}>
                  <Td>{c.payerName}</Td>
                  <Td>{channelByKey(c.channel)?.label ?? c.channel}</Td>
                  <Td>
                    <span className="id">{c.destination}</span>
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
