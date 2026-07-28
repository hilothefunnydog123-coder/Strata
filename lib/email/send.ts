/**
 * Outbound email.
 *
 * One rule holds this module together: a message is never silently dropped.
 * Every send writes an `email_send` row first, and the row records what
 * happened. If Resend is not configured, or refuses the message, the row stays
 * behind with a status and an error, and the operator console shows it. A demo
 * request that could not be delivered is still recoverable with
 *
 *   select * from demo_request where notified_at is null;
 *
 * The second rule: an unsubscribed contact is excluded at send time, in this
 * module, with no parameter to override it. CAN-SPAM compliance is not
 * something a caller gets to opt out of.
 */
import { Resend } from 'resend';
import { eq } from 'drizzle-orm';
import { db } from '@/lib/db';
import { contact, emailSend } from '@/lib/db/schema';
import { env } from '@/lib/env';
import { log } from '@/lib/log';

export interface SendInput {
  to: string;
  subject: string;
  /** Plain text. Every message this product sends is a letter, not a brochure. */
  text: string;
  html?: string;
  contactId?: string;
  campaignId?: string;
}

export type SendResult =
  | { status: 'sent'; providerId: string; emailSendId: string }
  | { status: 'failed'; error: string; emailSendId: string }
  | { status: 'skipped_unsubscribed'; emailSendId: string }
  | { status: 'queued'; reason: string; emailSendId: string };

let client: Resend | null = null;

function resend(): Resend | null {
  if (!env.RESEND_API_KEY) return null;
  client ??= new Resend(env.RESEND_API_KEY);
  return client;
}

export function emailConfigured(): boolean {
  return Boolean(env.RESEND_API_KEY && env.EMAIL_FROM);
}

/**
 * Send one message.
 *
 * Returns rather than throws, because every caller here is either a background
 * job that must record the failure and retry, or a user-facing action that must
 * not fail because a mail provider is having a bad afternoon.
 */
export async function send(input: SendInput): Promise<SendResult> {
  if (input.contactId) {
    const row = await db.query.contact.findFirst({
      where: eq(contact.id, input.contactId),
    });
    if (row?.unsubscribedAt) {
      const [record] = await db
        .insert(emailSend)
        .values({
          contactId: input.contactId,
          campaignId: input.campaignId ?? null,
          toEmail: input.to,
          subject: input.subject,
          body: input.text,
          status: 'skipped_unsubscribed',
        })
        .returning({ id: emailSend.id });
      log.info('send skipped, contact unsubscribed', { contactId: input.contactId });
      return { status: 'skipped_unsubscribed', emailSendId: record!.id };
    }
  }

  const [record] = await db
    .insert(emailSend)
    .values({
      contactId: input.contactId ?? null,
      campaignId: input.campaignId ?? null,
      toEmail: input.to,
      subject: input.subject,
      body: input.text,
      status: 'queued',
    })
    .returning({ id: emailSend.id });

  const emailSendId = record!.id;
  const provider = resend();

  if (!provider || !env.EMAIL_FROM) {
    const reason = !provider
      ? 'RESEND_API_KEY is not set'
      : 'EMAIL_FROM is not set';
    log.warn('email not sent, provider is not configured', { emailSendId, reason });
    await db
      .update(emailSend)
      .set({ status: 'queued', error: reason })
      .where(eq(emailSend.id, emailSendId));
    return { status: 'queued', reason, emailSendId };
  }

  try {
    const result = await provider.emails.send({
      from: env.EMAIL_FROM,
      to: input.to,
      subject: input.subject,
      text: input.text,
      ...(input.html ? { html: input.html } : {}),
    });

    if (result.error) {
      await db
        .update(emailSend)
        .set({ status: 'failed', error: result.error.message })
        .where(eq(emailSend.id, emailSendId));
      log.error('email provider refused the message', { emailSendId });
      return { status: 'failed', error: result.error.message, emailSendId };
    }

    const providerId = result.data?.id ?? '';
    await db
      .update(emailSend)
      .set({ status: 'sent', providerId, sentAt: new Date() })
      .where(eq(emailSend.id, emailSendId));

    return { status: 'sent', providerId, emailSendId };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    await db
      .update(emailSend)
      .set({ status: 'failed', error: message })
      .where(eq(emailSend.id, emailSendId));
    log.error('email send threw', { emailSendId, error });
    return { status: 'failed', error: message, emailSendId };
  }
}
