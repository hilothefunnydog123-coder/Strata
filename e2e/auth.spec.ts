/**
 * Authentication and authorisation, tested by request rather than through the
 * interface.
 *
 * The role matrix at the bottom is the important one. It fetches every route
 * group as every role and asserts the status, which is the only way to know
 * that a surface is actually closed rather than merely un-linked. A page that
 * renders because nobody put a link to it is not access control.
 */
import { expect, test } from '@playwright/test';
import {
  app,
  completeFirstSignIn,
  signIn,
  signInWithTotp,
  signOut,
  type SeededUser,
} from './helpers';

const STAMP = Date.now();
const PASSWORD = 'e2e-password-that-is-long-enough';

interface Seeded {
  orgId: string;
  orgSlug: string;
  users: Record<string, SeededUser>;
}

let seeded: Seeded;

test.beforeAll(() => {
  app<number>('resetRateLimits');
  seeded = app<Seeded>('seedOrgAndRoles', { stamp: STAMP });
});

// Each test signs in and often enrols a second factor. The real per-address
// limits are right to notice a burst of that from one address, so the suite
// clears its own state rather than asking for the limits to be raised.
test.beforeEach(() => {
  app<number>('resetRateLimits');
});

/**
 * A fresh account for one test.
 *
 * Tests that change a password or enrol a second factor mutate the account they
 * use, so sharing one across tests makes the second one fail depending on
 * ordering. Each test gets its own, provisioned through the same code path the
 * operator console uses.
 */
let counter = 0;
function freshAccount(
  role: 'org_admin' | 'appeal_specialist' | 'readonly' | 'clinical_reviewer' | 'legal_reviewer' | 'superadmin',
): SeededUser {
  counter += 1;
  const email = `${role}-${STAMP}-${counter}@example.test`;

  const platformRole =
    role === 'superadmin' || role === 'clinical_reviewer' || role === 'legal_reviewer'
      ? role
      : undefined;
  const membership =
    platformRole === undefined ? { organizationId: seeded.orgId, role } : undefined;
  const reviewerOrgIds =
    role === 'clinical_reviewer' || role === 'legal_reviewer' ? [seeded.orgId] : undefined;

  return app<SeededUser>('provision', {
    email,
    name: `Test ${role}`,
    ...(platformRole ? { platformRole } : {}),
    ...(membership ? { membership } : {}),
    ...(reviewerOrgIds ? { reviewerOrgIds } : {}),
  });
}

test.describe('sign in', () => {
  test('a provisioned account must change its password and enrol two-factor before working', async ({
    page,
  }) => {
    const account = freshAccount('superadmin');

    // The temporary password gets them in, and no further.
    await signIn(page, account.email, account.temporaryPassword);
    await expect(page).toHaveURL(/\/account\/password/);

    // Trying to jump straight to a surface bounces back to the same gate.
    await page.goto('/admin');
    await expect(page).toHaveURL(/\/account\/password/);

    await page.getByLabel('Current password').fill(account.temporaryPassword);
    await page.getByLabel('New password', { exact: true }).fill(PASSWORD);
    await page.getByLabel('New password again').fill(PASSWORD);
    await page.getByRole('button', { name: 'Change password' }).click();

    // Password settled, the second factor is now the thing standing in the way.
    await expect(page).toHaveURL(/\/account\/two-factor/);
    await page.goto('/admin');
    await expect(page).toHaveURL(/\/account\/two-factor/);
  });

  test('rejects a wrong password without saying which half was wrong', async ({ page }) => {
    await signIn(page, freshAccount('readonly').email, 'not-the-right-password');
    await expect(page.getByText('Sign in failed')).toBeVisible();
    await expect(
      page.getByText('That email and password do not match an account'),
    ).toBeVisible();
    await expect(page).toHaveURL(/\/sign-in/);
  });

  test('an unknown account fails identically to a wrong password', async ({ page }) => {
    await signIn(page, `nobody-${STAMP}@example.test`, PASSWORD);
    await expect(
      page.getByText('That email and password do not match an account'),
    ).toBeVisible();
  });
});

test.describe('two-factor', () => {
  test('enrols, then is demanded on the next sign in', async ({ page }) => {
    const account = freshAccount('org_admin');

    const { totpSecret } = await completeFirstSignIn(
      page,
      account.email,
      account.temporaryPassword,
      PASSWORD,
    );

    await expect(page).toHaveURL(/\/app/);

    await signOut(page);

    // Password alone is no longer enough.
    await signIn(page, account.email, PASSWORD);
    await expect(page).toHaveURL(/\/sign-in\/two-factor/);

    await page.getByLabel('Six digit code').fill('000000');
    await page.getByRole('button', { name: 'Verify' }).click();
    await expect(page.getByText('Verification failed')).toBeVisible();

    await signInWithTotp(page, account.email, PASSWORD, totpSecret);
    await expect(page).toHaveURL(/\/app/);
  });

  test('a read only account is not forced into enrolment', async ({ page }) => {
    const account = freshAccount('readonly');
    await signIn(page, account.email, account.temporaryPassword);
    await expect(page).toHaveURL(/\/account\/password/);

    await page.getByLabel('Current password').fill(account.temporaryPassword);
    await page.getByLabel('New password', { exact: true }).fill(PASSWORD);
    await page.getByLabel('New password again').fill(PASSWORD);
    await page.getByRole('button', { name: 'Change password' }).click();

    // Straight to work, with no second factor demanded.
    await expect(page).toHaveURL(/\/app/);
  });
});

test.describe('route access by role', () => {
  const SURFACES = ['/app', '/review', '/admin'] as const;

  /** Which surfaces each role may reach. Everything else must be refused. */
  const ALLOWED: Record<string, string[]> = {
    org_admin: ['/app'],
    appeal_specialist: ['/app'],
    readonly: ['/app'],
    clinical_reviewer: ['/review'],
    legal_reviewer: ['/review'],
    superadmin: ['/app', '/review', '/admin'],
  };

  for (const role of Object.keys(ALLOWED)) {
    test(`${role} reaches only its own surfaces`, async ({ page }) => {
      const account = freshAccount(role as 'org_admin');
      const password = `${PASSWORD}-${role}`;

      const needsTwoFactor = role !== 'readonly';
      if (needsTwoFactor) {
        const { totpSecret } = await completeFirstSignIn(
          page,
          account.email,
          account.temporaryPassword,
          password,
        );
        expect(totpSecret.length).toBeGreaterThan(0);
      } else {
        await signIn(page, account.email, account.temporaryPassword);
        await page.waitForURL('**/account/password');
        await page.getByLabel('Current password').fill(account.temporaryPassword);
        await page.getByLabel('New password', { exact: true }).fill(password);
        await page.getByLabel('New password again').fill(password);
        await page.getByRole('button', { name: 'Change password' }).click();
        await page.waitForURL(/\/app/);
      }

      for (const surface of SURFACES) {
        // Fetched from inside the signed in page, so the request carries exactly
        // the cookies the browser holds, and redirects are not followed. This is
        // a request test rather than a click test on purpose: a surface that is
        // merely un-linked is not a surface that is closed.
        const { status, landedOn } = await page.evaluate(async (path) => {
          const res = await fetch(path, { credentials: 'include' });
          return { status: res.status, landedOn: new URL(res.url).pathname };
        }, surface);

        if (ALLOWED[role]!.includes(surface)) {
          // Served, at the address asked for, without being bounced anywhere.
          expect(
            status,
            `${role} should reach ${surface}, got ${status} at ${landedOn}`,
          ).toBe(200);
          expect(
            landedOn,
            `${role} should stay on ${surface}, but was sent to ${landedOn}`,
          ).toBe(surface);
        } else {
          // forbidden() answers 403 and does not redirect, so a refusal is
          // distinguishable from "not signed in", which redirects to sign in.
          expect(
            status,
            `${role} must not reach ${surface}, got ${status} at ${landedOn}`,
          ).toBe(403);
        }
      }
    });
  }

  test('no session reaches any surface', async ({ request }) => {
    for (const surface of [...SURFACES, '/account']) {
      const response = await request.get(surface, { maxRedirects: 0 });
      expect(response.status(), surface).toBe(307);
      expect(response.headers().location, surface).toContain('/sign-in');
    }
  });
});

test.describe('audit', () => {
  test('every sign in writes a row with who, when, and from where', async ({ page }) => {
    const account = freshAccount('appeal_specialist');
    const password = `${PASSWORD}-audit`;

    await completeFirstSignIn(page, account.email, account.temporaryPassword, password);

    const rows = app<
      { action: string; entityType: string; hasIp: boolean; hasUserAgent: boolean; userId: string | null }[]
    >('recentAudit', { limit: 20 });

    const login = rows.find(
      (r) => r.action === 'login' && r.userId === account.userId,
    );
    expect(login, 'a login row was written for this account').toBeTruthy();
    expect(login!.entityType).toBe('session');
    expect(login!.hasIp, 'the row records the client address').toBe(true);
    expect(login!.hasUserAgent, 'the row records the user agent').toBe(true);
  });
});
