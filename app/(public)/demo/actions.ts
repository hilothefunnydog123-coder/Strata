'use server';

import { headers } from 'next/headers';
import { eq } from 'drizzle-orm';
import { db } from '@/lib/db';
import { demoRequest } from '@/lib/db/schema';
import { send } from '@/lib/email/send';
import { env } from '@/lib/env';
import { log } from '@/lib/log';
import { rateLimit } from '@/lib/rate-limit';
import {
  demoRequestSchema,
  HONEYPOT_FIELD,
  VOLUME_LABELS,
  type DemoRequestInput,
} from '@/lib/validation/demo-request';

export type DemoRequestState =
  | { status: 'idle' }
  | { status: 'ok' }
  | { status: 'error'; message: string; fieldErrors: Record<string, string> };

/**
 * Take a demo request.
 *
 * Order matters here. The row is written first and the notification is sent
 * second, so a mail provider outage costs us a notification but never a lead.
 * `notified_at` stays null when the send did not land, which is what the
 * operator console filters on and what the recovery query in lib/email/send.ts
 * looks for.
 */
export async function submitDemoRequest(
  _previous: DemoRequestState,
  formData: FormData,
): Promise<DemoRequestState> {
  // The honeypot is read first and separately. A real person never sees this
  // field, so a value in it is a bot: answer exactly as though it worked, store
  // nothing, and say nothing, because telling a bot it was caught only teaches
  // whoever wrote it to try harder. It is kept out of the schema on purpose, so
  // a filled honeypot cannot surface as a validation error.
  if (String(formData.get(HONEYPOT_FIELD) ?? '').length > 0) {
    log.info('demo request discarded, honeypot filled');
    return { status: 'ok' };
  }

  const raw = {
    name: formData.get('name'),
    email: formData.get('email'),
    orgName: formData.get('orgName'),
    title: formData.get('title'),
    annualDenialVolume: formData.get('annualDenialVolume'),
    message: formData.get('message'),
  };

  const parsed = demoRequestSchema.safeParse(raw);

  if (!parsed.success) {
    const fieldErrors: Record<string, string> = {};
    for (const issue of parsed.error.issues) {
      const key = issue.path[0];
      if (typeof key === 'string' && !fieldErrors[key]) fieldErrors[key] = issue.message;
    }
    return {
      status: 'error',
      message: 'Some of this needs fixing before we can send it.',
      fieldErrors,
    };
  }

  const input: DemoRequestInput = parsed.data;

  const h = await headers();
  const ip =
    h.get('x-forwarded-for')?.split(',')[0]?.trim() ?? h.get('x-real-ip') ?? 'unknown';

  const limit = await rateLimit(`demo-request:${ip}`, 5, 60 * 60);
  if (!limit.allowed) {
    return {
      status: 'error',
      message:
        'That is several requests from the same connection in the last hour. Email us directly and we will pick it up.',
      fieldErrors: {},
    };
  }

  const [row] = await db
    .insert(demoRequest)
    .values({
      name: input.name,
      email: input.email,
      orgName: input.orgName,
      title: input.title,
      message: input.message || null,
      annualDenialVolume: input.annualDenialVolume,
      ip,
    })
    .returning({ id: demoRequest.id });

  const id = row!.id;
  const volume = VOLUME_LABELS[input.annualDenialVolume];

  // Every field, so the notification is the whole lead and not a pointer to it.
  const notification = await send({
    to: env.DEMO_REQUEST_TO,
    subject: `Demo request: ${input.orgName}`,
    text: [
      'A demo request came in.',
      '',
      `Name:                  ${input.name}`,
      `Work email:            ${input.email}`,
      `Organisation:          ${input.orgName}`,
      `Title:                 ${input.title}`,
      `Annual denial volume:  ${volume}`,
      '',
      'Message:',
      input.message ? input.message : '(none)',
      '',
      `Received from:         ${ip}`,
      `Record:                ${id}`,
      `Open in the console:   ${env.APP_URL}/admin/demo-requests`,
    ].join('\n'),
  });

  const confirmation = await send({
    to: input.email,
    subject: 'Your Medeal demo request',
    text: [
      `${input.name.split(' ')[0] ?? input.name},`,
      '',
      `We have your request for ${input.orgName} and will reply within one business day.`,
      '',
      'What the call covers: we take one real denial of yours, run it through the',
      'system, and show you the drafted appeal with every assertion traced back to',
      'the decision or the chart line it came from. About 30 minutes.',
      '',
      'To make that useful, have a denial letter and the matching clinical record to',
      'hand. We will work from a redacted copy until a business associate agreement',
      'is in place.',
      '',
      'Medeal',
    ].join('\n'),
  });

  if (notification.status === 'sent') {
    await db
      .update(demoRequest)
      .set({ notifiedAt: new Date() })
      .where(eq(demoRequest.id, id));
  } else {
    // Loud, because a lead that arrived and was not delivered is the one thing
    // here worth waking someone up for.
    log.error('demo request stored but not delivered', {
      demoRequestId: id,
      notificationStatus: notification.status,
      confirmationStatus: confirmation.status,
    });
  }

  return { status: 'ok' };
}
