/**
 * The corpus pipeline, run for real.
 *
 * Every government source this product ingests is unreachable from the build
 * environment: the egress proxy answers 403 to hhs.gov, ecfr.gov, and cms.gov.
 * That is a network policy and not something to route around, so the pipeline
 * had never made a single live request and the corpus had never held a row.
 *
 * This closes as much of that gap as can honestly be closed here. A real HTTP
 * server runs on localhost serving documents shaped like the real ones, and the
 * real fetcher talks to it: robots.txt is read and obeyed, the identifying User
 * Agent is sent, bytes are hashed and stored before anything parses them, and
 * a second run of the same document is skipped on its hash. Then the real
 * parse, extract, verify, and embed stages run over what came back.
 *
 * What this does not prove is that hhs.gov serves what we think it serves. That
 * needs egress and is one command, documented in BLOCKED.md.
 *
 * The extraction stage is the only one that calls a model, and no API key
 * exists here, so the model boundary is replaced for that stage alone. The
 * substitution is at the boundary rather than inside the pipeline, so every
 * line of pipeline code under test is the code that ships.
 */
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { rm } from 'node:fs/promises';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { eq, sql } from 'drizzle-orm';

/* ─── The documents the fake source serves ────────────────────────────────── */

/**
 * A decision in the shape the Departmental Appeals Board publishes: a heading,
 * a statement of the issue, and a paragraph carrying the rule. The quotes the
 * extractor is told to return are sliced out of this text below, so nothing is
 * asserted about text that is not really here.
 */
const DECISION_HTML = `<!doctype html><html><body>
<h1>Springfield Regional Medical Center, DAB No. 9001 (2025)</h1>
<p>The issue before the Board is whether the Medicare Advantage organization
applied coverage criteria more restrictive than those of Traditional Medicare
when it denied coverage of the beneficiary's skilled nursing facility stay.</p>
<p>A Medicare Advantage organization may not apply coverage criteria more
restrictive than Traditional Medicare when determining whether a skilled nursing
facility stay is covered. The record shows the organization applied a
proprietary screening tool in place of the regulatory standard, and the denial
cannot stand on that basis.</p>
<p>Accordingly, the determination is reversed and coverage is allowed.</p>
</body></html>`;

const REGULATION_XML = `<?xml version="1.0" encoding="UTF-8"?>
<DIV5 TYPE="PART" N="422">
  <HEAD>PART 422 - MEDICARE ADVANTAGE PROGRAM</HEAD>
  <DIV8 TYPE="SECTION" N="422.101">
    <HEAD>&#167; 422.101 Requirements relating to basic benefits.</HEAD>
    <P>Each MA organization must comply with general coverage guidelines
    included in original Medicare manuals and instructions unless superseded by
    regulations in this part or related instructions.</P>
    <P>When coverage criteria are not fully established, an MA organization may
    create publicly accessible internal coverage criteria that are based on
    current evidence in widely used treatment guidelines or clinical
    literature.</P>
  </DIV8>
</DIV5>`;

let server: Server;
let origin = '';

/** Paths the fake source disallows, so the robots check has something to catch. */
const DISALLOWED = '/private/decision.html';

beforeAll(async () => {
  server = createServer((request, response) => {
    if (request.url === '/robots.txt') {
      response.writeHead(200, { 'content-type': 'text/plain' });
      response.end(`User-agent: *\nDisallow: /private/\n`);
      return;
    }
    if (request.url === DISALLOWED) {
      response.writeHead(200, { 'content-type': 'text/html' });
      response.end(DECISION_HTML);
      return;
    }
    if (request.url === '/decision.html') {
      response.writeHead(200, { 'content-type': 'text/html' });
      response.end(DECISION_HTML);
      return;
    }
    if (request.url === '/part-422.xml') {
      response.writeHead(200, { 'content-type': 'application/xml' });
      response.end(REGULATION_XML);
      return;
    }
    response.writeHead(404).end('not found');
  });

  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  origin = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;

  process.env.CRAWLER_CONTACT = 'corpus@example.test';
});

afterAll(async () => {
  await new Promise<void>((resolve) => server.close(() => resolve()));
  await rm('.storage-test', { recursive: true, force: true });
});

/* ─── The model boundary, for the extraction stage only ───────────────────── */

/** The sentence the stand-in looks for, and quotes if it finds it. */
const RULE_PHRASE = 'may not apply coverage criteria more';

/**
 * The stand-in reads the spans out of the prompt it was given and quotes one of
 * them verbatim, which is what the real model is instructed to do.
 *
 * Typing a quote here instead would test nothing: it would either be copied
 * from the fixture and pass forever, or drift from it and fail for a reason
 * that has nothing to do with the pipeline. Slicing from the prompt means the
 * quote is genuinely a substring of what the server served, travelled through
 * the fetcher, the storage layer, and the parser to get here, and the verify
 * stage is then a real check on all of that.
 */
function quoteFromPrompt(user: string): { spanOrdinal: number; verbatimQuote: string } | null {
  // Spans arrive as "--- span N [heading] ---\ntext".
  const blocks = [...user.matchAll(/--- span (\d+)[^\n]*---\n([\s\S]*?)(?=\n\n--- span |\s*$)/g)];

  for (const [, ordinal, text] of blocks) {
    const at = text!.indexOf(RULE_PHRASE);
    if (at === -1) continue;
    // A clause long enough to be evidence, ending on a word boundary.
    const slice = text!.slice(at, at + 120);
    const cut = slice.lastIndexOf(' ');
    return { spanOrdinal: Number(ordinal), verbatimQuote: slice.slice(0, cut) };
  }
  return null;
}

vi.mock('@/lib/llm/client', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/llm/client')>();
  return {
    ...actual,
    complete: vi.fn(async (request: { stage: string; user: string }) => {
      if (request.stage !== 'corpus_extract') {
        throw new Error(`This test only substitutes corpus_extract, not ${request.stage}.`);
      }

      const quoted = quoteFromPrompt(request.user);

      return {
        // A batch with nothing quotable in it returns no holdings, which is
        // also what the real model is told to do.
        value: {
          holdings: quoted
            ? [
                {
                  spanOrdinal: quoted.spanOrdinal,
                  verbatimQuote: quoted.verbatimQuote,
                  issue:
                    'Whether a Medicare Advantage organization may apply coverage criteria more restrictive than Traditional Medicare.',
                  ruleApplied:
                    'A Medicare Advantage organization may not apply criteria more restrictive than Traditional Medicare.',
                  outcome: 'claimant_favorable',
                  serviceType: 'skilled_nursing',
                  payerType: 'medicare_advantage',
                  denialBasis: 'proprietary_criteria',
                },
              ]
            : [],
        },
        inputTokens: 1200,
        outputTokens: 200,
        costCents: 1,
        latencyMs: 10,
      };
    }),
  };
});

/* ─── A source pointing at the local server ───────────────────────────────── */

vi.mock('@/lib/corpus/sources', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/corpus/sources')>();
  const { fetchDocument } = await import('@/lib/corpus/fetch');

  return {
    ...actual,
    SOURCES: {
      ...actual.SOURCES,
      dab: {
        key: 'dab',
        label: 'Test decisions',
        async discover() {
          return [
            {
              sourceType: 'dab_decision' as const,
              citation: 'DAB No. 9001',
              title: 'Springfield Regional Medical Center',
              url: `${origin}/decision.html`,
              decidedAt: new Date('2025-06-01'),
            },
          ];
        },
        fetch: (document: { url: string }) => fetchDocument(document.url),
      },
      ecfr: {
        key: 'ecfr',
        label: 'Test regulations',
        async discover() {
          return [
            {
              sourceType: 'regulation' as const,
              citation: '42 CFR Part 422',
              title: 'Medicare Advantage Program',
              url: `${origin}/part-422.xml`,
              decidedAt: null,
            },
          ];
        },
        fetch: (document: { url: string }) => fetchDocument(document.url),
      },
    },
  };
});

const { fetchStage, parseStage, extractStage, verifyStage, embedStage, corpusHealth } =
  await import('@/lib/corpus/pipeline');
const { fetchDocument, resetCrawlerState, RobotsDisallowedError, userAgent } = await import(
  '@/lib/corpus/fetch'
);
const { db } = await import('@/lib/db');
const { holding, sourceDocument, sourceSpan } = await import('@/lib/db/schema');

/** The corpus tables, emptied so a re-run measures this run. */
async function clearCorpus(): Promise<void> {
  await db.delete(holding);
  await db.delete(sourceSpan);
  await db.delete(sourceDocument);
}

describe('the fetcher, against a real server', () => {
  beforeAll(async () => {
    resetCrawlerState();
    await clearCorpus();
  });

  it('identifies itself with a contactable User Agent', async () => {
    expect(userAgent()).toContain('corpus@example.test');
  });

  it('refuses a path robots.txt disallows', async () => {
    // The document is served at that path and would fetch perfectly well. The
    // only thing stopping it is that we said we would not.
    await expect(fetchDocument(`${origin}${DISALLOWED}`)).rejects.toBeInstanceOf(
      RobotsDisallowedError,
    );
  });

  it('fetches, hashes, and stores both documents', async () => {
    const decisions = await fetchStage('dab');
    const regulations = await fetchStage('ecfr');

    expect(decisions.processed).toBe(1);
    expect(regulations.processed).toBe(1);
    expect(decisions.failed + regulations.failed).toBe(0);

    const rows = await db.select().from(sourceDocument);
    expect(rows).toHaveLength(2);
    // A hash per document, so the skip on re-run has something to compare.
    expect(new Set(rows.map((r) => r.contentHash)).size).toBe(2);
    expect(rows.every((r) => r.contentHash.length === 64)).toBe(true);
    expect(rows.every((r) => r.rawPath.length > 0)).toBe(true);
  }, 60_000);

  it('skips a document whose bytes have not changed', async () => {
    // This is what makes running the pipeline on a schedule safe: an unchanged
    // document must not become a second copy with a second set of holdings.
    const again = await fetchStage('dab');
    expect(again.processed).toBe(0);
    expect(again.skipped).toBe(1);
    expect(await db.select().from(sourceDocument)).toHaveLength(2);
  }, 60_000);
});

describe('the stages after the fetch', () => {
  it('parses both documents into locatable spans', async () => {
    const result = await parseStage();
    expect(result.failed).toBe(0);

    const spans = await db.select().from(sourceSpan);
    expect(spans.length).toBeGreaterThan(2);
    // Offsets are what make a citation point at characters rather than at a
    // document, so a span with a zero width range is useless.
    expect(spans.every((s) => s.charEnd > s.charStart)).toBe(true);

    const parsed = await db.select().from(sourceDocument);
    expect(parsed.every((d) => d.parsedAt !== null)).toBe(true);
  }, 60_000);

  it('extracts a holding carrying a quote from the decision', async () => {
    const result = await extractStage();
    expect(result.failed).toBe(0);

    const holdings = await db.select().from(holding);
    expect(holdings).toHaveLength(1);
    expect(holdings[0]!.denialBasis).toBe('proprietary_criteria');
    // The quote runs across a line break in the served HTML, so it is asserted
    // on a phrase that does not straddle one. That the whole quote is genuinely
    // in the span is what the verify stage below proves.
    expect(holdings[0]!.verbatimQuote).toContain('may not apply coverage criteria');
    expect(holdings[0]!.verbatimQuote.length).toBeGreaterThan(40);
  }, 60_000);

  it('verifies every holding quote against the span it cites', async () => {
    const result = await verifyStage();

    // The quote was sliced out of the served document, so it must survive. A
    // failure here means the pipeline lost or altered text between fetching and
    // storing it, which would be the worst kind of bug in this product.
    expect(result.failureRate).toBe(0);
    expect(result.failed).toBe(0);

    const verified = await db
      .select({ n: sql<number>`count(*)::int` })
      .from(holding)
      .where(sql`${holding.verifiedAt} is not null`);
    expect(verified[0]!.n).toBe(1);
  }, 60_000);

  it('rejects a holding whose quote is not in its span', async () => {
    // The half that protects the customer. A holding is only worth citing if
    // the words are genuinely in the decision.
    const [row] = await db.select().from(holding).limit(1);
    await db
      .update(holding)
      .set({
        verbatimQuote: 'The Board finds that proprietary criteria are entirely permissible.',
        verifiedAt: null,
      })
      .where(eq(holding.id, row!.id));

    const result = await verifyStage();
    expect(result.failed).toBe(1);
    expect(result.failureRate).toBeGreaterThan(0);

    // Discarded rather than flagged. A holding whose quote is not in the
    // decision is not a weaker citation, it is not a citation, and leaving it
    // in the corpus would let retrieval offer it to a future draft.
    const after = await db.select().from(holding).where(eq(holding.id, row!.id));
    expect(after).toHaveLength(0);
  }, 60_000);

  it('embeds holdings so retrieval can score them', async () => {
    // The previous test broke the stored quote deliberately. Re-running the
    // extraction from scratch restores a real one rather than a typed copy.
    await db.delete(holding);
    await db.update(sourceDocument).set({ extractedAt: null });
    await extractStage();
    await verifyStage();

    const result = await embedStage();
    expect(result.failed).toBe(0);

    const [embedded] = await db.select().from(holding).limit(1);
    expect(embedded!.embedding).not.toBeNull();
    expect(embedded!.embedding!.length).toBeGreaterThan(0);
  }, 60_000);

  it('reports a corpus that is no longer empty', async () => {
    const health = await corpusHealth();
    expect(health.documentsBySource.reduce((n, r) => n + r.count, 0)).toBe(2);
    expect(health.holdingsTotal).toBeGreaterThanOrEqual(1);
    expect(health.holdingsVerified).toBe(health.holdingsTotal);
    expect(health.embeddingCoverage).toBe(1);
  }, 60_000);
});
