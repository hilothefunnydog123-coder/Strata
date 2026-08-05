/**
 * What has actually happened when this holding was cited.
 *
 * The company bills a percentage of what it recovers, so a win is revenue and a
 * loss is nothing. Outcomes were already recorded to the row a bill is computed
 * from, and read by nothing else: every appeal was drafted with no memory of
 * the last thousand. This is the half that was missing.
 *
 * Derived by query rather than kept in counters on the holding. A counter has
 * to be incremented by whoever records an outcome, stays wrong once anything is
 * corrected or a draft is superseded, and needs a recompute script nobody runs.
 * The join is the definition, so it cannot drift from the facts it summarises.
 */
import { and, eq, inArray, ne, sql } from 'drizzle-orm';
import { db } from '@/lib/db';
import { appealDraft, assertion, denial, outcome } from '@/lib/db/schema';

export interface TrackRecord {
  /** Appeals that cited this holding and have since been decided. */
  decided: number;
  /** Wins, counting a partial recovery as half. */
  credit: number;
}

/**
 * A partial recovery is evidence, and it is not a win.
 *
 * Counting it as either one throws away the distinction the outcome enum went
 * to the trouble of recording. Withdrawn is excluded entirely rather than
 * counted as a loss: an appeal the hospital abandoned says something about the
 * hospital, not about whether the argument was any good.
 */
const CREDIT: Record<string, number | null> = {
  won: 1,
  partial: 0.5,
  lost: 0,
  withdrawn: null,
};

/**
 * How strongly to pull a thin record toward the corpus average.
 *
 * A holding cited once, in an appeal that won, has a raw win rate of 100
 * percent and has told us almost nothing. Without shrinkage it would outrank a
 * holding that has won forty appeals out of fifty, and the top of every result
 * list would be whatever was tried once and got lucky. At five, a single win
 * moves a holding barely at all and a record of fifty dominates its prior,
 * which is the behaviour worth having.
 */
const SMOOTHING = 5;

export interface TrackRecordSet {
  /** The corpus win rate, which a holding with no record is judged as having. */
  baseRate: number;
  byHolding: Map<string, TrackRecord>;
}

/**
 * The record of every holding named, plus the corpus base rate.
 *
 * Only assertions from a draft that was actually sent count. A superseded draft
 * is one a reviewer replaced before it left the building, so its citations were
 * never tested against a payer and crediting them with the outcome would be
 * counting an argument nobody made.
 */
export async function trackRecords(holdingIds: readonly string[]): Promise<TrackRecordSet> {
  if (holdingIds.length === 0) return { baseRate: 0, byHolding: new Map() };

  const rows = await db
    .select({
      holdingId: assertion.sourceId,
      result: outcome.result,
      n: sql<number>`count(*)::int`,
    })
    .from(assertion)
    .innerJoin(appealDraft, eq(assertion.appealDraftId, appealDraft.id))
    .innerJoin(denial, eq(appealDraft.denialId, denial.id))
    .innerJoin(outcome, eq(outcome.denialId, denial.id))
    .where(
      and(
        eq(assertion.sourceKind, 'holding'),
        ne(appealDraft.status, 'superseded'),
        inArray(assertion.sourceId, [...holdingIds]),
      ),
    )
    .groupBy(assertion.sourceId, outcome.result);

  const byHolding = new Map<string, TrackRecord>();
  let totalDecided = 0;
  let totalCredit = 0;

  for (const row of rows) {
    const credit = CREDIT[row.result];
    if (credit === null || credit === undefined) continue;

    const current = byHolding.get(row.holdingId) ?? { decided: 0, credit: 0 };
    current.decided += row.n;
    current.credit += credit * row.n;
    byHolding.set(row.holdingId, current);

    totalDecided += row.n;
    totalCredit += credit * row.n;
  }

  return {
    // With nothing decided yet there is no corpus average, and every holding is
    // judged against zero, which cancels for all of them. That is the right
    // answer on day one: no evidence, no opinion.
    baseRate: totalDecided === 0 ? 0 : totalCredit / totalDecided,
    byHolding,
  };
}

/**
 * How much better than average this holding has done, from -1 to 1.
 *
 * Centred on the base rate rather than on zero, so a holding nobody has cited
 * scores exactly 0 and is neither rewarded nor buried. That matters more than
 * it sounds: without it, every holding from a chapter added this morning would
 * rank below everything with any history at all, and a corpus that keeps
 * growing would keep burying its newest and most specific authority.
 */
export function trackRecordSignal(
  record: TrackRecord | undefined,
  baseRate: number,
): number {
  if (!record || record.decided === 0) return 0;

  const shrunk =
    (record.credit + SMOOTHING * baseRate) / (record.decided + SMOOTHING);

  return shrunk - baseRate;
}

/** Said the way a reviewer would want it said, or null when there is nothing to say. */
export function trackRecordReason(record: TrackRecord | undefined): string | null {
  if (!record || record.decided === 0) return null;

  const appeals = `${record.decided} decided appeal${record.decided === 1 ? '' : 's'}`;
  const wins = Number.isInteger(record.credit) ? String(record.credit) : record.credit.toFixed(1);

  return `cited in ${appeals}, worth ${wins} in recoveries (a partial counts as half)`;
}
