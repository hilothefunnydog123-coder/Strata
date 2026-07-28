/**
 * Rate limiting for unauthenticated endpoints.
 *
 * Backed by the database rather than memory, because the application runs on
 * serverless functions where a module level Map is per-instance and therefore
 * not a limit at all. The `job` table is reused as generic keyed storage: a row
 * per bucket, counting hits inside a window.
 *
 * This is deliberately modest. It stops a script hammering the demo form. It is
 * not a defence against a distributed flood, which is the CDN's job.
 */
import { and, eq, gte, sql } from 'drizzle-orm';
import { db } from '@/lib/db';
import { job } from '@/lib/db/schema';

export interface RateLimitResult {
  allowed: boolean;
  remaining: number;
  retryAfterSeconds: number;
}

/**
 * Count one hit against a key. Returns whether it is allowed.
 *
 * `key` should identify the actor and the action together, for instance
 * `demo-request:203.0.113.9`.
 */
export async function rateLimit(
  key: string,
  limit: number,
  windowSeconds: number,
): Promise<RateLimitResult> {
  const windowStart = new Date(Date.now() - windowSeconds * 1000);

  const [existing] = await db
    .select({ id: job.id, attempts: job.attempts, createdAt: job.createdAt })
    .from(job)
    .where(
      and(
        eq(job.kind, 'rate_limit'),
        eq(sql`${job.payload}->>'key'`, key),
        gte(job.createdAt, windowStart),
      ),
    )
    .limit(1);

  if (!existing) {
    await db.insert(job).values({
      kind: 'rate_limit',
      payload: { key },
      status: 'done',
      attempts: 1,
      runAfter: new Date(),
    });
    return { allowed: true, remaining: limit - 1, retryAfterSeconds: 0 };
  }

  const attempts = existing.attempts + 1;
  await db.update(job).set({ attempts }).where(eq(job.id, existing.id));

  if (attempts > limit) {
    const elapsed = (Date.now() - existing.createdAt.getTime()) / 1000;
    return {
      allowed: false,
      remaining: 0,
      retryAfterSeconds: Math.max(1, Math.ceil(windowSeconds - elapsed)),
    };
  }

  return { allowed: true, remaining: limit - attempts, retryAfterSeconds: 0 };
}

/** Drop expired rate limit buckets. Called by the cron drain. */
export async function pruneRateLimits(olderThan: Date): Promise<number> {
  const deleted = await db
    .delete(job)
    .where(and(eq(job.kind, 'rate_limit'), sql`${job.createdAt} < ${olderThan}`))
    .returning({ id: job.id });
  return deleted.length;
}
