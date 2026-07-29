import type { Metadata } from 'next';
import { redirect } from 'next/navigation';
import { getPrincipal } from '@/lib/auth/guards';
import { SignInForm } from './sign-in-form';
import { landingFor } from '@/lib/auth/landing';

export const metadata: Metadata = {
  title: 'Sign in',
  robots: { index: false, follow: false },
};

export default async function SignInPage({
  searchParams,
}: {
  searchParams: Promise<{ next?: string }>;
}) {
  const principal = await getPrincipal();
  const { next } = await searchParams;

  if (principal) redirect(safeNext(next) ?? landingFor(principal));

  return <SignInForm next={safeNext(next)} />;
}

/**
 * Only same-site paths are honoured. A `next` of `https://elsewhere/` would
 * otherwise turn the sign in page into an open redirect.
 */
function safeNext(next: string | undefined): string | undefined {
  if (!next) return undefined;
  if (!next.startsWith('/') || next.startsWith('//')) return undefined;
  return next;
}

// Everything behind a session is dynamic by definition: it renders from the
// signed in principal, which only exists per request. Saying so explicitly
// keeps `next build` from attempting to prerender these, which it otherwise
// tries first and abandons only once a request API is touched. That attempt is
// what made the build require a full runtime environment in order to emit
// static assets for pages that were never static.
export const dynamic = 'force-dynamic';
