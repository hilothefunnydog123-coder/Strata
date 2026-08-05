/**
 * Ask once, then one click, and say so when the answer stops working.
 *
 * The interesting case is not the happy one. It is a hospital that chose a
 * channel months ago and whose channel has since stopped being usable, because
 * the two obvious behaviours are both wrong: silently filing through a
 * different channel sends an appeal somewhere nobody chose, and silently
 * failing strands it near a deadline. So a lapsed preference is treated as no
 * preference and says why it is asking again.
 */
import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest';

// This deployment has no mail key, and that is the correct default: a channel
// nobody has set up must be refused. Email is the one channel with a working
// adapter, so it stands in here for "a channel that is configured", which is
// what the preference logic is actually about.
vi.mock('@/lib/email/send', () => ({
  emailConfigured: () => true,
  send: async () => ({ status: 'sent', providerId: 'msg-test', emailSendId: 'x' }),
}));
import { eq } from 'drizzle-orm';
import { db } from '@/lib/db';
import { organization } from '@/lib/db/schema';
import { filingPrompt, setDefaultChannel } from '@/lib/filing/preference';

const ORG = 'org-filing-test';

beforeEach(async () => {
  await db.delete(organization).where(eq(organization.id, ORG));
  await db.insert(organization).values({
    id: ORG,
    name: 'Filing Test Hospital',
    slug: 'filing-test-hospital',
  });
});

afterAll(async () => {
  await db.delete(organization).where(eq(organization.id, ORG));
});

describe('the first time a hospital files', () => {
  it('asks, and offers every channel with its reason', async () => {
    const prompt = await filingPrompt(ORG);

    expect(prompt.kind).toBe('choose');
    expect(prompt.kind === 'choose' && prompt.options.length).toBeGreaterThan(3);
    expect(prompt.kind === 'choose' && prompt.lapsed).toBeNull();
  });
});

describe('after they have chosen', () => {
  it('files without asking again', async () => {
    // email is the channel with an adapter, and it is configured in tests.
    await setDefaultChannel(ORG, 'email');

    const prompt = await filingPrompt(ORG);

    expect(prompt.kind).toBe('ready');
    expect(prompt.kind === 'ready' && prompt.channel).toBe('email');
    expect(prompt.kind === 'ready' && prompt.label).toBe('Email');
  });

  it('lets them change their mind back to being asked', async () => {
    await setDefaultChannel(ORG, 'email');
    await setDefaultChannel(ORG, null);

    expect((await filingPrompt(ORG)).kind).toBe('choose');
  });
});

describe('a preference that has stopped working', () => {
  it('asks again and says why, rather than silently filing another way', async () => {
    // Written straight to the column, which is how a preference set when a
    // channel was configured survives that channel being switched off.
    await db
      .update(organization)
      .set({ defaultFilingChannel: 'esmd' })
      .where(eq(organization.id, ORG));

    const prompt = await filingPrompt(ORG);

    expect(prompt.kind).toBe('choose');
    expect(prompt.kind === 'choose' && prompt.lapsed?.channel).toBe('esmd');
    expect(prompt.kind === 'choose' && prompt.lapsed?.reason).toMatch(/enrolment/i);
  });
});

describe('what may be saved as a default', () => {
  it('refuses a channel nobody has set up', async () => {
    // Saving it would make every future filing take two clicks again while
    // appearing to be configured: the most annoying outcome and the hardest to
    // diagnose from the outside.
    const result = await setDefaultChannel(ORG, 'esmd');

    expect(result.ok).toBe(false);
    expect(result.ok === false && result.reason).toMatch(/not set up/i);

    const org = await db.query.organization.findFirst({ where: eq(organization.id, ORG) });
    expect(org?.defaultFilingChannel).toBeNull();
  });

  it('refuses payer portal automation as a default like anything else', async () => {
    const result = await setDefaultChannel(ORG, 'payer_portal');

    expect(result.ok).toBe(false);
  });

  it('refuses a channel that does not exist', async () => {
    const result = await setDefaultChannel(ORG, 'carrier_pigeon' as 'email');

    expect(result.ok).toBe(false);
    expect(result.ok === false && result.reason).toMatch(/not a filing channel/i);
  });
});
