import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import Link from 'next/link';
import { audit } from '@/lib/audit';
import { assertCanOrForbid, requirePrincipal } from '@/lib/auth/guards';
import { can } from '@/lib/auth/roles';
import { loadDenialDetail } from '@/lib/denials/detail';
import { hasBothApprovals } from '@/lib/appeals/workflow';
import {
  DENIAL_BASIS_LABELS,
  PLAN_TYPE_LABELS,
  SERVICE_TYPE_LABELS,
} from '@/lib/denials/upload';
import { daysUntil, STATUS_LABELS, type Status } from '@/lib/appeals/workflow';
import { LetterView } from '@/components/appeal/letter-view';
import { EmptyState, Money, PanelHeader, Tag } from '@/components/ui/primitives';
import { filingStatus } from '@/lib/filing/status';
import { GenerateButton } from './generate-button';
import { OutcomeForm } from './outcome-form';
import { SubmitForm } from './submit-form';
import { ExportButtons } from './export-buttons';
import { AppealProgress } from './appeal-progress';
import { FileAppealButton } from './file-appeal-button';
import { filingOptions } from './filing-actions';

export const metadata: Metadata = { title: 'Denial' };

export default async function DenialDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const principal = await requirePrincipal();
  const { id } = await params;

  const detail = await loadDenialDetail(id);
  if (!detail) notFound();

  assertCanOrForbid(principal, detail.denial.organizationId, 'denial:read');

  // Compliance requirement 3: reading a clinical record leaves a row.
  await audit({
    userId: principal.userId,
    organizationId: detail.denial.organizationId,
    action: 'read',
    entityType: 'denial',
    entityId: id,
  });

  const orgRole =
    principal.memberships.find((m) => m.organizationId === detail.denial.organizationId)
      ?.role ?? null;
  const mayGenerate = can(principal.platformRole, orgRole, 'draft:generate');
  const mayExport = can(principal.platformRole, orgRole, 'draft:export');
  const mayRecordOutcome = can(principal.platformRole, orgRole, 'outcome:record');

  const status = detail.denial.status as Status;
  const days = daysUntil(detail.denial.appealDeadline);
  const approvals = detail.draft
    ? await hasBothApprovals(detail.draft.id)
    : { clinical: false, legal: false, both: false };

  const filing = await filingStatus(
    id,
    detail.denial.planType,
    detail.denial.appealDeadline,
  );

  // Resolved on the server so the button can name the channel and the address
  // before it is pressed. A filing control that only discovers where it is
  // sending after the click is one that files to a stale address for a year.
  const filingPrompt = mayExport && detail.draft ? await filingOptions(id) : null;

  // The outcome form appears once the appeal has actually been filed, or once
  // an outcome exists, so a specialist cannot record a result for something
  // that never went out.
  const canRecordOutcome =
    mayRecordOutcome &&
    (detail.outcome !== null ||
      (['submitted', 'decided', 'invoiced'] as Status[]).includes(status));

  return (
    <div className="grid gap-px bg-rule xl:grid-cols-[280px_1fr]">
      {/* Case metadata and timeline */}
      <aside className="bg-paper-2">
        <PanelHeader title="Case" />
        <dl className="divide-y divide-rule text-sm">
          <Row label="Reference">
            <span className="id">{detail.denial.internalRef}</span>
          </Row>
          <Row label="Payer">{detail.denial.payerName}</Row>
          <Row label="Plan">{PLAN_TYPE_LABELS[detail.denial.planType]}</Row>
          <Row label="Service">{SERVICE_TYPE_LABELS[detail.denial.serviceType]}</Row>
          <Row label="Amount denied">
            <Money cents={detail.denial.claimAmountCents} tone="denied" />
          </Row>
          {detail.denial.denialBasis ? (
            <Row label="Basis">{DENIAL_BASIS_LABELS[detail.denial.denialBasis]}</Row>
          ) : null}
          <Row label="Stage">
            <Tag tone={status === 'approved' ? 'recovered' : 'neutral'}>
              {STATUS_LABELS[status]}
            </Tag>
          </Row>
          <Row label="Appeal due">
            {detail.denial.appealDeadline ? (
              <span className={days !== null && days <= 7 ? 'text-denied' : ''}>
                <span className="id">
                  {detail.denial.appealDeadline.toISOString().slice(0, 10)}
                </span>
                {days !== null ? (
                  <span className="ml-1.5 text-xs">
                    {days < 0
                      ? `${Math.abs(days)} days ago`
                      : days === 0
                        ? 'today'
                        : `in ${days} days`}
                  </span>
                ) : null}
              </span>
            ) : (
              <span className="text-ink-2">not set</span>
            )}
          </Row>
          {detail.denial.isSynthetic ? (
            <Row label="Data">
              <Tag tone="denied">Synthetic</Tag>
            </Row>
          ) : null}
        </dl>

        <AppealProgress status={filing} />

        <PanelHeader title="Documents" className="mt-0" />
        <ul className="divide-y divide-rule text-sm">
          {detail.documents.map((doc) => (
            <li key={doc.id} className="px-3 py-2">
              <p className="id text-xs">{doc.filename}</p>
              <p className="mt-0.5 text-xs text-ink-2">
                {doc.kind.replace(/_/g, ' ')}
                {doc.parsedAt ? ', parsed' : ', not parsed'}
              </p>
              {doc.textSource === 'ocr' ? (
                // Said here as well as in the review workspace, because this is
                // the page where someone decides whether the case is worth
                // pursuing, and a scanned source changes that judgement.
                <p className="mt-1 text-xs font-medium text-denied">
                  Read by OCR at {doc.ocrConfidence}% confidence. Quotes from this document
                  are a machine reading of an image and must be checked against the scan.
                </p>
              ) : null}
            </li>
          ))}
          {detail.documents.length === 0 ? (
            <li className="px-3 py-2 text-xs text-ink-2">No documents uploaded.</li>
          ) : null}
        </ul>

        {detail.draftHistory.length > 1 ? (
          <>
            <PanelHeader title="Versions" />
            <ul className="divide-y divide-rule text-sm">
              {detail.draftHistory.map((d) => (
                <li key={d.id} className="flex justify-between px-3 py-1.5 text-xs">
                  <span className="id">v{d.version}</span>
                  <span className="text-ink-2">
                    {d.generatedAt.toISOString().slice(0, 10)}
                  </span>
                  <span className="text-ink-2">{d.status}</span>
                </li>
              ))}
            </ul>
          </>
        ) : null}

        <PanelHeader title="Timeline" />
        <ul className="divide-y divide-rule">
          {detail.timeline.slice(0, 12).map((entry) => (
            <li key={entry.id} className="px-3 py-1.5 text-xs">
              <span className="font-medium">{entry.action}</span>
              <span className="id ml-2 text-ink-2">
                {entry.createdAt.toISOString().slice(0, 16).replace('T', ' ')}
              </span>
            </li>
          ))}
          {detail.timeline.length === 0 ? (
            <li className="px-3 py-2 text-xs text-ink-2">Nothing recorded yet.</li>
          ) : null}
        </ul>
      </aside>

      {/* Letter and source */}
      <div className="bg-paper-2">
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-rule bg-paper px-3 py-2">
          <div className="flex items-center gap-3">
            <Link href="/app/denials" className="text-xs">
              Back to denials
            </Link>
            {detail.draft ? (
              <span className="text-xs text-ink-2">
                Clinical {approvals.clinical ? 'approved' : 'pending'}, legal{' '}
                {approvals.legal ? 'approved' : 'pending'}
              </span>
            ) : null}
          </div>
          <div className="flex items-center gap-2">
            {mayGenerate && status !== 'invoiced' ? (
              <GenerateButton
                denialId={id}
                hasDraft={Boolean(detail.draft)}
                ready={status === 'ready_for_generation' || Boolean(detail.draft)}
              />
            ) : null}
            {mayExport && detail.draft ? (
              <ExportButtons
                denialId={id}
                draftId={detail.draft.id}
                enabled={approvals.both}
              />
            ) : null}
            {filingPrompt && detail.draft ? (
              <FileAppealButton
                denialId={id}
                draftId={detail.draft.id}
                enabled={approvals.both}
                initial={filingPrompt}
              />
            ) : null}
          </div>
        </div>

        {status === 'approved' && mayExport ? <SubmitForm denialId={id} /> : null}

        {canRecordOutcome ? (
          <div className="border-b border-rule p-4">
            <OutcomeForm
              denialId={id}
              existing={
                detail.outcome
                  ? {
                      result: detail.outcome.result,
                      decidedAt: detail.outcome.decidedAt.toISOString().slice(0, 10),
                      amountRecoveredCents: detail.outcome.amountRecoveredCents,
                      invoiced: detail.outcome.invoiceId !== null,
                    }
                  : null
              }
            />
          </div>
        ) : null}

        {detail.draft && detail.assertions.length > 0 ? (
          <LetterView
            assertions={detail.assertions}
            sources={detail.sources}
            gaps={detail.draft.documentationGaps}
            proprietaryFlag={detail.draft.proprietaryCriteriaFlag}
            version={detail.draft.version}
          />
        ) : (
          <EmptyState
            title={
              status === 'intake' || status === 'parsing'
                ? 'This case is still being read'
                : 'No appeal drafted yet'
            }
            body={
              status === 'intake' || status === 'parsing'
                ? 'The uploaded documents are being parsed into passages. Reload in a moment.'
                : mayGenerate
                  ? 'Generate the appeal and every assertion in it will be checked against the source it cites before it reaches you.'
                  : 'An appeal specialist at your organisation can generate the appeal.'
            }
          />
        )}
      </div>
    </div>
  );
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex items-baseline justify-between gap-3 px-3 py-1.5">
      <dt className="text-xs text-ink-2">{label}</dt>
      <dd className="text-right">{children}</dd>
    </div>
  );
}
