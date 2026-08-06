/**
 * Closing the rung an outcome decided.
 *
 * Found by looking at the page rather than by a failing test. A case showed
 * "Won, fully overturned, recovering $13,560" in one panel and, in the ladder
 * directly beneath it, a level still marked open with no result. Both were
 * reading the database correctly. Nothing had ever written the result down onto
 * the level it decided.
 *
 * That gap is not cosmetic. The ladder is what decides whether a claim has
 * anywhere left to go, and a level that stays open forever is a level the
 * product will keep offering to escalate long after the claim is finished.
 */
import { and, asc, eq, isNull } from 'drizzle-orm';
import { db } from '@/lib/db';
import { appeal } from '@/lib/db/schema';

export type RungResult = 'won' | 'lost' | 'partial' | 'withdrawn';

/**
 * Write a result onto the lowest level that has not been decided.
 *
 * Does nothing when no level exists. A denial whose appeal was filed outside
 * this product has no rung to close, and creating one here would assert a
 * filing that this system has no evidence of.
 *
 * Returns the ordinal closed, or null, so a caller can say what happened.
 */
export async function closeCurrentRung(
  denialId: string,
  result: RungResult,
  decidedAt: Date,
): Promise<number | null> {
  const [open] = await db
    .select()
    .from(appeal)
    .where(and(eq(appeal.denialId, denialId), isNull(appeal.result)))
    .orderBy(asc(appeal.levelOrdinal))
    .limit(1);

  if (!open) return null;

  await db.update(appeal).set({ result, decidedAt }).where(eq(appeal.id, open.id));

  return open.levelOrdinal;
}
