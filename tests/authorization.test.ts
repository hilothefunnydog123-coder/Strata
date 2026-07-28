/**
 * Every role against every permission, and every role against every surface.
 *
 * This is written as an exhaustive matrix rather than a list of examples on
 * purpose. A permission added to lib/auth/roles.ts without a decision recorded
 * here fails the "every permission is accounted for" test at the bottom, which
 * means a new capability cannot quietly land in a role nobody reviewed.
 */
import { describe, expect, it } from 'vitest';
import {
  can,
  canEnter,
  ORG_ROLES,
  PERMISSIONS,
  permissionsFor,
  PLATFORM_ROLES,
  requiresTwoFactor,
  ROUTE_GROUPS,
  routeGroupFor,
  type OrgRole,
  type Permission,
  type PlatformRole,
  type RouteGroup,
} from '@/lib/auth/roles';

type Principal = { platform: PlatformRole; org: OrgRole | null; label: string };

const PRINCIPALS: Principal[] = [
  { platform: 'none', org: 'readonly', label: 'readonly' },
  { platform: 'none', org: 'appeal_specialist', label: 'appeal_specialist' },
  { platform: 'none', org: 'org_admin', label: 'org_admin' },
  { platform: 'clinical_reviewer', org: null, label: 'clinical_reviewer' },
  { platform: 'legal_reviewer', org: null, label: 'legal_reviewer' },
  { platform: 'superadmin', org: null, label: 'superadmin' },
  { platform: 'none', org: null, label: 'authenticated with no role' },
];

/**
 * The expected matrix. Read it as: this principal, and only this principal set,
 * may do this thing.
 */
const EXPECTED: Record<Permission, string[]> = {
  'denial:read': [
    'readonly',
    'appeal_specialist',
    'org_admin',
    'clinical_reviewer',
    'legal_reviewer',
    'superadmin',
  ],
  'denial:create': ['appeal_specialist', 'org_admin', 'superadmin'],
  'denial:update': ['appeal_specialist', 'org_admin', 'superadmin'],
  'denial:delete': ['org_admin', 'superadmin'],
  'draft:generate': ['appeal_specialist', 'org_admin', 'superadmin'],
  'draft:read': [
    'readonly',
    'appeal_specialist',
    'org_admin',
    'clinical_reviewer',
    'legal_reviewer',
    'superadmin',
  ],
  'draft:submit_for_review': ['appeal_specialist', 'org_admin', 'superadmin'],
  'draft:export': ['appeal_specialist', 'org_admin', 'superadmin'],
  'outcome:record': ['appeal_specialist', 'org_admin', 'superadmin'],
  'invoice:read': ['readonly', 'appeal_specialist', 'org_admin', 'superadmin'],
  'org:read_members': ['org_admin', 'superadmin'],
  'org:manage_members': ['org_admin', 'superadmin'],
  'org:read_dashboard': ['readonly', 'appeal_specialist', 'org_admin', 'superadmin'],
  'review:queue': ['clinical_reviewer', 'legal_reviewer', 'superadmin'],
  'review:clinical': ['clinical_reviewer', 'superadmin'],
  'review:legal': ['legal_reviewer', 'superadmin'],
  'review:edit_assertion': ['clinical_reviewer', 'legal_reviewer', 'superadmin'],
  'admin:organizations': ['superadmin'],
  'admin:users': ['superadmin'],
  'admin:all_appeals': ['superadmin'],
  'admin:corpus': ['superadmin'],
  'admin:spend': ['superadmin'],
  'admin:jobs': ['superadmin'],
  'admin:email': ['superadmin'],
  'admin:demo_requests': ['superadmin'],
  'admin:delete_org_data': ['superadmin'],
};

describe('permission matrix', () => {
  for (const permission of PERMISSIONS) {
    describe(permission, () => {
      const allowed = EXPECTED[permission];
      for (const principal of PRINCIPALS) {
        const shouldPass = allowed.includes(principal.label);
        it(`${shouldPass ? 'allows' : 'denies'} ${principal.label}`, () => {
          expect(can(principal.platform, principal.org, permission)).toBe(shouldPass);
        });
      }
    });
  }

  it('accounts for every declared permission', () => {
    expect(Object.keys(EXPECTED).sort()).toEqual([...PERMISSIONS].sort());
  });
});

describe('surface entry', () => {
  const EXPECTED_ENTRY: Record<RouteGroup, string[]> = {
    public: PRINCIPALS.map((p) => p.label),
    app: ['readonly', 'appeal_specialist', 'org_admin', 'superadmin'],
    review: ['clinical_reviewer', 'legal_reviewer', 'superadmin'],
    admin: ['superadmin'],
  };

  for (const group of ROUTE_GROUPS) {
    for (const principal of PRINCIPALS) {
      const shouldPass = EXPECTED_ENTRY[group].includes(principal.label);
      it(`${group}: ${shouldPass ? 'admits' : 'refuses'} ${principal.label}`, () => {
        expect(canEnter(group, principal.platform, principal.org)).toBe(shouldPass);
      });
    }
  }

  it('never lets a client portal role into the review or operator surfaces', () => {
    for (const org of ORG_ROLES) {
      expect(canEnter('review', 'none', org)).toBe(false);
      expect(canEnter('admin', 'none', org)).toBe(false);
    }
  });

  it('never lets a reviewer into the client portal or the operator console', () => {
    for (const platform of ['clinical_reviewer', 'legal_reviewer'] as PlatformRole[]) {
      expect(canEnter('app', platform, null)).toBe(false);
      expect(canEnter('admin', platform, null)).toBe(false);
    }
  });

  it('keeps the two review roles out of each other s gate', () => {
    expect(can('clinical_reviewer', null, 'review:legal')).toBe(false);
    expect(can('legal_reviewer', null, 'review:clinical')).toBe(false);
  });

  it('gives a reviewer no sight of money', () => {
    for (const platform of ['clinical_reviewer', 'legal_reviewer'] as PlatformRole[]) {
      expect(can(platform, null, 'invoice:read')).toBe(false);
      expect(can(platform, null, 'org:read_dashboard')).toBe(false);
    }
  });

  it('gives an account with no role at all nothing', () => {
    expect(permissionsFor('none', null).size).toBe(0);
  });
});

describe('routeGroupFor', () => {
  const cases: [string, RouteGroup][] = [
    ['/', 'public'],
    ['/pricing', 'public'],
    ['/security', 'public'],
    ['/app', 'app'],
    ['/app/denials/abc', 'app'],
    ['/review', 'review'],
    ['/review/queue', 'review'],
    ['/admin', 'admin'],
    ['/admin/organizations', 'admin'],
    // A public path that merely begins with the same letters is still public.
    ['/application-notes', 'public'],
    ['/administrative-appeals', 'public'],
    ['/reviews-we-have-won', 'public'],
  ];
  for (const [path, group] of cases) {
    it(`${path} is ${group}`, () => {
      expect(routeGroupFor(path)).toBe(group);
    });
  }
});

describe('two factor requirement', () => {
  it('is mandatory for every role above read only', () => {
    expect(requiresTwoFactor('superadmin', [])).toBe(true);
    expect(requiresTwoFactor('clinical_reviewer', [])).toBe(true);
    expect(requiresTwoFactor('legal_reviewer', [])).toBe(true);
    expect(requiresTwoFactor('none', ['org_admin'])).toBe(true);
    expect(requiresTwoFactor('none', ['appeal_specialist'])).toBe(true);
  });

  it('is not demanded of a read only account', () => {
    expect(requiresTwoFactor('none', ['readonly'])).toBe(false);
    expect(requiresTwoFactor('none', [])).toBe(false);
  });

  it('is demanded when any one membership is above read only', () => {
    expect(requiresTwoFactor('none', ['readonly', 'appeal_specialist'])).toBe(true);
  });
});

describe('role sets are closed', () => {
  it('has no unexpected platform roles', () => {
    expect([...PLATFORM_ROLES]).toEqual([
      'none',
      'superadmin',
      'clinical_reviewer',
      'legal_reviewer',
    ]);
  });

  it('has no unexpected organisation roles', () => {
    expect([...ORG_ROLES]).toEqual(['org_admin', 'appeal_specialist', 'readonly']);
  });
});
