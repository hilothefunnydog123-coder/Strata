import { requirePrincipal } from '@/lib/auth/guards';
import { EmptyState } from '@/components/ui/primitives';

export const metadata = { title: 'Review queue' };

export default async function ReviewQueue() {
  const principal = await requirePrincipal();

  if (principal.reviewerOrgIds.length === 0 && principal.platformRole !== 'superadmin') {
    return (
      <EmptyState
        title="You are not assigned to any organisations"
        body="Reviewers see the queues of the hospitals they are assigned to. Ask the operator to assign you."
      />
    );
  }

  return (
    <div className="p-4">
      <h1 className="text-lg">Queue</h1>
    </div>
  );
}
