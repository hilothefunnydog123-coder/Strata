import type { Metadata } from 'next';
import { asc, count, eq, sql } from 'drizzle-orm';
import { assertPlatformOrForbid, requirePrincipal } from '@/lib/auth/guards';
import { analyticsQuery } from '@/lib/analytics/guard';
import { db } from '@/lib/db';
import { invoice, member, organization } from '@/lib/db/schema';
import { formatRate } from '@/lib/billing/invoice';
import {
  EmptyState,
  Money,
  Panel,
  PanelHeader,
  Table,
  Tag,
  Td,
  Th,
} from '@/components/ui/primitives';
import { OrganizationRow, NewOrganizationForm } from './client';

export const metadata: Metadata = { title: 'Organisations' };

export default async function OrganizationsPage() {
  const principal = await requirePrincipal();
  assertPlatformOrForbid(principal, 'admin:organizations');

  // Cross-organisation, so it declares itself as analytics and therefore cannot
  // reach into a PHI table. Revenue comes from invoices, which carry money and
  // an organisation id and nothing about a patient.
  const rows = await analyticsQuery(['organization', 'member', 'invoice'], () =>
    db
      .select({
        id: organization.id,
        name: organization.name,
        slug: organization.slug,
        status: organization.status,
        contingencyRateBps: organization.contingencyRateBps,
        createdAt: organization.createdAt,
        members: sql<number>`(
          select count(*)::int from member m where m.organization_id = ${organization.id}
        )`,
        feesCents: sql<number>`(
          select coalesce(sum(i.fee_cents), 0)::int from invoice i
          where i.organization_id = ${organization.id}
        )`,
      })
      .from(organization)
      .orderBy(asc(organization.name)),
  );

  return (
    <div className="px-4 py-5">
      <h1 className="text-lg">Organisations</h1>

      <NewOrganizationForm />

      <Panel className="mt-6">
        <PanelHeader title={`${rows.length} ${rows.length === 1 ? 'organisation' : 'organisations'}`} />
        {rows.length === 0 ? (
          <EmptyState
            title="No organisations yet"
            body="Create one above. A customer organisation is what users, denials, and invoices all hang off."
          />
        ) : (
          <Table>
            <thead>
              <tr>
                <Th>Name</Th>
                <Th>Slug</Th>
                <Th numeric>Members</Th>
                <Th numeric>Rate</Th>
                <Th numeric>Fees billed</Th>
                <Th>Status</Th>
                <Th>Actions</Th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => (
                <OrganizationRow
                  key={row.id}
                  id={row.id}
                  name={row.name}
                  slug={row.slug}
                  status={row.status}
                  members={row.members}
                  ratePercent={row.contingencyRateBps / 100}
                  rateLabel={formatRate(row.contingencyRateBps)}
                  feesCents={row.feesCents}
                />
              ))}
            </tbody>
          </Table>
        )}
      </Panel>
    </div>
  );
}

export { Money, Tag, Td, count, eq, invoice, member };
