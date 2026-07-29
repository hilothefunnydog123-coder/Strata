/**
 * The workflow state machine.
 *
 *   intake -> parsing -> ready_for_generation -> generating -> clinical_review
 *          -> legal_review -> approved -> submitted -> decided -> invoiced
 *
 * Transitions happen only through the server actions that call `transition()`,
 * and every one writes an audit row. The guards below are the whole point: a
 * state machine whose transitions can be skipped by setting a column is not a
 * state machine, it is a comment.
 *
 * The two rules the product depends on:
 *
 *   approved requires both a clinical and a legal ReviewAction with action =
 *   approved. Not one, not either, both.
 *
 *   Export is blocked before approved. Checked in the export action against
 *   `canExport()` below, not by hiding the button.
 */
import { and, eq } from 'drizzle-orm';
import { audit } from '@/lib/audit';
import { db } from '@/lib/db';
import { appealDraft, denial, outcome, reviewAction } from '@/lib/db/schema';

export const STATUSES = [
  'intake',
  'parsing',
  'ready_for_generation',
  'generating',
  'clinical_review',
  'legal_review',
  'approved',
  'submitted',
  'decided',
  'invoiced',
] as const;

export type Status = (typeof STATUSES)[number];

/**
 * Which transitions exist at all.
 *
 * Rejection at either review stage returns the case to ready_for_generation,
 * with the reviewer's notes attached, because a rejected draft is regenerated
 * rather than edited into shape by whoever is next to open it.
 */
const ALLOWED: Record<Status, Status[]> = {
  intake: ['parsing'],
  parsing: ['ready_for_generation', 'intake'],
  ready_for_generation: ['generating'],
  generating: ['clinical_review', 'ready_for_generation'],
  clinical_review: ['legal_review', 'ready_for_generation'],
  legal_review: ['approved', 'ready_for_generation'],
  approved: ['submitted', 'ready_for_generation'],
  submitted: ['decided'],
  decided: ['invoiced'],
  invoiced: [],
};

export const STATUS_LABELS: Record<Status, string> = {
  intake: 'Intake',
  parsing: 'Parsing',
  ready_for_generation: 'Ready to draft',
  generating: 'Drafting',
  clinical_review: 'Clinical review',
  legal_review: 'Legal review',
  approved: 'Approved',
  submitted: 'Filed',
  decided: 'Decided',
  invoiced: 'Invoiced',
};

export class TransitionError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'TransitionError';
  }
}

export function canTransition(from: Status, to: Status): boolean {
  return ALLOWED[from].includes(to);
}

/** Both reviews approved on the current draft. */
export async function hasBothApprovals(draftId: string): Promise<{
  clinical: boolean;
  legal: boolean;
  both: boolean;
}> {
  const actions = await db
    .select({ reviewType: reviewAction.reviewType, action: reviewAction.action })
    .from(reviewAction)
    .where(eq(reviewAction.appealDraftId, draftId));

  // The latest verdict of each type is what counts: a reviewer who rejects,
  // sees a regenerated draft, and then approves has approved.
  const latest = new Map<string, string>();
  for (const a of actions) latest.set(a.reviewType, a.action);

  const clinical = latest.get('clinical') === 'approved';
  const legal = latest.get('legal') === 'approved';
  return { clinical, legal, both: clinical && legal };
}

/**
 * Whether this draft may be exported.
 *
 * Called by the export action before it generates anything. Returns a reason
 * rather than a boolean, so the interface can say which approval is missing
 * instead of just refusing.
 */
export async function canExport(
  denialId: string,
  draftId: string,
): Promise<{ ok: true } | { ok: false; reason: string }> {
  const record = await db.query.denial.findFirst({ where: eq(denial.id, denialId) });
  if (!record) return { ok: false, reason: 'That denial does not exist.' };

  const draft = await db.query.appealDraft.findFirst({
    where: eq(appealDraft.id, draftId),
  });
  if (!draft) return { ok: false, reason: 'That draft does not exist.' };
  if (draft.denialId !== denialId) {
    return { ok: false, reason: 'That draft belongs to a different denial.' };
  }
  if (draft.status === 'superseded') {
    return {
      ok: false,
      reason: 'This draft has been superseded by a newer version. Export that one.',
    };
  }

  const approvals = await hasBothApprovals(draftId);
  if (!approvals.both) {
    const missing = [
      approvals.clinical ? null : 'clinical review',
      approvals.legal ? null : 'legal review',
    ].filter(Boolean);
    return {
      ok: false,
      reason: `This appeal still needs ${missing.join(' and ')} before it can be exported.`,
    };
  }

  const reached = (['approved', 'submitted', 'decided', 'invoiced'] as Status[]).includes(
    record.status as Status,
  );
  if (!reached) {
    return {
      ok: false,
      reason: `This appeal is at ${STATUS_LABELS[record.status as Status]}. Export opens once it is approved.`,
    };
  }

  return { ok: true };
}

export interface TransitionInput {
  denialId: string;
  to: Status;
  userId: string;
  organizationId: string;
  /** Carried into the audit row and, for rejections, shown to the specialist. */
  note?: string;
}

/**
 * Move a denial to a new state.
 *
 * Every guard that matters is enforced here rather than by the caller, so a new
 * action added later cannot skip one by forgetting to check.
 */
export async function transition(input: TransitionInput): Promise<void> {
  const record = await db.query.denial.findFirst({
    where: eq(denial.id, input.denialId),
  });
  if (!record) throw new TransitionError('That denial does not exist.');

  const from = record.status as Status;

  if (from === input.to) return;

  if (!canTransition(from, input.to)) {
    throw new TransitionError(
      `An appeal at ${STATUS_LABELS[from]} cannot move to ${STATUS_LABELS[input.to]}. ` +
        `From here it can go to: ${
          ALLOWED[from].map((s) => STATUS_LABELS[s]).join(', ') || 'nowhere, this is the end'
        }.`,
    );
  }

  // approved requires both reviews. This is the gate the product is sold on.
  if (input.to === 'approved') {
    const draft = await currentDraft(input.denialId);
    if (!draft) {
      throw new TransitionError('There is no draft to approve.');
    }
    const approvals = await hasBothApprovals(draft.id);
    if (!approvals.both) {
      const missing = [
        approvals.clinical ? null : 'clinical',
        approvals.legal ? null : 'legal',
      ].filter(Boolean);
      throw new TransitionError(
        `This appeal cannot be approved until both reviews have approved it. Still ` +
          `waiting on: ${missing.join(' and ')}.`,
      );
    }
  }

  // decided requires a recorded outcome, because the outcome is what the
  // invoice is computed from.
  if (input.to === 'decided') {
    const recorded = await db.query.outcome.findFirst({
      where: eq(outcome.denialId, input.denialId),
    });
    if (!recorded) {
      throw new TransitionError(
        'Record the outcome first. An appeal is not decided until we know what happened ' +
          'and how much came back.',
      );
    }
  }

  await db
    .update(denial)
    .set({ status: input.to, updatedAt: new Date() })
    .where(eq(denial.id, input.denialId));

  await audit({
    userId: input.userId,
    organizationId: input.organizationId,
    action: 'transition',
    entityType: 'denial',
    entityId: input.denialId,
  });
}

/** The draft currently in play for a denial, if there is one. */
export async function currentDraft(denialId: string) {
  return db.query.appealDraft.findFirst({
    where: and(eq(appealDraft.denialId, denialId), eq(appealDraft.status, 'ready')),
    orderBy: (t, { desc }) => [desc(t.version)],
  });
}

/** Days until the appeal deadline. Negative once it has passed. */
export function daysUntil(deadline: Date | null, now = new Date()): number | null {
  if (!deadline) return null;
  const ms = deadline.getTime() - now.getTime();
  return Math.ceil(ms / (1000 * 60 * 60 * 24));
}

/** A deadline inside seven days is shown in the denied colour. */
export function deadlineTone(days: number | null): 'neutral' | 'denied' {
  if (days === null) return 'neutral';
  return days <= 7 ? 'denied' : 'neutral';
}
