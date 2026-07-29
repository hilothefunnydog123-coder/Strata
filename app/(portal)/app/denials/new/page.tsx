import type { Metadata } from 'next';
import { forbidden } from 'next/navigation';
import {
  assertCanOrForbid,
  requirePrincipal,
  type Membership,
} from '@/lib/auth/guards';
import { syntheticTagRequired } from '@/lib/denials/upload';
import { NewDenialForm } from './form';

export const metadata: Metadata = { title: 'New denial' };

export default async function NewDenialPage({
  searchParams,
}: {
  searchParams: Promise<{ org?: string }>;
}) {
  const principal = await requirePrincipal();
  const { org } = await searchParams;

  const membership: Membership | undefined =
    principal.memberships.find((m) => m.organizationId === org) ??
    principal.memberships[0];

  if (!membership) forbidden();

  assertCanOrForbid(principal, membership.organizationId, 'denial:create');

  return (
    <div className="mx-auto max-w-3xl px-4 py-6">
      <h1 className="text-lg">New denial</h1>
      <p className="mt-1 text-sm text-ink-2">
        Upload the denial letter and whatever documentation supports the stay.
        Both are parsed into passages so every later citation points at a real
        line rather than at a document in general.
      </p>

      <NewDenialForm
        organizationId={membership.organizationId}
        organizationName={membership.organizationName}
        syntheticRequired={syntheticTagRequired()}
      />
    </div>
  );
}
