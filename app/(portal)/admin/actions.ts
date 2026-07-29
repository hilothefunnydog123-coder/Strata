'use server';

import { revalidatePath } from 'next/cache';
import { eq } from 'drizzle-orm';
import { z } from 'zod';
import { audit } from '@/lib/audit';
import { assertPlatform, requirePrincipalOrThrow } from '@/lib/auth/guards';
import {
  createOrganization,
  deactivateUser,
  forcePasswordReset,
  provisionUser,
  reactivateUser,
} from '@/lib/auth/provision';
import { db } from '@/lib/db';
import { organization, user } from '@/lib/db/schema';
import { deleteOrganizationData } from '@/lib/compliance/delete';
import { ORG_ROLES, PLATFORM_ROLES } from '@/lib/auth/roles';
import { log } from '@/lib/log';

export type AdminState =
  | { status: 'idle' }
  | { status: 'ok'; message: string; secret?: string }
  | { status: 'error'; message: string; fieldErrors: Record<string, string> };

function fieldErrors(error: z.ZodError): Record<string, string> {
  const out: Record<string, string> = {};
  for (const issue of error.issues) {
    const key = issue.path[0];
    if (typeof key === 'string' && !out[key]) out[key] = issue.message;
  }
  return out;
}

/* ─── Organisations ───────────────────────────────────────────────────────── */

const orgSchema = z.object({
  name: z.string().trim().min(2, 'Enter the organisation name.').max(160),
  slug: z
    .string()
    .trim()
    .toLowerCase()
    .min(2, 'Enter a short slug, used in invoice numbers.')
    .max(48)
    .regex(/^[a-z0-9-]+$/, 'Lowercase letters, numbers, and hyphens only.'),
  contingencyRateBps: z
    .string()
    .trim()
    .transform((value, ctx) => {
      const percent = Number(value);
      if (!Number.isFinite(percent) || percent < 0 || percent > 100) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: 'Enter a percentage between 0 and 100, for example 15 or 12.5.',
        });
        return z.NEVER;
      }
      // Basis points, so the fee calculation never touches a float.
      return Math.round(percent * 100);
    }),
});

export async function createOrg(
  _previous: AdminState,
  formData: FormData,
): Promise<AdminState> {
  const principal = await requirePrincipalOrThrow();
  assertPlatform(principal, 'admin:organizations');

  const parsed = orgSchema.safeParse({
    name: formData.get('name'),
    slug: formData.get('slug'),
    contingencyRateBps: formData.get('contingencyRate'),
  });

  if (!parsed.success) {
    return {
      status: 'error',
      message: 'Some of this needs fixing.',
      fieldErrors: fieldErrors(parsed.error),
    };
  }

  const existing = await db.query.organization.findFirst({
    where: eq(organization.slug, parsed.data.slug),
  });
  if (existing) {
    return {
      status: 'error',
      message: 'That slug is taken.',
      fieldErrors: { slug: `${parsed.data.slug} already belongs to ${existing.name}.` },
    };
  }

  const created = await createOrganization(parsed.data);

  await audit({
    userId: principal.userId,
    organizationId: created.id,
    action: 'provision',
    entityType: 'organization',
    entityId: created.id,
  });

  revalidatePath('/admin/organizations');
  return { status: 'ok', message: `${created.name} created.` };
}

export async function setOrgStatus(
  organizationId: string,
  status: 'active' | 'inactive',
): Promise<AdminState> {
  const principal = await requirePrincipalOrThrow();
  assertPlatform(principal, 'admin:organizations');

  await db
    .update(organization)
    .set({ status })
    .where(eq(organization.id, organizationId));

  await audit({
    userId: principal.userId,
    organizationId,
    action: 'update',
    entityType: 'organization',
    entityId: organizationId,
  });

  revalidatePath('/admin/organizations');
  return {
    status: 'ok',
    message:
      status === 'inactive'
        ? 'Deactivated. Its members lose access immediately.'
        : 'Reactivated.',
  };
}

export async function setContingencyRate(
  organizationId: string,
  percent: number,
): Promise<AdminState> {
  const principal = await requirePrincipalOrThrow();
  assertPlatform(principal, 'admin:organizations');

  if (!Number.isFinite(percent) || percent < 0 || percent > 100) {
    return {
      status: 'error',
      message: 'A rate has to be between 0 and 100 percent.',
      fieldErrors: {},
    };
  }

  await db
    .update(organization)
    .set({ contingencyRateBps: Math.round(percent * 100) })
    .where(eq(organization.id, organizationId));

  await audit({
    userId: principal.userId,
    organizationId,
    action: 'update',
    entityType: 'organization',
    entityId: organizationId,
  });

  revalidatePath('/admin/organizations');
  return {
    status: 'ok',
    message: `Rate set to ${percent} percent. It applies to invoices issued from now on.`,
  };
}

/**
 * Erase everything belonging to an organisation.
 *
 * Irreversible, so the operator has to type the organisation's name to confirm.
 * That is not theatre: it is the difference between clicking the wrong row and
 * meaning it.
 */
export async function eraseOrg(
  organizationId: string,
  typedName: string,
  reason: string,
): Promise<AdminState> {
  const principal = await requirePrincipalOrThrow();
  assertPlatform(principal, 'admin:delete_org_data');

  const org = await db.query.organization.findFirst({
    where: eq(organization.id, organizationId),
  });
  if (!org) {
    return { status: 'error', message: 'That organisation does not exist.', fieldErrors: {} };
  }

  if (typedName.trim() !== org.name) {
    return {
      status: 'error',
      message: `Type ${org.name} exactly to confirm. Nothing was deleted.`,
      fieldErrors: {},
    };
  }

  try {
    const result = await deleteOrganizationData({
      organizationId,
      requestedBy: principal.userId,
      reason,
    });

    const rows = Object.values(result.deletedCounts).reduce((a, b) => a + b, 0);
    revalidatePath('/admin/organizations');
    return {
      status: 'ok',
      message: `${result.organizationName} erased: ${rows} rows and ${result.documentsDeleted} stored documents. The record of the deletion is kept.`,
    };
  } catch (error) {
    log.error('erasure failed', { organizationId, error });
    return {
      status: 'error',
      message: error instanceof Error ? error.message : 'The erasure failed.',
      fieldErrors: {},
    };
  }
}

/* ─── Users ───────────────────────────────────────────────────────────────── */

const userSchema = z
  .object({
    email: z.string().trim().toLowerCase().email('That is not an email address.'),
    name: z.string().trim().min(2, 'Enter their name.').max(120),
    platformRole: z.enum(PLATFORM_ROLES),
    organizationId: z.string().trim().optional(),
    orgRole: z.enum(ORG_ROLES).optional(),
    reviewerOrgIds: z.array(z.string()).optional(),
  })
  .refine(
    (d) => d.platformRole !== 'none' || (d.organizationId && d.orgRole),
    {
      message:
        'A customer account needs an organisation and a role in it. An operator or reviewer does not.',
      path: ['organizationId'],
    },
  );

export async function provision(
  _previous: AdminState,
  formData: FormData,
): Promise<AdminState> {
  const principal = await requirePrincipalOrThrow();
  assertPlatform(principal, 'admin:users');

  const platformRole = String(formData.get('platformRole') ?? 'none');
  const reviewerOrgIds = formData.getAll('reviewerOrgIds').map(String).filter(Boolean);

  const parsed = userSchema.safeParse({
    email: formData.get('email'),
    name: formData.get('name'),
    platformRole,
    organizationId: String(formData.get('organizationId') ?? '') || undefined,
    orgRole: String(formData.get('orgRole') ?? '') || undefined,
    reviewerOrgIds,
  });

  if (!parsed.success) {
    return {
      status: 'error',
      message: 'Some of this needs fixing.',
      fieldErrors: fieldErrors(parsed.error),
    };
  }

  const input = parsed.data;

  const result = await provisionUser({
    email: input.email,
    name: input.name,
    platformRole: input.platformRole,
    ...(input.platformRole === 'none' && input.organizationId && input.orgRole
      ? { membership: { organizationId: input.organizationId, role: input.orgRole } }
      : {}),
    ...(input.platformRole === 'clinical_reviewer' ||
    input.platformRole === 'legal_reviewer'
      ? { reviewerOrgIds: input.reviewerOrgIds ?? [] }
      : {}),
  });

  await audit({
    userId: principal.userId,
    organizationId: input.organizationId ?? null,
    action: 'provision',
    entityType: 'user',
    entityId: result.userId,
  });

  revalidatePath('/admin/users');
  return {
    status: 'ok',
    message: `${result.email} ${result.created ? 'created' : 'reset'}. Give them this password once; it is not stored in readable form and they must change it at first sign in.`,
    secret: result.temporaryPassword,
  };
}

export async function setUserStatus(
  userId: string,
  status: 'active' | 'disabled',
): Promise<AdminState> {
  const principal = await requirePrincipalOrThrow();
  assertPlatform(principal, 'admin:users');

  if (userId === principal.userId && status === 'disabled') {
    return {
      status: 'error',
      message: 'You cannot deactivate your own account. Ask another operator.',
      fieldErrors: {},
    };
  }

  if (status === 'disabled') await deactivateUser(userId);
  else await reactivateUser(userId);

  await audit({
    userId: principal.userId,
    organizationId: null,
    action: status === 'disabled' ? 'deprovision' : 'provision',
    entityType: 'user',
    entityId: userId,
  });

  revalidatePath('/admin/users');
  return {
    status: 'ok',
    message:
      status === 'disabled'
        ? 'Deactivated. Their sessions were destroyed immediately rather than left to expire.'
        : 'Reactivated. They still need their password.',
  };
}

export async function resetPassword(userId: string): Promise<AdminState> {
  const principal = await requirePrincipalOrThrow();
  assertPlatform(principal, 'admin:users');

  const target = await db.query.user.findFirst({ where: eq(user.id, userId) });
  if (!target) {
    return { status: 'error', message: 'That user does not exist.', fieldErrors: {} };
  }

  const password = await forcePasswordReset(userId);

  await audit({
    userId: principal.userId,
    organizationId: null,
    action: 'update',
    entityType: 'user',
    entityId: userId,
  });

  revalidatePath('/admin/users');
  return {
    status: 'ok',
    message: `Password reset for ${target.email}. Their sessions were destroyed and they must change this at next sign in.`,
    secret: password,
  };
}
