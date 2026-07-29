import type { Principal } from '@/lib/auth/guards';

/**
 * Where a principal belongs after signing in.
 *
 * A person holds exactly one job here in practice, so the first surface they
 * can enter is the right one. Order matters: the operator console first, then
 * the review queue, then the client portal.
 */
export function landingFor(principal: Principal): string {
  if (principal.platformRole === 'superadmin') return '/admin';
  if (
    principal.platformRole === 'clinical_reviewer' ||
    principal.platformRole === 'legal_reviewer'
  ) {
    return '/review';
  }
  if (principal.memberships.length > 0) return '/app';
  return '/account';
}
