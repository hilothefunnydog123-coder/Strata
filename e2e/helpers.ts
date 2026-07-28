/**
 * Shared machinery for the end to end tests.
 *
 * The tests provision their own accounts and organisations through the same
 * code paths the operator console uses, then drive the browser as those users.
 * Nothing is inserted straight into a table that the application would not
 * insert the same way.
 */
import { createHmac } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import type { Page } from '@playwright/test';
import { expect } from '@playwright/test';

/* ─── TOTP ────────────────────────────────────────────────────────────────── */

const BASE32 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';

function base32Decode(input: string): Buffer {
  const clean = input.toUpperCase().replace(/=+$/, '').replace(/\s/g, '');
  let bits = 0;
  let value = 0;
  const out: number[] = [];
  for (const char of clean) {
    const index = BASE32.indexOf(char);
    if (index === -1) throw new Error(`Not a base32 character: ${char}`);
    value = (value << 5) | index;
    bits += 5;
    if (bits >= 8) {
      out.push((value >>> (bits - 8)) & 0xff);
      bits -= 8;
    }
  }
  return Buffer.from(out);
}

/**
 * A six digit TOTP for the given base32 secret, exactly as an authenticator app
 * would produce it. Used so the tests can clear the mandatory second factor the
 * same way a real user does.
 */
export function totp(secret: string, at: Date = new Date()): string {
  const counter = Math.floor(at.getTime() / 1000 / 30);
  const buf = Buffer.alloc(8);
  buf.writeUInt32BE(Math.floor(counter / 2 ** 32), 0);
  buf.writeUInt32BE(counter >>> 0, 4);

  const hmac = createHmac('sha1', base32Decode(secret)).update(buf).digest();
  const offset = hmac[hmac.length - 1]! & 0x0f;
  const code =
    (((hmac[offset]! & 0x7f) << 24) |
      ((hmac[offset + 1]! & 0xff) << 16) |
      ((hmac[offset + 2]! & 0xff) << 8) |
      (hmac[offset + 3]! & 0xff)) %
    1_000_000;
  return code.toString().padStart(6, '0');
}

/* ─── Fixtures created through the real provisioning path ─────────────────── */

export interface SeededUser {
  email: string;
  temporaryPassword: string;
  userId: string;
  created: boolean;
}

/**
 * Call the application's own code through e2e/support/cli.ts, in a child
 * process, so server modules never enter the Playwright runtime.
 */
export function app<T>(command: string, args: Record<string, unknown> = {}): T {
  const out = execFileSync(
    'pnpm',
    ['exec', 'tsx', 'e2e/support/cli.ts', command, JSON.stringify(args)],
    { encoding: 'utf8', cwd: process.cwd(), env: process.env },
  );
  const marker = out.lastIndexOf('__RESULT__');
  if (marker === -1) {
    throw new Error(`${command} produced no result:\n${out}`);
  }
  return JSON.parse(out.slice(marker + '__RESULT__'.length).trim()) as T;
}

/* ─── Browser flows ───────────────────────────────────────────────────────── */

export async function signIn(page: Page, email: string, password: string) {
  await page.goto('/sign-in');
  await page.getByLabel('Work email').fill(email);
  await page.getByLabel('Password').fill(password);
  await page.getByRole('button', { name: 'Sign in' }).click();
}

/**
 * Take a freshly provisioned account all the way to working: change the
 * temporary password, then enrol two-factor. This is the mandatory path for
 * every role above read only, so most tests start here.
 */
export async function completeFirstSignIn(
  page: Page,
  email: string,
  temporaryPassword: string,
  newPassword: string,
): Promise<{ totpSecret: string; backupCodes: string[] }> {
  await signIn(page, email, temporaryPassword);

  await page.waitForURL('**/account/password');
  await page.getByLabel('Current password').fill(temporaryPassword);
  await page.getByLabel('New password', { exact: true }).fill(newPassword);
  await page.getByLabel('New password again').fill(newPassword);
  await page.getByRole('button', { name: 'Change password' }).click();

  await page.waitForURL('**/account/two-factor');
  await page.getByLabel('Confirm your password').fill(newPassword);
  await page.getByRole('button', { name: 'Continue' }).click();

  const secret = (await page.locator('[data-testid="totp-secret"]').textContent())!.trim();
  const backupCodes = await page.locator('[data-testid="backup-code"]').allTextContents();

  await page.getByLabel('Six digit code').fill(totp(secret));
  await page.getByRole('button', { name: 'Turn on two-factor' }).click();
  await expect(page.getByText('Two-factor authentication is on')).toBeVisible();

  // Finish the way a person does, by leaving the enrolment page. The session
  // cookie is only exchanged for one carrying the second factor on the next
  // request, so a test that stops here still looks un-enrolled to the server.
  await page.getByRole('button', { name: /Go to my work|Continue/ }).click();
  await page.waitForURL((url) => !url.pathname.startsWith('/account/two-factor'));

  return { totpSecret: secret, backupCodes: backupCodes.map((c) => c.trim()) };
}

/** Sign in for an account that already has two-factor enrolled. */
export async function signInWithTotp(
  page: Page,
  email: string,
  password: string,
  secret: string,
) {
  await signIn(page, email, password);
  await page.waitForURL('**/sign-in/two-factor');
  await page.getByLabel('Six digit code').fill(totp(secret));
  await page.getByRole('button', { name: 'Verify' }).click();
}

export async function signOut(page: Page) {
  await page.getByRole('button', { name: 'Sign out' }).click();
  await page.waitForURL('**/sign-in**');
}
