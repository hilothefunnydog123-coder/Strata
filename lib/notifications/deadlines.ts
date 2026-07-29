/**
 * Deadline warnings.
 *
 * An appeal filed late is worth nothing, so this is the one notification the
 * product owes a customer unprompted. Warnings go out at 14 and 7 days, once
 * each, to the organisation's admins and specialists.
 *
 * The notification names the case and the date and nothing else. A deadline
 * warning that quoted the clinical record would be putting patient content into
 * an inbox we do not control, which is precisely what the compliance boundary
 * exists to prevent.
 */
import { and, eq, gte, inArray, lte, sql } from 'drizzle-orm';
import { db } from '@/lib/db';
import { denial, emailSend, member, organization, user } from '@/lib/db/schema';
import { env } from '@/lib/env';
import { log } from '@/lib/log';
import { send } from '@/lib/email/send';

/** Days out at which a warning is sent. */
const WARN_AT_DAYS = [14, 7] as const;

/** Stages where a deadline still matters. Filed and later, it does not. */
const LIVE_STAGES = [
  'intake',
  'parsing',
  'ready_for_generation',
  'generating',
  'clinical_review',
  'legal_review',
  'approved',
] as const;

/**
 * Send any warnings due now.
 *
 * Called by the cron drain. Idempotent within a day: a warning already sent for
 * a case at a given threshold is not sent again, checked against email_send
 * rather than a flag on the denial, so the record of what was sent is the thing
 * that decides.
 */
export async function sendDeadlineWarnings(): Promise<number> {
  let sent = 0;

  for (const days of WARN_AT_DAYS) {
    const now = new Date();
    const windowStart = new Date(now.getTime() + (days - 1) * 24 * 60 * 60 * 1000);
    const windowEnd = new Date(now.getTime() + days * 24 * 60 * 60 * 1000);

    const due = await db
      .select({
        id: denial.id,
        internalRef: denial.internalRef,
        payerName: denial.payerName,
        claimAmountCents: denial.claimAmountCents,
        appealDeadline: denial.appealDeadline,
        status: denial.status,
        organizationId: denial.organizationId,
        organizationName: organization.name,
      })
      .from(denial)
      .innerJoin(organization, eq(denial.organizationId, organization.id))
      .where(
        and(
          gte(denial.appealDeadline, windowStart),
          lte(denial.appealDeadline, windowEnd),
          inArray(denial.status, [...LIVE_STAGES]),
          eq(organization.status, 'active'),
        ),
      );

    for (const row of due) {
      const subject = `Appeal due in ${days} days: ${row.internalRef}`;

      // Already warned at this threshold for this case.
      const [already] = await db
        .select({ id: emailSend.id })
        .from(emailSend)
        .where(eq(emailSend.subject, subject))
        .limit(1);
      if (already) continue;

      const recipients = await db
        .select({ email: user.email, name: user.name })
        .from(member)
        .innerJoin(user, eq(member.userId, user.id))
        .where(
          and(
            eq(member.organizationId, row.organizationId),
            eq(user.status, 'active'),
            // Read only accounts cannot act on it, so telling them is noise.
            sql`${member.role} in ('org_admin', 'appeal_specialist')`,
          ),
        );

      for (const recipient of recipients) {
        const result = await send({
          to: recipient.email,
          subject,
          text: [
            `${recipient.name.split(' ')[0] ?? recipient.name},`,
            '',
            `The appeal deadline for ${row.internalRef} is in ${days} days, on ` +
              `${row.appealDeadline!.toISOString().slice(0, 10)}.`,
            '',
            `Payer:   ${row.payerName}`,
            `Amount:  ${(row.claimAmountCents / 100).toLocaleString('en-US', {
              style: 'currency',
              currency: 'USD',
            })}`,
            `Stage:   ${row.status.replace(/_/g, ' ')}`,
            '',
            `Open it: ${env.APP_URL}/app/denials/${row.id}`,
            '',
            'Medeal',
          ].join('\n'),
        });

        if (result.status === 'sent' || result.status === 'queued') sent += 1;
      }
    }
  }

  if (sent > 0) log.info('deadline warnings sent', { count: sent });
  return sent;
}
