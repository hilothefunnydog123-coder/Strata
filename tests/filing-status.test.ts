/**
 * Where a claim stands, which the old single status word could not say.
 *
 * A denial used to carry one word, and that word rendered three situations
 * identically: nothing filed, filed and waiting, and lost below with sixty days
 * left to reach an ALJ. Only the last of those is worth money, and it looked
 * exactly like giving up.
 *
 * The tests worth having here are about what is claimed rather than what is
 * displayed. A level that says it is open when it is not invites a specialist to
 * file into a forum that will not hear it; a level that says it is not reached
 * when it is loses the claim by silence. So: which levels are reachable, which
 * are decided, and what a plan this product does not model is told.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { eq } from 'drizzle-orm';
import { db } from '@/lib/db';
import {
  appeal,
  appealDraft,
  denial,
  organization,
  submission,
  submissionEvent,
  user,
} from '@/lib/db/schema';
import { filingStatus } from '@/lib/filing/status';

const ORG = 'org-status-test';
const USER = 'user-status-test';

let denialId = '';
let draftId = '';

async function makeDenial(planType: 'traditional_medicare' | 'medicare_advantage' | 'commercial') {
  const [record] = await db
    .insert(denial)
    .values({
      organizationId: ORG,
      internalRef: `REF-${planType}`,
      payerName: 'Test Plan',
      planType,
      serviceType: 'skilled_nursing',
      claimAmountCents: 250_000,
      isSynthetic: true,
      createdBy: USER,
      status: 'approved',
    })
    .returning();

  const [draft] = await db
    .insert(appealDraft)
    .values({
      denialId: record!.id,
      version: 1,
      bodyJson: '{}',
      status: 'ready',
      generatedByModel: 'test',
    })
    .returning();

  return { denialId: record!.id, draftId: draft!.id };
}

beforeAll(async () => {
  await db.delete(denial);
  await db.delete(organization);
  await db.delete(user).where(eq(user.id, USER));

  await db.insert(organization).values({
    id: ORG,
    name: 'Status Test Hospital',
    slug: 'status-test-hospital',
  });
  await db.insert(user).values({
    id: USER,
    name: 'Operator',
    email: 'status@example.test',
    emailVerified: true,
  });
});

beforeEach(async () => {
  await db.delete(denial);
  const made = await makeDenial('traditional_medicare');
  denialId = made.denialId;
  draftId = made.draftId;
});

afterAll(async () => {
  await db.delete(denial);
  await db.delete(organization);
  await db.delete(user).where(eq(user.id, USER));
});

describe('a denial nobody has appealed yet', () => {
  it('shows the whole ladder with only the first rung open', async () => {
    const status = await filingStatus(denialId, 'traditional_medicare');

    expect(status.ladder).toBe('traditional_medicare');
    expect(status.rungs).toHaveLength(5);
    expect(status.rungs[0]!.state).toBe('open');
    // The levels above are drawn rather than hidden. A hospital deciding
    // whether a lost redetermination is the end of the claim needs to see that
    // there are four more forums above it.
    expect(status.rungs.slice(1).every((r) => r.state === 'not_reached')).toBe(true);
    expect(status.everFiled).toBe(false);
    expect(status.current?.ordinal).toBe(1);
  });

  it('shows the same deadline the case panel does, rather than none', async () => {
    // Caught by looking at the page. The case panel said "appeal due
    // 2026-08-16, in 11 days" and the ladder directly beneath it showed the
    // same level with no date at all. Two answers to one question on one
    // screen, and a specialist would act on whichever they read first.
    const deadline = new Date('2026-08-16T00:00:00Z');

    const status = await filingStatus(denialId, 'traditional_medicare', deadline);

    expect(status.rungs[0]!.dueBy).toEqual(deadline);
    // Only the first rung. The levels above it count from the notice of the
    // level beneath, which has not been issued, so there is no honest date.
    expect(status.rungs[1]!.dueBy).toBeNull();
  });

  it('names the forum for each level, since they are different institutions', async () => {
    const status = await filingStatus(denialId, 'traditional_medicare');

    expect(status.rungs[0]!.decidedBy).toMatch(/Administrative Contractor/);
    expect(status.rungs[2]!.decidedBy).toMatch(/Medicare Hearings and Appeals/);
  });
});

describe('a Medicare Advantage denial', () => {
  it('climbs its own ladder rather than the Traditional one', async () => {
    const made = await makeDenial('medicare_advantage');
    const status = await filingStatus(made.denialId, 'medicare_advantage');

    expect(status.ladder).toBe('medicare_advantage');
    expect(status.rungs[0]!.label).toBe('Plan reconsideration');
    // They converge at the ALJ, which is the point of modelling both.
    expect(status.rungs[2]!.label).toBe('ALJ hearing');
  });
});

describe('a plan whose process this product does not model', () => {
  it('says so instead of attaching a Medicare deadline to it', async () => {
    // Showing a commercial denial a 120 day redetermination clock would be
    // telling a hospital a date that has nothing to do with their claim.
    const made = await makeDenial('commercial');
    const status = await filingStatus(made.denialId, 'commercial');

    expect(status.ladder).toBeNull();
    expect(status.rungs).toEqual([]);
    expect(status.unmodelled).toMatch(/does not model/i);
  });
});

describe('a rung that has been filed', () => {
  beforeEach(async () => {
    const [rung] = await db
      .insert(appeal)
      .values({
        denialId,
        level: 'redetermination',
        levelOrdinal: 1,
        appealDraftId: draftId,
        filedAt: new Date('2026-03-01T10:00:00Z'),
        dueBy: new Date('2026-06-01T00:00:00Z'),
      })
      .returning();

    const [sent] = await db
      .insert(submission)
      .values({
        appealDraftId: draftId,
        appealId: rung!.id,
        channel: 'email',
        status: 'sent',
        method: 'Email',
        submittedAt: new Date('2026-03-01T10:00:00Z'),
        trackingRef: 'msg-abc',
      })
      .returning();

    await db.insert(submissionEvent).values([
      {
        submissionId: sent!.id,
        kind: 'prepared',
        detail: 'Filing by Email to appeals@payer.example.',
        at: new Date('2026-03-01T09:59:00Z'),
      },
      {
        submissionId: sent!.id,
        kind: 'sent',
        detail: 'Accepted by the mail provider.',
        at: new Date('2026-03-01T10:00:00Z'),
      },
    ]);
  });

  it('reports it as filed, and does not open the level above it yet', async () => {
    // A reconsideration cannot be filed before the redetermination is decided.
    // Showing it as open would invite filing into a forum that will not hear
    // it, and the rejection would arrive with the real clock still running.
    const status = await filingStatus(denialId, 'traditional_medicare');

    expect(status.rungs[0]!.state).toBe('filed');
    expect(status.rungs[1]!.state).toBe('not_reached');
    expect(status.everFiled).toBe(true);
    // Still the level to act on: it is filed and waiting on a decision.
    expect(status.current?.ordinal).toBe(1);
  });

  it('carries the reference that proves it went', async () => {
    const status = await filingStatus(denialId, 'traditional_medicare');
    const [filed] = status.rungs[0]!.submissions;

    expect(filed!.channelLabel).toBe('Email');
    expect(filed!.status).toBe('sent');
    expect(filed!.trackingRef).toBe('msg-abc');
  });

  it('keeps the events in the order they happened', async () => {
    const status = await filingStatus(denialId, 'traditional_medicare');
    const [filed] = status.rungs[0]!.submissions;

    expect(filed!.events.map((e) => e.kind)).toEqual(['prepared', 'sent']);
  });
});

describe('a filing that failed', () => {
  it('stays visible with its reason rather than vanishing', async () => {
    // The whole point of writing the submission before the send. A filing
    // nobody can see is worse than one that failed loudly, because the second
    // one gets retried before the deadline.
    const [rung] = await db
      .insert(appeal)
      .values({ denialId, level: 'redetermination', levelOrdinal: 1, appealDraftId: draftId })
      .returning();

    await db.insert(submission).values({
      appealDraftId: draftId,
      appealId: rung!.id,
      channel: 'email',
      status: 'failed',
      method: 'Email',
      failureReason: 'appeals@ is not an address.',
    });

    const status = await filingStatus(denialId, 'traditional_medicare');

    // Not filed: an attempt that failed did not file anything.
    expect(status.rungs[0]!.state).toBe('open');
    expect(status.everFiled).toBe(false);
    expect(status.rungs[0]!.submissions[0]!.failureReason).toMatch(/not an address/);
  });
});

describe('a rung that has been decided against us', () => {
  it('is not the end of the claim, and the next level is open', async () => {
    // The mistake this replaces: treating a loss as terminal and sending the
    // case to invoiced having recovered nothing. Claims are won at an ALJ every
    // day after being denied twice below.
    await db.insert(appeal).values({
      denialId,
      level: 'redetermination',
      levelOrdinal: 1,
      appealDraftId: draftId,
      filedAt: new Date('2026-03-01T10:00:00Z'),
      decidedAt: new Date('2026-04-01T00:00:00Z'),
      result: 'lost',
    });

    const status = await filingStatus(denialId, 'traditional_medicare');

    expect(status.rungs[0]!.state).toBe('decided');
    expect(status.rungs[0]!.result).toBe('lost');
    expect(status.rungs[1]!.state).toBe('open');
    expect(status.current?.ordinal).toBe(2);
  });

  it('reports nothing to act on once every level is decided', async () => {
    for (const [ordinal, level] of [
      'redetermination',
      'reconsideration',
      'alj',
      'council',
      'judicial',
    ].entries()) {
      await db.insert(appeal).values({
        denialId,
        level: level as 'redetermination',
        levelOrdinal: ordinal + 1,
        appealDraftId: draftId,
        decidedAt: new Date('2026-04-01T00:00:00Z'),
        result: 'lost',
      });
    }

    const status = await filingStatus(denialId, 'traditional_medicare');

    expect(status.current).toBeNull();
    expect(status.rungs.every((r) => r.state === 'decided')).toBe(true);
  });
});

describe('recording an outcome closes the level it decided', () => {
  it('writes the result onto the lowest level still open', async () => {
    // Found by looking at the page. One panel said "Won, fully overturned,
    // recovering $13,560" and the ladder beneath it showed the level still
    // open. Both were reading the database correctly; nothing had ever written
    // the result down onto the level it decided.
    const { closeCurrentRung } = await import('@/lib/appeals/rungs');

    await db.insert(appeal).values([
      {
        denialId,
        level: 'redetermination',
        levelOrdinal: 1,
        decidedAt: new Date('2026-04-01T00:00:00Z'),
        result: 'lost',
      },
      { denialId, level: 'reconsideration', levelOrdinal: 2 },
    ]);

    const closed = await closeCurrentRung(denialId, 'won', new Date('2026-06-01T00:00:00Z'));

    expect(closed).toBe(2);

    const status = await filingStatus(denialId, 'traditional_medicare');
    expect(status.rungs[1]!.result).toBe('won');
    // The level already decided is left exactly as it was.
    expect(status.rungs[0]!.result).toBe('lost');
    // And a claim that has been won is finished. Showing an ALJ hearing as
    // open on it would invite appealing a case the hospital has been paid for.
    expect(status.rungs[2]!.state).toBe('not_reached');
    expect(status.current).toBeNull();
  });

  it('opens the next forum after a partial, which is what it is for', async () => {
    const { closeCurrentRung } = await import('@/lib/appeals/rungs');

    await db.insert(appeal).values({ denialId, level: 'redetermination', levelOrdinal: 1 });
    await closeCurrentRung(denialId, 'partial', new Date('2026-06-01T00:00:00Z'));

    const status = await filingStatus(denialId, 'traditional_medicare');

    // The part that was denied is still denied, and that is exactly what
    // reconsideration is for.
    expect(status.rungs[1]!.state).toBe('open');
    expect(status.current?.ordinal).toBe(2);
  });

  it('does not prompt to climb again after a withdrawal', async () => {
    const { closeCurrentRung } = await import('@/lib/appeals/rungs');

    await db.insert(appeal).values({ denialId, level: 'redetermination', levelOrdinal: 1 });
    await closeCurrentRung(denialId, 'withdrawn', new Date('2026-06-01T00:00:00Z'));

    const status = await filingStatus(denialId, 'traditional_medicare');

    expect(status.rungs[1]!.state).toBe('not_reached');
    expect(status.current).toBeNull();
  });

  it('does nothing when no level exists, rather than inventing one', async () => {
    // A denial appealed outside this product has no rung to close, and creating
    // one here would assert a filing there is no evidence of.
    const { closeCurrentRung } = await import('@/lib/appeals/rungs');

    const closed = await closeCurrentRung(denialId, 'won', new Date());

    expect(closed).toBeNull();
    expect((await filingStatus(denialId, 'traditional_medicare')).everFiled).toBe(false);
  });
});
