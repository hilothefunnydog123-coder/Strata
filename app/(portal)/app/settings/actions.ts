'use server';

/**
 * Changing how this hospital files, after the first time it was asked.
 *
 * The same guard as filing itself, deliberately. Anyone who can file can change
 * how filing happens, because the alternative is a specialist who ticked "file
 * this way from now on" during their first filing and then cannot untick it
 * without an administrator. That gap would not protect anything: the setting is
 * already reachable from the filing panel by anyone who can file.
 */
import { revalidatePath } from 'next/cache';
import { audit } from '@/lib/audit';
import { assertCan, requirePrincipalOrThrow } from '@/lib/auth/guards';
import { setDefaultChannel } from '@/lib/filing/preference';
import type { SubmissionChannel } from '@/lib/filing/types';

export type SaveChannelResult =
  | { status: 'ok'; message: string }
  | { status: 'error'; message: string };

export async function saveDefaultChannel(
  organizationId: string,
  channel: SubmissionChannel | null,
): Promise<SaveChannelResult> {
  const principal = await requirePrincipalOrThrow();
  assertCan(principal, organizationId, 'draft:export');

  const saved = await setDefaultChannel(organizationId, channel);
  if (!saved.ok) return { status: 'error', message: saved.reason };

  await audit({
    userId: principal.userId,
    organizationId,
    action: 'update',
    entityType: 'organization',
    entityId: organizationId,
  });

  revalidatePath('/app/settings');

  return {
    status: 'ok',
    message: channel
      ? 'Saved. Appeals will file this way without asking.'
      : 'Saved. You will be asked how to file each time.',
  };
}
