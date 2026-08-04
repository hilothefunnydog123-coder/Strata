/**
 * A scanned denial letter, uploaded through the interface.
 *
 * The unit tests prove the OCR engine reads the fixture. They cannot prove it
 * still works once Next.js has built the application, because the risk there is
 * not the recognition, it is the packaging: tesseract.js starts a worker thread
 * and loads a WebAssembly core and a language file from disk, and a bundler
 * that rewrites those paths breaks it in a way no unit test run through the
 * TypeScript loader would ever see.
 *
 * So this uploads a real two page scan to a real running server, through the
 * real form, and then checks the case became ready and the page says where the
 * text came from. Before this existed, that file was rejected at the door.
 */
import path from 'node:path';
import { expect, test } from '@playwright/test';
import { app, completeFirstSignIn, type SeededUser } from './helpers';

const STAMP = `scan-${Date.now()}`;
const PASSWORD = 'scanned-upload-password-long';

const SCAN = path.join(__dirname, '..', 'tests', 'fixtures', 'scanned-denial.pdf');

let specialist: SeededUser;
let orgId = '';

test.beforeAll(() => {
  app<number>('resetRateLimits');
  const seeded = app<{ orgId: string; users: Record<string, SeededUser> }>('seedOrgAndRoles', {
    stamp: STAMP,
  });
  orgId = seeded.orgId;
  specialist = seeded.users.appeal_specialist!;
});

test.beforeEach(() => {
  app<number>('resetRateLimits');
});

test('a scanned denial letter is read, and the case says so', async ({ page }) => {
  await completeFirstSignIn(page, specialist.email, specialist.temporaryPassword, PASSWORD);

  await page.goto(`/app/denials/new?org=${orgId}`);

  await page.getByLabel('Your reference').fill(`${STAMP}-001`);
  await page.getByLabel('Payer', { exact: true }).fill('Meridian Health Plan');
  await page.getByLabel('Amount denied').fill('18420.00');

  // The synthetic affirmation is mandatory in this mode and has no bypass.
  await page.getByRole('checkbox').check();

  await page.getByLabel('Denial letter').setInputFiles(SCAN);

  await page.getByRole('button', { name: 'Create denial' }).click();

  await page.waitForURL('**/app/denials/**', { timeout: 60_000 });

  // OCR runs during parsing and takes a second or two per page, so the case
  // reaching a readable state is the thing to wait for rather than a fixed
  // pause.
  await expect(page.getByText(/Read by OCR at \d+% confidence/)).toBeVisible({
    timeout: 60_000,
  });

  // The reviewer has to be told a quote from this document is a machine's
  // reading of a picture. That warning is the only thing standing in for
  // verification here, so its absence would be the bug worth catching.
  await expect(page.getByText(/must be checked against the scan/)).toBeVisible();
});
