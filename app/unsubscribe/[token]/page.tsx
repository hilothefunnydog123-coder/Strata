import type { Metadata } from 'next';
import { eq } from 'drizzle-orm';
import { db } from '@/lib/db';
import { contact } from '@/lib/db/schema';
import { log } from '@/lib/log';

export const metadata: Metadata = {
  title: 'Unsubscribed',
  robots: { index: false, follow: false },
};

/**
 * The unsubscribe link.
 *
 * No session, no confirmation step, no "are you sure". Someone who clicked
 * unsubscribe has already decided, and making them click twice is the kind of
 * thing that gets a sender reported rather than merely unsubscribed.
 *
 * It acts on load rather than on a form submission, which is the trade every
 * unsubscribe link makes: a link prefetcher could in principle unsubscribe
 * someone who did not click. That is the safe direction to fail in.
 */
export default async function UnsubscribePage({
  params,
}: {
  params: Promise<{ token: string }>;
}) {
  const { token } = await params;

  const row = await db.query.contact.findFirst({
    where: eq(contact.unsubscribeToken, token),
  });

  if (row && !row.unsubscribedAt) {
    await db
      .update(contact)
      .set({ unsubscribedAt: new Date() })
      .where(eq(contact.id, row.id));
    log.info('contact unsubscribed', { contactId: row.id });
  }

  return (
    <main className="mx-auto max-w-lg px-6 py-24">
      <p className="id text-xs uppercase tracking-widest text-ink-2">Medeal</p>
      <h1 className="mt-4 text-2xl">
        {row ? 'You are unsubscribed' : 'That link has expired'}
      </h1>
      <p className="mt-3 text-ink-2">
        {row
          ? 'You will not get any more outreach from us. It takes effect immediately and there is nothing you need to do.'
          : 'We could not match that link to anyone, which usually means it was already used or the address was already removed. Either way you are not on the list.'}
      </p>
      <p className="mt-3 text-ink-2">
        This does not affect email about an account you hold with us, if you hold
        one. That is not marketing and it is not something we would unsubscribe
        you from without asking.
      </p>
    </main>
  );
}

// Everything behind a session is dynamic by definition: it renders from the
// signed in principal, which only exists per request. Saying so explicitly
// keeps `next build` from attempting to prerender these, which it otherwise
// tries first and abandons only once a request API is touched. That attempt is
// what made the build require a full runtime environment in order to emit
// static assets for pages that were never static.
export const dynamic = 'force-dynamic';
