/**
 * Operator outreach.
 *
 * Prospecting email, which is a different thing from transactional email and
 * is governed by different law. Three rules hold, and none of them has an
 * override parameter:
 *
 *   1. Every message carries a working unsubscribe link and a physical mailing
 *      address. CAN-SPAM requires both, and a campaign cannot start without
 *      MAILING_ADDRESS configured.
 *   2. An unsubscribed contact is excluded at send time, in lib/email/send.ts,
 *      where the check cannot be skipped by a caller.
 *   3. Throttled to 30 an hour, queued through the jobs table, never a single
 *      bulk blast.
 *
 * And one that is ours rather than the law's: a campaign cannot send until the
 * operator has sent themselves a test. Substitution bugs are invisible until
 * you see the message, and the person who wrote it is the cheapest place to
 * catch one.
 */
import { randomBytes } from 'node:crypto';
import { and, eq, isNull, sql } from 'drizzle-orm';
import { db } from '@/lib/db';
import { campaign, contact, emailSend, job } from '@/lib/db/schema';
import { env } from '@/lib/env';
import { log } from '@/lib/log';
import { send } from './send';
import { campaignFooter, substitute, type Substitutable } from './substitute';

/** Messages an hour. Slow enough to look like a person, fast enough to matter. */
export const SENDS_PER_HOUR = 30;
const SPACING_MS = Math.ceil((60 * 60 * 1000) / SENDS_PER_HOUR);

export {
  campaignFooter,
  placeholdersIn,
  substitute,
  unsubscribeUrl,
  type Substitutable,
} from './substitute';

export class MailingAddressMissingError extends Error {
  constructor() {
    super(
      'MAILING_ADDRESS is not set, so a campaign cannot send. CAN-SPAM requires every ' +
        'commercial message to carry a real postal address alongside a working ' +
        'unsubscribe link. Nothing was queued.',
    );
    this.name = 'MailingAddressMissingError';
  }
}

export class TestSendRequiredError extends Error {
  constructor() {
    super(
      'Send yourself a test first. Substitution bugs are invisible until you see the ' +
        'message, and you are the cheapest place to catch one. Nothing was queued.',
    );
    this.name = 'TestSendRequiredError';
  }
}

/** Send one message immediately. Used for the operator's own test send. */
export async function sendTest(
  campaignId: string,
  toEmail: string,
  previewContact: Substitutable,
): Promise<{ ok: boolean; message: string }> {
  const record = await db.query.campaign.findFirst({
    where: eq(campaign.id, campaignId),
  });
  if (!record) return { ok: false, message: 'That campaign does not exist.' };

  const result = await send({
    to: toEmail,
    subject: `[test] ${substitute(record.subject, previewContact)}`,
    text: substitute(record.body, previewContact) + campaignFooter(previewContact),
    campaignId,
  });

  await db
    .update(campaign)
    .set({ testSentAt: new Date() })
    .where(eq(campaign.id, campaignId));

  if (result.status === 'sent') {
    return { ok: true, message: `Test sent to ${toEmail}. Read it before you start.` };
  }
  if (result.status === 'queued') {
    return {
      ok: true,
      message:
        `No mail provider is configured, so nothing was delivered, but the message was ` +
        `composed and recorded exactly as it would be sent. ${result.reason}.`,
    };
  }
  if (result.status === 'failed') {
    return { ok: false, message: `The provider refused it: ${result.error}` };
  }
  // The only remaining case is skipped_unsubscribed, which cannot happen here
  // because a test send is addressed to the operator rather than to a contact.
  return { ok: false, message: 'The test was skipped, which should not happen here.' };
}

/**
 * Queue a campaign.
 *
 * One job per recipient, spaced to respect the throttle, so the queue drains at
 * a steady rate rather than in a burst. Unsubscribed contacts are filtered here
 * as well as at send time: filtering twice is cheap, and queueing a job that
 * will certainly be skipped just makes the queue harder to read.
 */
export async function queueCampaign(
  campaignId: string,
): Promise<{ queued: number; skipped: number }> {
  if (!env.MAILING_ADDRESS) throw new MailingAddressMissingError();

  const record = await db.query.campaign.findFirst({
    where: eq(campaign.id, campaignId),
  });
  if (!record) throw new Error('That campaign does not exist.');
  if (!record.testSentAt) throw new TestSendRequiredError();

  const recipients = await db
    .select()
    .from(contact)
    .where(isNull(contact.unsubscribedAt));

  const allContacts = await db.select({ id: contact.id }).from(contact);
  const skipped = allContacts.length - recipients.length;

  let queued = 0;
  const start = Date.now();

  for (const target of recipients) {
    // Per-contact history, so nobody is emailed the same campaign twice.
    const [already] = await db
      .select({ id: emailSend.id })
      .from(emailSend)
      .where(
        and(eq(emailSend.campaignId, campaignId), eq(emailSend.contactId, target.id)),
      )
      .limit(1);
    if (already) continue;

    await db.insert(job).values({
      kind: 'campaign_send',
      payload: { campaignId, contactId: target.id },
      runAfter: new Date(start + queued * SPACING_MS),
    });
    queued += 1;
  }

  await db
    .update(campaign)
    .set({ startedAt: new Date() })
    .where(eq(campaign.id, campaignId));

  log.info('campaign queued', { campaignId, queued, skipped });
  return { queued, skipped };
}

/** Run one queued campaign send. Called by the cron drain. */
export async function runCampaignSend(payload: {
  campaignId: string;
  contactId: string;
}): Promise<void> {
  const [record, target] = await Promise.all([
    db.query.campaign.findFirst({ where: eq(campaign.id, payload.campaignId) }),
    db.query.contact.findFirst({ where: eq(contact.id, payload.contactId) }),
  ]);

  if (!record) throw new Error('That campaign no longer exists.');
  if (!target) throw new Error('That contact no longer exists.');

  // send() checks the unsubscribe again and records a skip if it has happened
  // since queueing, which is exactly the window that matters.
  await send({
    to: target.email,
    subject: substitute(record.subject, target),
    text: substitute(record.body, target) + campaignFooter(target),
    contactId: target.id,
    campaignId: record.id,
  });
}

/* ─── Contacts ────────────────────────────────────────────────────────────── */

export function newUnsubscribeToken(): string {
  return randomBytes(24).toString('base64url');
}

export interface ContactInput {
  email: string;
  firstName?: string;
  lastName?: string;
  title?: string;
  orgName?: string;
  source?: string;
}

export async function upsertContact(input: ContactInput): Promise<{ created: boolean }> {
  const email = input.email.trim().toLowerCase();
  const existing = await db.query.contact.findFirst({
    where: eq(contact.email, email),
  });

  if (existing) {
    await db
      .update(contact)
      .set({
        firstName: input.firstName ?? existing.firstName,
        lastName: input.lastName ?? existing.lastName,
        title: input.title ?? existing.title,
        orgName: input.orgName ?? existing.orgName,
      })
      .where(eq(contact.id, existing.id));
    return { created: false };
  }

  await db.insert(contact).values({
    email,
    firstName: input.firstName ?? null,
    lastName: input.lastName ?? null,
    title: input.title ?? null,
    orgName: input.orgName ?? null,
    source: input.source ?? 'manual',
    unsubscribeToken: newUnsubscribeToken(),
  });
  return { created: true };
}

/**
 * Parse a pasted CSV.
 *
 * Deliberately forgiving about column order and header spelling, because the
 * operator is pasting an export from someone else's tool and should not have to
 * rename headers first. Deliberately strict about the email column, because a
 * contact without one is not a contact.
 */
export function parseContactsCsv(csv: string): {
  contacts: ContactInput[];
  errors: string[];
} {
  const lines = csv.trim().split(/\r?\n/).filter((l) => l.trim().length > 0);
  if (lines.length === 0) return { contacts: [], errors: ['That was empty.'] };

  const header = splitCsvLine(lines[0]!).map((h) =>
    h.trim().toLowerCase().replace(/[^a-z]/g, ''),
  );

  const index = (...names: string[]) => {
    for (const name of names) {
      const at = header.indexOf(name);
      if (at !== -1) return at;
    }
    return -1;
  };

  const emailAt = index('email', 'emailaddress', 'workemail');
  if (emailAt === -1) {
    return {
      contacts: [],
      errors: ['No email column. The header needs one called email.'],
    };
  }

  const firstAt = index('firstname', 'first', 'givenname');
  const lastAt = index('lastname', 'last', 'surname', 'familyname');
  const titleAt = index('title', 'jobtitle', 'role');
  const orgAt = index('orgname', 'organisation', 'organization', 'company', 'hospital');

  const contacts: ContactInput[] = [];
  const errors: string[] = [];
  const seen = new Set<string>();

  for (let i = 1; i < lines.length; i += 1) {
    const cells = splitCsvLine(lines[i]!);
    const email = (cells[emailAt] ?? '').trim().toLowerCase();

    if (!email) {
      errors.push(`Row ${i + 1}: no email, skipped.`);
      continue;
    }
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) {
      errors.push(`Row ${i + 1}: ${email} is not an email address, skipped.`);
      continue;
    }
    if (seen.has(email)) {
      errors.push(`Row ${i + 1}: ${email} appears more than once, kept the first.`);
      continue;
    }
    seen.add(email);

    contacts.push({
      email,
      ...(firstAt !== -1 && cells[firstAt]?.trim()
        ? { firstName: cells[firstAt]!.trim() }
        : {}),
      ...(lastAt !== -1 && cells[lastAt]?.trim()
        ? { lastName: cells[lastAt]!.trim() }
        : {}),
      ...(titleAt !== -1 && cells[titleAt]?.trim()
        ? { title: cells[titleAt]!.trim() }
        : {}),
      ...(orgAt !== -1 && cells[orgAt]?.trim() ? { orgName: cells[orgAt]!.trim() } : {}),
      source: 'csv',
    });
  }

  return { contacts, errors };
}

/** Split one CSV line, honouring quoted fields containing commas. */
function splitCsvLine(line: string): string[] {
  const cells: string[] = [];
  let current = '';
  let inQuotes = false;

  for (let i = 0; i < line.length; i += 1) {
    const ch = line[i];
    if (ch === '"') {
      if (inQuotes && line[i + 1] === '"') {
        current += '"';
        i += 1;
      } else {
        inQuotes = !inQuotes;
      }
    } else if (ch === ',' && !inQuotes) {
      cells.push(current);
      current = '';
    } else {
      current += ch;
    }
  }
  cells.push(current);
  return cells;
}

/** Per-contact send history, so nobody is emailed twice by accident. */
export async function contactHistory(contactId: string) {
  return db
    .select({
      subject: emailSend.subject,
      status: emailSend.status,
      sentAt: emailSend.sentAt,
      createdAt: emailSend.createdAt,
    })
    .from(emailSend)
    .where(eq(emailSend.contactId, contactId))
    .orderBy(sql`${emailSend.createdAt} desc`);
}
