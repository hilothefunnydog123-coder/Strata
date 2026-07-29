import type { Metadata } from 'next';
import Link from 'next/link';
import { env, envStatus } from '@/lib/env';

export const metadata: Metadata = {
  title: 'Contact',
  description: 'How to reach Medeal.',
};

export default function Contact() {
  return (
    <div className="mx-auto max-w-2xl px-5 py-14">
      <h1 className="text-3xl">Contact</h1>
      <p className="mt-4 text-ink-2">
        The fastest route is the demo request form, which reaches a person
        directly and gets a reply within one business day.
      </p>

      <dl className="mt-8 divide-y divide-rule border-y border-rule">
        <div className="grid gap-1 py-3 sm:grid-cols-[180px_1fr]">
          <dt className="text-sm font-medium">Demos and pilots</dt>
          <dd>
            <Link href="/demo">Request a demo</Link>
          </dd>
        </div>
        <div className="grid gap-1 py-3 sm:grid-cols-[180px_1fr]">
          <dt className="text-sm font-medium">Anything else</dt>
          <dd className="id text-sm">
            {envStatus().configured ? env.DEMO_REQUEST_TO : 'not configured yet'}
          </dd>
        </div>
        <div className="grid gap-1 py-3 sm:grid-cols-[180px_1fr]">
          <dt className="text-sm font-medium">Security review</dt>
          <dd className="text-ink-2">
            Start with the{' '}
            <Link href="/security">security page</Link>. It is written for your
            reviewer rather than for a buyer.
          </dd>
        </div>
      </dl>
    </div>
  );
}
