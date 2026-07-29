import type { Metadata } from 'next';
import { desc, sql } from 'drizzle-orm';
import { assertPlatformOrForbid, requirePrincipal } from '@/lib/auth/guards';
import { analyticsQuery } from '@/lib/analytics/guard';
import { db } from '@/lib/db';
import { llmCall } from '@/lib/db/schema';
import {
  EmptyState,
  Money,
  Panel,
  PanelHeader,
  Table,
  Td,
  Th,
} from '@/components/ui/primitives';

export const metadata: Metadata = { title: 'Model spend' };

export default async function SpendPage() {
  const principal = await requirePrincipal();
  assertPlatformOrForbid(principal, 'admin:spend');

  // Declared as analytics, which is what stops this reaching across into a PHI
  // table for a figure. llm_call carries a hash of the prompt and never the
  // prompt itself, which is why it is safe to aggregate here.
  const { byStage, daily, perAppeal } = await analyticsQuery(
    ['llm_call'],
    async () => {
      const [byStage, daily, perAppeal] = await Promise.all([
        db
          .select({
            stage: llmCall.stage,
            calls: sql<number>`count(*)::int`,
            failed: sql<number>`count(*) filter (where not ${llmCall.ok})::int`,
            costCents: sql<number>`coalesce(sum(${llmCall.costCents}), 0)::int`,
            promptTokens: sql<number>`coalesce(sum(${llmCall.promptTokens}), 0)::int`,
            completionTokens: sql<number>`coalesce(sum(${llmCall.completionTokens}), 0)::int`,
            medianLatency: sql<number>`coalesce(percentile_cont(0.5) within group (order by ${llmCall.latencyMs}), 0)::int`,
          })
          .from(llmCall)
          .groupBy(llmCall.stage),

        db
          .select({
            day: sql<string>`to_char(${llmCall.createdAt}, 'YYYY-MM-DD')`,
            calls: sql<number>`count(*)::int`,
            costCents: sql<number>`coalesce(sum(${llmCall.costCents}), 0)::int`,
          })
          .from(llmCall)
          .groupBy(sql`to_char(${llmCall.createdAt}, 'YYYY-MM-DD')`)
          .orderBy(desc(sql`to_char(${llmCall.createdAt}, 'YYYY-MM-DD')`))
          .limit(30),

        db
          .select({
            appeals: sql<number>`count(distinct ${llmCall.denialId})::int`,
            costCents: sql<number>`coalesce(sum(${llmCall.costCents}), 0)::int`,
          })
          .from(llmCall),
      ]);
      return { byStage, daily, perAppeal };
    },
  );

  const totalCost = byStage.reduce((sum, row) => sum + row.costCents, 0);
  const appeals = perAppeal[0]?.appeals ?? 0;
  const costPerAppeal = appeals === 0 ? null : Math.round(totalCost / appeals);

  return (
    <div className="px-4 py-5">
      <h1 className="text-lg">Model spend</h1>
      <p className="mt-1 max-w-3xl text-sm text-ink-2">
        What the model costs, by stage. Prompts are never stored: each row here
        carries a hash of the input, the token counts, the latency, and the cost,
        which is everything spend reporting needs and nothing more.
      </p>

      <div className="mt-4 grid gap-px border border-rule bg-rule sm:grid-cols-3">
        <div className="bg-paper-2 p-3">
          <p className="text-2xs uppercase tracking-wider text-ink-2">Total spend</p>
          <p className="mt-1 text-2xl font-semibold">
            <Money cents={totalCost} />
          </p>
        </div>
        <div className="bg-paper-2 p-3">
          <p className="text-2xs uppercase tracking-wider text-ink-2">
            Appeals with model spend
          </p>
          <p className="tnum mt-1 text-2xl font-semibold">{appeals}</p>
        </div>
        <div className="bg-paper-2 p-3">
          <p className="text-2xs uppercase tracking-wider text-ink-2">
            Cost per appeal
          </p>
          <p className="mt-1 text-2xl font-semibold">
            {costPerAppeal === null ? (
              <span className="text-base font-normal text-ink-2">
                nothing generated yet
              </span>
            ) : (
              <Money cents={costPerAppeal} />
            )}
          </p>
        </div>
      </div>

      <Panel className="mt-6">
        <PanelHeader title="By stage" />
        {byStage.length === 0 ? (
          <EmptyState
            title="No model calls yet"
            body="Spend appears here as soon as a corpus extraction or an appeal generation runs."
          />
        ) : (
          <Table>
            <thead>
              <tr>
                <Th>Stage</Th>
                <Th numeric>Calls</Th>
                <Th numeric>Failed</Th>
                <Th numeric>Input tokens</Th>
                <Th numeric>Output tokens</Th>
                <Th numeric>Median latency</Th>
                <Th numeric>Cost</Th>
              </tr>
            </thead>
            <tbody>
              {byStage.map((row) => (
                <tr key={row.stage}>
                  <Td>{row.stage.replace(/_/g, ' ')}</Td>
                  <Td numeric>{row.calls}</Td>
                  <Td numeric>
                    <span className={row.failed > 0 ? 'text-denied' : ''}>
                      {row.failed}
                    </span>
                  </Td>
                  <Td numeric>{row.promptTokens.toLocaleString('en-US')}</Td>
                  <Td numeric>{row.completionTokens.toLocaleString('en-US')}</Td>
                  <Td numeric>{row.medianLatency.toLocaleString('en-US')} ms</Td>
                  <Td numeric>
                    <Money cents={row.costCents} />
                  </Td>
                </tr>
              ))}
            </tbody>
          </Table>
        )}
      </Panel>

      <Panel className="mt-6">
        <PanelHeader title="Daily, last 30 days with activity" />
        {daily.length === 0 ? (
          <EmptyState title="Nothing yet" body="A daily trend appears once there is spend." />
        ) : (
          <Table>
            <thead>
              <tr>
                <Th>Day</Th>
                <Th numeric>Calls</Th>
                <Th numeric>Cost</Th>
              </tr>
            </thead>
            <tbody>
              {daily.map((row) => (
                <tr key={row.day}>
                  <Td>
                    <span className="id">{row.day}</span>
                  </Td>
                  <Td numeric>{row.calls}</Td>
                  <Td numeric>
                    <Money cents={row.costCents} />
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
