import Link from 'next/link';
import { requirePrincipal } from '@/lib/auth/guards';
import { PhiBanner } from '@/components/phi-banner';
import { Panel, PanelHeader, Tag } from '@/components/ui/primitives';

export const metadata = { title: 'Your account' };

export default async function AccountPage() {
  const principal = await requirePrincipal();

  return (
    <>
      <PhiBanner />
      <main className="mx-auto max-w-xl px-6 py-12">
        <h1 className="text-2xl">Your account</h1>
        <Panel className="mt-6">
          <PanelHeader title="Sign in" />
          <dl className="divide-y divide-rule text-sm">
            <div className="flex justify-between gap-4 px-3 py-2">
              <dt className="text-ink-2">Email</dt>
              <dd className="id">{principal.email}</dd>
            </div>
            <div className="flex justify-between gap-4 px-3 py-2">
              <dt className="text-ink-2">Two-factor</dt>
              <dd>
                {principal.twoFactorEnabled ? (
                  <Tag tone="recovered">On</Tag>
                ) : (
                  <Link href="/account/two-factor">Set it up</Link>
                )}
              </dd>
            </div>
            <div className="flex justify-between gap-4 px-3 py-2">
              <dt className="text-ink-2">Password</dt>
              <dd>
                <Link href="/account/password">Change it</Link>
              </dd>
            </div>
          </dl>
        </Panel>
      </main>
    </>
  );
}
