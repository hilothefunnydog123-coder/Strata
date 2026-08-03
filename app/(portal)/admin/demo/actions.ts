'use server';

import { revalidatePath } from 'next/cache';
import { audit } from '@/lib/audit';
import { assertPlatform, requirePrincipalOrThrow } from '@/lib/auth/guards';
import { seedDemo, type SeedResult } from '@/lib/demo/seed';
import { env } from '@/lib/env';
import { log } from '@/lib/log';

export type SeedState =
  | { status: 'idle' }
  | { status: 'ok'; result: SeedResult }
  | { status: 'error'; message: string };

/**
 * Create the demonstration data from the console.
 *
 * Two gates, and the second is the one that matters. Only a superadmin may call
 * this, and it refuses outright in PHI_MODE=live. Writing invented patients
 * into a deployment approved for real records would be a data integrity
 * incident, not a convenience, so the mode check is not a warning that can be
 * clicked through: there is no parameter that overrides it.
 */
export async function createDemoData(reset: boolean): Promise<SeedState> {
  const principal = await requirePrincipalOrThrow();
  assertPlatform(principal, 'admin:organizations');

  if (env.phiLive) {
    return {
      status: 'error',
      message:
        'This deployment runs in live PHI mode, so demonstration data cannot be ' +
        'created here. Invented patients do not belong in a system approved for ' +
        'real records.',
    };
  }

  try {
    const result = await seedDemo({ reset });

    await audit({
      userId: principal.userId,
      organizationId: null,
      action: 'create',
      entityType: 'organization',
      entityId: 'demo-northgate',
    });

    revalidatePath('/admin/demo');
    revalidatePath('/admin/organizations');
    return { status: 'ok', result };
  } catch (error) {
    log.error('could not create the demonstration data', { error });
    const message = error instanceof Error ? error.message : String(error);
    return { status: 'error', message };
  }
}
