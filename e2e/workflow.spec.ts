/**
 * The workflow gates, tested against a real database.
 *
 * Generation needs an Anthropic key this environment does not have, so this
 * suite builds a draft directly through the same tables generation writes to,
 * and then exercises everything downstream: the two review gates, the export
 * block, rejection returning the case with notes, and the invoice.
 *
 * That is a deliberate and stated limitation. What it does not test is whether
 * the model produces a good draft. What it does test is that a draft cannot
 * reach a payer without two humans approving it, which is the claim the product
 * is sold on and the one a bug would be most expensive in.
 */
import { expect, test } from '@playwright/test';
import { app, completeFirstSignIn, signIn, type SeededUser } from './helpers';

const STAMP = Date.now();
const PASSWORD = 'workflow-password-long-enough';

interface Fixture {
  orgId: string;
  denialId: string;
  draftId: string;
  assertionIds: string[];
  specialist: SeededUser;
  clinical: SeededUser;
  legal: SeededUser;
}

let fixture: Fixture;

test.beforeAll(() => {
  // This suite signs in and enrols a second factor several times in quick
  // succession, which the real per-address limits are right to notice. Tests
  // start from a known state rather than the limits being loosened for them.
  app<number>('resetRateLimits');
  fixture = app<Fixture>('seedReviewableDraft', { stamp: STAMP });
});

test.beforeEach(() => {
  app<number>('resetRateLimits');
});

test.describe('the two review gates', () => {
  test('export is blocked until both reviews approve, and the block is on the server', async ({
    page,
  }) => {
    // Nothing approved yet.
    let state = app<{ clinical: boolean; legal: boolean; canExport: boolean; reason: string }>(
      'exportState',
      { denialId: fixture.denialId, draftId: fixture.draftId },
    );
    expect(state.canExport, 'no approvals, no export').toBe(false);
    expect(state.reason).toContain('clinical review');
    expect(state.reason).toContain('legal review');

    // Clinical approves.
    await completeFirstSignIn(
      page,
      fixture.clinical.email,
      fixture.clinical.temporaryPassword,
      `${PASSWORD}-clinical`,
    );
    await page.goto(`/review/${fixture.draftId}`);
    await expect(page.getByRole('button', { name: 'Approve' })).toBeVisible();
    await page.getByRole('button', { name: 'Approve' }).click();
    await page.waitForURL('**/review');

    state = app('exportState', {
      denialId: fixture.denialId,
      draftId: fixture.draftId,
    });
    expect(state.clinical, 'clinical approved').toBe(true);
    expect(state.legal, 'legal has not').toBe(false);
    expect(state.canExport, 'one approval is not enough').toBe(false);
    expect(state.reason).toContain('legal review');
    expect(state.reason).not.toContain('clinical review');

    // Legal approves.
    await page.goto('/sign-in');
    await page.getByRole('button', { name: 'Sign out' }).click().catch(() => {});
    await completeFirstSignIn(
      page,
      fixture.legal.email,
      fixture.legal.temporaryPassword,
      `${PASSWORD}-legal`,
    );
    await page.goto(`/review/${fixture.draftId}`);
    await page.getByRole('button', { name: 'Approve' }).click();
    await page.waitForURL('**/review');

    state = app('exportState', {
      denialId: fixture.denialId,
      draftId: fixture.draftId,
    });
    expect(state.clinical).toBe(true);
    expect(state.legal).toBe(true);
    expect(state.canExport, 'both approvals, export opens').toBe(true);
  });
});

test.describe('rejection', () => {
  test('returns the case for regeneration with the notes visible', async ({ page }) => {
    const second = app<Fixture>('seedReviewableDraft', { stamp: `${STAMP}-reject` });

    await completeFirstSignIn(
      page,
      second.clinical.email,
      second.clinical.temporaryPassword,
      `${PASSWORD}-reject`,
    );

    await page.goto(`/review/${second.draftId}`);
    await page
      .getByLabel('Notes')
      .fill('Assertion 2 claims a daily skilled need, but the note it cites covers one shift.');
    await page.getByRole('button', { name: 'Send back' }).click();
    await page.waitForURL('**/review');

    const status = app<string>('denialStatus', { denialId: second.denialId });
    expect(status, 'a rejected draft goes back for regeneration').toBe(
      'ready_for_generation',
    );

    // The note is attached and visible on the next look at the draft.
    await page.goto(`/review/${second.draftId}`);
    await expect(page.getByText('This case was sent back before')).toBeVisible();
    await expect(page.getByText('covers one shift')).toBeVisible();

    const state = app<{ canExport: boolean; reason: string }>('exportState', {
      denialId: second.denialId,
      draftId: second.draftId,
    });
    expect(state.canExport, 'a rejected draft cannot be exported').toBe(false);
  });

  test('refuses a rejection with no note', async ({ page }) => {
    const third = app<Fixture>('seedReviewableDraft', { stamp: `${STAMP}-nonote` });

    await completeFirstSignIn(
      page,
      third.clinical.email,
      third.clinical.temporaryPassword,
      `${PASSWORD}-nonote`,
    );

    await page.goto(`/review/${third.draftId}`);
    await page.getByRole('button', { name: 'Send back' }).click();

    await expect(page.getByText('Not recorded')).toBeVisible();
    await expect(page.getByText('Say what is wrong with it')).toBeVisible();

    expect(app<string>('denialStatus', { denialId: third.denialId })).toBe(
      'clinical_review',
    );
  });
});

test.describe('the assertion checklist', () => {
  test('an edit is re-verified against the source and refused if the quote is not there', async ({
    page,
  }) => {
    const fourth = app<Fixture>('seedReviewableDraft', { stamp: `${STAMP}-edit` });

    await completeFirstSignIn(
      page,
      fourth.clinical.email,
      fourth.clinical.temporaryPassword,
      `${PASSWORD}-edit`,
    );

    await page.goto(`/review/${fourth.draftId}`);

    // An edit whose quote is not in the source is refused, not saved with a
    // warning. This is the citation invariant holding at the reviewer's hands.
    await page.getByRole('button', { name: 'Edit' }).first().click();
    await page
      .getByLabel('Quoted passage')
      .fill('a passage that appears in no source anywhere in this system at all');
    await page.getByRole('button', { name: 'Save and re-verify' }).click();

    await expect(page.getByText('Not recorded')).toBeVisible();
    await expect(
      page.getByText('does not appear in the source this assertion cites'),
    ).toBeVisible();
  });
});

test.describe('outcomes and invoicing', () => {
  test('a recorded win produces an invoice at the organisation rate', async () => {
    const fifth = app<Fixture>('seedReviewableDraft', { stamp: `${STAMP}-invoice` });

    // Approve, file, and record a win: 18,420.00 recovered at 15 percent.
    const result = app<{
      recoveredCents: number;
      feeCents: number;
      rateBps: number;
      number: string;
      lineCount: number;
    }>('runToInvoice', {
      denialId: fifth.denialId,
      draftId: fifth.draftId,
      organizationId: fifth.orgId,
      amountRecoveredCents: 1_842_000,
    });

    expect(result.recoveredCents).toBe(1_842_000);
    expect(result.rateBps).toBe(1500);
    // 15 percent of $18,420.00 is $2,763.00, to the cent.
    expect(result.feeCents).toBe(276_300);
    expect(result.lineCount).toBe(1);
    expect(result.number).toMatch(/-\d{6}-\d{3}$/);

    // The same outcome cannot be billed a second time.
    const again = app<{ error: string }>('runToInvoice', {
      denialId: fifth.denialId,
      draftId: fifth.draftId,
      organizationId: fifth.orgId,
      amountRecoveredCents: 1_842_000,
      expectFailure: true,
    });
    expect(again.error, 'an outcome already billed is not billed again').toContain(
      'Nothing recovered',
    );
  });
});

test.describe('the client portal reflects it', () => {
  test('the dashboard shows the recovered figure it computed', async ({ page }) => {
    const sixth = app<Fixture>('seedReviewableDraft', { stamp: `${STAMP}-dash` });

    app('runToInvoice', {
      denialId: sixth.denialId,
      draftId: sixth.draftId,
      organizationId: sixth.orgId,
      amountRecoveredCents: 940_050,
    });

    await signIn(page, sixth.specialist.email, sixth.specialist.temporaryPassword);
    await page.waitForURL('**/account/password');
    await page.getByLabel('Current password').fill(sixth.specialist.temporaryPassword);
    await page.getByLabel('New password', { exact: true }).fill(`${PASSWORD}-dash`);
    await page.getByLabel('New password again').fill(`${PASSWORD}-dash`);
    await page.getByRole('button', { name: 'Change password' }).click();
    await page.waitForURL('**/account/two-factor');

    const { totpSecret } = { totpSecret: '' };
    void totpSecret;

    // Specialists need a second factor, so finish enrolment the normal way.
    await page.goto('/account/two-factor');
    await page.getByLabel('Confirm your password').fill(`${PASSWORD}-dash`);
    await page.getByRole('button', { name: 'Continue' }).click();
    const secret = (await page
      .locator('[data-testid="totp-secret"]')
      .textContent())!.trim();
    const { totp } = await import('./helpers');
    await page.getByLabel('Six digit code').fill(totp(secret));
    await page.getByRole('button', { name: 'Turn on two-factor' }).click();
    await page.getByRole('button', { name: /Go to my work|Continue/ }).click();

    await page.goto(`/app?org=${sixth.orgId}`);

    // $9,400.50 recovered, shown as whole dollars in the hero figure.
    await expect(page.getByText('$9,401').or(page.getByText('$9,400'))).toBeVisible();
    await expect(page.getByText('Recovered to date')).toBeVisible();
  });
});
