import type { Metadata } from 'next';
import Link from 'next/link';
import { env } from '@/lib/env';

export const metadata: Metadata = {
  title: 'Privacy',
  description: 'What Medeal collects, why, and what it does not do with it.',
};

export default function Privacy() {
  return (
    <div className="mx-auto max-w-2xl px-5 py-14">
      <h1 className="text-3xl">Privacy</h1>
      <p className="mt-3 text-sm text-ink-2">Last updated 28 July 2026.</p>

      <section className="mt-8">
        <h2 className="text-lg">What this page covers</h2>
        <p className="mt-2 text-ink-2">
          This is about information we collect from visitors to this site and
          from people who use the application. Patient information submitted by a
          hospital customer is governed by that customer&apos;s business associate
          agreement rather than by this page, and is described on the{' '}
          <Link href="/security">security page</Link>.
        </p>
      </section>

      <section className="mt-8">
        <h2 className="text-lg">From visitors to this site</h2>
        <p className="mt-2 text-ink-2">
          If you submit the demo request form we store what you typed: your name,
          work email, organisation, title, denial volume, and message, along with
          the network address the request came from. We use the address to rate
          limit the form and for nothing else.
        </p>
        <p className="mt-2 text-ink-2">
          We do not run advertising trackers, analytics scripts, or third party
          cookies on this site.
        </p>
      </section>

      <section className="mt-8">
        <h2 className="text-lg">From people who use the application</h2>
        <p className="mt-2 text-ink-2">
          Your name, work email, role, and the record of what you did: every read
          and write of a clinical record writes an audit row with your identity,
          the record touched, the action, the time, and the address you were
          working from. That log exists because HIPAA requires it and because you
          would want it if someone else touched your organisation&apos;s cases.
        </p>
      </section>

      <section className="mt-8">
        <h2 className="text-lg">Outbound email</h2>
        <p className="mt-2 text-ink-2">
          If we email you as part of outreach rather than because you asked us
          to, every message carries a working unsubscribe link and our postal
          address. Unsubscribing is honoured immediately and cannot be overridden
          by anyone here.
        </p>
      </section>

      <section className="mt-8">
        <h2 className="text-lg">What we never do</h2>
        <ul className="mt-2 space-y-2 text-ink-2">
          <li>We do not sell your information, and we do not share it for advertising.</li>
          <li>
            We do not use patient information to train models. Clinical text is
            sent to a model only to draft your own appeal, and only under a
            business associate agreement.
          </li>
        </ul>
      </section>

      <section className="mt-8">
        <h2 className="text-lg">Asking us to delete it</h2>
        <p className="mt-2 text-ink-2">
          Write to <span className="id">{env.DEMO_REQUEST_TO}</span> and we will
          delete what we hold about you. For an organisation&apos;s complete record,
          deletion cascades through every dependent row and is itself recorded.
        </p>
      </section>
    </div>
  );
}
