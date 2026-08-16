'use server';

import { revalidatePath } from 'next/cache';
import { eq } from 'drizzle-orm';
import { audit } from '@/lib/audit';
import { assertPlatform, requirePrincipalOrThrow } from '@/lib/auth/guards';
import { db } from '@/lib/db';
import { contact } from '@/lib/db/schema';
import { parseContactsCsv, upsertContact } from '@/lib/email/campaign';
import {
  enrollEveryone,
  PILOT_SEQUENCE,
  PILOT_STEPS,
  runDueSteps,
  stopFor,
  upsertSequence,
} from '@/lib/email/sequence';
import { log } from '@/lib/log';

export type OutreachState =
  | { status: 'idle' }
  | { status: 'ok'; message: string; notes?: string[] }
  | { status: 'error'; message: string; notes?: string[] };

/**
 * Load targets from pasted text.
 *
 * A paste box rather than a file upload, because the operator is as likely to
 * be on a phone as at a desk, and a spreadsheet's rows copy straight into one.
 */
export async function addTargets(
  _previous: OutreachState,
  formData: FormData,
): Promise<OutreachState> {
  const principal = await requirePrincipalOrThrow();
  assertPlatform(principal, 'admin:email');

  const { contacts, errors } = parseContactsCsv(String(formData.get('csv') ?? ''));

  if (contacts.length === 0) {
    return {
      status: 'error',
      message: 'Nothing was added. Every row needs an email address.',
      notes: errors.slice(0, 8),
    };
  }

  let created = 0;
  for (const input of contacts) {
    const result = await upsertContact(input);
    if (result.created) created += 1;
  }

  await audit({
    userId: principal.userId,
    organizationId: null,
    action: 'create',
    entityType: 'contact',
    entityId: null,
  });

  revalidatePath('/admin/outreach');
  return {
    status: 'ok',
    message: `${created} added, ${contacts.length - created} already known.`,
    notes: errors.slice(0, 8),
  };
}

/**
 * Start the cadence for everybody not already in it.
 *
 * Creates the sequence if this is the first time, so there is one button rather
 * than a setup step somebody can forget and then wonder why nothing sent.
 */
export async function startOutreach(
  _previous: OutreachState,
  formData: FormData,
): Promise<OutreachState> {
  const principal = await requirePrincipalOrThrow();
  assertPlatform(principal, 'admin:email');

  const perDay = Math.max(1, Math.min(50, Number(formData.get('perDay') ?? 20) || 20));
  const alreadySent = formData.get('alreadyWritten') === 'on' ? 1 : 0;

  await upsertSequence(PILOT_SEQUENCE, PILOT_STEPS, principal.userId);

  const { enrolled, already, days } = await enrollEveryone({
    sequenceName: PILOT_SEQUENCE,
    alreadySent,
    perDay,
  });

  await audit({
    userId: principal.userId,
    organizationId: null,
    action: 'create',
    entityType: 'campaign',
    entityId: PILOT_SEQUENCE,
  });

  revalidatePath('/admin/outreach');

  if (enrolled === 0) {
    return {
      status: 'ok',
      message:
        already > 0
          ? `Everybody is already in the sequence. Nothing was scheduled twice.`
          : 'There is nobody to write to yet. Add targets first.',
    };
  }

  return {
    status: 'ok',
    message:
      alreadySent === 0
        ? `${enrolled} started. The first email goes out ${perDay} a day over ` +
          `${days} day${days === 1 ? '' : 's'}, then follow-ups on days 4, 10 and 20.`
        : `${enrolled} started at the follow-ups, on days 4, 10 and 20 from now.`,
  };
}

/**
 * Somebody answered.
 *
 * The most important button on the page, and the reason the whole console
 * exists: it has to be reachable in one tap from a phone, because the moment it
 * matters is the moment a reply lands and the next scheduled message is still
 * pending.
 */
export async function theyReplied(contactId: string): Promise<OutreachState> {
  const principal = await requirePrincipalOrThrow();
  assertPlatform(principal, 'admin:email');

  const person = await db.query.contact.findFirst({ where: eq(contact.id, contactId) });
  if (!person) return { status: 'error', message: 'That contact no longer exists.' };

  const stopped = await stopFor(person.id, 'replied', 'marked in the console');

  await audit({
    userId: principal.userId,
    organizationId: null,
    action: 'update',
    entityType: 'contact',
    entityId: contactId,
  });

  revalidatePath('/admin/outreach');
  return {
    status: 'ok',
    message: stopped
      ? `Stopped everything scheduled to ${person.email}. Go answer them.`
      : `${person.email} had nothing scheduled, so nothing needed stopping.`,
  };
}

/** Stop writing to somebody without claiming they replied. */
export async function stopWriting(contactId: string): Promise<OutreachState> {
  const principal = await requirePrincipalOrThrow();
  assertPlatform(principal, 'admin:email');

  const person = await db.query.contact.findFirst({ where: eq(contact.id, contactId) });
  if (!person) return { status: 'error', message: 'That contact no longer exists.' };

  await stopFor(person.id, 'stopped', 'stopped in the console');
  revalidatePath('/admin/outreach');
  return { status: 'ok', message: `No further messages to ${person.email}.` };
}

/**
 * Send whatever is due, now.
 *
 * The scheduled drain does this on its own. The button exists so the first
 * message can be watched leaving rather than waited for, which is the only way
 * to find out that mail works before a list of seventy depends on it.
 */
export async function sendDueNow(): Promise<OutreachState> {
  const principal = await requirePrincipalOrThrow();
  assertPlatform(principal, 'admin:email');

  try {
    const { considered, sent } = await runDueSteps();
    revalidatePath('/admin/outreach');

    if (considered === 0) {
      return { status: 'ok', message: 'Nothing is due right now.' };
    }
    if (sent === 0) {
      return {
        status: 'error',
        message:
          `${considered} due, none sent. The usual cause is that no mail provider is ` +
          'configured, in which case nothing was spent and everything stays due.',
      };
    }
    return { status: 'ok', message: `${sent} sent, out of ${considered} due.` };
  } catch (error) {
    log.warn('sending due steps from the console failed', { error });
    return {
      status: 'error',
      message: error instanceof Error ? error.message : 'Sending failed.',
    };
  }
}
