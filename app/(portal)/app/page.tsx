import { requirePrincipal } from '@/lib/auth/guards';
import { EmptyState } from '@/components/ui/primitives';

export const metadata = { title: 'Dashboard' };

export default async function AppDashboard() {
  const principal = await requirePrincipal();
  const org = principal.memberships[0];

  if (!org) {
    return (
      <EmptyState
        title="Your account is not attached to an organisation yet"
        body="Ask your administrator to add you to one. Until then there is nothing here for you to work on."
      />
    );
  }

  return (
    <div className="p-4">
      <h1 className="text-lg">{org.organizationName}</h1>
    </div>
  );
}
