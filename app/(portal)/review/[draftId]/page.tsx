import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import Link from 'next/link';
import { eq } from 'drizzle-orm';
import { audit } from '@/lib/audit';
import { assertCanOrForbid, requirePrincipal } from '@/lib/auth/guards';
import { db } from '@/lib/db';
import { appealDraft } from '@/lib/db/schema';
import { loadDenialDetail } from '@/lib/denials/detail';
import { marksFor, reviewHistory } from '@/lib/review/queue';
import { daysUntil } from '@/lib/appeals/workflow';
import { Money, PanelHeader, Tag } from '@/components/ui/primitives';
import { ReviewWorkspace } from './workspace';

export const metadata: Metadata = { title: 'Review' };

export default async function ReviewDetailPage({
  params,
}: {
  params: Promise<{ draftId: string }>;
}) {
  const principal = await requirePrincipal();
  const { draftId } = await params;

  const draft = await db.query.appealDraft.findFirst({
    where: eq(appealDraft.id, draftId),
  });
  if (!draft) notFound();

  const detail = await loadDenialDetail(draft.denialId);
  if (!detail) notFound();

  const reviewType =
    principal.platformRole === 'legal_reviewer' ? 'legal' : 'clinical';

  assertCanOrForbid(
    principal,
    detail.denial.organizationId,
    reviewType === 'legal' ? 'review:legal' : 'review:clinical',
  );

  // Compliance requirement 3. A reviewer reading a clinical record is a read.
  await audit({
    userId: principal.userId,
    organizationId: detail.denial.organizationId,
    action: 'read',
    entityType: 'appeal_draft',
    entityId: draftId,
  });

  const [marks, history] = await Promise.all([
    marksFor(draftId, principal.userId),
    reviewHistory(draftId),
  ]);

  const days = daysUntil(detail.denial.appealDeadline);
  const rejections = history.filter((h) => h.action === 'rejected');

  return (
    <div>
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-rule bg-paper px-3 py-2">
        <div className="flex flex-wrap items-center gap-4">
          <Link href="/review" className="text-xs">
            Back to queue
          </Link>
          <span className="id text-sm font-medium">{detail.denial.internalRef}</span>
          <span className="text-xs text-ink-2">{detail.denial.payerName}</span>
          <Money cents={detail.denial.claimAmountCents} tone="denied" />
          {detail.denial.appealDeadline ? (
            <span className={`text-xs ${days !== null && days <= 7 ? 'text-denied' : 'text-ink-2'}`}>
              due {detail.denial.appealDeadline.toISOString().slice(0, 10)}
              {days !== null ? ` (${days}d)` : ''}
            </span>
          ) : null}
        </div>
        <Tag tone={reviewType === 'legal' ? 'action' : 'neutral'}>
          {reviewType === 'legal' ? 'Legal review' : 'Clinical review'}
        </Tag>
      </div>

      {rejections.length > 0 ? (
        <div className="border-b border-denied/40 bg-denied-wash px-3 py-2.5">
          <p className="text-xs font-semibold text-denied">
            This case was sent back before
          </p>
          <ul className="mt-1 space-y-1 text-xs text-ink">
            {rejections.map((r) => (
              <li key={r.id}>
                <span className="id">{r.createdAt.toISOString().slice(0, 10)}</span>
                <span className="ml-2 text-ink-2">{r.reviewType} review:</span>{' '}
                {r.notes ?? 'no note left'}
              </li>
            ))}
          </ul>
        </div>
      ) : null}

      {detail.assertions.length === 0 ? (
        <div className="px-6 py-12 text-center">
          <p className="text-sm font-semibold">There is nothing to review</p>
          <p className="mt-1 text-sm text-ink-2">
            This draft has no assertions, which should not happen: a draft that
            fails verification is discarded rather than saved. Tell the operator.
          </p>
        </div>
      ) : (
        <ReviewWorkspace
          draftId={draftId}
          reviewType={reviewType}
          assertions={detail.assertions}
          sources={detail.sources}
          gaps={draft.documentationGaps}
          proprietaryFlag={draft.proprietaryCriteriaFlag}
          version={draft.version}
          initialMarks={marks}
        />
      )}
    </div>
  );
}

export { PanelHeader };
