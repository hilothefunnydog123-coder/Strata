/**
 * Erasing an organisation's data.
 *
 * Compliance requirement 6. A customer can ask for complete deletion at any
 * time and this is what runs.
 *
 * Two decisions worth explaining to a reviewer:
 *
 * The cascade is declared in the schema rather than written out here. Every
 * dependent table carries `onDelete: 'cascade'` against `organization`, so
 * deleting the organisation row removes everything beneath it. A hand-written
 * list of deletes in this file would drift the first time somebody adds a table
 * and forgets, and the failure mode of that drift is silent: rows survive an
 * erasure nobody re-checks.
 *
 * The evidence survives the data. Counts are taken before anything is deleted
 * and stored on `deletion_request`, along with who asked and when. After the
 * rows are gone there is still a record that they were, and how many there
 * were, which is what a customer or a regulator actually needs. The audit row
 * about the erasure survives too, by design.
 */
import { count, eq } from 'drizzle-orm';
import { audit } from '@/lib/audit';
import { db } from '@/lib/db';
import {
  appealDraft,
  assertion,
  assertionReview,
  clinicalFact,
  deletionRequest,
  denial,
  denialDocument,
  denialSpan,
  invoice,
  member,
  organization,
  outcome,
  reviewAction,
  reviewerAssignment,
  submission,
} from '@/lib/db/schema';
import { log } from '@/lib/log';
import { organizationPrefix, storage } from '@/lib/storage';

export interface DeletionResult {
  requestId: string;
  organizationName: string;
  deletedCounts: Record<string, number>;
  documentsDeleted: number;
}

export class OrganizationNotFoundError extends Error {
  constructor(organizationId: string) {
    super(`No organisation with id ${organizationId}. Nothing was deleted.`);
    this.name = 'OrganizationNotFoundError';
  }
}

/** Count what is about to go, so the erasure can be evidenced afterwards. */
async function countBeforeDeletion(organizationId: string): Promise<Record<string, number>> {
  const denials = await db
    .select({ id: denial.id })
    .from(denial)
    .where(eq(denial.organizationId, organizationId));
  const denialIds = denials.map((d) => d.id);

  const counts: Record<string, number> = {
    denial: denialIds.length,
    denial_document: 0,
    denial_span: 0,
    clinical_fact: 0,
    appeal_draft: 0,
    assertion: 0,
    assertion_review: 0,
    review_action: 0,
    submission: 0,
    outcome: 0,
  };

  for (const denialId of denialIds) {
    const documents = await db
      .select({ id: denialDocument.id })
      .from(denialDocument)
      .where(eq(denialDocument.denialId, denialId));
    counts.denial_document! += documents.length;

    for (const document of documents) {
      const [spans] = await db
        .select({ n: count() })
        .from(denialSpan)
        .where(eq(denialSpan.denialDocumentId, document.id));
      counts.denial_span! += spans?.n ?? 0;
    }

    const [facts] = await db
      .select({ n: count() })
      .from(clinicalFact)
      .where(eq(clinicalFact.denialId, denialId));
    counts.clinical_fact! += facts?.n ?? 0;

    const drafts = await db
      .select({ id: appealDraft.id })
      .from(appealDraft)
      .where(eq(appealDraft.denialId, denialId));
    counts.appeal_draft! += drafts.length;

    for (const draft of drafts) {
      const assertions = await db
        .select({ id: assertion.id })
        .from(assertion)
        .where(eq(assertion.appealDraftId, draft.id));
      counts.assertion! += assertions.length;

      for (const a of assertions) {
        const [reviews] = await db
          .select({ n: count() })
          .from(assertionReview)
          .where(eq(assertionReview.assertionId, a.id));
        counts.assertion_review! += reviews?.n ?? 0;
      }

      const [actions] = await db
        .select({ n: count() })
        .from(reviewAction)
        .where(eq(reviewAction.appealDraftId, draft.id));
      counts.review_action! += actions?.n ?? 0;

      const [submissions] = await db
        .select({ n: count() })
        .from(submission)
        .where(eq(submission.appealDraftId, draft.id));
      counts.submission! += submissions?.n ?? 0;
    }

    const [outcomes] = await db
      .select({ n: count() })
      .from(outcome)
      .where(eq(outcome.denialId, denialId));
    counts.outcome! += outcomes?.n ?? 0;
  }

  const [invoices] = await db
    .select({ n: count() })
    .from(invoice)
    .where(eq(invoice.organizationId, organizationId));
  counts.invoice = invoices?.n ?? 0;

  const [members] = await db
    .select({ n: count() })
    .from(member)
    .where(eq(member.organizationId, organizationId));
  counts.member = members?.n ?? 0;

  const [assignments] = await db
    .select({ n: count() })
    .from(reviewerAssignment)
    .where(eq(reviewerAssignment.organizationId, organizationId));
  counts.reviewer_assignment = assignments?.n ?? 0;

  counts.organization = 1;

  return counts;
}

/**
 * Erase an organisation and everything belonging to it.
 *
 * Irreversible. The caller must have already established that the request is
 * genuine; this function does not ask twice.
 */
export async function deleteOrganizationData(input: {
  organizationId: string;
  requestedBy: string;
  reason?: string;
}): Promise<DeletionResult> {
  const org = await db.query.organization.findFirst({
    where: eq(organization.id, input.organizationId),
  });
  if (!org) throw new OrganizationNotFoundError(input.organizationId);

  const deletedCounts = await countBeforeDeletion(input.organizationId);

  // The record of the erasure is written before the erasure, so a failure
  // partway through still leaves evidence that it was attempted.
  const [request] = await db
    .insert(deletionRequest)
    .values({
      organizationId: org.id,
      organizationName: org.name,
      requestedBy: input.requestedBy,
      reason: input.reason ?? null,
      deletedCounts,
    })
    .returning({ id: deletionRequest.id });

  const requestId = request!.id;

  // Stored documents first. If the rows went first, the keys pointing at the
  // files would be gone and the files would be orphaned in object storage.
  let documentsDeleted = 0;
  try {
    documentsDeleted = await storage().deletePrefix(organizationPrefix(org.id));
  } catch (error) {
    log.error('could not delete stored documents during erasure', {
      organizationId: org.id,
      error,
    });
    throw new Error(
      'The stored documents could not be deleted, so the database rows were left in ' +
        'place rather than orphaning the files. Nothing was erased. Fix storage access ' +
        'and run this again.',
    );
  }

  // One delete. The cascades declared in the schema do the rest.
  await db.delete(organization).where(eq(organization.id, org.id));

  await db
    .update(deletionRequest)
    .set({ completedAt: new Date() })
    .where(eq(deletionRequest.id, requestId));

  await audit({
    userId: input.requestedBy,
    organizationId: org.id,
    action: 'erase',
    entityType: 'organization',
    entityId: org.id,
  });

  log.info('organisation data erased', {
    organizationId: org.id,
    documentsDeleted,
    rowsDeleted: Object.values(deletedCounts).reduce((a, b) => a + b, 0),
  });

  return {
    requestId,
    organizationName: org.name,
    deletedCounts,
    documentsDeleted,
  };
}

/** Past erasures, for the operator console and for answering a customer. */
export async function deletionHistory() {
  return db
    .select()
    .from(deletionRequest)
    .orderBy((t) => t.requestedAt);
}
