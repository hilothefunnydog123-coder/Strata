/**
 * The demo request form, end to end.
 *
 * The acceptance criterion is that a real submission stores a row and produces
 * a notification carrying every field. Whether that notification reaches an
 * inbox depends on a Resend key being configured; what is asserted here is the
 * part that is ours: the row exists, the message was composed with every field
 * in it, and it was handed to the mail layer, which records the outcome either
 * way rather than dropping it.
 */
import { expect, test } from '@playwright/test';
import { app } from './helpers';

const STAMP = Date.now();

// The form allows five submissions an hour per address. This suite runs several
// times an hour from one address, so it starts from a known state rather than
// the product limit being loosened to accommodate a test.
test.beforeAll(() => {
  app<number>('resetRateLimits');
});

interface DemoRow {
  id: string;
  name: string;
  email: string;
  orgName: string;
  title: string;
  message: string | null;
  annualDenialVolume: string;
  notifiedAt: string | null;
}

interface EmailRow {
  toEmail: string;
  subject: string;
  body: string;
  status: string;
}

test.describe('demo request', () => {
  test('a complete submission stores a row and composes both messages', async ({
    page,
  }) => {
    const email = `mercy-${STAMP}@mercyregional.test`;

    await page.goto('/demo');
    await page.getByLabel('Your name').fill('Dana Whitfield');
    await page.getByLabel('Work email').fill(email);
    await page.getByLabel('Hospital or health system').fill('Mercy Regional Health');
    await page.getByLabel('Your title').fill('Director of Revenue Integrity');
    await page.getByLabel('Denials a year').selectOption('2000_10000');
    await page
      .getByLabel('Anything you want us to look at')
      .fill('Meridian keeps denying our SNF stays on day four.');

    await page.getByRole('button', { name: 'Send request' }).click();

    await expect(page.getByText('Request received')).toBeVisible();

    const row = app<DemoRow | null>('findDemoRequest', { email });
    expect(row, 'the request was stored').toBeTruthy();
    expect(row!.name).toBe('Dana Whitfield');
    expect(row!.orgName).toBe('Mercy Regional Health');
    expect(row!.title).toBe('Director of Revenue Integrity');
    expect(row!.annualDenialVolume).toBe('2000_10000');
    expect(row!.message).toContain('Meridian keeps denying');

    const sends = app<EmailRow[]>('emailsFor', { email });

    // The notification to the operator carries every field, so the message is
    // the whole lead rather than a pointer to a record someone has to open.
    const notification = sends.find((s) => s.subject.startsWith('Demo request:'));
    expect(notification, 'an operator notification was composed').toBeTruthy();
    for (const fragment of [
      'Dana Whitfield',
      email,
      'Mercy Regional Health',
      'Director of Revenue Integrity',
      '2,000 to 10,000',
      'Meridian keeps denying',
    ]) {
      expect(notification!.body, `notification contains ${fragment}`).toContain(fragment);
    }

    // The requester gets a confirmation telling them what to bring.
    const confirmation = sends.find((s) => s.toEmail === email);
    expect(confirmation, 'a confirmation was composed for the requester').toBeTruthy();
    expect(confirmation!.subject).toBe('Your Strata demo request');
    expect(confirmation!.body).toContain('Mercy Regional Health');
  });

  test('shows inline errors and stores nothing when the form is wrong', async ({
    page,
  }) => {
    const before = app<number>('countRows', { table: 'demoRequest' });

    await page.goto('/demo');
    await page.getByLabel('Your name').fill('X');
    await page.getByLabel('Work email').fill('someone@gmail.com');
    await page.getByLabel('Hospital or health system').fill('A');
    await page.getByLabel('Your title').fill('B');
    await page.getByRole('button', { name: 'Send request' }).click();

    await expect(page.getByText('Not sent yet')).toBeVisible();
    await expect(
      page.getByText('Use your work email so we can tell which organisation you are with.'),
    ).toBeVisible();
    await expect(page.getByText('Enter your name.')).toBeVisible();
    await expect(page.getByText('Pick the range closest to your volume.')).toBeVisible();

    expect(app<number>('countRows', { table: 'demoRequest' })).toBe(before);
  });

  test('discards a submission that fills the honeypot, without saying so', async ({
    page,
  }) => {
    const before = app<number>('countRows', { table: 'demoRequest' });
    const email = `bot-${STAMP}@example.test`;

    await page.goto('/demo');
    await page.getByLabel('Your name').fill('Automated Crawler');
    await page.getByLabel('Work email').fill(email);
    await page.getByLabel('Hospital or health system').fill('Nowhere General');
    await page.getByLabel('Your title').fill('Bot');
    await page.getByLabel('Denials a year').selectOption('not_sure');
    await page.locator('#website').fill('http://spam.example');

    await page.getByRole('button', { name: 'Send request' }).click();

    // Looks exactly like success, on purpose.
    await expect(page.getByText('Request received')).toBeVisible();
    expect(app<number>('countRows', { table: 'demoRequest' })).toBe(before);
    expect(app<DemoRow | null>('findDemoRequest', { email })).toBeNull();
  });
});
