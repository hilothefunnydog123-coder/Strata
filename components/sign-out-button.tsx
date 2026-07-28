'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { signOut } from '@/lib/auth/client';
import { Button } from '@/components/ui/button';

export function SignOutButton() {
  const router = useRouter();
  const [busy, setBusy] = useState(false);

  return (
    <Button
      size="sm"
      intent="quiet"
      disabled={busy}
      onClick={async () => {
        setBusy(true);
        await signOut();
        router.push('/sign-in');
        router.refresh();
      }}
    >
      {busy ? 'Signing out' : 'Sign out'}
    </Button>
  );
}
