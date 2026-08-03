import type { Metadata } from 'next';
import { asc, eq, sql } from 'drizzle-orm';
import { assertPlatformOrForbid, requirePrincipal } from '@/lib/auth/guards';
import { analyticsQuery } from '@/lib/analytics/guard';
import { db } from '@/lib/db';
import { organization, user } from '@/lib/db/schema';
import {
  EmptyState,
  Panel,
  PanelHeader,
  Table,
  Td,
  Th,
} from '@/components/ui/primitives';
import { ProvisionForm, UserRow } from './client';

export const metadata: Metadata = { title: 'Users' };

export default async function UsersPage() {
  const principal = await requirePrincipal();
  assertPlatformOrForbid(principal, 'admin:users');

  const { users, orgs } = await analyticsQuery(
    ['user', 'member', 'organization'],
    async () => {
      const [users, orgs] = await Promise.all([
        db
          .select({
            id: user.id,
            email: user.email,
            name: user.name,
            status: user.status,
            platformRole: user.platformRole,
            twoFactorEnabled: user.twoFactorEnabled,
            mustChangePassword: user.mustChangePassword,
            createdAt: user.createdAt,
            memberships: sql<string>`coalesce((
              select string_agg(o.name || ' (' || m.role || ')', ', ')
              from member m join organization o on o.id = m.organization_id
              where m.user_id = "user"."id"
            ), '')`,
            reviewerOrgs: sql<string>`coalesce((
              select string_agg(o.name, ', ')
              from reviewer_assignment ra join organization o on o.id = ra.organization_id
              where ra.user_id = "user"."id"
            ), '')`,
          })
          .from(user)
          .orderBy(asc(user.email)),
        db
          .select({ id: organization.id, name: organization.name })
          .from(organization)
          .where(eq(organization.status, 'active'))
          .orderBy(asc(organization.name)),
      ]);
      return { users, orgs };
    },
  );

  return (
    <div className="px-4 py-5">
      <h1 className="text-lg">Users</h1>
      <p className="mt-1 max-w-3xl text-sm text-ink-2">
        There is no signup route. Every account is created here, always lands
        with a temporary password, and must change it before it can do anything.
        Every role above read only must then enrol two-factor.
      </p>

      <ProvisionForm organizations={orgs} />

      <Panel className="mt-6">
        <PanelHeader title={`${users.length} ${users.length === 1 ? 'account' : 'accounts'}`} />
        {users.length === 0 ? (
          <EmptyState
            title="No accounts yet"
            body="Provision one above. Run pnpm provision:superadmin if you need the first operator."
          />
        ) : (
          <Table>
            <thead>
              <tr>
                <Th>Email</Th>
                <Th>Name</Th>
                <Th>Platform role</Th>
                <Th>Organisations</Th>
                <Th>2FA</Th>
                <Th>Status</Th>
                <Th>Actions</Th>
              </tr>
            </thead>
            <tbody>
              {users.map((u) => (
                <UserRow
                  key={u.id}
                  id={u.id}
                  email={u.email}
                  name={u.name}
                  status={u.status}
                  platformRole={u.platformRole}
                  twoFactorEnabled={u.twoFactorEnabled}
                  mustChangePassword={u.mustChangePassword}
                  memberships={u.memberships}
                  reviewerOrgs={u.reviewerOrgs}
                  isSelf={u.id === principal.userId}
                />
              ))}
            </tbody>
          </Table>
        )}
      </Panel>
    </div>
  );
}

export { Td };
