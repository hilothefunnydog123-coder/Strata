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
