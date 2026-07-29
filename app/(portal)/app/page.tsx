import type { Metadata } from 'next';
import Link from 'next/link';
import { requirePrincipal, type Membership } from '@/lib/auth/guards';
import { dashboardFigures } from '@/lib/denials/queries';
import { STATUS_LABELS, type Status } from '@/lib/appeals/workflow';
import {
  EmptyState,
  formatDollars,
  Money,
  Panel,
  PanelHeader,
  Table,
  Td,
  Th,
} from '@/components/ui/primitives';

export const metadata: Metadata = { title: 'Dashboard' };

export default async function AppDashboard({
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
        body="Ask your administrator to add you to one. Until then there is nothing here for you to work on."
      />
    );
  }

  const figures = await dashboardFigures(membership.organizationId);

  if (figures.totalDenials === 0) {
    return (
      <div className="mx-auto max-w-2xl px-4 py-16">
        <h1 className="text-xl">{membership.organizationName}</h1>
        <div className="mt-6 border border-rule bg-paper-2 p-6">
          <p className="text-sm font-semibold">No denials yet</p>
          <p className="mt-2 text-sm text-ink-2">
            Start with one. Upload the denial letter and whatever documentation
            supports the stay, and you will get back a drafted appeal in which
            every legal claim cites a published decision and every clinical claim
            cites a line in your own record.
          </p>
          <p className="mt-2 text-sm text-ink-2">
            The figures on this page are computed from your cases. They stay empty
            until there are some, rather than showing numbers that mean nothing.
          </p>
          <p className="mt-5">
            <Link href="/app/denials/new" className="font-medium">
              Add your first denial
            </Link>
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="px-4 py-5">
      {/* The hero figure. Total recovered is the emotional core of the product,
          so it is set enormous and alone. */}
      <section>
        <p className="text-2xs uppercase tracking-widest text-ink-2">
          Recovered to date, {membership.organizationName}
        </p>
        <p className="tnum mt-1 text-6xl font-semibold leading-none text-recovered sm:text-7xl">
          {formatDollars(figures.totalRecoveredCents)}
        </p>
        <p className="mt-2 text-sm text-ink-2">
          From {figures.decided.won + figures.decided.partial} overturned{' '}
          {figures.decided.won + figures.decided.partial === 1 ? 'appeal' : 'appeals'}.
          {figures.feesBilledCents > 0 ? (
            <>
              {' '}
              Fees billed to date <Money cents={figures.feesBilledCents} />.
            </>
          ) : null}
        </p>
      </section>

      <div className="mt-6 grid gap-px border border-rule bg-rule sm:grid-cols-2 lg:grid-cols-5">
        <Tile label="Recovered this month">
          <Money cents={figures.recoveredThisMonthCents} tone="recovered" whole />
        </Tile>
        <Tile label="At risk, in flight">
          <Money cents={figures.atRiskCents} tone="denied" whole />
        </Tile>
        <Tile label="Win rate">
          {figures.winRatePercent === null ? (
            <span className="text-base font-normal text-ink-2">no decisions yet</span>
          ) : (
            <span className="tnum">{figures.winRatePercent}%</span>
          )}
        </Tile>
        <Tile label="Average days to decision">
          {figures.averageDaysToDecision === null ? (
            <span className="text-base font-normal text-ink-2">no decisions yet</span>
          ) : (
            <span className="tnum">{figures.averageDaysToDecision}</span>
          )}
        </Tile>
        <Tile label="Due inside 7 days">
          <span
            className={`tnum ${figures.deadlinesInside7Days > 0 ? 'text-denied' : ''}`}
          >
            {figures.deadlinesInside7Days}
          </span>
          {figures.deadlinesPassed > 0 ? (
            <span className="ml-2 text-sm text-denied">
              {figures.deadlinesPassed} passed
            </span>
          ) : null}
        </Tile>
      </div>

      <Panel className="mt-6">
        <PanelHeader title="In flight by stage">
          <Link href="/app/denials" className="text-xs">
            All denials
          </Link>
        </PanelHeader>
        <Table>
          <thead>
            <tr>
              <Th>Stage</Th>
              <Th numeric>Cases</Th>
              <Th numeric>Amount at issue</Th>
            </tr>
          </thead>
          <tbody>
            {figures.inFlightByStage.map((row) => (
              <tr key={row.status}>
                <Td>
                  <Link href={`/app/denials?status=${row.status}`}>
                    {STATUS_LABELS[row.status as Status]}
                  </Link>
                </Td>
                <Td numeric>{row.count}</Td>
                <Td numeric>
                  <Money cents={row.amountCents} whole />
                </Td>
              </tr>
            ))}
          </tbody>
        </Table>
      </Panel>
    </div>
  );
}

function Tile({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="bg-paper-2 p-3">
      <p className="text-2xs uppercase tracking-wider text-ink-2">{label}</p>
      <p className="mt-1 text-2xl font-semibold">{children}</p>
    </div>
  );
}
