'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { twoFactor } from '@/lib/auth/client';
import { Button } from '@/components/ui/button';
import { Field, Input } from '@/components/ui/field';
import { ErrorState } from '@/components/ui/primitives';

export function TwoFactorForm({ next }: { next?: string | undefined }) {
  const router = useRouter();
  const [code, setCode] = useState('');
  const [useBackup, setUseBackup] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function onSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    setError(null);

    const result = useBackup
      ? await twoFactor.verifyBackupCode({ code })
      : await twoFactor.verifyTotp({ code });

    if (result.error) {
      setBusy(false);
      setError(
        useBackup
          ? 'That backup code is not valid, or it has already been used. Each one works once.'
          : 'That code is not valid. Codes change every 30 seconds, so check your authenticator for the current one.',
      );
      return;
    }

    router.push(`/after-sign-in${next ? `?next=${encodeURIComponent(next)}` : ''}`);
    router.refresh();
  }

  return (
    <main className="mx-auto flex min-h-screen max-w-sm flex-col justify-center px-6 py-16">
      <p className="id text-xs uppercase tracking-widest text-ink-2">Medeal</p>
      <h1 className="mt-4 text-2xl">
        {useBackup ? 'Enter a backup code' : 'Enter your code'}
      </h1>
      <p className="mt-2 text-sm text-ink-2">
        {useBackup
          ? 'Backup codes work once each. Using one does not disable your authenticator.'
          : 'Open your authenticator app and enter the six digit code for Medeal.'}
      </p>

      <form onSubmit={onSubmit} className="mt-8 space-y-5" noValidate>
        {error ? <ErrorState title="Verification failed" body={error} /> : null}

        <Field label={useBackup ? 'Backup code' : 'Six digit code'} name="code" required>
          {(props) => (
            <Input
              {...props}
              className="id tracking-[0.3em]"
              inputMode={useBackup ? 'text' : 'numeric'}
              autoComplete="one-time-code"
              autoFocus
              value={code}
              onChange={(e) => setCode(e.target.value.trim())}
            />
          )}
        </Field>

        <Button type="submit" intent="primary" disabled={busy} className="w-full">
          {busy ? 'Checking' : 'Verify'}
        </Button>

        <Button
          intent="quiet"
          size="sm"
          className="w-full"
          onClick={() => {
            setUseBackup((v) => !v);
            setCode('');
            setError(null);
          }}
        >
          {useBackup ? 'Use my authenticator instead' : 'I do not have my authenticator'}
        </Button>
      </form>
    </main>
  );
}
