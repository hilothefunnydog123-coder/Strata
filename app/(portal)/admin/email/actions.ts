'use server';

import { revalidatePath } from 'next/cache';
import { desc, eq, isNull, sql } from 'drizzle-orm';
import { audit } from '@/lib/audit';
import { assertPlatform, requirePrincipalOrThrow } from '@/lib/auth/guards';
import { db } from '@/lib/db';
import { campaign, contact } from '@/lib/db/schema';
import {
  parseContactsCsv,
  queueCampaign,
  sendTest,
  upsertContact,
  type Substitutable,
} from '@/lib/email/campaign';
import { log } from '@/lib/log';

export type EmailState =
  | { status: 'idle' }
  | { status: 'ok'; message: string; notes?: string[] }
  | { status: 'error'; message: string; notes?: string[] };

/** Import contacts from pasted CSV. */
export async function importContacts(
  _previous: EmailState,
  formData: FormData,
): Promise<EmailState> {
  const principal = await requirePrincipalOrThrow();
  assertPlatform(principal, 'admin:email');

  const csv = String(formData.get('csv') ?? '');
  const { contacts, errors } = parseContactsCsv(csv);

  if (contacts.length === 0) {
    return {
      status: 'error',
      message: 'Nothing was imported.',
      notes: errors,
    };
  }

  let created = 0;
  let updated = 0;
  for (const input of contacts) {
    const result = await upsertContact(input);
    if (result.created) created += 1;
    else updated += 1;
  }

  await audit({
    userId: principal.userId,
    organizationId: null,
    action: 'create',
    entityType: 'contact',
    entityId: null,
  });

  revalidatePath('/admin/email');
  return {
    status: 'ok',
    message: `${created} added, ${updated} already known and updated.`,
    notes: errors,
  };
}

export async function addContact(
  _previous: EmailState,
  formData: FormData,
): Promise<EmailState> {
  const principal = await requirePrincipalOrThrow();
  assertPlatform(principal, 'admin:email');

  const email = String(formData.get('email') ?? '').trim();
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) {
    return { status: 'error', message: 'That is not an email address.' };
  }

  const result = await upsertContact({
    email,
    firstName: String(formData.get('firstName') ?? '') || undefined,
    lastName: String(formData.get('lastName') ?? '') || undefined,
    title: String(formData.get('title') ?? '') || undefined,
    orgName: String(formData.get('orgName') ?? '') || undefined,
  });

  revalidatePath('/admin/email');
  return {
    status: 'ok',
    message: result.created ? `${email} added.` : `${email} was already known, updated.`,
  };
}

export async function saveCampaign(
  _previous: EmailState,
  formData: FormData,
): Promise<EmailState> {
  const principal = await requirePrincipalOrThrow();
  assertPlatform(principal, 'admin:email');

  const name = String(formData.get('name') ?? '').trim();
  const subject = String(formData.get('subject') ?? '').trim();
  const body = String(formData.get('body') ?? '').trim();
  const id = String(formData.get('campaignId') ?? '');

  if (name.length < 2) return { status: 'error', message: 'Give it a name.' };
  if (subject.length < 3) return { status: 'error', message: 'Write a subject line.' };
  if (body.length < 20) {
    return { status: 'error', message: 'The message is too short to be worth sending.' };
  }

  if (id) {
    await db
      .update(campaign)
      // Editing the content invalidates the test send, because the thing that
      // was checked is no longer the thing that would go out.
      .set({ name, subject, body, testSentAt: null })
      .where(eq(campaign.id, id));
    revalidatePath('/admin/email');
    return {
      status: 'ok',
      message: 'Saved. The test send was cleared, because what you tested has changed.',
    };
  }

  await db.insert(campaign).values({
    name,
    subject,
    body,
    createdBy: principal.userId,
  });

  revalidatePath('/admin/email');
  return { status: 'ok', message: 'Campaign saved. Send yourself a test next.' };
}

export async function testSend(campaignId: string): Promise<EmailState> {
  const principal = await requirePrincipalOrThrow();
  assertPlatform(principal, 'admin:email');

  // Previewed against a real contact where there is one, so the test shows what
  // a recipient will actually see rather than an idealised example.
  const sample = await db.query.contact.findFirst({
    where: isNull(contact.unsubscribedAt),
  });

  const preview: Substitutable = sample ?? {
    firstName: principal.name.split(' ')[0] ?? null,
    lastName: null,
    title: 'Director of Revenue Integrity',
    orgName: 'Example Regional Health',
    email: principal.email,
    unsubscribeToken: 'preview-token',
  };

  const result = await sendTest(campaignId, principal.email, preview);

  revalidatePath('/admin/email');
  return result.ok
    ? { status: 'ok', message: result.message }
    : { status: 'error', message: result.message };
}

export async function startCampaign(campaignId: string): Promise<EmailState> {
  const principal = await requirePrincipalOrThrow();
  assertPlatform(principal, 'admin:email');

  try {
    const { queued, skipped } = await queueCampaign(campaignId);

    await audit({
      userId: principal.userId,
      organizationId: null,
      action: 'create',
      entityType: 'campaign',
      entityId: campaignId,
    });

    revalidatePath('/admin/email');
    return {
      status: 'ok',
      message:
        `${queued} queued at 30 an hour. ${skipped} unsubscribed ${skipped === 1 ? 'contact was' : 'contacts were'} excluded. ` +
        'The cron drain sends them; nothing goes out in a burst.',
    };
  } catch (error) {
    log.warn('campaign could not start', { campaignId, error });
    return {
      status: 'error',
      message: error instanceof Error ? error.message : 'The campaign could not start.',
    };
  }
}

export async function campaignList() {
  return db.select().from(campaign).orderBy(desc(campaign.createdAt));
}

export async function contactCounts() {
  const [row] = await db
    .select({
      total: sql<number>`count(*)::int`,
      unsubscribed: sql<number>`count(${contact.unsubscribedAt})::int`,
    })
    .from(contact);
  return { total: row?.total ?? 0, unsubscribed: row?.unsubscribed ?? 0 };
}
