/**
 * Who may do what.
 *
 * This module is pure data and pure functions: no database, no request, no
 * session. That is deliberate, because it means the authorisation rules can be
 * tested exhaustively (tests/authorization.test.ts walks every role against
 * every route) without standing anything up.
 *
 * Enforcement lives in lib/auth/guards.ts, which is what routes and server
 * actions actually call. Hiding a button is never the control.
 */

export const ORG_ROLES = ['org_admin', 'appeal_specialist', 'readonly'] as const;
export type OrgRole = (typeof ORG_ROLES)[number];

export const PLATFORM_ROLES = [
  'none',
  'superadmin',
  'clinical_reviewer',
  'legal_reviewer',
] as const;
export type PlatformRole = (typeof PLATFORM_ROLES)[number];

export function isOrgRole(value: string): value is OrgRole {
  return (ORG_ROLES as readonly string[]).includes(value);
}

/**
 * Every distinct thing a user can attempt. Route handlers and server actions
 * name one of these rather than re-deriving a rule, so there is one place to
 * read the policy and one place to change it.
 */
export const PERMISSIONS = [
  // Client portal
  'denial:read',
  'denial:create',
  'denial:update',
  'denial:delete',
  'draft:generate',
  'draft:read',
  'draft:submit_for_review',
  'draft:export',
  'outcome:record',
  'invoice:read',
  'org:read_members',
  'org:manage_members',
  'org:read_dashboard',

  // Review portal
  'review:queue',
  'review:clinical',
  'review:legal',
  'review:edit_assertion',

  // Operator console
  'admin:organizations',
  'admin:users',
  'admin:all_appeals',
  'admin:corpus',
  'admin:spend',
  'admin:jobs',
  'admin:email',
  'admin:demo_requests',
  'admin:delete_org_data',
] as const;

export type Permission = (typeof PERMISSIONS)[number];

const READONLY: Permission[] = [
  'denial:read',
  'draft:read',
  'invoice:read',
  'org:read_dashboard',
];

const APPEAL_SPECIALIST: Permission[] = [
  ...READONLY,
  'denial:create',
  'denial:update',
  'draft:generate',
  'draft:submit_for_review',
  'draft:export',
  'outcome:record',
];

const ORG_ADMIN: Permission[] = [
  ...APPEAL_SPECIALIST,
  'denial:delete',
  'org:read_members',
  'org:manage_members',
];

const ORG_ROLE_PERMISSIONS: Record<OrgRole, readonly Permission[]> = {
  readonly: READONLY,
  appeal_specialist: APPEAL_SPECIALIST,
  org_admin: ORG_ADMIN,
};

/**
 * Reviewers read the case they are reviewing, and nothing beyond their assigned
 * organisations. They cannot create denials, cannot export, and cannot see
 * money: they are checking assertions against sources, and recovery figures
 * would be a distraction at best and a bias at worst.
 */
const CLINICAL_REVIEWER: Permission[] = [
  'review:queue',
  'review:clinical',
  'review:edit_assertion',
  'denial:read',
  'draft:read',
];

const LEGAL_REVIEWER: Permission[] = [
  'review:queue',
  'review:legal',
  'review:edit_assertion',
  'denial:read',
  'draft:read',
];

const SUPERADMIN: readonly Permission[] = PERMISSIONS;

const PLATFORM_ROLE_PERMISSIONS: Record<PlatformRole, readonly Permission[]> = {
  none: [],
  superadmin: SUPERADMIN,
  clinical_reviewer: CLINICAL_REVIEWER,
  legal_reviewer: LEGAL_REVIEWER,
};

/** Roles that must have two-factor authentication enrolled before they can work. */
const READ_ONLY_ROLES = new Set<string>(['readonly', 'none']);

/**
 * Compliance requirement 7: two-factor is mandatory for every role above read
 * only. A user whose only capability is looking at their own organisation's
 * appeals is not a lever an attacker can pull; everyone else is.
 */
export function requiresTwoFactor(
  platformRole: PlatformRole,
  orgRoles: readonly OrgRole[],
): boolean {
  if (!READ_ONLY_ROLES.has(platformRole)) return true;
  return orgRoles.some((role) => !READ_ONLY_ROLES.has(role));
}

/** The permissions a principal holds, given their platform role and one org role. */
export function permissionsFor(
  platformRole: PlatformRole,
  orgRole: OrgRole | null,
): ReadonlySet<Permission> {
  const set = new Set<Permission>(PLATFORM_ROLE_PERMISSIONS[platformRole]);
  if (orgRole) {
    for (const permission of ORG_ROLE_PERMISSIONS[orgRole]) set.add(permission);
  }
  return set;
}

export function can(
  platformRole: PlatformRole,
  orgRole: OrgRole | null,
  permission: Permission,
): boolean {
  return permissionsFor(platformRole, orgRole).has(permission);
}

/* ─────────────────────────────────────────────────────────────────────────────
   Route groups

   Middleware works at this granularity: it decides whether a principal may see
   a surface at all. Whether they may act on a particular record is decided by
   the guards, which know the record.
   ────────────────────────────────────────────────────────────────────────── */

export const ROUTE_GROUPS = ['public', 'app', 'review', 'admin'] as const;
export type RouteGroup = (typeof ROUTE_GROUPS)[number];

export function routeGroupFor(pathname: string): RouteGroup {
  if (pathname === '/admin' || pathname.startsWith('/admin/')) return 'admin';
  if (pathname === '/review' || pathname.startsWith('/review/')) return 'review';
  if (pathname === '/app' || pathname.startsWith('/app/')) return 'app';
  return 'public';
}

/** The permission that gates entry to each surface. */
const GROUP_ENTRY: Record<Exclude<RouteGroup, 'public'>, Permission> = {
  app: 'org:read_dashboard',
  review: 'review:queue',
  admin: 'admin:organizations',
};

export function canEnter(
  group: RouteGroup,
  platformRole: PlatformRole,
  orgRole: OrgRole | null,
): boolean {
  if (group === 'public') return true;
  return can(platformRole, orgRole, GROUP_ENTRY[group]);
}
