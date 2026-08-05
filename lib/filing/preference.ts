/**
 * Asking once, then never again.
 *
 * A specialist filing their fiftieth appeal of the week should press one
 * button. A specialist filing their first should be asked how, once, and be
 * offered the chance to stop being asked. Both of those are the same setting
 * seen from different ends.
 *
 * Stored on the organisation rather than the user, deliberately. Filing is a
 * departmental habit with a paper trail behind it, not a personal taste, and
 * two specialists at one hospital filing the same plan through different
 * channels is how a deadline gets missed by nobody in particular.
 */
import { eq } from 'drizzle-orm';
import { db } from '@/lib/db';
import { organization } from '@/lib/db/schema';
import { channelAvailability, channelByKey } from './channels';
import type { ChannelAvailability } from './channels';
import type { SubmissionChannel } from './types';

export type FilingPrompt =
  | {
      /** Their usual channel is set and usable: file straight away. */
      kind: 'ready';
      channel: SubmissionChannel;
      label: string;
    }
  | {
      /** No preference yet, or it can no longer be used. Offer the choice. */
      kind: 'choose';
      options: ChannelAvailability[];
      /**
       * Set when they did have a preference and it has stopped working, so the
       * screen can say why they are being asked again instead of appearing to
       * have forgotten.
       */
      lapsed: { channel: SubmissionChannel; label: string; reason: string } | null;
    };

/**
 * What to show when someone presses File appeal.
 *
 * A preference that has stopped being usable is treated as no preference, and
 * says so. Silently falling back to another channel would file an appeal
 * somewhere the hospital did not choose, and silently failing would strand it.
 */
export async function filingPrompt(organizationId: string): Promise<FilingPrompt> {
  const org = await db.query.organization.findFirst({
    where: eq(organization.id, organizationId),
  });

  const options = channelAvailability();
  const preferred = org?.defaultFilingChannel ?? null;

  if (!preferred) return { kind: 'choose', options, lapsed: null };

  const entry = options.find((o) => o.channel.key === preferred);

  if (entry?.available) {
    return { kind: 'ready', channel: preferred, label: entry.channel.label };
  }

  return {
    kind: 'choose',
    options,
    lapsed: {
      channel: preferred,
      label: entry?.channel.label ?? preferred,
      reason:
        entry?.reason ??
        'That channel is no longer offered by this product, so it cannot be used.',
    },
  };
}

/**
 * Remember a choice, or forget one.
 *
 * Refuses a channel that cannot currently be used. Saving one would make every
 * future filing take two clicks again while appearing to have been configured,
 * which is the most annoying possible outcome and the hardest to diagnose.
 */
export async function setDefaultChannel(
  organizationId: string,
  channel: SubmissionChannel | null,
): Promise<{ ok: true } | { ok: false; reason: string }> {
  if (channel !== null) {
    const definition = channelByKey(channel);
    if (!definition) {
      return { ok: false, reason: `${channel} is not a filing channel this product knows about.` };
    }
    if (!definition.requirement.configured()) {
      return {
        ok: false,
        reason:
          `${definition.label} is not set up on this deployment, so it cannot be made the ` +
          `default. ${definition.requirement.needs}`,
      };
    }
  }

  await db
    .update(organization)
    .set({ defaultFilingChannel: channel })
    .where(eq(organization.id, organizationId));

  return { ok: true };
}
