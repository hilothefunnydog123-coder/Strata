'use server';

import { revalidatePath } from 'next/cache';
import { eq } from 'drizzle-orm';
import { audit } from '@/lib/audit';
import { assertPlatform, requirePrincipalOrThrow } from '@/lib/auth/guards';
import { db } from '@/lib/db';
import { demoRequest } from '@/lib/db/schema';

export async function setDemoRequestStatus(
  id: string,
  status: string,
): Promise<{ ok: boolean }> {
  const principal = await requirePrincipalOrThrow();
  assertPlatform(principal, 'admin:demo_requests');

  await db
    .update(demoRequest)
    .set({ status: status as 'new' })
    .where(eq(demoRequest.id, id));

  await audit({
    userId: principal.userId,
    organizationId: null,
    action: 'update',
    entityType: 'demo_request',
    entityId: id,
  });

  revalidatePath('/admin/demo-requests');
  return { ok: true };
}
