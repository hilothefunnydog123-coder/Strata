'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { twoFactor } from '@/lib/auth/client';
import { Button } from '@/components/ui/button';
import { Field, Input } from '@/components/ui/field';
import { ErrorState, Notice, Panel } from '@/components/ui/primitives';

type Stage =
  | { step: 'password' }
  | { step: 'verify'; uri: string; backupCodes: string[] }
  | { step: 'done'; backupCodes: string[] };

/**
 * Three steps, because that is what the flow genuinely needs: confirm the
 * password so a hijacked session cannot enrol its own authenticator, show the
 * secret, then prove the authenticator works before the factor is switched on.
 */
export function EnrollTwoFactor({
  required,
  next,
}: {
  required: boolean;
  next: string;
}) {
  const router = useRouter();
  const [stage, setStage] = useState<Stage>({ step: 'password' });
  const [password, setPassword] = useState('');
  const [code, setCode] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function begin(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    setError(null);

    const result = await twoFactor.enable({ password });
    setBusy(false);

    if (result.error || !result.data) {
      setError('That password is not right. Enter the one you just signed in with.');
      return;
    }

    setStage({
      step: 'verify',
      uri: result.data.totpURI,
      backupCodes: result.data.backupCodes,
    });
  }

  async function confirm(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    setError(null);

    const result = await twoFactor.verifyTotp({ code });
    setBusy(false);

    if (result.error) {
      setError(
        'That code is not valid. Codes change every 30 seconds, so use the one showing now.',
      );
      return;
    }

    setStage((s) =>
      s.step === 'verify' ? { step: 'done', backupCodes: s.backupCodes } : s,
    );
  }

  if (stage.step === 'password') {
    return (
      <form onSubmit={begin} className="mt-8 space-y-5" noValidate>
        {error ? <ErrorState title="Could not start setup" body={error} /> : null}
        <Field
          label="Confirm your password"
          name="password"
          required
          hint="This stops someone who has taken over your session from enrolling their own device."
        >
          {(props) => (
            <Input
              {...props}
              type="password"
              autoComplete="current-password"
              autoFocus
              value={password}
              onChange={(e) => setPassword(e.target.value)}
            />
          )}
        </Field>
        <Button type="submit" intent="primary" disabled={busy}>
          {busy ? 'Working' : 'Continue'}
        </Button>
      </form>
    );
  }

  if (stage.step === 'verify') {
    const secret = new URL(stage.uri).searchParams.get('secret') ?? '';
    return (
      <div className="mt-8 space-y-6">
        <Panel className="p-4">
          <h2 className="text-sm font-semibold">1. Add Strata to your authenticator</h2>
          <p className="mt-1 text-sm text-ink-2">
            Enter this key in your authenticator app, or paste the full setup link.
          </p>
          <p
            data-testid="totp-secret"
            className="id mt-3 break-all border border-rule bg-paper px-3 py-2 text-sm"
          >
            {secret}
          </p>
          <details className="mt-2">
            <summary className="cursor-pointer text-xs text-action">
              Show the full setup link
            </summary>
            <p className="id mt-2 break-all border border-rule bg-paper px-3 py-2 text-xs">
              {stage.uri}
            </p>
          </details>
        </Panel>

        <Panel className="p-4">
          <h2 className="text-sm font-semibold">2. Save your backup codes</h2>
          <p className="mt-1 text-sm text-ink-2">
            Each code works once, and they are the only way in if you lose your
            phone. Store them somewhere other than the device running your
            authenticator.
          </p>
          <ul className="id mt-3 grid grid-cols-2 gap-x-6 gap-y-1 border border-rule bg-paper px-3 py-2 text-sm">
            {stage.backupCodes.map((c) => (
              <li key={c} data-testid="backup-code">
                {c}
              </li>
            ))}
          </ul>
        </Panel>

        <form onSubmit={confirm} className="space-y-4" noValidate>
          <h2 className="text-sm font-semibold">3. Prove it works</h2>
          {error ? <ErrorState title="Code not accepted" body={error} /> : null}
          <Field label="Six digit code" name="code" required>
            {(props) => (
              <Input
                {...props}
                className="id tracking-[0.3em]"
                inputMode="numeric"
                autoComplete="one-time-code"
                value={code}
                onChange={(e) => setCode(e.target.value.trim())}
              />
            )}
          </Field>
          <Button type="submit" intent="primary" disabled={busy}>
            {busy ? 'Checking' : 'Turn on two-factor'}
          </Button>
        </form>
      </div>
    );
  }

  return (
    <div className="mt-8 space-y-6">
      <Notice tone="recovered">
        Two-factor authentication is on. You will be asked for a code each time
        you sign in.
      </Notice>
      <Panel className="p-4">
        <h2 className="text-sm font-semibold">Your backup codes, one last time</h2>
        <ul className="id mt-3 grid grid-cols-2 gap-x-6 gap-y-1 border border-rule bg-paper px-3 py-2 text-sm">
          {stage.backupCodes.map((c) => (
            <li key={c}>{c}</li>
          ))}
        </ul>
      </Panel>
      <Button
        intent="primary"
        onClick={() => {
          router.push(next);
          router.refresh();
        }}
      >
        {required ? 'Go to my work' : 'Continue'}
      </Button>
    </div>
  );
}
