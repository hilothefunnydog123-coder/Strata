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
        { href: '/admin/demo', label: 'Demonstration' },
      ]}
    >
      {children}
    </Shell>
  );
}

// Everything behind a session is dynamic by definition: it renders from the
// signed in principal, which only exists per request. Saying so explicitly
// keeps `next build` from attempting to prerender these, which it otherwise
// tries first and abandons only once a request API is touched. That attempt is
// what made the build require a full runtime environment in order to emit
// static assets for pages that were never static.
export const dynamic = 'force-dynamic';
