import type { Metadata } from 'next';
import { assertPlatformOrForbid, requirePrincipal } from '@/lib/auth/guards';
import { corpusHealth } from '@/lib/corpus/pipeline';
import {
  EmptyState,
  Panel,
  PanelHeader,
  Table,
  Tag,
  Td,
  Th,
} from '@/components/ui/primitives';

export const metadata: Metadata = { title: 'Corpus health' };

export default async function CorpusPage() {
  const principal = await requirePrincipal();
  assertPlatformOrForbid(principal, 'admin:corpus');

  const health = await corpusHealth();

  // Holdings extraction has produced that verification has not reached yet.
  // Not failures: a holding whose quote does not check out is deleted, so this
  // can only ever mean the stages are at different points in the same run.
  const awaitingVerification = health.holdingsTotal - health.holdingsVerified;

  return (
    <div className="px-4 py-5">
      <h1 className="text-lg">Corpus</h1>
      <p className="mt-1 max-w-3xl text-sm text-ink-2">
        The published decisions and regulations every legal assertion is drawn
        from. A holding whose quote does not check out against its source is
        deleted rather than flagged, so what is counted here is what can be cited.
      </p>

      <div className="mt-4 grid gap-px border border-rule bg-rule sm:grid-cols-2 lg:grid-cols-4">
        <Tile label="Holdings verified" value={health.holdingsVerified.toLocaleString('en-US')} />
        <Tile label="Holdings total" value={health.holdingsTotal.toLocaleString('en-US')} />
        <Tile
          label="Awaiting verification"
          value={awaitingVerification.toLocaleString('en-US')}
          tone="neutral"
        />
        <Tile
          label="Embedding coverage"
          value={`${(health.embeddingCoverage * 100).toFixed(1)}%`}
        />
      </div>

      {awaitingVerification > 0 ? (
        <div className="mt-4 border border-rule bg-paper-sunk px-4 py-3 text-sm">
          <p className="font-semibold text-ink">
            {awaitingVerification.toLocaleString('en-US')} holding
            {awaitingVerification === 1 ? '' : 's'} have not been verified yet
          </p>
          <p className="mt-1 text-ink">
            They are not offered to any appeal until their quotes have been
            checked against the documents they cite. Run corpus:verify to
            finish, then corpus:embed to make what passes retrievable.
          </p>
          <p className="mt-1 text-ink">
            This page cannot report a failure rate, and saying otherwise was the
            bug it used to have. A holding whose quote does not check out is
            deleted rather than flagged, so the only rate it could compute is
            how far verification is behind extraction. The real rate is the one
            corpus:verify prints for the batch it just rejected.
          </p>
        </div>
      ) : null}

      <Panel className="mt-6">
        <PanelHeader title="Documents by source" />
        {health.documentsBySource.length === 0 ? (
          <EmptyState
            title="No documents ingested"
            body="Run pnpm corpus:fetch to populate it. If every fetch fails at the proxy, the government hosts are unreachable from this environment by network policy; see BLOCKED.md."
          />
        ) : (
          <Table>
            <thead>
              <tr>
                <Th>Source</Th>
                <Th numeric>Documents</Th>
                <Th>Last fetched</Th>
              </tr>
            </thead>
            <tbody>
              {health.documentsBySource.map((row) => (
                <tr key={row.sourceType}>
                  <Td>{row.sourceType.replace(/_/g, ' ')}</Td>
                  <Td numeric>{row.count}</Td>
                  <Td>
                    <span className="id">
                      {row.lastRetrieved
                        ? new Date(row.lastRetrieved).toISOString().slice(0, 10)
                        : 'never'}
                    </span>
                  </Td>
                </tr>
              ))}
            </tbody>
          </Table>
        )}
      </Panel>

      <div className="mt-6 grid gap-6 lg:grid-cols-2">
        <Panel>
          <PanelHeader title="Verified holdings by service type" />
          {health.holdingsByServiceType.length === 0 ? (
            <EmptyState
              title="Nothing extracted yet"
              body="Holdings appear once corpus:extract and corpus:verify have run."
            />
          ) : (
            <Table>
              <tbody>
                {health.holdingsByServiceType.map((row) => (
                  <tr key={row.serviceType ?? 'unstated'}>
                    <Td>{(row.serviceType ?? 'not stated').replace(/_/g, ' ')}</Td>
                    <Td numeric>{row.count}</Td>
                  </tr>
                ))}
              </tbody>
            </Table>
          )}
        </Panel>

        <Panel>
          <PanelHeader title="Verified holdings by denial basis" />
          {health.holdingsByDenialBasis.length === 0 ? (
            <EmptyState
              title="Nothing extracted yet"
              body="This is the breakdown that matters most: proprietary criteria holdings are the strongest authority the product has."
            />
          ) : (
            <Table>
              <tbody>
                {health.holdingsByDenialBasis.map((row) => (
                  <tr key={row.denialBasis ?? 'unstated'}>
                    <Td>
                      {(row.denialBasis ?? 'not stated').replace(/_/g, ' ')}
                      {row.denialBasis === 'proprietary_criteria' ? (
                        <Tag tone="action" className="ml-2">
                          strongest
                        </Tag>
                      ) : null}
                    </Td>
                    <Td numeric>{row.count}</Td>
                  </tr>
                ))}
              </tbody>
            </Table>
          )}
        </Panel>
      </div>
    </div>
  );
}

function Tile({
  label,
  value,
  tone = 'neutral',
}: {
  label: string;
  value: string;
  tone?: 'neutral' | 'denied';
}) {
  return (
    <div className="bg-paper-2 p-3">
      <p className="text-2xs uppercase tracking-wider text-ink-2">{label}</p>
      <p
        className={`tnum mt-1 text-2xl font-semibold ${tone === 'denied' ? 'text-denied' : ''}`}
      >
        {value}
      </p>
    </div>
  );
}
