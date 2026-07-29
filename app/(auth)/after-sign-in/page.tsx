import { redirect } from 'next/navigation';
import { getPrincipal, pendingAccountAction } from '@/lib/auth/guards';
import { landingFor } from '@/lib/auth/landing';

/**
 * Where a session goes once it exists.
 *
 * The sign in form cannot decide this: it knows an email and a password, not a
 * role, not whether the password is temporary, and not whether two-factor is
 * enrolled. Sending the browser here and letting the server answer keeps the
 * decision in one place and, more importantly, keeps the account gates on the
 * path every sign in takes rather than only on the surfaces middleware covers.
 *
 * A client that redirected itself straight to a public page would slip past
 * those gates entirely, which is exactly the bug this route exists to prevent.
 */
export default async function AfterSignIn({
  searchParams,
}: {
  searchParams: Promise<{ next?: string }>;
}) {
  const principal = await getPrincipal();
  if (!principal) redirect('/sign-in');

  const pending = pendingAccountAction(principal);
  if (pending) redirect(pending);

  const { next } = await searchParams;
  const safe = next && next.startsWith('/') && !next.startsWith('//') ? next : null;

  redirect(safe ?? landingFor(principal));
}
