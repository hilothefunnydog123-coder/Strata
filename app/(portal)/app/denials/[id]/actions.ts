'use server';

import { revalidatePath } from 'next/cache';
import { eq } from 'drizzle-orm';
import { audit } from '@/lib/audit';
import { assertCan, requirePrincipalOrThrow } from '@/lib/auth/guards';
import { db } from '@/lib/db';
import { assertion, denial, organization } from '@/lib/db/schema';
import { generateAppeal, GenerationError, NoAuthorityError } from '@/lib/appeals/generate';
import { canExport } from '@/lib/appeals/workflow';
import { loadDenialDetail } from '@/lib/denials/detail';
import { buildCitations, groupIntoSections } from '@/lib/appeals/render';
import { toDocx, toPdf } from '@/lib/appeals/export';
import { formatCents } from '@/components/ui/primitives';
import { log } from '@/lib/log';

export type GenerateResult =
  | { status: 'ok'; assertionCount: number; gapCount: number; attempts: number }
  | { status: 'error'; message: string; detail?: string[] };

/**
 * Generate, or regenerate, the appeal for a denial.
 *
 * Everything about verification and regeneration lives in
 * lib/appeals/generate.ts. This action's job is authorisation, auditing, and
 * turning a failure into something a specialist can act on.
 */
export async function generate(denialId: string): Promise<GenerateResult> {
  const principal = await requirePrincipalOrThrow();

  const record = await db.query.denial.findFirst({ where: eq(denial.id, denialId) });
  if (!record) return { status: 'error', message: 'That denial does not exist.' };

  assertCan(principal, record.organizationId, 'draft:generate');

  await db
    .update(denial)
    .set({ status: 'generating', updatedAt: new Date() })
    .where(eq(denial.id, denialId));

  try {
    const result = await generateAppeal(denialId);

    await audit({
      userId: principal.userId,
      organizationId: record.organizationId,
      action: 'generate',
      entityType: 'appeal_draft',
      entityId: result.draftId,
    });

    revalidatePath(`/app/denials/${denialId}`);

    return {
      status: 'ok',
      assertionCount: result.assertionCount,
      gapCount: result.gaps.length,
      attempts: result.attempts,
    };
  } catch (error) {
    if (error instanceof NoAuthorityError) {
      // Not a failure of the model. The corpus has nothing covering this kind
      // of denial, so pressing the button again changes nothing.
      log.error('generation refused: no controlling authority in the corpus', {
        denialId,
        serviceType: error.serviceType,
        denialBasis: error.denialBasis,
      });
      return { status: 'error', message: error.message };
    }

    if (error instanceof GenerationError) {
      // Three consecutive failures. The operator console surfaces this, and the
      // right response is to look at the prompt rather than press the button
      // again.
      log.error('generation escalated after repeated verification failures', {
        denialId,
        attempts: error.attempts,
      });
      return {
        status: 'error',
        message: error.message,
        detail: error.lastFailures.slice(0, 10),
      };
    }

    log.error('generation failed', { denialId, error });
    return {
      status: 'error',
      message:
        error instanceof Error
          ? error.message
          : 'Generation failed. Nothing was saved.',
    };
  }
}

export type ExportFormat = 'docx' | 'pdf';

export type ExportResult =
  | { status: 'ok'; filename: string; contentType: string; base64: string }
  | { status: 'error'; message: string };

/**
 * Export an approved appeal.
 *
 * The approval gate is checked here, on the server, against canExport(). The
 * buttons in the interface are disabled without both approvals, but that is a
 * courtesy; this is the control.
 */
export async function exportAppeal(
  denialId: string,
  draftId: string,
  format: ExportFormat,
): Promise<ExportResult> {
  const principal = await requirePrincipalOrThrow();

  const record = await db.query.denial.findFirst({ where: eq(denial.id, denialId) });
  if (!record) return { status: 'error', message: 'That denial does not exist.' };

  assertCan(principal, record.organizationId, 'draft:export');

  const permitted = await canExport(denialId, draftId);
  if (!permitted.ok) return { status: 'error', message: permitted.reason };

  const detail = await loadDenialDetail(denialId);
  if (!detail?.draft) {
    return { status: 'error', message: 'There is no draft to export.' };
  }

  const org = await db.query.organization.findFirst({
    where: eq(organization.id, record.organizationId),
  });

  const renderable = detail.assertions.map((a) => ({
    id: a.id,
    ordinal: a.ordinal,
    section: a.section,
    kind: a.kind,
    text: a.text,
    sourceKind: a.sourceKind,
    sourceId: a.sourceId,
    verbatimQuote: a.verbatimQuote,
  }));

  const describe = (kind: (typeof renderable)[number]['sourceKind'], id: string) => {
    const source = detail.sources[`${kind}:${id}`];
    return {
      label: source?.label ?? 'Source',
      detail: source?.detail ?? '',
      url: source?.url ?? null,
    };
  };

  const letter = {
    header: {
      organizationName: org?.name ?? 'Provider',
      payerName: record.payerName,
      internalRef: record.internalRef,
      serviceType: record.serviceType,
      serviceDates: formatRange(record.serviceDateFrom, record.serviceDateTo),
      claimAmount: formatCents(record.claimAmountCents),
      appealDeadline: record.appealDeadline
        ? record.appealDeadline.toISOString().slice(0, 10)
        : null,
      today: new Date().toISOString().slice(0, 10),
    },
    sections: groupIntoSections(renderable),
    citations: buildCitations(renderable, describe),
  };

  const bytes = format === 'docx' ? await toDocx(letter) : await toPdf(letter);

  await audit({
    userId: principal.userId,
    organizationId: record.organizationId,
    action: 'export',
    entityType: 'appeal_draft',
    entityId: draftId,
  });

  return {
    status: 'ok',
    filename: `appeal-${record.internalRef}-v${detail.draft.version}.${format}`,
    contentType:
      format === 'docx'
        ? 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
        : 'application/pdf',
    base64: bytes.toString('base64'),
  };
}

function formatRange(from: Date | null, to: Date | null): string {
  if (!from && !to) return 'not stated';
  const iso = (d: Date) => d.toISOString().slice(0, 10);
  if (from && to) return `${iso(from)} to ${iso(to)}`;
  return iso((from ?? to)!);
}

export { assertion };
