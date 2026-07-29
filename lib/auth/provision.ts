/**
 * Creating and deactivating accounts.
 *
 * There is no signup route in this application. Accounts come into existence
 * here and nowhere else, called either by the bootstrap script that creates the
 * first operator or by the operator console that creates everyone after that.
 *
 * The one rule this module exists to hold: a new account always lands with a
 * temporary password and mustChangePassword set. Nobody, including the operator,
 * ever knows a user's working password.
 */
import { randomBytes } from 'node:crypto';
import { and, eq } from 'drizzle-orm';
import { auth } from '@/lib/auth';
import { db } from '@/lib/db';
import { member, organization, reviewerAssignment, session, user } from '@/lib/db/schema';
import type { OrgRole, PlatformRole } from '@/lib/auth/roles';

/** Readable but not guessable. The ambiguous glyphs are left out on purpose. */
export function temporaryPassword(length = 24): string {
  const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789';
  const bytes = randomBytes(length);
  let out = '';
  for (const byte of bytes) out += alphabet[byte % alphabet.length];
  return out;
}

function id(): string {
  return randomBytes(16).toString('hex');
}

export interface ProvisionInput {
  email: string;
  name: string;
  platformRole?: PlatformRole;
  /** Customer membership. Omit for operators and reviewers. */
  membership?: { organizationId: string; role: OrgRole };
  /** Organisations a reviewer may see. Only meaningful for reviewer roles. */
  reviewerOrgIds?: string[];
}

export interface ProvisionResult {
  userId: string;
  email: string;
  temporaryPassword: string;
  created: boolean;
}

/**
 * Create an account, or reset an existing one to a fresh temporary password.
 *
 * Idempotent by email: running it twice does not produce two accounts, it
 * produces one account with a new temporary password, which is also the
 * recovery path when someone is locked out.
 */
export async function provisionUser(input: ProvisionInput): Promise<ProvisionResult> {
  const email = input.email.trim().toLowerCase();
  const password = temporaryPassword();
  const ctx = await auth.$context;
  const hash = await ctx.password.hash(password);

  const existing = await db.query.user.findFirst({ where: eq(user.email, email) });

  let userId: string;
  let created: boolean;

  if (existing) {
    userId = existing.id;
    created = false;
    await ctx.internalAdapter.updatePassword(userId, hash);
    await db
      .update(user)
      .set({
        name: input.name,
        status: 'active',
        mustChangePassword: true,
        ...(input.platformRole ? { platformRole: input.platformRole } : {}),
        updatedAt: new Date(),
      })
      .where(eq(user.id, userId));
  } else {
    created = true;
    const record = await ctx.internalAdapter.createUser({
      id: id(),
      email,
      name: input.name,
      emailVerified: false,
    });
    userId = record.id;

    await ctx.internalAdapter.createAccount({
      id: id(),
      userId,
      providerId: 'credential',
      accountId: userId,
      password: hash,
    });

    await db
      .update(user)
      .set({
        platformRole: input.platformRole ?? 'none',
        mustChangePassword: true,
        updatedAt: new Date(),
      })
      .where(eq(user.id, userId));
  }

  if (input.membership) {
    const already = await db.query.member.findFirst({
      where: and(
        eq(member.userId, userId),
        eq(member.organizationId, input.membership.organizationId),
      ),
    });
    if (already) {
      await db
        .update(member)
        .set({ role: input.membership.role })
        .where(eq(member.id, already.id));
    } else {
      await db.insert(member).values({
        id: id(),
        userId,
        organizationId: input.membership.organizationId,
        role: input.membership.role,
      });
    }
  }

  if (input.reviewerOrgIds) {
    await db.delete(reviewerAssignment).where(eq(reviewerAssignment.userId, userId));
    if (input.reviewerOrgIds.length > 0) {
      await db.insert(reviewerAssignment).values(
        input.reviewerOrgIds.map((organizationId) => ({ userId, organizationId })),
      );
    }
  }

  return { userId, email, temporaryPassword: password, created };
}

/**
 * Turn an account off.
 *
 * The row stays, because the audit log references it and an audit trail that
 * points at deleted users is not an audit trail. Sessions are destroyed
 * immediately rather than left to expire: a deactivation that takes half an
 * hour to bite is not a deactivation.
 */
export async function deactivateUser(userId: string): Promise<void> {
  await db
    .update(user)
    .set({ status: 'disabled', updatedAt: new Date() })
    .where(eq(user.id, userId));
  await db.delete(session).where(eq(session.userId, userId));
}

export async function reactivateUser(userId: string): Promise<void> {
  await db
    .update(user)
    .set({ status: 'active', updatedAt: new Date() })
    .where(eq(user.id, userId));
}

/** Force a password change at next sign in, and end current sessions. */
export async function forcePasswordReset(userId: string): Promise<string> {
  const password = temporaryPassword();
  const ctx = await auth.$context;
  await ctx.internalAdapter.updatePassword(userId, await ctx.password.hash(password));
  await db
    .update(user)
    .set({ mustChangePassword: true, updatedAt: new Date() })
    .where(eq(user.id, userId));
  await db.delete(session).where(eq(session.userId, userId));
  return password;
}

export interface CreateOrganizationInput {
  name: string;
  slug: string;
  contingencyRateBps: number;
}

export async function createOrganization(input: CreateOrganizationInput) {
  const [row] = await db
    .insert(organization)
    .values({
      id: id(),
      name: input.name,
      slug: input.slug,
      contingencyRateBps: input.contingencyRateBps,
    })
    .returning();
  return row!;
}
