/**
 * The job drain.
 *
 * A cron route rather than a queue service, per the specification. Vercel hits
 * this on a schedule with CRON_SECRET in the Authorization header; it claims a
 * batch of due jobs, runs them, and records what happened.
 *
 * Deliberately modest: a bounded batch per invocation, so a backlog drains over
 * several runs rather than one invocation timing out halfway and leaving jobs
 * marked running with nothing running them.
 */
import { NextResponse, type NextRequest } from 'next/server';
import { and, eq, lte, sql } from 'drizzle-orm';
import { db } from '@/lib/db';
import { job } from '@/lib/db/schema';
import { env } from '@/lib/env';
import { log } from '@/lib/log';
import { runCampaignSend } from '@/lib/email/campaign';
import { pruneRateLimits } from '@/lib/rate-limit';
import { sendDeadlineWarnings } from '@/lib/notifications/deadlines';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** Jobs per invocation. Small enough that a run always finishes. */
const BATCH = 20;

type Handler = (payload: Record<string, unknown>) => Promise<void>;

const HANDLERS: Record<string, Handler> = {
  campaign_send: (payload) =>
    runCampaignSend({
      campaignId: String(payload.campaignId),
      contactId: String(payload.contactId),
    }),
};

export async function GET(request: NextRequest): Promise<NextResponse> {
  const authorization = request.headers.get('authorization');

  if (!env.CRON_SECRET) {
    // Refusing is the safe answer: an unprotected drain is an endpoint anyone
    // can use to make the application send mail.
    return NextResponse.json(
      { error: 'CRON_SECRET is not configured, so the drain is closed.' },
      { status: 503 },
    );
  }

  if (authorization !== `Bearer ${env.CRON_SECRET}`) {
    return NextResponse.json({ error: 'Not authorised.' }, { status: 401 });
  }

  const now = new Date();

  const due = await db
    .select()
    .from(job)
    .where(and(eq(job.status, 'pending'), lte(job.runAfter, now)))
    .orderBy(job.runAfter)
    .limit(BATCH);

  let ran = 0;
  let failed = 0;

  for (const item of due) {
    // Claim it, so two overlapping invocations do not run the same job twice.
    const claimed = await db
      .update(job)
      .set({ status: 'running', attempts: item.attempts + 1, updatedAt: new Date() })
      .where(and(eq(job.id, item.id), eq(job.status, 'pending')))
      .returning({ id: job.id });

    if (claimed.length === 0) continue;

    const handler = HANDLERS[item.kind];
    if (!handler) {
      await db
        .update(job)
        .set({
          status: 'failed',
          lastError: `No handler for job kind ${item.kind}.`,
          updatedAt: new Date(),
        })
        .where(eq(job.id, item.id));
      failed += 1;
      continue;
    }

    try {
      await handler(item.payload);
      await db
        .update(job)
        .set({ status: 'done', lastError: null, updatedAt: new Date() })
        .where(eq(job.id, item.id));
      ran += 1;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      const attempts = item.attempts + 1;
      const exhausted = attempts >= item.maxAttempts;

      await db
        .update(job)
        .set({
          status: exhausted ? 'failed' : 'pending',
          lastError: message,
          // Exponential backoff, so a failing dependency is not hammered.
          runAfter: new Date(Date.now() + Math.min(2 ** attempts, 60) * 60 * 1000),
          updatedAt: new Date(),
        })
        .where(eq(job.id, item.id));

      failed += 1;
      log.error('job failed', { jobId: item.id, kind: item.kind, attempts, error });
    }
  }

  // Housekeeping that has no natural trigger of its own.
  const [prunedLimits, warnings] = await Promise.all([
    pruneRateLimits(new Date(Date.now() - 24 * 60 * 60 * 1000)),
    sendDeadlineWarnings(),
  ]);

  const [remaining] = await db
    .select({ n: sql<number>`count(*)::int` })
    .from(job)
    .where(eq(job.status, 'pending'));

  return NextResponse.json({
    ran,
    failed,
    pending: remaining?.n ?? 0,
    prunedRateLimits: prunedLimits,
    deadlineWarningsSent: warnings,
  });
}
