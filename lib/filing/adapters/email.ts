/**
 * Filing by email, to the appeals address a plan publishes.
 *
 * The weakest of the channels on evidence and the only one this product can do
 * today, because it already sends mail. It proves the letter was sent. It does
 * not prove it was delivered, opened, or accepted, and the option says so
 * where a specialist picks it rather than burying it here.
 *
 * That honesty is the point rather than a disclaimer. A hospital choosing this
 * for a filing three days before a deadline is taking a risk they should be
 * taking knowingly, and certified mail exists in the list above it for exactly
 * that case.
 */
import { send } from '@/lib/email/send';
import type { FilingChannelAdapter, FilingPacket, FilingResult } from '../types';

/** A plain address, which is all this can send to. */
function looksLikeAnAddress(destination: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(destination.trim());
}

export const emailAdapter: FilingChannelAdapter = {
  key: 'email',

  async send(packet: FilingPacket): Promise<FilingResult> {
    if (!looksLikeAnAddress(packet.destination)) {
      return {
        status: 'failed',
        // Not retryable: sending the same thing to the same non-address again
        // will fail the same way, and saying so stops a retry loop that looks
        // like the payer is at fault.
        retryable: false,
        detail:
          `"${packet.destination}" is not an email address, so this appeal has not been ` +
          'sent. Set the appeals address for this payer, or file it another way.',
      };
    }

    const result = await send({
      to: packet.destination.trim(),
      subject: packet.subject,
      text: packet.body,
    });

    if (result.status === 'sent') {
      return {
        status: 'sent',
        externalRef: result.providerId,
        detail: `Sent to ${packet.destination.trim()}.`,
      };
    }

    if (result.status === 'queued') {
      // The mailer could not reach its provider and has kept the message. That
      // is a real send in progress, not a filing, and calling it sent would put
      // a filing date in the record that nothing supports.
      return {
        status: 'failed',
        retryable: true,
        detail: `The mail provider was unreachable and the message is queued: ${result.reason}`,
      };
    }

    if (result.status === 'skipped_unsubscribed') {
      return {
        status: 'failed',
        retryable: false,
        detail:
          'That address has unsubscribed from mail from this system, so the appeal was not ' +
          'sent. An appeals address should not be on the marketing list; file it another way.',
      };
    }

    return {
      status: 'failed',
      retryable: true,
      detail: result.error,
    };
  },
};
