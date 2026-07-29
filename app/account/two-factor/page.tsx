import type { Metadata } from 'next';
import { redirect } from 'next/navigation';
import { requirePrincipal } from '@/lib/auth/guards';
import { requiresTwoFactor } from '@/lib/auth/roles';
import { landingFor } from '@/lib/auth/landing';
import { PhiBanner } from '@/components/phi-banner';
import { EnrollTwoFactor } from './enroll';

export const metadata: Metadata = {
  title: 'Set up two-factor authentication',
  robots: { index: false, follow: false },
};

export default async function TwoFactorSetupPage() {
  const principal = await requirePrincipal();

  if (principal.twoFactorEnabled) redirect(landingFor(principal));

  const required = requiresTwoFactor(
    principal.platformRole,
    principal.memberships.map((m) => m.role),
  );

  return (
    <>
      <PhiBanner />
      <main className="mx-auto max-w-lg px-6 py-16">
        <p className="id text-xs uppercase tracking-widest text-ink-2">Medeal</p>
        <h1 className="mt-4 text-2xl">Set up two-factor authentication</h1>
        <p className="mt-2 text-sm text-ink-2">
          {required
            ? 'Your role can change appeal records, so a second factor is required before you can work.'
            : 'Your account is read only, so this is optional. It is still worth doing.'}
        </p>
        <EnrollTwoFactor required={required} next={landingFor(principal)} />
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
