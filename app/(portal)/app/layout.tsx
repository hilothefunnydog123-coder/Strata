import { forbidden, redirect } from 'next/navigation';
import { Shell } from '@/components/shell';
import {
  canEnterGroup,
  pendingAccountAction,
  requirePrincipal,
} from '@/lib/auth/guards';
import { OrgSwitcher } from './org-switcher';

/**
 * Entry to the client portal.
 *
 * This runs on the server for every route beneath /app and cannot be skipped by
 * any page under it, which is why the authoritative role decision lives here
 * rather than in middleware. Middleware only turned away requests with no
 * session cookie at all.
 */
export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const principal = await requirePrincipal();

  const pending = pendingAccountAction(principal);
  if (pending) redirect(pending);

  if (!canEnterGroup(principal, 'app')) forbidden();

  return (
    <Shell
      surface="Appeals"
      principal={principal}
      context={<OrgSwitcher memberships={principal.memberships} />}
      nav={[
        { href: '/app', label: 'Dashboard' },
        { href: '/app/denials', label: 'Denials' },
        { href: '/app/invoices', label: 'Invoices' },
        { href: '/app/team', label: 'Team' },
      ]}
    >
      {children}
    </Shell>
  );
}
