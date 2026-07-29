'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { authClient } from '@/lib/auth/client';
import { clearMustChangePassword } from './actions';
import { Button } from '@/components/ui/button';
import { Field, Input } from '@/components/ui/field';
import { ErrorState } from '@/components/ui/primitives';

export function ChangePasswordForm() {
  const router = useRouter();
  const [current, setCurrent] = useState('');
  const [fresh, setFresh] = useState('');
  const [confirm, setConfirm] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [fieldError, setFieldError] = useState<{ fresh?: string; confirm?: string }>({});
  const [busy, setBusy] = useState(false);

  async function onSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    setFieldError({});

    if (fresh.length < 12) {
      setFieldError({ fresh: 'Use at least 12 characters.' });
      return;
    }
    if (fresh !== confirm) {
      setFieldError({ confirm: 'These two do not match. Retype the second one.' });
      return;
    }
    if (fresh === current) {
      setFieldError({ fresh: 'This is the password you already have. Pick a different one.' });
      return;
    }

    setBusy(true);
    const result = await authClient.changePassword({
      currentPassword: current,
      newPassword: fresh,
      // Every other session for this account ends. If the reason for the change
      // was that the old password leaked, leaving those alive defeats it.
      revokeOtherSessions: true,
    });

    if (result.error) {
      setBusy(false);
      setError('The current password is not right. Enter the one you signed in with.');
      return;
    }

    await clearMustChangePassword();
    // Back through the server, which will send them to two-factor enrolment if
    // their role needs it, or to their work if it does not.
    router.push('/after-sign-in');
    router.refresh();
  }

  return (
    <form onSubmit={onSubmit} className="mt-8 space-y-5" noValidate>
      {error ? <ErrorState title="Could not change it" body={error} /> : null}

      <Field label="Current password" name="current" required>
        {(props) => (
          <Input
            {...props}
            type="password"
            autoComplete="current-password"
            autoFocus
            value={current}
            onChange={(e) => setCurrent(e.target.value)}
          />
        )}
      </Field>

      <Field
        label="New password"
        name="fresh"
        required
        error={fieldError.fresh}
        hint="At least 12 characters."
      >
        {(props) => (
          <Input
            {...props}
            type="password"
            autoComplete="new-password"
            invalid={Boolean(fieldError.fresh)}
            value={fresh}
            onChange={(e) => setFresh(e.target.value)}
          />
        )}
      </Field>

      <Field label="New password again" name="confirm" required error={fieldError.confirm}>
        {(props) => (
          <Input
            {...props}
            type="password"
            autoComplete="new-password"
            invalid={Boolean(fieldError.confirm)}
            value={confirm}
            onChange={(e) => setConfirm(e.target.value)}
          />
        )}
      </Field>

      <Button type="submit" intent="primary" disabled={busy}>
        {busy ? 'Changing' : 'Change password'}
      </Button>
    </form>
  );
}
