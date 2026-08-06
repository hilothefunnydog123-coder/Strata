'use server';

import { revalidatePath } from 'next/cache';
import { eq } from 'drizzle-orm';
import { z } from 'zod';
import { audit } from '@/lib/audit';
import { assertCan, requirePrincipalOrThrow } from '@/lib/auth/guards';
import { db } from '@/lib/db';
import { denial, outcome } from '@/lib/db/schema';
import { closeCurrentRung } from '@/lib/appeals/rungs';
import { transition } from '@/lib/appeals/workflow';
import { denialDocumentKey, storage } from '@/lib/storage';
import { assertReadable } from '@/lib/denials/upload';
import { log } from '@/lib/log';

export type OutcomeState =
  | { status: 'idle' }
  | { status: 'ok'; message: string }
  | { status: 'error'; message: string; fieldErrors: Record<string, string> };

const dollarsToCents = z
  .string()
  .trim()
  .transform((value, ctx) => {
    const cleaned = value.replace(/[$,\s]/g, '');
    if (cleaned.length === 0) return 0;
    if (!/^\d+(\.\d{1,2})?$/.test(cleaned)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'Enter an amount like 18420.00, with no currency symbol.',
      });
      return z.NEVER;
    }
    const [whole, fraction = ''] = cleaned.split('.');
    return Number(whole) * 100 + Number(fraction.padEnd(2, '0'));
  });

const outcomeSchema = z
  .object({
    result: z.enum(['won', 'lost', 'partial', 'withdrawn']),
    decidedAt: z
      .string()
      .trim()
      .min(1, 'When was it decided?')
      .transform((v) => new Date(v))
      .refine((d) => !Number.isNaN(d.getTime()), 'That is not a date.'),
    amountRecoveredCents: dollarsToCents,
  })
  .refine(
    (data) =>
      data.result === 'lost' || data.result === 'withdrawn'
        ? data.amountRecoveredCents === 0
        : true,
    {
      message:
        'A lost or withdrawn appeal recovered nothing. If money did come back, this is a partial.',
      path: ['amountRecoveredCents'],
    },
  )
  .refine(
    (data) =>
      data.result === 'won' || data.result === 'partial'
        ? data.amountRecoveredCents > 0
        : true,
    {
      message:
        'Enter what actually came back. An overturned appeal that recovered nothing is a partial with zero, and worth a note to us.',
      path: ['amountRecoveredCents'],
    },
  );

/**
 * Record what happened to an appeal.
 *
 * This is the billing system: the invoice is computed from these rows, so the
 * amount entered here is the amount the contingency fee is charged on. That is
 * why the evidence upload matters and why the validation refuses combinations
 * that would not reconcile against a remittance advice.
 */
export async function recordOutcome(
  _previous: OutcomeState,
  formData: FormData,
): Promise<OutcomeState> {
  const principal = await requirePrincipalOrThrow();
  const denialId = String(formData.get('denialId') ?? '');

  const record = await db.query.denial.findFirst({ where: eq(denial.id, denialId) });
  if (!record) {
    return { status: 'error', message: 'That denial does not exist.', fieldErrors: {} };
  }

  assertCan(principal, record.organizationId, 'outcome:record');

  const parsed = outcomeSchema.safeParse({
    result: formData.get('result'),
    decidedAt: formData.get('decidedAt'),
    amountRecoveredCents: formData.get('amountRecovered') ?? '0',
  });

  if (!parsed.success) {
    const fieldErrors: Record<string, string> = {};
    for (const issue of parsed.error.issues) {
      const key = issue.path[0];
      if (typeof key === 'string' && !fieldErrors[key]) fieldErrors[key] = issue.message;
    }
    return {
      status: 'error',
      message: 'Some of this needs fixing before the outcome can be recorded.',
      fieldErrors,
    };
  }

  const input = parsed.data;

  // Remittance evidence, if supplied. Optional because a payer sometimes
  // notifies by phone and the paperwork follows.
  let evidenceKey: string | null = null;
  const evidence = formData.get('evidence');
  if (evidence instanceof File && evidence.size > 0) {
    try {
      assertReadable(evidence.type, evidence.size);
    } catch (error) {
      return {
        status: 'error',
        message: 'That evidence file cannot be read.',
        fieldErrors: {
          evidence: error instanceof Error ? error.message : 'Unsupported file.',
        },
      };
    }
    const bytes = Buffer.from(await evidence.arrayBuffer());
    evidenceKey = denialDocumentKey(
      record.organizationId,
      denialId,
      'outcome',
      evidence.name,
    );
    await storage().put(evidenceKey, bytes, evidence.type);
  }

  const existing = await db.query.outcome.findFirst({
    where: eq(outcome.denialId, denialId),
  });

  if (existing) {
    if (existing.invoiceId) {
      return {
        status: 'error',
        message:
          'This outcome has already been billed on an invoice, so it cannot be changed here. ' +
          'Tell us what needs correcting and we will issue a credit rather than rewrite history.',
        fieldErrors: {},
      };
    }
    await db
      .update(outcome)
      .set({
        result: input.result,
        decidedAt: input.decidedAt,
        amountRecoveredCents: input.amountRecoveredCents,
        ...(evidenceKey ? { evidenceDocKey: evidenceKey } : {}),
        recordedBy: principal.userId,
      })
      .where(eq(outcome.id, existing.id));
  } else {
    await db.insert(outcome).values({
      denialId,
      result: input.result,
      decidedAt: input.decidedAt,
      amountRecoveredCents: input.amountRecoveredCents,
      evidenceDocKey: evidenceKey,
      recordedBy: principal.userId,
    });
  }

  // The result also belongs on the level it decided. Without this the ladder
  // shows a level still open on a claim that has been decided and billed, and
  // the product would go on offering to escalate a case that is finished.
  await closeCurrentRung(denialId, input.result, input.decidedAt);

  await audit({
    userId: principal.userId,
    organizationId: record.organizationId,
    action: 'update',
    entityType: 'outcome',
    entityId: denialId,
  });

  try {
    await transition({
      denialId,
      to: 'decided',
      userId: principal.userId,
      organizationId: record.organizationId,
    });
  } catch (error) {
    // The outcome is recorded either way. A case that was not at "submitted"
    // cannot move to "decided", and saying so is more useful than refusing the
    // record of what happened.
    log.warn('outcome recorded but the case could not move to decided', {
      denialId,
      error,
    });
    revalidatePath(`/app/denials/${denialId}`);
    return {
      status: 'ok',
      message:
        'Outcome recorded. The case stage was left where it was, because it had not been ' +
        'marked as filed.',
    };
  }

  revalidatePath(`/app/denials/${denialId}`);
  revalidatePath('/app');
  return { status: 'ok', message: 'Outcome recorded.' };
}

/** Mark an approved appeal as filed with the payer. */
export async function markSubmitted(
  denialId: string,
  method: string,
  trackingRef: string,
): Promise<{ status: 'ok' } | { status: 'error'; message: string }> {
  const principal = await requirePrincipalOrThrow();

  const record = await db.query.denial.findFirst({ where: eq(denial.id, denialId) });
  if (!record) return { status: 'error', message: 'That denial does not exist.' };

  assertCan(principal, record.organizationId, 'draft:submit_for_review');

  const { submission, appealDraft } = await import('@/lib/db/schema');
  const draft = await db.query.appealDraft.findFirst({
    where: eq(appealDraft.denialId, denialId),
    orderBy: (t, { desc }) => [desc(t.version)],
  });
  if (!draft) return { status: 'error', message: 'There is no draft to file.' };

  await db.insert(submission).values({
    appealDraftId: draft.id,
    submittedAt: new Date(),
    submittedBy: principal.userId,
    method,
    trackingRef: trackingRef || null,
  });

  try {
    await transition({
      denialId,
      to: 'submitted',
      userId: principal.userId,
      organizationId: record.organizationId,
    });
  } catch (error) {
    return {
      status: 'error',
      message: error instanceof Error ? error.message : 'Could not mark it filed.',
    };
  }

  revalidatePath(`/app/denials/${denialId}`);
  return { status: 'ok' };
}
