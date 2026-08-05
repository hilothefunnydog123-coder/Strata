/**
 * How an appeal actually reaches the payer.
 *
 * The product drafted a letter, two people signed it, and then someone
 * downloaded a PDF and did the rest by hand at the most time sensitive moment
 * in the whole process. This is that step.
 *
 * The channels are not interchangeable and the differences are not cosmetic.
 * What separates them is what can be proven afterwards, which is the only thing
 * that matters when a payer says a filing never arrived or arrived late:
 *
 *   certified_mail  a receipt establishing the filing date. The strongest
 *                   evidence available, and the reason it stays in the list
 *                   long after the machine channels work.
 *   esmd            CMS's own electronic submission route, which returns an
 *                   acknowledgement tied to the claim.
 *   clearinghouse   X12 through a clearinghouse, acknowledged by the payer.
 *   fax             a transmission report, which is weaker than a receipt and
 *                   still the thing many plans expect.
 *   email           a message with the letter attached, to an appeals address
 *                   the plan publishes. Proves sending, not delivery.
 *   payer_portal    an upload to the plan's own website.
 *
 * On that last one. Many payer portal terms of service prohibit automated
 * access, and the realistic consequence of being caught is not a warning but
 * the hospital's portal account being closed, which breaks their entire revenue
 * cycle rather than merely this product. So it is declared here, it is not
 * implemented, and it will not be implemented by inference from a ticket that
 * says "automate filing". It needs somebody to decide that, in writing, per
 * payer.
 */
import { emailConfigured } from '@/lib/email/send';
import type { SubmissionChannel } from './types';

export interface ChannelRequirement {
  /** What an operator has to arrange before this can be switched on. */
  needs: string;
  /** Whether it is arranged, checked at call time rather than at import. */
  configured: () => boolean;
}

export interface ChannelDefinition {
  key: SubmissionChannel;
  label: string;
  /** One line, shown next to the option when a specialist picks a channel. */
  summary: string;
  /** What the hospital can prove afterwards, which is why they would pick it. */
  evidence: string;
  /**
   * Ordering in the picker. Lower is offered first.
   *
   * Ordered by how much the hospital can prove, not by how modern the channel
   * is. Certified mail is unglamorous and beats every other option in front of
   * an adjudicator deciding whether a deadline was met.
   */
  rank: number;
  requirement: ChannelRequirement;
}

/**
 * Whether a channel can be used right now, and what to say if not.
 *
 * Deliberately returns the reason rather than a boolean. A specialist who
 * cannot see why an option is greyed out will file it another way and never
 * mention it, and the operator will never learn the integration was never
 * switched on.
 */
export interface ChannelAvailability {
  channel: ChannelDefinition;
  available: boolean;
  reason: string | null;
}

/** Set once the corresponding integration is actually wired to a provider. */
const notYetIntegrated = (needs: string): ChannelRequirement => ({
  needs,
  configured: () => false,
});

export const CHANNELS: readonly ChannelDefinition[] = [
  {
    key: 'certified_mail',
    label: 'Certified mail',
    summary: 'Printed and posted with tracking and a return receipt.',
    evidence: 'A receipt establishing the filing date. The strongest proof of timely filing.',
    rank: 1,
    requirement: notYetIntegrated(
      'An account with a print and mail provider, and the return address for each hospital.',
    ),
  },
  {
    key: 'esmd',
    label: 'CMS esMD',
    summary: "Electronic submission through CMS's own gateway.",
    evidence: 'An acknowledgement from CMS tied to the claim.',
    rank: 2,
    requirement: notYetIntegrated(
      'esMD enrolment through a CMS approved network service vendor, and a submitter ID.',
    ),
  },
  {
    key: 'clearinghouse',
    label: 'Clearinghouse',
    summary: 'X12 attachment submitted through a clearinghouse to the payer.',
    evidence: 'A payer acknowledgement, usually within a day.',
    rank: 3,
    requirement: notYetIntegrated(
      'A clearinghouse account with attachment submission enabled, and payer enrolment per plan.',
    ),
  },
  {
    key: 'fax',
    label: 'Fax',
    summary: 'Sent to the appeals fax number the plan publishes.',
    evidence: 'A transmission report. Weaker than a receipt, and what many plans still expect.',
    rank: 4,
    requirement: notYetIntegrated('A fax provider account.'),
  },
  {
    key: 'email',
    label: 'Email',
    summary: 'Sent to the appeals address the plan publishes, with the letter attached.',
    evidence: 'Proof that it was sent, not that it was delivered or read.',
    rank: 5,
    // The one channel this product can already do, because it already sends
    // mail. Checked at call time: an environment without a key must offer this
    // greyed out with a reason rather than fail once someone clicks it.
    requirement: {
      needs: 'RESEND_API_KEY and EMAIL_FROM, which this deployment already uses for its own mail.',
      configured: () => emailConfigured(),
    },
  },
  {
    key: 'payer_portal',
    label: 'Payer portal',
    summary: 'Uploaded to the plan’s own website.',
    evidence: 'A confirmation number from the portal.',
    rank: 6,
    requirement: {
      needs:
        'A written decision, per payer, that automated access is permitted. Many portal terms ' +
        'of service prohibit it, and an account closed for breaching them takes the hospital’s ' +
        'whole revenue cycle with it, not just this product.',
      configured: () => false,
    },
  },
];

export function channelByKey(key: string): ChannelDefinition | null {
  return CHANNELS.find((c) => c.key === key) ?? null;
}

/**
 * Every channel, in the order to offer them, each saying whether it can be used.
 *
 * Unavailable channels are returned rather than filtered out, with the reason
 * attached. Hiding them makes the product look like it only ever supported one
 * way of filing, and gives a hospital no way to ask for the one they want.
 */
export function channelAvailability(): ChannelAvailability[] {
  return [...CHANNELS]
    .sort((a, b) => a.rank - b.rank)
    .map((channel) => {
      const available = channel.requirement.configured();
      return {
        channel,
        available,
        reason: available ? null : channel.requirement.needs,
      };
    });
}

/** The channels a specialist can actually pick right now. */
export function availableChannels(): ChannelDefinition[] {
  return channelAvailability()
    .filter((c) => c.available)
    .map((c) => c.channel);
}
