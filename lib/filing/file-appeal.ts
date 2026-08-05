/**
 * Filing an approved appeal, and recording enough to prove it happened.
 *
 * The order here is deliberate and is the whole design. A submission row and
 * its first event are written before anything is sent, so a filing that dies
 * halfway leaves a record saying it was attempted rather than no trace at all.
 * The alternative, sending first and recording after, loses exactly the cases
 * worth knowing about: the ones that failed.
 */
import { eq } from 'drizzle-orm';
import { db } from '@/lib/db';
import { appeal, submission, submissionEvent } from '@/lib/db/schema';
import { log } from '@/lib/log';
import { canExport } from '@/lib/appeals/workflow';
import { channelByKey } from './channels';
import { emailAdapter } from './adapters/email';
import type { FilingChannelAdapter, FilingPacket, SubmissionChannel } from './types';

/** Only channels with a working adapter. The rest are declared, not built. */
const ADAPTERS: Partial<Record<SubmissionChannel, FilingChannelAdapter>> = {
  email: emailAdapter,
};

export type FileAppealResult =
  | { ok: true; submissionId: string; externalRef: string | null; detail: string }
  | { ok: false; submissionId: string | null; reason: string; retryable: boolean };

export interface FileAppealInput {
  denialId: string;
  appealDraftId: string;
  /** The ladder rung being filed. Created by the caller when the level opens. */
  appealId: string;
  channel: SubmissionChannel;
  packet: FilingPacket;
  /** Null when the system filed it rather than a person. */
  filedByUserId: string | null;
}

async function record(submissionId: string, kind: string, detail: string): Promise<void> {
  await db.insert(submissionEvent).values({ submissionId, kind, detail });
}

export async function fileAppeal(input: FileAppealInput): Promise<FileAppealResult> {
  // Both reviewers first, before anything is written or sent.
  //
  // The same gate the export path uses, asked again here rather than assumed
  // from it. Exporting a letter and filing one are different acts, and a filing
  // route that trusted the caller to have checked would be one refactor away
  // from sending an unapproved letter to a payer.
  const allowed = await canExport(input.denialId, input.appealDraftId);
  if (!allowed.ok) {
    return { ok: false, submissionId: null, reason: allowed.reason, retryable: false };
  }

  const definition = channelByKey(input.channel);
  if (!definition) {
    return {
      ok: false,
      submissionId: null,
      reason: `${input.channel} is not a filing channel this product knows about.`,
      retryable: false,
    };
  }

  if (!definition.requirement.configured()) {
    return {
      ok: false,
      submissionId: null,
      reason: `${definition.label} is not set up on this deployment. ${definition.requirement.needs}`,
      retryable: false,
    };
  }

  const adapter = ADAPTERS[input.channel];
  if (!adapter) {
    // Configured but unimplemented would be a programming error rather than a
    // deployment one, so it says which.
    return {
      ok: false,
      submissionId: null,
      reason: `${definition.label} reports itself as set up but has no adapter. This is a bug.`,
      retryable: false,
    };
  }

  // Written before the send, so an attempt that dies mid-flight is still on the
  // record. A filing nobody can see is worse than one that failed visibly.
  const [row] = await db
    .insert(submission)
    .values({
      appealDraftId: input.appealDraftId,
      appealId: input.appealId,
      channel: input.channel,
      status: 'sending',
      method: definition.label,
      submittedBy: input.filedByUserId,
    })
    .returning();

  const submissionId = row!.id;
  await record(submissionId, 'prepared', `Filing by ${definition.label} to ${input.packet.destination}.`);

  let result;
  try {
    result = await adapter.send(input.packet);
  } catch (error) {
    // An adapter that throws is a bug in the adapter, and the filing still has
    // to end up in a state a person can act on rather than stuck at "sending".
    const detail = error instanceof Error ? error.message : String(error);
    await db
      .update(submission)
      .set({ status: 'failed', failureReason: detail })
      .where(eq(submission.id, submissionId));
    await record(submissionId, 'failed', detail);
    log.error('filing adapter threw', { submissionId, channel: input.channel, error });
    return { ok: false, submissionId, reason: detail, retryable: true };
  }

  if (result.status === 'failed') {
    await db
      .update(submission)
      .set({ status: 'failed', failureReason: result.detail })
      .where(eq(submission.id, submissionId));
    await record(submissionId, 'failed', result.detail);
    return { ok: false, submissionId, reason: result.detail, retryable: result.retryable };
  }

  const sentAt = new Date();

  await db
    .update(submission)
    .set({
      status: 'sent',
      submittedAt: sentAt,
      trackingRef: result.externalRef,
      lastCheckedAt: sentAt,
    })
    .where(eq(submission.id, submissionId));

  await record(submissionId, 'sent', result.detail);

  // The rung is filed. This is the timestamp the next deadline counts from if
  // the payer decides against us, so it belongs on the appeal and not only on
  // the submission that happened to carry it.
  await db.update(appeal).set({ filedAt: sentAt }).where(eq(appeal.id, input.appealId));

  return {
    ok: true,
    submissionId,
    externalRef: result.externalRef,
    detail: result.detail,
  };
}
