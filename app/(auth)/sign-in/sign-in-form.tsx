'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { signIn } from '@/lib/auth/client';
import { Button } from '@/components/ui/button';
import { Field, Input } from '@/components/ui/field';
import { ErrorState } from '@/components/ui/primitives';

export function SignInForm({ next }: { next?: string | undefined }) {
  const router = useRouter();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function onSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    setError(null);

    const result = await signIn.email({ email, password });

    if (result.error) {
      setBusy(false);
      // A specific message here would tell an attacker which half was right.
      // A rate limited response must not be reported as a wrong password. It
      // sends someone off hunting for a typo that is not there, and it is the
      // sort of thing a whole department hits at once when they share an
      // address.
      if (result.error.status === 429) {
        setError(
          'Too many sign in attempts from your network in the last minute. Wait a minute and try again.',
        );
        return;
      }
      setError(
        result.error.status === 403
          ? 'This account is not active. Ask your administrator to re-enable it.'
          : 'That email and password do not match an account. Check both and try again.',
      );
      return;
    }

    const query = next ? `?next=${encodeURIComponent(next)}` : '';

    const data = result.data as { twoFactorRedirect?: boolean } | null;
    if (data?.twoFactorRedirect) {
      router.push(`/sign-in/two-factor${query}`);
      return;
    }

    // The server decides where this account belongs, and enforces the password
    // and two-factor gates on the way.
    router.push(`/after-sign-in${query}`);
    router.refresh();
  }

  return (
    <main className="mx-auto flex min-h-screen max-w-sm flex-col justify-center px-6 py-16">
      <p className="id text-xs uppercase tracking-widest text-ink-2">Medeal</p>
      <h1 className="mt-4 text-2xl">Sign in</h1>
      <p className="mt-2 text-sm text-ink-2">
        Accounts are created by your administrator. There is no self signup.
      </p>

      <form onSubmit={onSubmit} className="mt-8 space-y-5" noValidate>
        {error ? <ErrorState title="Sign in failed" body={error} /> : null}

        <Field label="Work email" name="email" required>
          {(props) => (
            <Input
              {...props}
              type="email"
              autoComplete="username"
              autoFocus
              value={email}
              onChange={(e) => setEmail(e.target.value)}
            />
          )}
        </Field>

        <Field label="Password" name="password" required>
          {(props) => (
            <Input
              {...props}
              type="password"
              autoComplete="current-password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
            />
          )}
        </Field>

        <Button type="submit" intent="primary" disabled={busy} className="w-full">
          {busy ? 'Signing in' : 'Sign in'}
        </Button>
      </form>
    </main>
  );
}
