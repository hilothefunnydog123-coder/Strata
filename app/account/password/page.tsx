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
        <p className="id text-xs uppercase tracking-widest text-ink-2">Strata</p>
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
