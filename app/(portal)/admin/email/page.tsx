import type { Metadata } from 'next';
import { desc, sql } from 'drizzle-orm';
import { assertPlatformOrForbid, requirePrincipal } from '@/lib/auth/guards';
import { analyticsQuery } from '@/lib/analytics/guard';
import { db } from '@/lib/db';
import { campaign, contact, emailSend } from '@/lib/db/schema';
import { env } from '@/lib/env';
import { SENDS_PER_HOUR } from '@/lib/email/campaign';
import {
  EmptyState,
  Panel,
  PanelHeader,
  Table,
  Tag,
  Td,
  Th,
} from '@/components/ui/primitives';
import { AddContactForm, CampaignComposer, CampaignRow, ImportForm } from './client';

export const metadata: Metadata = { title: 'Outbound email' };

export default async function EmailPage() {
  const principal = await requirePrincipal();
  assertPlatformOrForbid(principal, 'admin:email');

  const { campaigns, contacts, counts } = await analyticsQuery(
    ['campaign', 'contact', 'email_send'],
    async () => {
      const [campaigns, contacts, counts] = await Promise.all([
        db
          .select({
            id: campaign.id,
            name: campaign.name,
            subject: campaign.subject,
            body: campaign.body,
            testSentAt: campaign.testSentAt,
            startedAt: campaign.startedAt,
            sent: sql<number>`(
              select count(*)::int from email_send es
              where es.campaign_id = ${campaign.id} and es.status = 'sent'
            )`,
            queued: sql<number>`(
              select count(*)::int from email_send es
              where es.campaign_id = ${campaign.id} and es.status = 'queued'
            )`,
            skipped: sql<number>`(
              select count(*)::int from email_send es
              where es.campaign_id = ${campaign.id} and es.status = 'skipped_unsubscribed'
            )`,
          })
          .from(campaign)
          .orderBy(desc(campaign.createdAt)),
        db
          .select({
            id: contact.id,
            email: contact.email,
            firstName: contact.firstName,
            orgName: contact.orgName,
            title: contact.title,
            unsubscribedAt: contact.unsubscribedAt,
            sends: sql<number>`(
              select count(*)::int from email_send es where es.contact_id = ${contact.id}
            )`,
          })
          .from(contact)
          .orderBy(desc(contact.createdAt))
          .limit(200),
        db
          .select({
            total: sql<number>`count(*)::int`,
            unsubscribed: sql<number>`count(${contact.unsubscribedAt})::int`,
          })
          .from(contact),
      ]);
      return { campaigns, contacts, counts };
    },
  );

  const total = counts[0]?.total ?? 0;
  const unsubscribed = counts[0]?.unsubscribed ?? 0;

  return (
    <div className="px-4 py-5">
      <h1 className="text-lg">Outbound email</h1>
      <p className="mt-1 max-w-3xl text-sm text-ink-2">
        Prospecting. Every message carries a working unsubscribe link and our
        postal address, unsubscribed contacts are excluded at send time with no
        override, and sending is throttled to {SENDS_PER_HOUR} an hour through
        the job queue rather than going out in one blast.
      </p>

      {!env.MAILING_ADDRESS ? (
        <div className="mt-4 border border-denied/40 bg-denied-wash px-4 py-3 text-sm">
          <p className="font-semibold text-denied">MAILING_ADDRESS is not set</p>
          <p className="mt-1 text-ink">
            No campaign can start without it. CAN-SPAM requires a real postal
            address in every commercial message, and it goes in the footer this
            system appends rather than in anything you type.
          </p>
        </div>
      ) : null}

      <div className="mt-4 grid gap-px border border-rule bg-rule sm:grid-cols-3">
        <Tile label="Contacts" value={total} />
        <Tile label="Unsubscribed" value={unsubscribed} tone={unsubscribed > 0 ? 'denied' : 'neutral'} />
        <Tile label="Reachable" value={total - unsubscribed} />
      </div>

      <div className="mt-6 grid gap-6 xl:grid-cols-2">
        <CampaignComposer canStart={Boolean(env.MAILING_ADDRESS)} />

        <div className="space-y-6">
          <ImportForm />
          <AddContactForm />
        </div>
      </div>

      <Panel className="mt-6">
        <PanelHeader title={`${campaigns.length} ${campaigns.length === 1 ? 'campaign' : 'campaigns'}`} />
        {campaigns.length === 0 ? (
          <EmptyState
            title="No campaigns yet"
            body="Write one on the left. You will have to send yourself a test before it can go anywhere."
          />
        ) : (
          <Table>
            <thead>
              <tr>
                <Th>Name</Th>
                <Th>Subject</Th>
                <Th>Test sent</Th>
                <Th numeric>Sent</Th>
                <Th numeric>Queued</Th>
                <Th numeric>Skipped</Th>
                <Th>Actions</Th>
              </tr>
            </thead>
            <tbody>
              {campaigns.map((c) => (
                <CampaignRow
                  key={c.id}
                  id={c.id}
                  name={c.name}
                  subject={c.subject}
                  testSentAt={c.testSentAt ? c.testSentAt.toISOString().slice(0, 16).replace('T', ' ') : null}
                  startedAt={c.startedAt ? c.startedAt.toISOString().slice(0, 10) : null}
                  sent={c.sent}
                  queued={c.queued}
                  skipped={c.skipped}
                  canStart={Boolean(env.MAILING_ADDRESS)}
                />
              ))}
            </tbody>
          </Table>
        )}
      </Panel>

      <Panel className="mt-6">
        <PanelHeader title={`${contacts.length} contacts shown`} />
        {contacts.length === 0 ? (
          <EmptyState
            title="No contacts yet"
            body="Paste a CSV or add one by hand. A contact needs an email; everything else improves the substitution but is optional."
          />
        ) : (
          <Table>
            <thead>
              <tr>
                <Th>Email</Th>
                <Th>Name</Th>
                <Th>Organisation</Th>
                <Th>Title</Th>
                <Th numeric>Messages</Th>
                <Th>Status</Th>
              </tr>
            </thead>
            <tbody>
              {contacts.map((c) => (
                <tr key={c.id} className="hover:bg-paper">
                  <Td>
                    <span className="id text-xs">{c.email}</span>
                  </Td>
                  <Td>{c.firstName ?? <span className="text-ink-2">not given</span>}</Td>
                  <Td>{c.orgName ?? <span className="text-ink-2">not given</span>}</Td>
                  <Td>{c.title ?? <span className="text-ink-2">not given</span>}</Td>
                  <Td numeric>{c.sends}</Td>
                  <Td>
                    {c.unsubscribedAt ? (
                      <Tag tone="denied">unsubscribed</Tag>
                    ) : (
                      <Tag tone="recovered">reachable</Tag>
                    )}
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

function Tile({
  label,
  value,
  tone = 'neutral',
}: {
  label: string;
  value: number;
  tone?: 'neutral' | 'denied';
}) {
  return (
    <div className="bg-paper-2 p-3">
      <p className="text-2xs uppercase tracking-wider text-ink-2">{label}</p>
      <p className={`tnum mt-1 text-2xl font-semibold ${tone === 'denied' ? 'text-denied' : ''}`}>
        {value}
      </p>
    </div>
  );
}

export { emailSend };
