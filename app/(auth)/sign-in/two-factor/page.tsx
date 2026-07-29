import type { Metadata } from 'next';
import { TwoFactorForm } from './two-factor-form';

export const metadata: Metadata = {
  title: 'Two-factor code',
  robots: { index: false, follow: false },
};

export default async function TwoFactorPage({
  searchParams,
}: {
  searchParams: Promise<{ next?: string }>;
}) {
  const { next } = await searchParams;
  const safe = next?.startsWith('/') && !next.startsWith('//') ? next : undefined;
  return <TwoFactorForm next={safe} />;
}

// Everything behind a session is dynamic by definition: it renders from the
// signed in principal, which only exists per request. Saying so explicitly
// keeps `next build` from attempting to prerender these, which it otherwise
// tries first and abandons only once a request API is touched. That attempt is
// what made the build require a full runtime environment in order to emit
// static assets for pages that were never static.
export const dynamic = 'force-dynamic';
