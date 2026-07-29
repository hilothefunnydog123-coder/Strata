'use server';

import { revalidatePath } from 'next/cache';
import { eq } from 'drizzle-orm';
import { audit } from '@/lib/audit';
import { assertPlatform, requirePrincipalOrThrow } from '@/lib/auth/guards';
import { db } from '@/lib/db';
import { job } from '@/lib/db/schema';

/**
 * Put a failed job back in the queue.
 *
 * The attempt counter resets, because an operator retrying after fixing the
 * cause is starting again rather than continuing. The previous error is left in
 * place until the next run overwrites it, so the history of what went wrong is
 * still readable while the job is pending.
 */
export async function retryJob(jobId: string): Promise<{ ok: boolean }> {
  const principal = await requirePrincipalOrThrow();
  assertPlatform(principal, 'admin:jobs');

  await db
    .update(job)
    .set({ status: 'pending', attempts: 0, runAfter: new Date(), updatedAt: new Date() })
    .where(eq(job.id, jobId));

  await audit({
    userId: principal.userId,
    organizationId: null,
    action: 'update',
    entityType: 'job',
    entityId: jobId,
  });

  revalidatePath('/admin/jobs');
  return { ok: true };
}
