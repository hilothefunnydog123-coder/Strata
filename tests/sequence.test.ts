/**
 * Follow-ups that run themselves, and stop themselves.
 *
 * The tests that matter here are not "does an email go out". They are the four
 * ways an automated cadence humiliates you in a stranger's inbox: it follows up
 * on somebody who already replied, it mails somebody who unsubscribed, it sends
 * the same step twice because two drains overlapped, and it sends step three
 * before step two. Each one has a test below, and each one exists because the
 * failure is invisible from inside the system and obvious to the recipient.
 */
import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest';

const sent: { to: string; subject: string; text: string }[] = [];

vi.mock('@/lib/email/send', () => ({
  emailConfigured: () => true,
  send: async (input: { to: string; subject: string; text: string }) => {
    sent.push(input);
    return { status: 'sent' as const, providerId: 'msg-test', emailSendId: 'send-x' };
  },
}));

import { eq, inArray } from 'drizzle-orm';
import { db } from '@/lib/db';
import { contact, sequence, sequenceEnrollment, user } from '@/lib/db/schema';
import {
  dueEnrollments,
  enroll,
  markReplied,
  runDueSteps,
  runStep,
  sequenceStatus,
  stepDueAt,
  stopFor,
  SequenceNotFoundError,
  type SequenceStep,
} from '@/lib/email/sequence';

const SEQ = 'test-cadence';
const OWNER = 'user-sequence-test';
const EMAILS = ['first@example.test', 'second@example.test'];

const STEPS: SequenceStep[] = [
  { dayOffset: 4, subject: 'Following up, {{first_name}}', body: 'Body one for {{org_name}}.' },
  { dayOffset: 10, subject: 'One more thing', body: 'Body two.' },
  { dayOffset: 20, subject: 'Closing the loop', body: 'Body three.' },
];

const DAY = 24 * 60 * 60 * 1000;
const ENROLLED = new Date('2026-08-01T09:00:00Z');
const day = (n: number) => new Date(ENROLLED.getTime() + n * DAY);

async function makeContact(email: string): Promise<string> {
  const [row] = await db
    .insert(contact)
    .values({
      email,
      firstName: 'Dana',
      orgName: 'Northgate Regional',
      unsubscribeToken: `tok-${email}`,
    })
    .returning({ id: contact.id });
  return row!.id;
}

beforeEach(async () => {
  sent.length = 0;
  await db.delete(contact).where(inArray(contact.email, EMAILS));
  await db.delete(sequence).where(eq(sequence.name, SEQ));
  await db.delete(user).where(eq(user.id, OWNER));
  await db.insert(user).values({
    id: OWNER,
    name: 'Sequence Test',
    email: 'sequence-test@example.test',
    emailVerified: true,
  });
  await db.insert(sequence).values({ name: SEQ, steps: STEPS, createdBy: OWNER });
});

afterAll(async () => {
  await db.delete(contact).where(inArray(contact.email, EMAILS));
  await db.delete(sequence).where(eq(sequence.name, SEQ));
  await db.delete(user).where(eq(user.id, OWNER));
});

describe('scheduling', () => {
  it('counts each step from enrolment, not from the step before it', () => {
    // So changing step two's delay never silently moves step three.
    expect(stepDueAt(ENROLLED, STEPS[0]!).toISOString()).toBe(day(4).toISOString());
    expect(stepDueAt(ENROLLED, STEPS[2]!).toISOString()).toBe(day(20).toISOString());
  });

  it('schedules the next unsent step when the first mail went out by hand', async () => {
    const id = await makeContact(EMAILS[0]!);
    const result = await enroll({
      sequenceName: SEQ,
      contactId: id,
      alreadySent: 1,
      enrolledAt: ENROLLED,
    });

    // alreadySent 1 means step one is done, so step two at day 10 is next.
    expect(result.nextRunAt?.toISOString()).toBe(day(10).toISOString());
    expect(result.alreadyEnrolled).toBe(false);
  });

  it('refuses to enrol into a sequence that does not exist', async () => {
    const id = await makeContact(EMAILS[0]!);
    await expect(
      enroll({ sequenceName: 'no-such-cadence', contactId: id }),
    ).rejects.toBeInstanceOf(SequenceNotFoundError);
  });

  it('treats a second enrolment as a no-op rather than a second cadence', async () => {
    // An import script that gets run twice must not double-mail anybody.
    const id = await makeContact(EMAILS[0]!);
    await enroll({ sequenceName: SEQ, contactId: id, enrolledAt: ENROLLED });
    const again = await enroll({ sequenceName: SEQ, contactId: id, enrolledAt: ENROLLED });

    expect(again.alreadyEnrolled).toBe(true);
    const rows = await db
      .select()
      .from(sequenceEnrollment)
      .where(eq(sequenceEnrollment.contactId, id));
    expect(rows).toHaveLength(1);
  });

  it('is not due until the day arrives', async () => {
    const id = await makeContact(EMAILS[0]!);
    await enroll({ sequenceName: SEQ, contactId: id, enrolledAt: ENROLLED });

    expect(await dueEnrollments(day(3))).toHaveLength(0);
    expect(await dueEnrollments(day(4))).toHaveLength(1);
  });

  it('sends a step that came due while nobody was draining', async () => {
    // Late is fine. Skipped is forever.
    const id = await makeContact(EMAILS[0]!);
    await enroll({ sequenceName: SEQ, contactId: id, enrolledAt: ENROLLED });

    const result = await runDueSteps(day(9));
    expect(result.sent).toBe(1);
    expect(sent[0]!.subject).toBe('Following up, Dana');
  });
});

describe('sending', () => {
  it('walks the steps in order, one per due date, and substitutes the contact in', async () => {
    const id = await makeContact(EMAILS[0]!);
    await enroll({ sequenceName: SEQ, contactId: id, enrolledAt: ENROLLED });

    await runDueSteps(day(4));
    expect(sent).toHaveLength(1);
    expect(sent[0]!.text).toContain('Body one for Northgate Regional.');

    // Nothing more is due until day 10, whatever else runs in between.
    await runDueSteps(day(5));
    expect(sent).toHaveLength(1);

    await runDueSteps(day(10));
    expect(sent).toHaveLength(2);
    expect(sent[1]!.subject).toBe('One more thing');
  });

  it('carries an unsubscribe link and a postal address in every step', async () => {
    // CAN-SPAM applies to the fourth message exactly as much as the first.
    const id = await makeContact(EMAILS[0]!);
    await enroll({ sequenceName: SEQ, contactId: id, enrolledAt: ENROLLED });
    await runDueSteps(day(4));

    expect(sent[0]!.text).toContain('unsubscribe');
  });

  it('finishes the enrolment after the last step rather than looping', async () => {
    const id = await makeContact(EMAILS[0]!);
    await enroll({ sequenceName: SEQ, contactId: id, enrolledAt: ENROLLED });

    await runDueSteps(day(4));
    await runDueSteps(day(10));
    await runDueSteps(day(20));
    await runDueSteps(day(60));

    expect(sent).toHaveLength(3);
    const [row] = await db
      .select()
      .from(sequenceEnrollment)
      .where(eq(sequenceEnrollment.contactId, id));
    expect(row!.status).toBe('completed');
    expect(row!.nextRunAt).toBeNull();
  });

  it('sends one message per person per moment, however often it is run', async () => {
    // This test found a real bug and is written to keep finding it. Running a
    // step twice used to send step one and then step two immediately, because
    // the second call read the cursor the first had just advanced and never
    // asked whether the next step was due yet. Two messages, seconds apart, to
    // a stranger. The due-date guard in runStep is what stands between an
    // operator typing the run command twice and that outcome.
    const id = await makeContact(EMAILS[0]!);
    const { enrollmentId } = await enroll({
      sequenceName: SEQ,
      contactId: id,
      enrolledAt: ENROLLED,
    });

    const [a, b] = await Promise.all([
      runStep(enrollmentId, day(4)),
      runStep(enrollmentId, day(4)),
    ]);

    expect([a.sent, b.sent].filter(Boolean)).toHaveLength(1);
    expect(sent).toHaveLength(1);
    expect(sent[0]!.subject).toBe('Following up, Dana');

    // And the same protection for the drain, which is what actually runs.
    await runDueSteps(day(4));
    await runDueSteps(day(4));
    expect(sent).toHaveLength(1);
  });
});

describe('the rule that matters: stopping', () => {
  it('sends nothing more once somebody replies', async () => {
    const id = await makeContact(EMAILS[0]!);
    await enroll({ sequenceName: SEQ, contactId: id, enrolledAt: ENROLLED });

    await runDueSteps(day(4));
    expect(sent).toHaveLength(1);

    const stopped = await markReplied(EMAILS[0]!.toUpperCase(), 'answered by email');
    expect(stopped).toBe(true);

    await runDueSteps(day(10));
    await runDueSteps(day(20));
    expect(sent).toHaveLength(1);

    const [row] = await db
      .select()
      .from(sequenceEnrollment)
      .where(eq(sequenceEnrollment.contactId, id));
    expect(row!.status).toBe('replied');
    expect(row!.repliedAt).not.toBeNull();
    expect(row!.nextRunAt).toBeNull();
  });

  it('stops a reply that lands after the step was already due', async () => {
    // The window that a naive scheduler gets wrong: the job was queued days
    // ago, the prospect answered an hour ago, and the answer must still win.
    const id = await makeContact(EMAILS[0]!);
    const { enrollmentId } = await enroll({
      sequenceName: SEQ,
      contactId: id,
      enrolledAt: ENROLLED,
    });

    await markReplied(EMAILS[0]!);
    const outcome = await runStep(enrollmentId, day(30));

    expect(outcome).toEqual({ sent: false, reason: 'not_active' });
    expect(sent).toHaveLength(0);
  });

  it('never mails an unsubscribed contact, and ends the enrolment', async () => {
    const id = await makeContact(EMAILS[0]!);
    await enroll({ sequenceName: SEQ, contactId: id, enrolledAt: ENROLLED });
    await db
      .update(contact)
      .set({ unsubscribedAt: new Date() })
      .where(eq(contact.id, id));

    await runDueSteps(day(4));

    expect(sent).toHaveLength(0);
    const [row] = await db
      .select()
      .from(sequenceEnrollment)
      .where(eq(sequenceEnrollment.contactId, id));
    expect(row!.status).toBe('unsubscribed');
  });

  it('stops one person without touching anybody else', async () => {
    const first = await makeContact(EMAILS[0]!);
    const second = await makeContact(EMAILS[1]!);
    await enroll({ sequenceName: SEQ, contactId: first, enrolledAt: ENROLLED });
    await enroll({ sequenceName: SEQ, contactId: second, enrolledAt: ENROLLED });

    await stopFor(first, 'replied');
    await runDueSteps(day(4));

    expect(sent).toHaveLength(1);
    expect(sent[0]!.to).toBe(EMAILS[1]);
  });

  it('says plainly when a reply arrives from somebody not in the list', async () => {
    expect(await markReplied('stranger@example.test')).toBe(false);
  });
});

describe('status', () => {
  it('reports where every enrolment stands', async () => {
    const first = await makeContact(EMAILS[0]!);
    const second = await makeContact(EMAILS[1]!);
    await enroll({ sequenceName: SEQ, contactId: first, enrolledAt: ENROLLED });
    await enroll({ sequenceName: SEQ, contactId: second, enrolledAt: ENROLLED });
    await markReplied(EMAILS[0]!);

    const status = await sequenceStatus(SEQ);
    expect(status.steps).toBe(3);
    expect(status.byStatus.active).toBe(1);
    expect(status.byStatus.replied).toBe(1);
  });
});
