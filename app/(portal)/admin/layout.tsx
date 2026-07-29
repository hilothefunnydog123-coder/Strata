import { forbidden, redirect } from 'next/navigation';
import { Shell } from '@/components/shell';
import {
  canEnterGroup,
  pendingAccountAction,
  requirePrincipal,
} from '@/lib/auth/guards';

export default async function AdminLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const principal = await requirePrincipal();

  const pending = pendingAccountAction(principal);
  if (pending) redirect(pending);

  if (!canEnterGroup(principal, 'admin')) forbidden();

  return (
    <Shell
      surface="Operator"
      principal={principal}
      nav={[
        { href: '/admin', label: 'Overview' },
        { href: '/admin/organizations', label: 'Organisations' },
        { href: '/admin/users', label: 'Users' },
        { href: '/admin/appeals', label: 'Appeals' },
        { href: '/admin/corpus', label: 'Corpus' },
        { href: '/admin/spend', label: 'Spend' },
        { href: '/admin/jobs', label: 'Jobs' },
        { href: '/admin/email', label: 'Email' },
        { href: '/admin/demo-requests', label: 'Demo requests' },
      ]}
    >
      {children}
    </Shell>
  );
}
