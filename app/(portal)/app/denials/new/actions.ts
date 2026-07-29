'use server';

import { redirect } from 'next/navigation';
import { audit } from '@/lib/audit';
import { assertCan, requirePrincipalOrThrow } from '@/lib/auth/guards';
import { db } from '@/lib/db';
import { denial, denialDocument } from '@/lib/db/schema';
import { log } from '@/lib/log';
import {
  assertReadable,
  assertUploadPermitted,
  denialIntakeSchema,
  syntheticTagRequired,
} from '@/lib/denials/upload';
import { parseDenial } from '@/lib/denials/parse';
import { denialDocumentKey, sha256, storage } from '@/lib/storage';

export type NewDenialState =
  | { status: 'idle' }
  | { status: 'error'; message: string; fieldErrors: Record<string, string> };

/**
 * Create a denial from the intake form.
 *
 * Order is deliberate: the synthetic tag is checked before anything is written,
 * the metadata is validated before any file is read, and the documents are
 * stored before the parse runs. A failure at any point leaves either nothing or
 * a case in intake, never a half-parsed case that looks ready.
 */
export async function createDenial(
  _previous: NewDenialState,
  formData: FormData,
): Promise<NewDenialState> {
  const principal = await requirePrincipalOrThrow();

  const organizationId = String(formData.get('organizationId') ?? '');
  assertCan(principal, organizationId, 'denial:create');

  const parsed = denialIntakeSchema.safeParse({
    internalRef: formData.get('internalRef'),
    payerName: formData.get('payerName'),
    planType: formData.get('planType'),
    serviceType: formData.get('serviceType'),
    denialReasonCode: formData.get('denialReasonCode') ?? undefined,
    claimAmountCents: formData.get('claimAmount'),
    serviceDateFrom: formData.get('serviceDateFrom') ?? undefined,
    serviceDateTo: formData.get('serviceDateTo') ?? undefined,
    appealDeadline: formData.get('appealDeadline') ?? undefined,
    isSynthetic: formData.get('isSynthetic') ?? undefined,
  });

  if (!parsed.success) {
    const fieldErrors: Record<string, string> = {};
    for (const issue of parsed.error.issues) {
      const key = issue.path[0];
      if (typeof key === 'string' && !fieldErrors[key]) fieldErrors[key] = issue.message;
    }
    return {
      status: 'error',
      message: 'Some of this needs fixing before the case can be created.',
      fieldErrors,
    };
  }

  const input = parsed.data;

  // Compliance requirement 4. Nothing is written until this passes.
  try {
    assertUploadPermitted(input.isSynthetic);
  } catch (error) {
    return {
      status: 'error',
      message: error instanceof Error ? error.message : 'This upload is not permitted.',
      fieldErrors: {
        isSynthetic: syntheticTagRequired()
          ? 'Confirm these documents are fabricated before uploading them.'
          : '',
      },
    };
  }

  const letter = formData.get('denialLetter');
  const record = formData.get('clinicalRecord');

  if (!(letter instanceof File) || letter.size === 0) {
    return {
      status: 'error',
      message: 'The denial letter is what everything else is built from.',
      fieldErrors: { denialLetter: 'Choose the denial letter to upload.' },
    };
  }

  const files: { kind: 'denial_letter' | 'clinical_record'; file: File }[] = [
    { kind: 'denial_letter', file: letter },
  ];
  if (record instanceof File && record.size > 0) {
    files.push({ kind: 'clinical_record', file: record });
  }

  for (const { kind, file } of files) {
    try {
      assertReadable(file.type, file.size);
    } catch (error) {
      return {
        status: 'error',
        message: 'One of those files cannot be read.',
        fieldErrors: {
          [kind === 'denial_letter' ? 'denialLetter' : 'clinicalRecord']:
            error instanceof Error ? error.message : 'That file cannot be read.',
        },
      };
    }
  }

  const existing = await db.query.denial.findFirst({
    where: (t, { and, eq }) =>
      and(eq(t.organizationId, organizationId), eq(t.internalRef, input.internalRef)),
  });
  if (existing) {
    return {
      status: 'error',
      message: 'That reference is already in use.',
      fieldErrors: {
        internalRef: `${input.internalRef} already exists. Use a different reference, or open the existing case.`,
      },
    };
  }

  const [created] = await db
    .insert(denial)
    .values({
      organizationId,
      internalRef: input.internalRef,
      payerName: input.payerName,
      planType: input.planType,
      serviceType: input.serviceType,
      denialReasonCode: input.denialReasonCode || null,
      claimAmountCents: input.claimAmountCents,
      serviceDateFrom: input.serviceDateFrom,
      serviceDateTo: input.serviceDateTo,
      appealDeadline: input.appealDeadline,
      status: 'parsing',
      isSynthetic: input.isSynthetic,
      createdBy: principal.userId,
    })
    .returning({ id: denial.id });

  const denialId = created!.id;

  await audit({
    userId: principal.userId,
    organizationId,
    action: 'create',
    entityType: 'denial',
    entityId: denialId,
  });

  for (const { kind, file } of files) {
    const bytes = Buffer.from(await file.arrayBuffer());
    const key = denialDocumentKey(organizationId, denialId, kind, file.name);
    await storage().put(key, bytes, file.type);

    await db.insert(denialDocument).values({
      denialId,
      kind,
      r2Key: key,
      filename: file.name,
      byteSize: bytes.byteLength,
      contentHash: sha256(bytes),
      uploadedBy: principal.userId,
    });

    await audit({
      userId: principal.userId,
      organizationId,
      action: 'create',
      entityType: 'denial_document',
      entityId: denialId,
    });
  }

  const result = await parseDenial(denialId);

  if (result.failures.length > 0) {
    log.warn('some documents could not be parsed', {
      denialId,
      failureCount: result.failures.length,
    });
  }

  redirect(`/app/denials/${denialId}`);
}
