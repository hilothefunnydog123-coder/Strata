/**
 * Where a claim actually stands, rung by rung.
 *
 * A denial used to have one status word on it, and that word could not say the
 * difference between "nothing has been filed", "filed and waiting", and "lost
 * at redetermination, 47 days left to reach a Qualified Independent
 * Contractor". Those are the three states a specialist needs to tell apart at a
 * glance, and only the last one is worth money.
 *
 * So this reads the ladder and the rows together. The ladder says which levels
 * exist for this plan and what each one's clock is; the rows say what has
 * happened. The levels nobody has reached yet are returned too, greyed rather
 * than hidden, because a hospital deciding whether to keep pushing needs to see
 * that there are four more forums above this one.
 */
import { asc, desc, eq, inArray } from 'drizzle-orm';
import { db } from '@/lib/db';
import { appeal, submission, submissionEvent } from '@/lib/db/schema';
import { ladderFor, levelsOf, type AppealLevel, type Ladder } from '@/lib/appeals/levels';
import { channelByKey } from './channels';
import type { SubmissionChannel } from './types';

export type SubmissionStatus =
  | 'prepared'
  | 'sending'
  | 'sent'
  | 'acknowledged'
  | 'rejected'
  | 'failed';

export interface FiledSubmission {
  id: string;
  channel: SubmissionChannel | null;
  /** "Email", or the stored method for a filing made before channels existed. */
  channelLabel: string;
  status: SubmissionStatus;
  submittedAt: Date | null;
  acknowledgedAt: Date | null;
  /** Confirmation, tracking or provider reference. What proves it went. */
  trackingRef: string | null;
  failureReason: string | null;
  events: { at: Date; kind: string; detail: string }[];
}

/**
 * What is true of a level right now.
 *
 * `open` is the one that matters: the level is reachable, nothing has been
 * filed, and there may be a clock running.
 */
export type RungState = 'open' | 'filed' | 'decided' | 'not_reached';

export interface AppealRung {
  ordinal: number;
  key: string;
  label: string;
  decidedBy: string;
  authority: string;
  amountInControversy: boolean;
  state: RungState;
  dueBy: Date | null;
  filedAt: Date | null;
  decidedAt: Date | null;
  result: 'won' | 'lost' | 'partial' | 'withdrawn' | null;
  submissions: FiledSubmission[];
}

export interface FilingStatus {
  ladder: Ladder | null;
  /**
   * Why there is no ladder, when there is none.
   *
   * Set for a plan type this product does not model. Saying so is the point: a
   * commercial denial shown a Medicare deadline would be told a date that has
   * nothing to do with its claim.
   */
  unmodelled: string | null;
  rungs: AppealRung[];
  /** Anything filed at all, on any rung. */
  everFiled: boolean;
  /** The level a specialist would act on now, or null when there is nothing. */
  current: AppealRung | null;
}

function labelFor(channel: SubmissionChannel | null, method: string | null): string {
  if (channel) return channelByKey(channel)?.label ?? channel.replace(/_/g, ' ');
  // Rows written before channels existed carry a free text method and nothing
  // else. Showing that is better than showing "unknown" for a real filing.
  return method ?? 'Recorded by hand';
}

export async function filingStatus(
  denialId: string,
  planType: string,
  /**
   * The deadline recorded on the denial itself, used for the first rung until
   * a row exists for it.
   *
   * Without this the case panel said "appeal due 2026-08-16, in 11 days" and
   * the ladder immediately beneath it showed the same level with no date at
   * all. Two answers to one question on one screen, and the one a specialist
   * would act on is whichever they happened to read.
   */
  appealDeadline: Date | null = null,
): Promise<FilingStatus> {
  const ladder = ladderFor(planType);

  const rows = await db
    .select()
    .from(appeal)
    .where(eq(appeal.denialId, denialId))
    .orderBy(asc(appeal.levelOrdinal));

  const submissions = rows.length
    ? await db
        .select()
        .from(submission)
        .where(
          inArray(
            submission.appealId,
            rows.map((r) => r.id),
          ),
        )
        .orderBy(desc(submission.createdAt))
    : [];

  const events = submissions.length
    ? await db
        .select()
        .from(submissionEvent)
        .where(
          inArray(
            submissionEvent.submissionId,
            submissions.map((s) => s.id),
          ),
        )
        .orderBy(asc(submissionEvent.at))
    : [];

  const eventsBySubmission = new Map<string, FiledSubmission['events']>();
  for (const e of events) {
    const list = eventsBySubmission.get(e.submissionId) ?? [];
    list.push({ at: e.at, kind: e.kind, detail: e.detail });
    eventsBySubmission.set(e.submissionId, list);
  }

  const submissionsByAppeal = new Map<string, FiledSubmission[]>();
  for (const s of submissions) {
    if (!s.appealId) continue;
    const list = submissionsByAppeal.get(s.appealId) ?? [];
    list.push({
      id: s.id,
      channel: s.channel,
      channelLabel: labelFor(s.channel, s.method),
      status: s.status,
      submittedAt: s.submittedAt,
      acknowledgedAt: s.acknowledgedAt,
      trackingRef: s.trackingRef,
      failureReason: s.failureReason,
      events: eventsBySubmission.get(s.id) ?? [],
    });
    submissionsByAppeal.set(s.appealId, list);
  }

  if (!ladder) {
    return {
      ladder: null,
      unmodelled:
        `This product models the Medicare appeal process, and this is a ` +
        `${planType.replace(/_/g, ' ')} plan whose process it does not model. Its levels and ` +
        'deadlines are not shown rather than guessed at.',
      rungs: [],
      everFiled: submissions.length > 0,
      current: null,
    };
  }

  const byOrdinal = new Map(rows.map((r) => [r.levelOrdinal, r]));
  const highestReached = rows.length ? Math.max(...rows.map((r) => r.levelOrdinal)) : 0;

  /**
   * Whether the level above the highest one reached is reachable at all.
   *
   * Only an adverse decision opens the next forum. A claim won at
   * reconsideration is finished, and showing an ALJ hearing as open on it
   * invites a specialist to appeal a case the hospital has already been paid
   * for. A partial counts as adverse, because the part that was denied is still
   * denied and is exactly what the next level is for. A withdrawal does not:
   * the hospital stopped, and the product should not be prompting them to
   * start again from a rung nobody reached.
   */
  const highest = highestReached ? byOrdinal.get(highestReached) : null;
  const nextIsReachable =
    highestReached === 0 || highest?.result === 'lost' || highest?.result === 'partial';

  const rungs: AppealRung[] = levelsOf(ladder).map((level: AppealLevel) => {
    const row = byOrdinal.get(level.ordinal) ?? null;

    // A level with no row is reachable only if it is the next one up from the
    // highest that exists. Level one is reachable from the start: that is the
    // whole point of a denial that has not been appealed yet.
    const state: RungState = row
      ? row.decidedAt || row.result
        ? 'decided'
        : row.filedAt
          ? 'filed'
          : 'open'
      : level.ordinal === highestReached + 1 && nextIsReachable
        ? 'open'
        : 'not_reached';

    return {
      ordinal: level.ordinal,
      key: level.key,
      label: level.label,
      decidedBy: level.decidedBy,
      authority: level.authority,
      amountInControversy: level.amountInControversy,
      state,
      dueBy: row?.dueBy ?? (level.ordinal === 1 ? appealDeadline : null),
      filedAt: row?.filedAt ?? null,
      decidedAt: row?.decidedAt ?? null,
      result: row?.result ?? null,
      submissions: row ? (submissionsByAppeal.get(row.id) ?? []) : [],
    };
  });

  // The rung to act on: the lowest that is not yet decided. Once every rung is
  // decided there is nothing to act on and the answer is honestly nothing.
  const current = rungs.find((r) => r.state === 'open' || r.state === 'filed') ?? null;

  return {
    ladder,
    unmodelled: null,
    rungs,
    everFiled: rows.some((r) => r.filedAt !== null),
    current,
  };
}
