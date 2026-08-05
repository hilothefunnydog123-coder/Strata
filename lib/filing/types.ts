/**
 * The shapes filing is described in, kept apart from the channels themselves so
 * a channel definition can be read without dragging in a database client.
 */

export type SubmissionChannel =
  | 'payer_portal'
  | 'clearinghouse'
  | 'esmd'
  | 'fax'
  | 'certified_mail'
  | 'email'
  | 'other';

/** The letter, and everything a channel needs to send it somewhere. */
export interface FilingPacket {
  /** The hospital's own reference, so a payer can match it to the claim. */
  claimReference: string;
  payerName: string;
  /** Where this is going, in whatever form the channel needs it. */
  destination: string;
  subject: string;
  /** The letter as text, for channels that carry text. */
  body: string;
  /** The letter as a document, for channels that carry a file. */
  document: { filename: string; bytes: Buffer; contentType: string };
}

/**
 * What happened when a channel tried to send.
 *
 * Returned rather than thrown for the same reason the mailer returns: a filing
 * that fails has to be recorded, shown, and retried by another channel before a
 * deadline, and an exception thrown into a server action loses all of that.
 */
export type FilingResult =
  | {
      status: 'sent';
      /** Confirmation number, tracking number, or provider id. */
      externalRef: string | null;
      detail: string;
    }
  | {
      status: 'failed';
      detail: string;
      /** True when trying the same channel again could plausibly work. */
      retryable: boolean;
    };

export interface FilingChannelAdapter {
  key: SubmissionChannel;
  send(packet: FilingPacket): Promise<FilingResult>;
}
