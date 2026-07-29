/**
 * Server side authorisation.
 *
 * Every page, route handler, and server action starts by calling one of these.
 * They throw or redirect; they never return a partially authorised principal.
 *
 * The pattern throughout is: resolve the principal, then check a permission
 * against a specific record. Checking "is this person an admin" in a page and
 * then trusting an identifier from the client is how tenant isolation bugs
 * happen, so the record-scoped helpers below take the identifier and do the
 * lookup themselves.
 */
import { and, eq } from 'drizzle-orm';
import { headers } from 'next/headers';
import { forbidden, redirect } from 'next/navigation';
import { cache } from 'react';
import { auth } from '@/lib/auth';
import {
  can,
  canEnter,
  isOrgRole,
  requiresTwoFactor,
  type OrgRole,
  type Permission,
  type PlatformRole,
  type RouteGroup,
} from '@/lib/auth/roles';
import { db } from '@/lib/db';
import { denial, member, organization, reviewerAssignment } from '@/lib/db/schema';

export interface Membership {
  organizationId: string;
  organizationName: string;
  organizationSlug: string;
  role: OrgRole;
  contingencyRateBps: number;
}

export interface Principal {
  userId: string;
  email: string;
  name: string;
  platformRole: PlatformRole;
  twoFactorEnabled: boolean;
  mustChangePassword: boolean;
  /** Customer organisations this user belongs to, with their role in each. */
  memberships: Membership[];
  /** Organisations a reviewer is assigned to. Empty for everyone else. */
  reviewerOrgIds: string[];
}

/** Thrown when a principal is authenticated but not permitted. */
export class AuthorizationError extends Error {
  readonly status = 403;
  constructor(public readonly permission: string) {
    super(`Not permitted: ${permission}`);
    this.name = 'AuthorizationError';
  }
}

/** Thrown when there is no valid session at all. */
export class AuthenticationError extends Error {
  readonly status = 401;
  constructor() {
    super('Not signed in');
    this.name = 'AuthenticationError';
  }
}

/**
 * Resolve the current principal, or null.
 *
 * Wrapped in React's cache so a page that calls this in the layout, the page,
 * and three components still makes one session lookup per request.
 */
export const getPrincipal = cache(async (): Promise<Principal | null> => {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session?.user) return null;

  const u = session.user as typeof session.user & {
    status?: string;
    platformRole?: string;
    mustChangePassword?: boolean;
  };

  // A deactivated account holds no permissions, whatever its session says.
  if (u.status === 'disabled') return null;

  const [memberships, assignments] = await Promise.all([
    db
      .select({
        organizationId: member.organizationId,
        role: member.role,
        organizationName: organization.name,
        organizationSlug: organization.slug,
        contingencyRateBps: organization.contingencyRateBps,
        organizationStatus: organization.status,
      })
      .from(member)
      .innerJoin(organization, eq(member.organizationId, organization.id))
      .where(eq(member.userId, u.id)),
    db
      .select({ organizationId: reviewerAssignment.organizationId })
      .from(reviewerAssignment)
      .where(eq(reviewerAssignment.userId, u.id)),
  ]);

  return {
    userId: u.id,
    email: u.email,
    name: u.name,
    platformRole: (u.platformRole ?? 'none') as PlatformRole,
    twoFactorEnabled: Boolean(session.user.twoFactorEnabled),
    mustChangePassword: Boolean(u.mustChangePassword),
    memberships: memberships
      // A deactivated organisation's members lose access with it.
      .filter((m) => m.organizationStatus === 'active' && isOrgRole(m.role))
      .map((m) => ({
        organizationId: m.organizationId,
        organizationName: m.organizationName,
        organizationSlug: m.organizationSlug,
        role: m.role as OrgRole,
        contingencyRateBps: m.contingencyRateBps,
      })),
    reviewerOrgIds: assignments.map((a) => a.organizationId),
  };
});

/** The principal, or a redirect to sign in. Use in pages. */
export async function requirePrincipal(): Promise<Principal> {
  const principal = await getPrincipal();
  if (!principal) redirect('/sign-in');
  return principal;
}

/** The principal, or a thrown 401. Use in route handlers and server actions. */
export async function requirePrincipalOrThrow(): Promise<Principal> {
  const principal = await getPrincipal();
  if (!principal) throw new AuthenticationError();
  return principal;
}

/**
 * The org role a principal holds in a given organisation, or null.
 *
 * A reviewer assigned to an organisation is not a member of it and holds no org
 * role there. Their permissions come from their platform role instead, which is
 * why this returns null for them rather than inventing a role.
 */
export function orgRoleIn(principal: Principal, organizationId: string): OrgRole | null {
  return (
    principal.memberships.find((m) => m.organizationId === organizationId)?.role ?? null
  );
}

/** Whether the principal may see anything at all belonging to this organisation. */
export function isScopedTo(principal: Principal, organizationId: string): boolean {
  if (principal.platformRole === 'superadmin') return true;
  if (principal.memberships.some((m) => m.organizationId === organizationId)) return true;
  return principal.reviewerOrgIds.includes(organizationId);
}

/**
 * Check a permission in the context of one organisation.
 *
 * Two gates, both required: the principal must be scoped to the organisation,
 * and the role they hold must carry the permission. A superadmin passes the
 * first automatically and the second on merit.
 */
export function assertCan(
  principal: Principal,
  organizationId: string | null,
  permission: Permission,
): void {
  if (organizationId !== null && !isScopedTo(principal, organizationId)) {
    throw new AuthorizationError(permission);
  }
  const orgRole = organizationId ? orgRoleIn(principal, organizationId) : null;
  if (!can(principal.platformRole, orgRole, permission)) {
    throw new AuthorizationError(permission);
  }
}

/** Platform level permissions, which no organisation role can grant. */
export function assertPlatform(principal: Principal, permission: Permission): void {
  if (!can(principal.platformRole, null, permission)) {
    throw new AuthorizationError(permission);
  }
}

/** Whether a principal may enter a surface at all. Used by middleware and layouts. */
export function canEnterGroup(principal: Principal, group: RouteGroup): boolean {
  if (group === 'public') return true;
  if (canEnter(group, principal.platformRole, null)) return true;
  return principal.memberships.some((m) =>
    canEnter(group, principal.platformRole, m.role),
  );
}

/**
 * Load a denial the principal is entitled to see, or throw.
 *
 * Callers pass an identifier that came from a URL, so the organisation is read
 * off the record rather than taken from the request. This is the only sanctioned
 * way to fetch a denial from a route.
 */
export async function denialForPrincipal(
  principal: Principal,
  denialId: string,
  permission: Permission = 'denial:read',
) {
  const row = await db.query.denial.findFirst({ where: eq(denial.id, denialId) });
  if (!row) return null;
  assertCan(principal, row.organizationId, permission);
  return row;
}

/** Membership row lookup used when the operator console edits a team. */
export async function membershipOf(userId: string, organizationId: string) {
  return db.query.member.findFirst({
    where: and(eq(member.userId, userId), eq(member.organizationId, organizationId)),
  });
}

/**
 * Compliance requirement 7: two-factor is mandatory above read only.
 *
 * Returns the path the principal must visit before doing anything else, or
 * null when they are clear to work. Enforced in the authenticated layouts, so
 * there is no surface that skips it.
 */
export function pendingAccountAction(principal: Principal): string | null {
  if (principal.mustChangePassword) return '/account/password';
  const orgRoles = principal.memberships.map((m) => m.role);
  if (requiresTwoFactor(principal.platformRole, orgRoles) && !principal.twoFactorEnabled) {
    return '/account/two-factor';
  }
  return null;
}

/** Turn an authorisation failure into the right HTTP response inside a page. */
export function respondToAuthFailure(error: unknown): never {
  if (error instanceof AuthenticationError) redirect('/sign-in');
  if (error instanceof AuthorizationError) forbidden();
  throw error;
}

/**
 * The page level versions of the assertions above.
 *
 * Next renders a layout and the page beneath it in parallel, so a layout
 * calling forbidden() does not stop the page from running and throwing first.
 * A raw AuthorizationError escaping a page becomes a 500, which tells a user
 * the application broke when in fact it worked exactly as intended.
 *
 * Every page therefore guards itself with one of these, and the layout guard
 * stays as the thing that catches routes nobody remembered to check.
 */
export function assertCanOrForbid(
  principal: Principal,
  organizationId: string | null,
  permission: Permission,
): void {
  try {
    assertCan(principal, organizationId, permission);
  } catch (error) {
    respondToAuthFailure(error);
  }
}

export function assertPlatformOrForbid(
  principal: Principal,
  permission: Permission,
): void {
  try {
    assertPlatform(principal, permission);
  } catch (error) {
    respondToAuthFailure(error);
  }
}
