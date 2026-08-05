/**
 * Filing an appeal, and asking how only once.
 *
 * The product drafted a letter, two people signed it, and then somebody
 * downloaded a PDF and did the rest by hand at the most time sensitive moment
 * in the process. This is that step, and the tests here are about the two
 * things that make it safe rather than merely automatic: a channel nobody has
 * set up must say so instead of failing when clicked, and a filing must leave a
 * record whether or not it worked.
 */
import { describe, expect, it, vi } from 'vitest';
import {
  availableChannels,
  channelAvailability,
  channelByKey,
  CHANNELS,
} from '@/lib/filing/channels';

describe('the channels on offer', () => {
  it('orders them by what the hospital can prove, not by how modern they are', () => {
    // Certified mail is unglamorous and beats everything else in front of an
    // adjudicator deciding whether a deadline was met, so it is offered first.
    const order = channelAvailability().map((c) => c.channel.key);

    expect(order[0]).toBe('certified_mail');
    expect(order.indexOf('esmd')).toBeLessThan(order.indexOf('email'));
  });

  it('says what each one proves, since that is the reason to pick it', () => {
    for (const channel of CHANNELS) {
      expect(channel.evidence.length).toBeGreaterThan(20);
      expect(channel.summary.length).toBeGreaterThan(10);
    }
  });

  it('is honest that email proves sending and not delivery', () => {
    // A hospital filing this way three days before a deadline is taking a risk,
    // and should be taking it knowingly.
    const email = channelByKey('email')!;

    expect(email.evidence).toMatch(/not that it was delivered/i);
  });

  it('shows a channel nobody has set up rather than hiding it', () => {
    // Hiding them makes the product look like it only ever supported one way of
    // filing, and gives a hospital no way to ask for the one they want.
    const esmd = channelAvailability().find((c) => c.channel.key === 'esmd')!;

    expect(esmd.available).toBe(false);
    expect(esmd.reason).toMatch(/enrolment/i);
  });

  it('does not offer portal automation, whatever the ticket said', () => {
    // Many payer portal terms of service prohibit automated access, and an
    // account closed for breaching them takes the hospital's whole revenue
    // cycle with it rather than merely this product. It stays unavailable until
    // somebody decides otherwise in writing, per payer.
    const portal = channelAvailability().find((c) => c.channel.key === 'payer_portal')!;

    expect(portal.available).toBe(false);
    expect(portal.reason).toMatch(/terms of service|written decision/i);
    expect(availableChannels().map((c) => c.key)).not.toContain('payer_portal');
  });

  it('gives every unusable channel a reason a person can act on', () => {
    for (const entry of channelAvailability()) {
      if (entry.available) continue;
      expect(entry.reason).toBeTruthy();
      expect(entry.reason!.length).toBeGreaterThan(20);
    }
  });
});

describe('the email channel, which is the one that works', () => {
  it('refuses something that is not an address, and does not retry it', async () => {
    // Retrying the same non-address forever looks like the payer is at fault.
    const { emailAdapter } = await import('@/lib/filing/adapters/email');

    const result = await emailAdapter.send({
      claimReference: 'REF-1',
      payerName: 'Test Plan',
      destination: 'the appeals department',
      subject: 'Appeal',
      body: 'Letter text',
      document: { filename: 'a.pdf', bytes: Buffer.from(''), contentType: 'application/pdf' },
    });

    expect(result.status).toBe('failed');
    expect(result.status === 'failed' && result.retryable).toBe(false);
    expect(result.status === 'failed' && result.detail).toMatch(/not an email address/);
  });

  it('treats a queued message as not filed', async () => {
    // The mailer keeps a message when it cannot reach its provider. That is a
    // send in progress, not a filing, and calling it sent would put a filing
    // date in the record that nothing supports.
    vi.resetModules();
    vi.doMock('@/lib/email/send', () => ({
      emailConfigured: () => true,
      send: async () => ({ status: 'queued', reason: 'provider unreachable', emailSendId: 'x' }),
    }));

    const { emailAdapter } = await import('@/lib/filing/adapters/email');
    const result = await emailAdapter.send({
      claimReference: 'REF-1',
      payerName: 'Test Plan',
      destination: 'appeals@plan.example',
      subject: 'Appeal',
      body: 'Letter text',
      document: { filename: 'a.pdf', bytes: Buffer.from(''), contentType: 'application/pdf' },
    });

    expect(result.status).toBe('failed');
    expect(result.status === 'failed' && result.retryable).toBe(true);
    vi.doUnmock('@/lib/email/send');
    vi.resetModules();
  });

  it('reports the provider id so the filing can be traced later', async () => {
    vi.resetModules();
    vi.doMock('@/lib/email/send', () => ({
      emailConfigured: () => true,
      send: async () => ({ status: 'sent', providerId: 'msg-abc', emailSendId: 'x' }),
    }));

    const { emailAdapter } = await import('@/lib/filing/adapters/email');
    const result = await emailAdapter.send({
      claimReference: 'REF-1',
      payerName: 'Test Plan',
      destination: 'appeals@plan.example',
      subject: 'Appeal',
      body: 'Letter text',
      document: { filename: 'a.pdf', bytes: Buffer.from(''), contentType: 'application/pdf' },
    });

    expect(result.status).toBe('sent');
    expect(result.status === 'sent' && result.externalRef).toBe('msg-abc');
    vi.doUnmock('@/lib/email/send');
    vi.resetModules();
  });
});
