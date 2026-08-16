/**
 * Follow-up sequences: outreach that continues without being remembered.
 *
 * The first email is the easy one. The second, fourth, and tenth are where the
 * replies actually come from, and they are the ones a person stops sending,
 * because sending them means keeping a spreadsheet and caring about it on a
 * Tuesday three weeks later. So the cadence is stored and the job drain runs
 * it, and the only human input is enrolling a contact once.
 *
 * Four rules hold here, and none of them has an override parameter.
 *
 *   1. A reply ends the sequence. Immediately, permanently, and checked again
 *      at send time rather than only when the reply arrives. Following up on
 *      somebody who already answered is the single worst thing an automated
 *      cadence can do: it tells the one person who engaged that nothing was
 *      listening.
 *   2. An unsubscribe ends it, enforced here and again in lib/email/send.ts
 *      where no caller can skip it.
 *   3. A step sends once. The cursor advances in the same transaction-shaped
 *      write that records the send, so a drain that runs twice cannot mail the
 *      same person the same message twice.
 *   4. Steps are due, not urgent. A step that came due while nobody was
 *      draining goes out on the next drain rather than being skipped, because
 *      a late follow-up still works and a skipped one is gone forever.
 */
import { and, eq, isNull, lte, or, sql } from 'drizzle-orm';
import { db } from '@/lib/db';
import { contact, sequence, sequenceEnrollment } from '@/lib/db/schema';
import { log } from '@/lib/log';
import { emailConfigured, send } from './send';
import { campaignFooter, substitute, type Substitutable } from './substitute';

export interface SequenceStep {
  /** Days after enrolment, not after the previous step. */
  dayOffset: number;
  subject: string;
  body: string;
}

const DAY_MS = 24 * 60 * 60 * 1000;

/** How many enrolments one drain will advance. Bounded so a run always ends. */
export const SEQUENCE_BATCH = 25;

export class SequenceNotFoundError extends Error {
  constructor(name: string) {
    super(`No sequence named "${name}" exists, so nobody was enrolled.`);
    this.name = 'SequenceNotFoundError';
  }
}

/**
 * When each step of a sequence is due for a contact enrolled at `from`.
 *
 * Pure, exported, and tested directly, because every scheduling bug in a
 * cadence looks identical from the outside (an email arrives on the wrong day)
 * and this is the only place the arithmetic lives.
 */
export function stepDueAt(from: Date, step: SequenceStep): Date {
  return new Date(from.getTime() + step.dayOffset * DAY_MS);
}

/**
 * Put a contact into a sequence.
 *
 * `alreadySent` is the count of steps that went out by hand before the machine
 * took over, which is the normal case rather than an edge one: the first email
 * is usually sent personally, and the sequence exists to carry the follow-ups
 * nobody remembers. Passing 1 means "step one is done, schedule step two".
 *
 * Enrolling somebody twice is a no-op rather than an error, so a script that
 * runs over a contact list can be run again after being interrupted.
 */
export async function enroll(input: {
  sequenceName: string;
  contactId: string;
  alreadySent?: number;
  /** Defaults to now. Set it to when the first email actually went out. */
  enrolledAt?: Date;
}): Promise<{ enrollmentId: string; nextRunAt: Date | null; alreadyEnrolled: boolean }> {
  const row = await db.query.sequence.findFirst({
    where: eq(sequence.name, input.sequenceName),
  });
  if (!row) throw new SequenceNotFoundError(input.sequenceName);

  const existing = await db.query.sequenceEnrollment.findFirst({
    where: and(
      eq(sequenceEnrollment.sequenceId, row.id),
      eq(sequenceEnrollment.contactId, input.contactId),
    ),
  });
  if (existing) {
    return {
      enrollmentId: existing.id,
      nextRunAt: existing.nextRunAt,
      alreadyEnrolled: true,
    };
  }

  const stepsSent = Math.max(0, input.alreadySent ?? 0);
  const enrolledAt = input.enrolledAt ?? new Date();
  const next = row.steps[stepsSent];

  const [created] = await db
    .insert(sequenceEnrollment)
    .values({
      sequenceId: row.id,
      contactId: input.contactId,
      stepsSent,
      // A contact enrolled past the last step is finished rather than active,
      // which keeps "active" meaning "will send something".
      status: next ? 'active' : 'completed',
      nextRunAt: next ? stepDueAt(enrolledAt, next) : null,
      enrolledAt,
    })
    .returning({ id: sequenceEnrollment.id, nextRunAt: sequenceEnrollment.nextRunAt });

  return {
    enrollmentId: created!.id,
    nextRunAt: created!.nextRunAt,
    alreadyEnrolled: false,
  };
}

/**
 * Stop every active sequence for a contact.
 *
 * The one function the whole design exists to make easy to call. It is
 * deliberately keyed on the contact rather than on an enrolment, because the
 * caller knows an email address replied, and does not and should not know which
 * cadences that address happens to be walking through.
 */
export async function stopFor(
  contactId: string,
  reason: 'replied' | 'unsubscribed' | 'stopped',
  note?: string,
): Promise<number> {
  const now = new Date();
  const stopped = await db
    .update(sequenceEnrollment)
    .set({
      status: reason,
      nextRunAt: null,
      repliedAt: reason === 'replied' ? now : undefined,
      stoppedReason: note ?? null,
      updatedAt: now,
    })
    .where(
      and(
        eq(sequenceEnrollment.contactId, contactId),
        eq(sequenceEnrollment.status, 'active'),
      ),
    )
    .returning({ id: sequenceEnrollment.id });

  if (stopped.length > 0) {
    log.info('sequences stopped for a contact', {
      contactId,
      reason,
      enrollments: stopped.length,
    });
  }
  return stopped.length;
}

/**
 * Somebody answered. Stop everything for that address.
 *
 * Takes an email rather than an id because that is what a reply carries, and
 * matching is case-insensitive because mail systems are.
 */
export async function markReplied(email: string, note?: string): Promise<boolean> {
  const row = await db.query.contact.findFirst({
    where: sql`lower(${contact.email}) = lower(${email})`,
  });
  if (!row) {
    log.info('a reply arrived from an address we are not sequencing', { email });
    return false;
  }
  const stopped = await stopFor(row.id, 'replied', note);
  return stopped > 0;
}

/** Enrolments with a step due now. Ordered oldest first so nobody starves. */
export async function dueEnrollments(now: Date = new Date(), limit = SEQUENCE_BATCH) {
  return db
    .select({
      id: sequenceEnrollment.id,
      sequenceId: sequenceEnrollment.sequenceId,
      contactId: sequenceEnrollment.contactId,
      stepsSent: sequenceEnrollment.stepsSent,
      enrolledAt: sequenceEnrollment.enrolledAt,
    })
    .from(sequenceEnrollment)
    .where(
      and(
        eq(sequenceEnrollment.status, 'active'),
        lte(sequenceEnrollment.nextRunAt, now),
      ),
    )
    .orderBy(sequenceEnrollment.nextRunAt)
    .limit(limit);
}

export type StepOutcome =
  | { sent: true; step: number; emailSendId: string }
  | {
      sent: false;
      reason:
        | 'replied'
        | 'unsubscribed'
        | 'not_active'
        | 'not_due'
        | 'no_step'
        | 'not_configured'
        | 'send_failed';
    };

/**
 * Send the one step a single enrolment is due for, then schedule the next.
 *
 * Every guard is re-checked here rather than trusted from whoever scheduled
 * this, because between scheduling and running, the prospect may have replied,
 * and that is precisely the moment when getting it wrong costs the most.
 */
export async function runStep(enrollmentId: string, now: Date = new Date()): Promise<StepOutcome> {
  const enrollment = await db.query.sequenceEnrollment.findFirst({
    where: eq(sequenceEnrollment.id, enrollmentId),
  });
  if (!enrollment || enrollment.status !== 'active') return { sent: false, reason: 'not_active' };

  // The step has to actually be due, and this guard is the reason the schedule
  // means anything at all.
  //
  // Without it, every path that runs a step twice in quick succession sends two
  // different steps back to back: the second call reads the cursor the first
  // one just advanced and mails the next message immediately, days early. A
  // test caught exactly that, by running two steps concurrently and getting
  // "following up" and "closing the loop" delivered in the same second. An
  // operator typing the run command twice would have done the same thing to a
  // real prospect.
  if (!enrollment.nextRunAt || enrollment.nextRunAt > now) {
    return { sent: false, reason: 'not_due' };
  }

  // No mail provider means no step is spent.
  //
  // The send path records an unsendable message rather than losing it, which is
  // right for one transactional email and wrong for a cadence: advancing the
  // cursor here would march every enrolled contact through all four steps into
  // a void, and the list would be burned without a single message arriving.
  // Leaving the step due means the opener goes out when the key is set, to
  // everybody, in order.
  if (!emailConfigured()) {
    log.warn('a sequence step came due with no mail provider configured', {
      enrollmentId,
      step: enrollment.stepsSent + 1,
      remedy: 'set RESEND_API_KEY and EMAIL_FROM; the step stays due until then',
    });
    return { sent: false, reason: 'not_configured' };
  }

  const person = await db.query.contact.findFirst({
    where: eq(contact.id, enrollment.contactId),
  });

  // Unsubscribed wins over everything and ends the enrolment, not just this
  // step: send() would refuse the message anyway, and leaving the enrolment
  // active would have it try again tomorrow, forever.
  if (!person || person.unsubscribedAt) {
    await stopFor(enrollment.contactId, 'unsubscribed', 'contact unsubscribed');
    return { sent: false, reason: 'unsubscribed' };
  }

  const seq = await db.query.sequence.findFirst({
    where: eq(sequence.id, enrollment.sequenceId),
  });
  const step = seq?.steps[enrollment.stepsSent];
  if (!seq || !step) {
    await db
      .update(sequenceEnrollment)
      .set({ status: 'completed', nextRunAt: null, updatedAt: now })
      .where(eq(sequenceEnrollment.id, enrollmentId));
    return { sent: false, reason: 'no_step' };
  }

  const target: Substitutable = {
    firstName: person.firstName,
    lastName: person.lastName,
    title: person.title,
    orgName: person.orgName,
    email: person.email,
    unsubscribeToken: person.unsubscribeToken,
  };

  const subject = substitute(step.subject, target);
  const text = `${substitute(step.body, target)}\n\n${campaignFooter(target)}`;

  // The cursor advances before the send, and the guard is the cursor's own
  // value in the WHERE clause. Two drains racing on the same enrolment means
  // one of them updates zero rows and stops, rather than both sending.
  const claimed = await db
    .update(sequenceEnrollment)
    .set({ stepsSent: enrollment.stepsSent + 1, updatedAt: now })
    .where(
      and(
        eq(sequenceEnrollment.id, enrollmentId),
        eq(sequenceEnrollment.stepsSent, enrollment.stepsSent),
        eq(sequenceEnrollment.status, 'active'),
      ),
    )
    .returning({ id: sequenceEnrollment.id });

  if (claimed.length === 0) return { sent: false, reason: 'not_active' };

  const result = await send({
    to: person.email,
    subject,
    text,
    contactId: person.id,
  });

  const upcoming = seq.steps[enrollment.stepsSent + 1];
  await db
    .update(sequenceEnrollment)
    .set({
      status: upcoming ? 'active' : 'completed',
      nextRunAt: upcoming ? stepDueAt(enrollment.enrolledAt, upcoming) : null,
      updatedAt: now,
    })
    .where(eq(sequenceEnrollment.id, enrollmentId));

  if (result.status === 'skipped_unsubscribed') {
    await stopFor(enrollment.contactId, 'unsubscribed', 'refused at send time');
    return { sent: false, reason: 'unsubscribed' };
  }

  if (result.status !== 'sent') {
    log.warn('a sequence step did not send', {
      enrollmentId,
      step: enrollment.stepsSent + 1,
      status: result.status,
    });
    return { sent: false, reason: 'send_failed' };
  }

  log.info('sequence step sent', {
    enrollmentId,
    step: enrollment.stepsSent + 1,
    of: seq.steps.length,
  });
  return { sent: true, step: enrollment.stepsSent + 1, emailSendId: result.emailSendId };
}

/** Advance every due enrolment. Called by the cron drain. */
export async function runDueSteps(now: Date = new Date()): Promise<{
  considered: number;
  sent: number;
}> {
  const due = await dueEnrollments(now);
  let sent = 0;
  for (const enrollment of due) {
    const outcome = await runStep(enrollment.id, now);
    if (outcome.sent) sent += 1;
  }
  if (due.length > 0) {
    log.info('sequence drain finished', { considered: due.length, sent });
  }
  return { considered: due.length, sent };
}

/**
 * Create the cadence, or update its steps if it is already there.
 *
 * Idempotent, because the console's button can be pressed twice and the second
 * press must not create a second cadence that everybody then walks through in
 * parallel.
 */
export async function upsertSequence(
  name: string,
  steps: SequenceStep[],
  createdBy: string,
): Promise<{ created: boolean }> {
  const existing = await db.query.sequence.findFirst({ where: eq(sequence.name, name) });
  if (existing) {
    await db.update(sequence).set({ steps }).where(eq(sequence.id, existing.id));
    return { created: false };
  }
  await db.insert(sequence).values({ name, steps, createdBy });
  return { created: true };
}

/**
 * Enrol everybody not already enrolled, spreading their start times.
 *
 * The spread is the point rather than a nicety. A new sending domain that emits
 * a hundred cold messages in a minute is classified as a spam source, and that
 * verdict is invisible from this side: every send reports success and no reply
 * ever comes. Staggering start times paces the opener and every follow-up
 * behind it, using the due dates that already exist.
 */
export async function enrollEveryone(input: {
  sequenceName: string;
  alreadySent?: number;
  perDay?: number;
  spacingMinutes?: number;
  from?: Date;
}): Promise<{ enrolled: number; already: number; days: number }> {
  const perDay = Math.max(1, input.perDay ?? 20);
  const spacing = Math.max(1, input.spacingMinutes ?? 7);
  const start = input.from ?? new Date();

  const everyone = await db
    .select({ id: contact.id })
    .from(contact)
    .where(isNull(contact.unsubscribedAt));

  let enrolled = 0;
  let already = 0;

  for (const person of everyone) {
    const dayShift = Math.floor(enrolled / perDay);
    const withinDay = (enrolled % perDay) * spacing;
    const enrolledAt = new Date(
      start.getTime() + dayShift * DAY_MS + withinDay * 60 * 1000,
    );

    const result = await enroll({
      sequenceName: input.sequenceName,
      contactId: person.id,
      alreadySent: input.alreadySent,
      enrolledAt,
    });

    if (result.alreadyEnrolled) already += 1;
    else enrolled += 1;
  }

  return { enrolled, already, days: Math.max(1, Math.ceil(enrolled / perDay)) };
}

/** Every contact with where they stand, for the console's table. */
export async function enrollmentBoard(sequenceName: string) {
  const row = await db.query.sequence.findFirst({
    where: eq(sequence.name, sequenceName),
  });

  return db
    .select({
      contactId: contact.id,
      email: contact.email,
      firstName: contact.firstName,
      orgName: contact.orgName,
      title: contact.title,
      unsubscribedAt: contact.unsubscribedAt,
      status: sequenceEnrollment.status,
      stepsSent: sequenceEnrollment.stepsSent,
      nextRunAt: sequenceEnrollment.nextRunAt,
      repliedAt: sequenceEnrollment.repliedAt,
      totalSteps: sql<number>`${row?.steps.length ?? 0}::int`,
    })
    .from(contact)
    .leftJoin(
      sequenceEnrollment,
      and(
        eq(sequenceEnrollment.contactId, contact.id),
        row ? eq(sequenceEnrollment.sequenceId, row.id) : sql`false`,
      ),
    )
    .orderBy(contact.orgName, contact.email);
}

/** What the operator console shows: where every enrolment stands. */
export async function sequenceStatus(sequenceName: string) {
  const row = await db.query.sequence.findFirst({
    where: eq(sequence.name, sequenceName),
  });
  if (!row) throw new SequenceNotFoundError(sequenceName);

  const counts = await db
    .select({
      status: sequenceEnrollment.status,
      count: sql<number>`count(*)::int`,
    })
    .from(sequenceEnrollment)
    .where(eq(sequenceEnrollment.sequenceId, row.id))
    .groupBy(sequenceEnrollment.status);

  const pending = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(sequenceEnrollment)
    .where(
      and(
        eq(sequenceEnrollment.sequenceId, row.id),
        eq(sequenceEnrollment.status, 'active'),
        or(isNull(sequenceEnrollment.nextRunAt), lte(sequenceEnrollment.nextRunAt, new Date())),
      ),
    );

  return {
    name: row.name,
    steps: row.steps.length,
    byStatus: Object.fromEntries(counts.map((c) => [c.status, c.count])),
    dueNow: pending[0]?.count ?? 0,
  };
}

/* ─── The pilot cadence ───────────────────────────────────────────────────── */

/** The one cadence this product runs today. Named so both the console and the
 * command line reach the same rows rather than each creating their own. */
export const PILOT_SEQUENCE = 'pilot-outreach';

/**
 * The four messages.
 *
 * Here rather than in a script so the console and the command line send the
 * same words, and so changing one of them is one edit in one place.
 */
export const PILOT_STEPS: SequenceStep[] = [
  {
    // The opener. Day zero, so enrolling a contact sends it on the next drain.
    //
    // Short, because the reader owes us nothing and a wall of text from a
    // stranger reads as a brochure. Their problem before our product, one
    // attributed number, and an ask small enough to answer with a single word.
    dayOffset: 0,
    subject: 'The denials {{org_name}} is writing off',
    body: `Hi {{first_name}},

When a Medicare Advantage plan denies a skilled nursing or rehab stay, appealing it takes about forty minutes of someone's day, so most of those denials get written off instead. The plans know that.

Federal reviewers have looked at this: the HHS Office of Inspector General and KFF both found that most Medicare Advantage denials that get appealed end up overturned, and that very few are ever appealed at all.

I build software that writes the appeal. It reads the denial letter, finds where the plan applied the wrong standard, drafts the argument from Medicare's own rules and the patient's record, and checks every quoted passage against its source before anyone signs it. Your appeals specialist reviews, edits, and files it. Nothing is submitted by software.

Would it be useful if I sent you a sample letter it wrote? It is a synthetic demonstration case, so there is no patient information in it and nothing to sign.`,
  },
  {
    dayOffset: 4,
    subject: 'Following up: Medicare Advantage denials at {{org_name}}',
    body: `Hi {{first_name}},

I wrote earlier this week about the skilled nursing and rehab denials that get written off because appealing one takes forty minutes nobody has.

One question and I will leave you alone: is that a real problem at {{org_name}}, or does someone there already handle it?

Either answer is useful to me.`,
  },
  {
    dayOffset: 10,
    subject: 'The plateau denials are appealable',
    body: `Hi {{first_name}},

One thing worth having whether or not you ever reply to me.

When a Medicare Advantage plan denies a skilled nursing stay because the resident "plateaued" or stopped making progress, that denial applies a standard Medicare disavowed in the Jimmo v. Sebelius settlement. Coverage turns on whether skilled care is needed, not on whether the patient improves. The same goes for denials resting on the plan's internal guidelines rather than Medicare's criteria, which 42 CFR 422.101(b) does not allow where Medicare has rules.

Our software flags both automatically and drafts the appeal, with every quoted passage checked against its source before anyone signs it.

Happy to send a sample letter if that would be useful.`,
  },
  {
    dayOffset: 20,
    subject: 'Closing the loop',
    body: `Hi {{first_name}},

I have written a couple of times about appealing Medicare Advantage denials and have not heard back, which almost always means it is not a priority right now. That is a fine answer.

Should I close the loop, or would it be better to try again later in the year?

Thanks either way.`,
  },
];
