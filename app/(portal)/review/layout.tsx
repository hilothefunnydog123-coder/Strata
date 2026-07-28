import { forbidden, redirect } from 'next/navigation';
import { Shell } from '@/components/shell';
import {
  canEnterGroup,
  pendingAccountAction,
  requirePrincipal,
} from '@/lib/auth/guards';

export default async function ReviewLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const principal = await requirePrincipal();

  const pending = pendingAccountAction(principal);
  if (pending) redirect(pending);

  if (!canEnterGroup(principal, 'review')) forbidden();

  return (
    <Shell
      surface={
        principal.platformRole === 'legal_reviewer' ? 'Legal review' : 'Clinical review'
      }
      principal={principal}
      nav={[{ href: '/review', label: 'Queue' }]}
    >
      {children}
    </Shell>
  );
}
