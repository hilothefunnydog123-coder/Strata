'use server';

/**
 * Filing an approved appeal from the screen it was approved on.
 *
 * The old flow was: export a PDF, go and send it yourself through whatever the
 * payer takes, come back, and tell us you did. That put a manual step at the
 * most time sensitive moment in the process and left the system unable to say
 * whether it had actually happened.
 *
 * The letter filed is rendered by the same path the export uses, deliberately.
 * Two renderers would eventually disagree, and the day they did, the document a
 * hospital had reviewed would not be the document that reached the payer.
 */
import { revalidatePath } from 'next/cache';
import { and, eq } from 'drizzle-orm';
import { audit } from '@/lib/audit';
import { assertCan, requirePrincipalOrThrow } from '@/lib/auth/guards';
import { db } from '@/lib/db';
import { appeal, denial, payerContact } from '@/lib/db/schema';
import { ladderFor, levelAt } from '@/lib/appeals/levels';
import { fileAppeal } from '@/lib/filing/file-appeal';
import { filingPrompt, setDefaultChannel } from '@/lib/filing/preference';
import { channelByKey } from '@/lib/filing/channels';
import type { SubmissionChannel } from '@/lib/filing/types';
import { log } from '@/lib/log';
import { exportAppeal } from './actions';

export interface FilingOption {
  key: string;
  label: string;
  summary: string;
  evidence: string;
  available: boolean;
  reason: string | null;
}

export type FilingPromptState =
  | { status: 'ready'; channel: string; label: string; destination: string | null }
  | {
      status: 'choose';
      options: FilingOption[];
      /** Set when a saved choice has stopped working, so the screen says why. */
      lapsed: { label: string; reason: string } | null;
      destination: string | null;
    }
  | { status: 'error'; message: string };

/** What to show when someone presses File appeal. */
export async function filingOptions(denialId: string): Promise<FilingPromptState> {
  const principal = await requirePrincipalOrThrow();

  const record = await db.query.denial.findFirst({ where: eq(denial.id, denialId) });
  if (!record) return { status: 'error', message: 'That denial does not exist.' };

  assertCan(principal, record.organizationId, 'draft:export');

  const prompt = await filingPrompt(record.organizationId);

  const known = async (channel: SubmissionChannel) =>
    (
      await db.query.payerContact.findFirst({
        where: and(
          eq(payerContact.organizationId, record.organizationId),
          eq(payerContact.payerName, record.payerName),
          eq(payerContact.channel, channel),
        ),
      })
    )?.destination ?? null;

  if (prompt.kind === 'ready') {
    return {
      status: 'ready',
      channel: prompt.channel,
      label: prompt.label,
      destination: await known(prompt.channel),
    };
  }

  return {
    status: 'choose',
    options: prompt.options.map((o) => ({
      key: o.channel.key,
      label: o.channel.label,
      summary: o.channel.summary,
      evidence: o.channel.evidence,
      available: o.available,
      reason: o.reason,
    })),
    lapsed: prompt.lapsed ? { label: prompt.lapsed.label, reason: prompt.lapsed.reason } : null,
    destination: null,
  };
}

export type FileResult =
  | { status: 'ok'; message: string }
  | { status: 'error'; message: string };

/**
 * File it.
 *
 * Every check the export path makes is made again here rather than inherited,
 * because exporting a letter and sending one to a payer are different acts and
 * a filing route that trusted the caller would be one refactor away from
 * sending an unapproved letter.
 */
export async function fileNow(input: {
  denialId: string;
  draftId: string;
  channel: SubmissionChannel;
  destination: string;
  /** Tick to stop being asked which channel every time. */
  remember: boolean;
}): Promise<FileResult> {
  const principal = await requirePrincipalOrThrow();

  const record = await db.query.denial.findFirst({ where: eq(denial.id, input.denialId) });
  if (!record) return { status: 'error', message: 'That denial does not exist.' };

  assertCan(principal, record.organizationId, 'draft:export');

  const definition = channelByKey(input.channel);
  if (!definition) return { status: 'error', message: 'That is not a filing channel.' };

  const destination = input.destination.trim();
  if (destination.length === 0) {
    return {
      status: 'error',
      message: `Enter where this payer takes appeals by ${definition.label.toLowerCase()}.`,
    };
  }

  // Render through the export path, so the filed letter is the reviewed letter.
  const rendered = await exportAppeal(input.denialId, input.draftId, 'pdf');
  if (rendered.status !== 'ok') {
    return { status: 'error', message: rendered.message };
  }

  // The rung being filed. Level one of whichever ladder this payer sits on,
  // created here because this is the first moment anything is filed at all.
  const ladder = ladderFor(record.planType);
  if (!ladder) {
    return {
      status: 'error',
      message:
        `This product models the Medicare appeal process, and ${record.payerName} is a ` +
        `${record.planType.replace(/_/g, ' ')} plan whose process it does not model. Filing ` +
        'it here would attach a Medicare deadline to a claim that does not have one.',
    };
  }

  const level = levelAt(ladder, 1)!;

  const existing = await db.query.appeal.findFirst({
    where: and(eq(appeal.denialId, input.denialId), eq(appeal.levelOrdinal, 1)),
  });

  const rung =
    existing ??
    (
      await db
        .insert(appeal)
        .values({
          denialId: input.denialId,
          level: level.key as 'redetermination',
          levelOrdinal: 1,
          appealDraftId: input.draftId,
          dueBy: record.appealDeadline,
        })
        .returning()
    )[0]!;

  const result = await fileAppeal({
    denialId: input.denialId,
    appealDraftId: input.draftId,
    appealId: rung.id,
    channel: input.channel,
    filedByUserId: principal.userId,
    packet: {
      claimReference: record.internalRef,
      payerName: record.payerName,
      destination,
      subject: `Appeal of claim ${record.internalRef}, ${record.payerName}`,
      body:
        `Please find attached an appeal of the denial of claim ${record.internalRef}.\n\n` +
        'The appeal and its supporting authority are set out in the attached letter.',
      document: {
        filename: rendered.filename,
        bytes: Buffer.from(rendered.base64, 'base64'),
        contentType: rendered.contentType,
      },
    },
  });

  if (!result.ok) {
    // Recorded as a failed submission by fileAppeal, so the attempt is visible
    // rather than lost. The specialist sees why and can try another channel.
    return { status: 'error', message: result.reason };
  }

  // Remember where this payer takes appeals, so nobody types it twice.
  await db
    .insert(payerContact)
    .values({
      organizationId: record.organizationId,
      payerName: record.payerName,
      channel: input.channel,
      destination,
    })
    .onConflictDoUpdate({
      target: [payerContact.organizationId, payerContact.payerName, payerContact.channel],
      set: { destination },
    });

  if (input.remember) {
    const saved = await setDefaultChannel(record.organizationId, input.channel);
    // A refusal here must not undo a filing that has already gone.
    if (!saved.ok) log.warn('could not save the default filing channel', { reason: saved.reason });
  }

  await audit({
    userId: principal.userId,
    organizationId: record.organizationId,
    action: 'file',
    entityType: 'appeal_draft',
    entityId: input.draftId,
  });

  revalidatePath(`/app/denials/${input.denialId}`);

  return {
    status: 'ok',
    message: `Filed by ${definition.label.toLowerCase()}. ${result.detail}`,
  };
}
