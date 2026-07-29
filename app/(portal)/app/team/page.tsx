import type { Metadata } from 'next';
import { asc, eq } from 'drizzle-orm';
import { assertCanOrForbid, requirePrincipal, type Membership } from '@/lib/auth/guards';
import { db } from '@/lib/db';
import { member, user } from '@/lib/db/schema';
import {
  EmptyState,
  Panel,
  PanelHeader,
  Table,
  Tag,
  Td,
  Th,
} from '@/components/ui/primitives';

export const metadata: Metadata = { title: 'Team' };

const ROLE_LABELS: Record<string, string> = {
  org_admin: 'Organisation admin',
  appeal_specialist: 'Appeal specialist',
  readonly: 'Read only',
};

export default async function TeamPage({
  searchParams,
}: {
  searchParams: Promise<{ org?: string }>;
}) {
  const principal = await requirePrincipal();
  const { org } = await searchParams;

  const membership: Membership | undefined =
    principal.memberships.find((m) => m.organizationId === org) ??
    principal.memberships[0];

  if (!membership) {
    return (
      <EmptyState
        title="Your account is not attached to an organisation yet"
        body="Ask your administrator to add you to one."
      />
    );
  }

  assertCanOrForbid(principal, membership.organizationId, 'org:read_members');

  const rows = await db
    .select({
      id: user.id,
      email: user.email,
      name: user.name,
      status: user.status,
      role: member.role,
      twoFactorEnabled: user.twoFactorEnabled,
      mustChangePassword: user.mustChangePassword,
    })
    .from(member)
    .innerJoin(user, eq(member.userId, user.id))
    .where(eq(member.organizationId, membership.organizationId))
    .orderBy(asc(user.email));

  return (
    <div className="px-4 py-5">
      <h1 className="text-lg">Team at {membership.organizationName}</h1>
      <p className="mt-1 max-w-2xl text-sm text-ink-2">
        Accounts are created by Strata rather than by signup. Ask us to add
        someone and they will get a one-time password that they must change, and
        a second factor to enrol if their role can change a record.
      </p>

      <Panel className="mt-4">
        <PanelHeader title={`${rows.length} ${rows.length === 1 ? 'person' : 'people'}`} />
        {rows.length === 0 ? (
          <EmptyState
            title="Nobody here yet"
            body="That should not be possible, since you are reading this. Tell us and we will look."
          />
        ) : (
          <Table>
            <thead>
              <tr>
                <Th>Email</Th>
                <Th>Name</Th>
                <Th>Role</Th>
                <Th>Two-factor</Th>
                <Th>Status</Th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => (
                <tr key={row.id} className="hover:bg-paper">
                  <Td>
                    <span className="id text-xs">{row.email}</span>
                  </Td>
                  <Td>{row.name}</Td>
                  <Td>{ROLE_LABELS[row.role] ?? row.role}</Td>
                  <Td>
                    {row.twoFactorEnabled ? (
                      <Tag tone="recovered">on</Tag>
                    ) : row.role === 'readonly' ? (
                      <span className="text-xs text-ink-2">not required</span>
                    ) : (
                      <Tag tone="denied">not enrolled</Tag>
                    )}
                  </Td>
                  <Td>
                    <Tag tone={row.status === 'active' ? 'recovered' : 'denied'}>
                      {row.status}
                    </Tag>
                    {row.mustChangePassword ? (
                      <span className="ml-1.5 text-2xs text-ink-2">
                        password pending
                      </span>
                    ) : null}
                  </Td>
                </tr>
              ))}
            </tbody>
          </Table>
        )}
      </Panel>
    </div>
  );
}
