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

const {
  fetchStage,
  parseStage,
  extractStage,
  verifyStage,
  embedStage,
  corpusHealth,
  FRUITLESS_WAITS_BEFORE_STOPPING,
} = await import('@/lib/corpus/pipeline');

/**
 * How many models a run may work through before it is genuinely out of road:
 * MODEL_NAME_CORPUS plus MODEL_NAME_CORPUS_FALLBACKS.
 */
const MODELS_AVAILABLE = 3;
const { fetchDocument, resetCrawlerState, RobotsDisallowedError, userAgent } = await import(
  '@/lib/corpus/fetch'
);
const { db } = await import('@/lib/db');
const { holding, sourceDocument, sourceSpan } = await import('@/lib/db/schema');
const { complete, ModelRateLimitedError, ModelRequestTooLargeError } = await import(
  '@/lib/llm/client'
);

/** The stand-in defined above, so a test can borrow and restore it. */
const defaultComplete = vi.mocked(complete).getMockImplementation()!;

/** How many spans a prompt carries, which is what the size tests turn on. */
function spanCount(user: string): number {
  return [...user.matchAll(/--- span \d+/g)].length;
}

type CompleteRequest = Parameters<typeof complete>[0];

/**
 * A provider that refuses any batch carrying more than one span.
 *
 * Harsher than a real free tier on purpose: it forces the splitting all the way
 * down, which proves the loop terminates rather than merely that it starts.
 * `alsoRefuse` adds a condition the splitting cannot satisfy, for the case
 * where a single span is itself too large.
 */
function refusingLargeBatches(alsoRefuse?: (user: string) => boolean): typeof complete {
  return (async (request: CompleteRequest) => {
    if (spanCount(request.user) > 1 || alsoRefuse?.(request.user)) {
      throw new ModelRequestTooLargeError('refused: too many tokens');
    }
    return defaultComplete(request);
  }) as typeof complete;
}

/**
 * Put every document back to unextracted, spans included.
 *
 * Both halves are needed now that the checkpoint is per span. Clearing only the
 * document flag leaves every span marked done, so the next extract stage finds
 * nothing to do and reports success having called the model zero times, which
 * is the most convincing kind of green test there is.
 */
async function reExtract(): Promise<void> {
  await db.update(sourceDocument).set({ extractedAt: null });
  await db.update(sourceSpan).set({ extractedAt: null });
}

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
    await reExtract();
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

/**
 * What happens when the provider refuses the request.
 *
 * The first real extraction run against a live provider died here, on a CMS
 * manual chapter. A batch is capped at 25 spans, and 25 spans of a decision is
 * a few thousand characters while 25 spans of a manual chapter is forty
 * thousand, so the request came back HTTP 413. One refused batch failed the
 * whole document and the run extracted nothing at all.
 *
 * A free tier makes this the normal case rather than an edge one, and the
 * limits differ per provider and change without notice, so the size that works
 * cannot be a constant anyone maintains. It has to be discovered at runtime.
 */
describe('a provider that refuses the request size', () => {
  beforeAll(async () => {
    await db.delete(holding);
    await reExtract();
  });

  afterAll(() => {
    vi.mocked(complete).mockImplementation(defaultComplete);
  });

  it('splits the batch and extracts anyway', async () => {
    vi.mocked(complete).mockImplementation(refusingLargeBatches());

    const result = await extractStage();

    // The point of the whole exercise: a refusal is not a lost document.
    expect(result.failed).toBe(0);
    expect(result.processed).toBe(2);

    const holdings = await db.select().from(holding);
    expect(holdings).toHaveLength(1);
    expect(holdings[0]!.verbatimQuote).toContain('may not apply coverage criteria');

    // And the quote still checks out, which is the thing splitting could have
    // broken: a span sent in a smaller batch is still the same span.
    const verified = await verifyStage();
    expect(verified.failureRate).toBe(0);
  }, 60_000);

  it('skips a single span it cannot shrink further, and keeps going', async () => {
    await db.delete(holding);
    await reExtract();

    // Nothing left to halve. The stage has to record the loss and carry on
    // rather than spin or abandon the document.
    const rulePhrase = 'may not apply coverage criteria more';
    vi.mocked(complete).mockImplementation(
      refusingLargeBatches((user) => user.includes(rulePhrase)),
    );

    const result = await extractStage();

    expect(result.failed).toBe(0);
    expect(result.notes.some((note) => /too large for the model/.test(note))).toBe(true);
    // The span that was skipped is named, because someone has to be able to go
    // and look at what was lost.
    expect(result.notes.some((note) => /span \d+ is too large/.test(note))).toBe(true);
  }, 60_000);
});

/**
 * A spent per minute allowance is a wait, not a failure.
 *
 * On a free tier a chapter meets this repeatedly, and until the stage waited on
 * its own the command ended and a person had to run it again. That is a person
 * employed as a retry loop, and it is the difference between a corpus that
 * ingests overnight and one that never finishes.
 */
describe('a provider that is rate limiting', () => {
  afterAll(() => {
    vi.mocked(complete).mockImplementation(defaultComplete);
  });

  it('waits and finishes rather than giving up on the document', async () => {
    await db.delete(holding);
    await reExtract();

    // Refuse the first two calls the way a spent allowance does, then relent.
    let refusals = 0;
    const slept: number[] = [];
    vi.mocked(complete).mockImplementation((async (request: CompleteRequest) => {
      if (refusals < 2) {
        refusals += 1;
        throw new ModelRateLimitedError('rate limited', 30);
      }
      return defaultComplete(request);
    }) as typeof complete);

    const result = await extractStage(100, {
      sleep: async (ms) => {
        slept.push(ms);
      },
    });

    expect(refusals).toBe(2);
    // Waited the provider's own number rather than one we invented. It knows
    // when its window rolls over and we do not.
    expect(slept).toEqual([30_000, 30_000]);

    // And the work completed, which is the whole point.
    expect(result.failed).toBe(0);
    expect(result.spansExtracted).toBeGreaterThan(0);
    expect(await db.select().from(holding)).not.toHaveLength(0);
  }, 60_000);

  it('moves to another model rather than waiting for tomorrow', async () => {
    // A daily cap belongs to a model, not to the key. The account still has an
    // untouched budget on the next model in the list, and the run used to stop
    // at the first empty bucket and hand the rest back to a person.
    await db.delete(holding);
    await reExtract();

    const modelsTried: (string | undefined)[] = [];
    vi.mocked(complete).mockImplementation((async (request: CompleteRequest) => {
      modelsTried.push(request.model);
      // The first model is out for the day. Anything else works.
      if (request.model === 'llama-3.1-8b-instant') {
        throw new ModelRateLimitedError('daily quota', 3 * 60 * 60);
      }
      return defaultComplete(request);
    }) as typeof complete);

    const result = await extractStage(100, { sleep: async () => {} });

    // It asked the first model, was refused for the day, and carried on.
    expect(modelsTried[0]).toBe('llama-3.1-8b-instant');
    expect(modelsTried.some((m) => m && m !== 'llama-3.1-8b-instant')).toBe(true);

    expect(result.quotaExhausted).toBe(false);
    expect(result.spansExtracted).toBeGreaterThan(0);
    expect(await db.select().from(holding)).not.toHaveLength(0);
    expect(result.notes.some((n) => /whose daily allowance is separate/.test(n))).toBe(true);
  }, 60_000);

  it('stops only once every model it may use is spent', async () => {
    // The list is not infinite patience. When there is nowhere left to go the
    // run has to stop and say so, naming what it tried.
    await db.delete(holding);
    await reExtract();

    const modelsTried = new Set<string | undefined>();
    vi.mocked(complete).mockImplementation((async (request: CompleteRequest) => {
      modelsTried.add(request.model);
      throw new ModelRateLimitedError('daily quota', 3 * 60 * 60);
    }) as typeof complete);

    const result = await extractStage(100, { sleep: async () => {} });

    expect(modelsTried.size).toBeGreaterThan(1);
    expect(result.quotaExhausted).toBe(true);
    expect(result.notes.some((n) => /every model available to this run/.test(n))).toBe(true);
  }, 60_000);

  it('stops instead of waiting when the wait is measured in hours', async () => {
    // A daily allowance does not come back during a run however patient it is,
    // and it says so: the wait it reports is hours, not minutes.
    await db.delete(holding);
    await reExtract();

    const slept: number[] = [];
    vi.mocked(complete).mockImplementation((async () => {
      throw new ModelRateLimitedError('daily quota', 3 * 60 * 60);
    }) as typeof complete);

    const result = await extractStage(100, {
      sleep: async (ms) => {
        slept.push(ms);
      },
    });

    expect(slept).toEqual([]);
    expect(result.quotaExhausted).toBe(true);
    expect(result.notes.some((n) => /daily quota/.test(n))).toBe(true);
  }, 60_000);

  it('waits out an hourly limit rather than handing the job back', async () => {
    // The measured case, and the reason the threshold moved. A real run was
    // told seven minutes on three chapters and gave up on all three, inside a
    // job that had five hours left. Seven minutes later the same request would
    // have gone through, and the alternative to waiting is a person
    // re-dispatching the workflow by hand.
    await db.delete(holding);
    await reExtract();

    let refused = false;
    const slept: number[] = [];
    vi.mocked(complete).mockImplementation((async (request: CompleteRequest) => {
      if (!refused) {
        refused = true;
        throw new ModelRateLimitedError('hourly quota', 7 * 60);
      }
      return defaultComplete(request);
    }) as typeof complete);

    const result = await extractStage(100, {
      sleep: async (ms) => {
        slept.push(ms);
      },
    });

    expect(slept).toEqual([7 * 60 * 1000]);
    expect(result.quotaExhausted).toBe(false);
    expect(result.failed).toBe(0);
    expect(result.spansExtracted).toBeGreaterThan(0);
    expect(await db.select().from(holding)).not.toHaveLength(0);
  }, 60_000);

  it('stops once waiting has stopped accomplishing anything', async () => {
    // The distinction the old threshold was reaching for, said directly. A run
    // once sat asking for the same batch every ten minutes, each time being
    // told ten minutes, with the passage count unchanged; left alone it would
    // have spent seven hours reaching exactly as far as it got in the first.
    // Length was the wrong test for that. Whether the wait got anywhere is the
    // right one.
    await db.delete(holding);
    await reExtract();

    const slept: number[] = [];
    vi.mocked(complete).mockImplementation((async () => {
      throw new ModelRateLimitedError('hourly quota that never clears', 7 * 60);
    }) as typeof complete);

    const result = await extractStage(100, {
      sleep: async (ms) => {
        slept.push(ms);
      },
    });

    // Patient a few times per model, then done, and done for the whole run
    // rather than once per document: the allowance belongs to the account, so
    // the documents behind this one are left for the next run instead of
    // sleeping through the same discovery each.
    //
    // Per model, because the run now rotates. Three waits establish that this
    // model is not coming back, and the next model has its own daily budget
    // that this one's exhaustion says nothing about.
    expect(slept.length).toBeLessThanOrEqual(FRUITLESS_WAITS_BEFORE_STOPPING * MODELS_AVAILABLE);
    expect(result.quotaExhausted).toBe(true);
    expect(result.notes.some((n) => /without a single batch getting through/.test(n))).toBe(true);
    expect(result.notes.some((n) => /left for the next run/.test(n))).toBe(true);
  }, 60_000);

  it('still waits out an ordinary per minute limit', async () => {
    // The line has to fall between the two. Treating a 30 second window as a
    // quota would stop a run that only needed to pause.
    await db.delete(holding);
    await reExtract();

    let refused = false;
    const slept: number[] = [];
    vi.mocked(complete).mockImplementation((async (request: CompleteRequest) => {
      if (!refused) {
        refused = true;
        throw new ModelRateLimitedError('per minute', 30);
      }
      return defaultComplete(request);
    }) as typeof complete);

    const result = await extractStage(100, {
      sleep: async (ms) => {
        slept.push(ms);
      },
    });

    expect(slept).toEqual([30_000]);
    expect(result.quotaExhausted).toBe(false);
    expect(result.failed).toBe(0);
  }, 60_000);

  it('gives up eventually rather than waiting all night', async () => {
    await db.delete(holding);
    await reExtract();

    const slept: number[] = [];
    vi.mocked(complete).mockImplementation((async () => {
      throw new ModelRateLimitedError('rate limited');
    }) as typeof complete);

    const result = await extractStage(100, {
      sleep: async (ms) => {
        slept.push(ms);
      },
    });

    // Bounded, and tightly. A provider that has stopped answering ends the run
    // rather than holding it open: the waits stop getting anywhere, which is
    // the thing actually worth measuring.
    expect(slept.length).toBeGreaterThan(0);
    expect(slept.length).toBeLessThanOrEqual((FRUITLESS_WAITS_BEFORE_STOPPING + 1) * MODELS_AVAILABLE);
    expect(result.failed).toBeGreaterThan(0);
    expect(result.quotaExhausted).toBe(true);

    // Not "spansExtracted is 0". Screening settles passages without a model
    // call and counts them as progress, which is the point of it, so a run that
    // reached the model zero times can still report passages done. What must be
    // true is that nothing came out of the model.
    expect(await db.select().from(holding)).toHaveLength(0);
  }, 60_000);
});

/**
 * A run that dies partway through a document must not leave half its holdings
 * behind.
 *
 * This one was invisible until the splitting above made multi call documents
 * ordinary. The stage inserts holdings batch by batch and sets extracted_at
 * only at the end, so a document that failed on its fourth batch kept the
 * holdings from its first three and stayed unextracted. The next run redid
 * those three batches and inserted a second copy of every holding in them.
 *
 * Nothing downstream would have caught it. Duplicates verify perfectly, because
 * they are genuine quotes from genuine spans. The corpus would simply have
 * gained weight every time a run was interrupted, and retrieval surfacing the
 * same authority three times reads as three sources agreeing.
 */
describe('a run interrupted partway through a document', () => {
  afterAll(() => {
    vi.mocked(complete).mockImplementation(defaultComplete);
  });

  it('does not double holdings when a crash landed between the write and the mark', async () => {
    // The gap the ordering exists to close, and the one a thrown model call
    // cannot reach: the writes are delete, insert, mark, and a process killed
    // between the insert and the mark leaves holdings whose passage is still
    // pending. The next run extracts that passage again and, without the
    // delete, writes a second copy of everything it found.
    //
    // There is no interactive transaction to lean on here. The Neon HTTP driver
    // has none, and that is the driver production runs on, so the ordering is
    // the mechanism rather than a convenience.
    //
    // Simulated by reproducing the state a crash leaves rather than by crashing
    // anything: a passage marked pending whose holdings are already written.
    await db.delete(holding);
    await reExtract();

    vi.mocked(complete).mockImplementation(refusingLargeBatches());
    await extractStage();

    const before = await db.select().from(holding);
    expect(before.length).toBeGreaterThan(0);

    // Roll one passage back to pending, leaving its holding in place. The
    // document flag goes with it, because a run that died mid document never
    // set it, and without clearing it the document is not selected at all and
    // this test passes by doing nothing.
    await db
      .update(sourceSpan)
      .set({ extractedAt: null })
      .where(eq(sourceSpan.id, before[0]!.spanId));
    await db.update(sourceDocument).set({ extractedAt: null });

    await extractStage();

    const after = await db.select().from(holding);
    expect(after).toHaveLength(before.length);
  }, 60_000);

  it('does not leave duplicate holdings for the next run to double', async () => {
    await db.delete(holding);
    await reExtract();

    // A clean run first, to establish what one document's worth looks like.
    vi.mocked(complete).mockImplementation(refusingLargeBatches());
    await extractStage();
    const clean = await db.select().from(holding);
    expect(clean.length).toBeGreaterThan(0);

    // Now a run that gets some holdings in and then dies on a later batch, the
    // way a rate limit or a dropped connection does.
    await db.delete(holding);
    await reExtract();

    // Die on the first call after a holding has actually been written, rather
    // than after a fixed number of calls. Counting calls is what a first
    // version of this test did, and it passed against the unfixed code: the
    // count landed before the batch carrying the quotable span, so the
    // interrupted run left nothing behind and there was nothing to duplicate.
    // The bug only exists once a partial run has partial results.
    let wrote = false;
    const dropping = refusingLargeBatches();
    vi.mocked(complete).mockImplementation((async (request: CompleteRequest) => {
      if (wrote) throw new Error('the connection dropped');
      const response = (await dropping(request)) as { value: { holdings: unknown[] } };
      if (response.value.holdings.length > 0) wrote = true;
      return response;
    }) as typeof complete);
    const interrupted = await extractStage();

    // The premise of the test. Without this the assertion below passes for the
    // wrong reason.
    expect(await db.select().from(holding)).not.toHaveLength(0);
    expect(interrupted.failed).toBeGreaterThan(0);

    // The document is still unextracted, so it will be picked up again.
    const stillPending = await db
      .select()
      .from(sourceDocument)
      .where(sql`${sourceDocument.extractedAt} is null`);
    expect(stillPending.length).toBeGreaterThan(0);

    // The re-run: same count as the clean run, not double it.
    vi.mocked(complete).mockImplementation(refusingLargeBatches());
    await extractStage();

    const after = await db.select().from(holding);
    expect(after).toHaveLength(clean.length);
  }, 60_000);

  it('resumes from the passage it stopped at rather than the start', async () => {
    // The reason the checkpoint is per span and not per document. A CMS manual
    // chapter is dozens of model calls and a free tier's per minute allowance
    // runs out partway through every attempt. Restarting the document each time
    // is not slow, it is non terminating: the work done between two rate limits
    // is always less than the whole chapter, so it never finishes.
    await db.delete(holding);
    await reExtract();

    let wrote = false;
    const dropping = refusingLargeBatches();
    vi.mocked(complete).mockImplementation((async (request: CompleteRequest) => {
      if (wrote) throw new Error('rate limited');
      const response = (await dropping(request)) as { value: { holdings: unknown[] } };
      if (response.value.holdings.length > 0) wrote = true;
      return response;
    }) as typeof complete);
    await extractStage();

    const done = await db
      .select()
      .from(sourceSpan)
      .where(sql`${sourceSpan.extractedAt} is not null`);
    const pending = await db
      .select()
      .from(sourceSpan)
      .where(sql`${sourceSpan.extractedAt} is null`);

    // Partway: some passages banked, some still to do. If either side were
    // empty this test would prove nothing about resuming.
    expect(done.length).toBeGreaterThan(0);
    expect(pending.length).toBeGreaterThan(0);

    // The second attempt must only look at what is left.
    let seen = 0;
    const counting = refusingLargeBatches();
    vi.mocked(complete).mockImplementation((async (request: CompleteRequest) => {
      seen += spanCount(request.user);
      return counting(request);
    }) as typeof complete);
    await extractStage();

    // Spans get re-sent when a batch is split, so this cannot be an equality.
    // What matters is that the passages already banked were not sent again,
    // which a restart would have done.
    expect(seen).toBeLessThan(done.length + pending.length);

    const remaining = await db
      .select()
      .from(sourceSpan)
      .where(sql`${sourceSpan.extractedAt} is null`);
    expect(remaining).toHaveLength(0);
  }, 60_000);
});
