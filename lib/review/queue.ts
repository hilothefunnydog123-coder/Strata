/**
 * The review queue.
 *
 * Reviewers see only the organisations they are assigned to, ordered by appeal
 * deadline, because the case due on Friday is the one that matters and no other
 * ordering is defensible when the queue is long.
 */
import { and, asc, eq, inArray, sql } from 'drizzle-orm';
import { db } from '@/lib/db';
import {
  appealDraft,
  assertionReview,
  clinicalFact,
  denial,
  denialSpan,
  holding,
  organization,
  reviewAction,
  sourceSpan,
} from '@/lib/db/schema';

export interface QueueItem {
  draftId: string;
  denialId: string;
  internalRef: string;
  organizationName: string;
  payerName: string;
  serviceType: string;
  claimAmountCents: number;
  appealDeadline: Date | null;
  status: string;
  version: number;
  assertionCount: number;
  gapCount: number;
  clinicalApproved: boolean;
  legalApproved: boolean;
}

/**
 * Drafts awaiting review, for the organisations this reviewer is assigned to.
 *
 * A superadmin sees everything, which is the one place the scoping opens up,
 * and it opens up because the operator is the person who fixes a stuck queue.
 */
export async function reviewQueue(
  organizationIds: readonly string[],
  reviewType: 'clinical' | 'legal',
  seeAll: boolean,
): Promise<QueueItem[]> {
  if (!seeAll && organizationIds.length === 0) return [];

  // A clinical reviewer works cases at clinical_review. A legal reviewer works
  // cases at legal_review. Neither sees the other's queue, which is not about
  // secrecy but about not being able to approve out of order.
  const stage = reviewType === 'clinical' ? 'clinical_review' : 'legal_review';

  const conditions = [
    eq(appealDraft.status, 'ready'),
    eq(denial.status, stage as 'clinical_review'),
  ];
  if (!seeAll) {
    conditions.push(inArray(denial.organizationId, [...organizationIds]));
  }

  const rows = await db
    .select({
      draftId: appealDraft.id,
      denialId: denial.id,
      internalRef: denial.internalRef,
      organizationName: organization.name,
      payerName: denial.payerName,
      serviceType: denial.serviceType,
      claimAmountCents: denial.claimAmountCents,
      appealDeadline: denial.appealDeadline,
      status: denial.status,
      version: appealDraft.version,
      gaps: appealDraft.documentationGaps,
      assertionCount: sql<number>`(
        select count(*)::int from assertion a where a.appeal_draft_id = ${appealDraft.id}
      )`,
      clinicalApproved: sql<boolean>`exists (
        select 1 from review_action ra
        where ra.appeal_draft_id = ${appealDraft.id}
          and ra.review_type = 'clinical' and ra.action = 'approved'
      )`,
      legalApproved: sql<boolean>`exists (
        select 1 from review_action ra
        where ra.appeal_draft_id = ${appealDraft.id}
          and ra.review_type = 'legal' and ra.action = 'approved'
      )`,
    })
    .from(appealDraft)
    .innerJoin(denial, eq(appealDraft.denialId, denial.id))
    .innerJoin(organization, eq(denial.organizationId, organization.id))
    .where(and(...conditions))
    // Soonest deadline first, nulls last. Written as one fragment because
    // wrapping a "nulls last" fragment in asc() emits "... nulls last asc",
    // which Postgres rejects.
    .orderBy(sql`${denial.appealDeadline} asc nulls last`);

  return rows.map((r) => ({
    draftId: r.draftId,
    denialId: r.denialId,
    internalRef: r.internalRef,
    organizationName: r.organizationName,
    payerName: r.payerName,
    serviceType: r.serviceType,
    claimAmountCents: r.claimAmountCents,
    appealDeadline: r.appealDeadline,
    status: r.status,
    version: r.version,
    assertionCount: r.assertionCount,
    gapCount: r.gaps.length,
    clinicalApproved: r.clinicalApproved,
    legalApproved: r.legalApproved,
  }));
}

/** A reviewer's own per-assertion marks on one draft. */
export async function marksFor(
  draftId: string,
  reviewerId: string,
): Promise<Record<string, { verified: boolean; notes: string | null }>> {
  const rows = await db
    .select({
      assertionId: assertionReview.assertionId,
      verified: assertionReview.verified,
      notes: assertionReview.notes,
    })
    .from(assertionReview)
    .innerJoin(
      // Scope to this draft's assertions.
      sql`assertion`,
      sql`assertion.id = ${assertionReview.assertionId}`,
    )
    .where(
      and(
        eq(assertionReview.reviewerId, reviewerId),
        sql`assertion.appeal_draft_id = ${draftId}`,
      ),
    );

  const marks: Record<string, { verified: boolean; notes: string | null }> = {};
  for (const row of rows) {
    marks[row.assertionId] = { verified: row.verified, notes: row.notes };
  }
  return marks;
}

/** Prior verdicts on a draft, so a reviewer can see why it came back. */
export async function reviewHistory(draftId: string) {
  return db
    .select()
    .from(reviewAction)
    .where(eq(reviewAction.appealDraftId, draftId))
    .orderBy(asc(reviewAction.createdAt));
}

/**
 * The text of whatever source an assertion cites.
 *
 * Used when re-verifying an edited assertion. Returns null when the source has
 * gone, which the caller treats as a refusal rather than a pass.
 */
export async function resolveSourceText(
  kind: 'holding' | 'source_span' | 'clinical_fact',
  id: string,
): Promise<string | null> {
  if (kind === 'holding') {
    const [row] = await db
      .select({ text: sourceSpan.text })
      .from(holding)
      .innerJoin(sourceSpan, eq(holding.spanId, sourceSpan.id))
      .where(eq(holding.id, id))
      .limit(1);
    return row?.text ?? null;
  }

  if (kind === 'source_span') {
    const [row] = await db
      .select({ text: sourceSpan.text })
      .from(sourceSpan)
      .where(eq(sourceSpan.id, id))
      .limit(1);
    return row?.text ?? null;
  }

  const [row] = await db
    .select({ text: denialSpan.text })
    .from(clinicalFact)
    .innerJoin(denialSpan, eq(clinicalFact.spanId, denialSpan.id))
    .where(eq(clinicalFact.id, id))
    .limit(1);
  return row?.text ?? null;
}
