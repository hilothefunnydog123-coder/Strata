import type { Metadata } from 'next';
import { requirePrincipal } from '@/lib/auth/guards';
import { PhiBanner } from '@/components/phi-banner';
import { ChangePasswordForm } from './form';

export const metadata: Metadata = {
  title: 'Change your password',
  robots: { index: false, follow: false },
};

export default async function PasswordPage() {
  const principal = await requirePrincipal();

  return (
    <>
      <PhiBanner />
      <main className="mx-auto max-w-sm px-6 py-16">
        <p className="id text-xs uppercase tracking-widest text-ink-2">Medeal</p>
        <h1 className="mt-4 text-2xl">
          {principal.mustChangePassword ? 'Choose a new password' : 'Change your password'}
        </h1>
        <p className="mt-2 text-sm text-ink-2">
          {principal.mustChangePassword
            ? 'Your administrator issued this account a temporary password. Replace it before you go any further.'
            : 'Twelve characters or more. Anything you have used elsewhere does not count as new.'}
        </p>
        <ChangePasswordForm />
      </main>
    </>
  );
}

// Everything behind a session is dynamic by definition: it renders from the
// signed in principal, which only exists per request. Saying so explicitly
// keeps `next build` from attempting to prerender these, which it otherwise
// tries first and abandons only once a request API is touched. That attempt is
// what made the build require a full runtime environment in order to emit
// static assets for pages that were never static.
export const dynamic = 'force-dynamic';
