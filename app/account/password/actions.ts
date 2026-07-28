'use server';

import { eq } from 'drizzle-orm';
import { audit } from '@/lib/audit';
import { requirePrincipalOrThrow } from '@/lib/auth/guards';
import { db } from '@/lib/db';
import { user } from '@/lib/db/schema';

/**
 * Lift the forced password change flag.
 *
 * Called after better-auth has accepted the new password, so this action never
 * decides whether the change was legitimate; it only records that the operator
 * imposed condition is satisfied.
 */
export async function clearMustChangePassword(): Promise<void> {
  const principal = await requirePrincipalOrThrow();

  await db
    .update(user)
    .set({ mustChangePassword: false, updatedAt: new Date() })
    .where(eq(user.id, principal.userId));

  await audit({
    userId: principal.userId,
    organizationId: null,
    action: 'update',
    entityType: 'user',
    entityId: principal.userId,
  });
}
