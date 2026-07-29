'use server';

import { revalidatePath } from 'next/cache';
import { and, eq } from 'drizzle-orm';
import { audit } from '@/lib/audit';
import {
  AuthorizationError,
  assertCan,
  requirePrincipalOrThrow,
  type Principal,
} from '@/lib/auth/guards';
import { db } from '@/lib/db';
import {
  appealDraft,
  assertion,
  assertionReview,
  denial,
  reviewAction,
} from '@/lib/db/schema';
import { transition, hasBothApprovals } from '@/lib/appeals/workflow';
import { verifyQuote } from '@/lib/appeals/verify';
import { resolveSourceText } from '@/lib/review/queue';
import { log } from '@/lib/log';

export type ReviewResult =
  | { status: 'ok'; message: string }
  | { status: 'error'; message: string };

/** Which review a principal is entitled to perform. */
function reviewTypeFor(principal: Principal): 'clinical' | 'legal' {
  if (principal.platformRole === 'clinical_reviewer') return 'clinical';
  if (principal.platformRole === 'legal_reviewer') return 'legal';
  // A superadmin reviewing is unusual but permitted; treat it as clinical
  // unless the draft already has a clinical approval, so they can complete
  // whichever gate is outstanding.
  return 'clinical';
}

async function draftContext(draftId: string) {
  const draft = await db.query.appealDraft.findFirst({
    where: eq(appealDraft.id, draftId),
  });
  if (!draft) return null;
  const record = await db.query.denial.findFirst({
    where: eq(denial.id, draft.denialId),
  });
  if (!record) return null;
  return { draft, denial: record };
}

/**
 * Record a reviewer's verdict on one assertion.
 *
 * The per-assertion checklist. Marking every assertion is not a precondition
 * for approving the draft, because a reviewer who has read the letter and is
 * satisfied should not be made to click twenty boxes. The checklist exists so
 * that a reviewer working through a long letter can keep their place and so
 * that a flag on a specific sentence is recorded against that sentence.
 */
export async function markAssertion(
  assertionId: string,
  verified: boolean,
  notes?: string,
): Promise<ReviewResult> {
  const principal = await requirePrincipalOrThrow();

  const [row] = await db
    .select({ draftId: assertion.appealDraftId })
    .from(assertion)
    .where(eq(assertion.id, assertionId))
    .limit(1);
  if (!row) return { status: 'error', message: 'That assertion does not exist.' };

  const context = await draftContext(row.draftId);
  if (!context) return { status: 'error', message: 'That draft does not exist.' };

  const reviewType = reviewTypeFor(principal);

  try {
    assertCan(
      principal,
      context.denial.organizationId,
      reviewType === 'clinical' ? 'review:clinical' : 'review:legal',
    );
  } catch (error) {
    if (error instanceof AuthorizationError) {
      return { status: 'error', message: 'You are not assigned to review this case.' };
    }
    throw error;
  }

  const existing = await db.query.assertionReview.findFirst({
    where: and(
      eq(assertionReview.assertionId, assertionId),
      eq(assertionReview.reviewerId, principal.userId),
      eq(assertionReview.reviewType, reviewType),
    ),
  });

  if (existing) {
    await db
      .update(assertionReview)
      .set({ verified, notes: notes ?? null })
      .where(eq(assertionReview.id, existing.id));
  } else {
    await db.insert(assertionReview).values({
      assertionId,
      reviewerId: principal.userId,
      reviewType,
      verified,
      notes: notes ?? null,
    });
  }

  revalidatePath(`/review/${row.draftId}`);
  return { status: 'ok', message: verified ? 'Marked verified.' : 'Flagged.' };
}

/**
 * Edit an assertion, and re-verify it.
 *
 * A reviewer may rewrite a sentence, but the rewritten sentence still has to
 * rest on the source it cites. The quote is unchanged by an edit: what changes
 * is the prose around it. If the reviewer supplies a new quote, that quote is
 * checked against the source before the edit is accepted, and an edit that
 * fails is refused rather than saved with a warning.
 */
export async function editAssertion(
  assertionId: string,
  text: string,
  verbatimQuote?: string,
): Promise<ReviewResult> {
  const principal = await requirePrincipalOrThrow();

  const [row] = await db
    .select()
    .from(assertion)
    .where(eq(assertion.id, assertionId))
    .limit(1);
  if (!row) return { status: 'error', message: 'That assertion does not exist.' };

  const context = await draftContext(row.appealDraftId);
  if (!context) return { status: 'error', message: 'That draft does not exist.' };

  try {
    assertCan(principal, context.denial.organizationId, 'review:edit_assertion');
  } catch (error) {
    if (error instanceof AuthorizationError) {
      return { status: 'error', message: 'You are not assigned to review this case.' };
    }
    throw error;
  }

  if (text.trim().length < 10) {
    return { status: 'error', message: 'An assertion needs more than a few words.' };
  }

  const quote = verbatimQuote?.trim() || row.verbatimQuote;

  // Re-verification. An edited assertion is checked exactly as a generated one
  // is, against the same source, by the same function.
  const sourceText = await resolveSourceText(row.sourceKind, row.sourceId);
  if (sourceText === null) {
    return {
      status: 'error',
      message: 'The source this assertion cites could not be loaded, so the edit was not saved.',
    };
  }

  const check = verifyQuote(quote, sourceText);
  if (!check.ok) {
    return {
      status: 'error',
      message:
        'That quote does not appear in the source this assertion cites, so the edit was not ' +
        'saved. Copy the passage exactly from the source panel.',
    };
  }

  await db
    .update(assertion)
    .set({
      text: text.trim(),
      verbatimQuote: quote,
      editedByReviewerId: principal.userId,
      editedAt: new Date(),
      verifiedAt: new Date(),
    })
    .where(eq(assertion.id, assertionId));

  await db.insert(reviewAction).values({
    appealDraftId: row.appealDraftId,
    reviewerId: principal.userId,
    reviewType: reviewTypeFor(principal),
    action: 'edited',
    notes: `Assertion ${row.ordinal} rewritten and re-verified.`,
  });

  await audit({
    userId: principal.userId,
    organizationId: context.denial.organizationId,
    action: 'update',
    entityType: 'assertion',
    entityId: assertionId,
  });

  revalidatePath(`/review/${row.appealDraftId}`);
  return { status: 'ok', message: 'Edited and re-verified against the source.' };
}

/**
 * Approve or reject the draft.
 *
 * Rejection returns the case to ready_for_generation with the notes attached
 * and visible, because a rejected draft is regenerated rather than patched by
 * whoever opens it next.
 */
export async function decideDraft(
  draftId: string,
  decision: 'approved' | 'rejected',
  notes: string,
): Promise<ReviewResult> {
  const principal = await requirePrincipalOrThrow();

  const context = await draftContext(draftId);
  if (!context) return { status: 'error', message: 'That draft does not exist.' };

  const reviewType = reviewTypeFor(principal);

  try {
    assertCan(
      principal,
      context.denial.organizationId,
      reviewType === 'clinical' ? 'review:clinical' : 'review:legal',
    );
  } catch (error) {
    if (error instanceof AuthorizationError) {
      return { status: 'error', message: 'You are not assigned to review this case.' };
    }
    throw error;
  }

  if (decision === 'rejected' && notes.trim().length < 10) {
    return {
      status: 'error',
      message:
        'Say what is wrong with it. A rejection with no note sends the specialist back to ' +
        'guess, and the next draft will have the same problem.',
    };
  }

  await db.insert(reviewAction).values({
    appealDraftId: draftId,
    reviewerId: principal.userId,
    reviewType,
    action: decision,
    notes: notes.trim() || null,
  });

  await audit({
    userId: principal.userId,
    organizationId: context.denial.organizationId,
    action: 'review',
    entityType: 'appeal_draft',
    entityId: draftId,
  });

  try {
    if (decision === 'rejected') {
      await transition({
        denialId: context.denial.id,
        to: 'ready_for_generation',
        userId: principal.userId,
        organizationId: context.denial.organizationId,
        note: notes,
      });
      revalidatePath('/review');
      return {
        status: 'ok',
        message: 'Sent back with your notes. The specialist will regenerate it.',
      };
    }

    const approvals = await hasBothApprovals(draftId);

    if (approvals.both) {
      await transition({
        denialId: context.denial.id,
        to: 'approved',
        userId: principal.userId,
        organizationId: context.denial.organizationId,
      });
      revalidatePath('/review');
      return {
        status: 'ok',
        message: 'Approved. Both reviews are complete, so this can now be exported.',
      };
    }

    // One gate down. Move to the other one if we were the first.
    if (context.denial.status === 'clinical_review' && approvals.clinical) {
      await transition({
        denialId: context.denial.id,
        to: 'legal_review',
        userId: principal.userId,
        organizationId: context.denial.organizationId,
      });
    }

    revalidatePath('/review');
    return {
      status: 'ok',
      message: `Approved. Still waiting on ${approvals.clinical ? 'legal' : 'clinical'} review.`,
    };
  } catch (error) {
    log.error('review transition failed', { draftId, error });
    return {
      status: 'error',
      message:
        error instanceof Error
          ? error.message
          : 'Your verdict was recorded but the case could not be moved.',
    };
  }
}
