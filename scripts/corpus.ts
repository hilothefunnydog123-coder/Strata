/**
 * The corpus command line.
 *
 *   pnpm corpus:doctor                       # check everything a run depends on
 *   pnpm corpus:fetch    --source=dab [--since=2020-01-01] [--limit=1000]
 *   pnpm corpus:parse    --unparsed
 *   pnpm corpus:extract  --unextracted [--limit=100]
 *   pnpm corpus:estimate
 *   pnpm corpus:verify   --unverified
 *   pnpm corpus:embed    --unembedded
 *   pnpm corpus:status
 *
 * The stage flags read as documentation of what each command does. They are
 * accepted and ignored, because every stage already selects exactly the
 * unfinished work by looking at the database rather than at a flag.
 */
import 'dotenv/config';
import {
  corpusHealth,
  embedStage,
  estimateExtraction,
  extractStage,
  fetchStage,
  parseStage,
  verifyStage,
} from '../lib/corpus/pipeline';
import { runChecks } from '../lib/corpus/doctor';
import { SOURCES, type SourceKey } from '../lib/corpus/sources';
import { llmConfigured } from '../lib/llm/client';
import { log } from '../lib/log';

function flag(name: string): string | undefined {
  const match = process.argv.find((arg) => arg.startsWith(`--${name}=`));
  return match?.slice(name.length + 3);
}

function out(text: string): void {
  process.stdout.write(`${text}\n`);
}

function reportStage(name: string, result: {
  processed: number;
  skipped: number;
  failed: number;
  notes: string[];
}): void {
  out(
    `${name}: ${result.processed} processed, ${result.skipped} skipped, ${result.failed} failed`,
  );
  for (const note of result.notes) out(`  ${note}`);
}

/**
 * Run the extract stage until it stops making progress.
 *
 * A run against a free tier meets the per minute allowance repeatedly, and the
 * stage waits those out on its own. What it cannot do from inside one document
 * is come back to a document it gave up on, and until now that was the
 * operator's job: watch for "1 failed", run the command again, repeat. That is
 * not a workflow, it is a person acting as a retry loop, and on a chapter
 * needing a dozen rounds it is how ingestion stops happening at all.
 *
 * The loop ends when a whole round extracts nothing. That is the honest signal:
 * document counts cannot tell a round that achieved nothing from one that got
 * three quarters of the way through a chapter, since both report zero processed
 * and one failed, but a passage count can.
 */
async function extract(limit: number | undefined): Promise<void> {
  let round = 0;
  let totalSpans = 0;

  for (;;) {
    round += 1;
    const result = await extractStage(limit);
    totalSpans += result.spansExtracted;

    reportStage(round === 1 ? 'extract' : `extract (round ${round})`, result);

    // Everything finished, or nothing moved and another round would only repeat
    // whatever is blocking it.
    if (result.failed === 0) break;

    if (result.quotaExhausted) {
      out('');
      out(`  ${totalSpans} passages were extracted before the provider's longer quota ran out.`);
      out('  They are saved. Running this again once the quota resets continues from there.');
      out('');
      out('  If this is happening early in a large document, the account is too small');
      out('  for its size. MODEL_NAME_CORPUS can point extraction at a smaller model');
      out('  with a larger allowance without changing the model that drafts appeals.');
      out('  Every quote is still verified against its source either way, so a weaker');
      out('  model here costs discarded holdings rather than wrong ones.');
      process.exitCode = 1;
      break;
    }

    if (result.spansExtracted === 0) {
      out('');
      out('  This round extracted nothing, so running again would not help.');
      out('  The error above says why. Passages already done are saved either way.');
      process.exitCode = 1;
      break;
    }

    out(
      `  ${result.spansExtracted} passages done this round, ${totalSpans} in total. ` +
        'Continuing from where it stopped.',
    );
  }
}

/**
 * What the outstanding extraction will cost, before spending any of it.
 *
 * Exists because the honest answer for one CMS chapter was "more than a day's
 * allowance on this account", and the only way to learn that was to run it for
 * forty minutes and watch it stall at 75 passages of 1,302.
 */
async function estimate(): Promise<void> {
  const rows = await estimateExtraction();

  out('');
  out('Extraction still to do');
  out('─'.repeat(72));

  if (rows.length === 0) {
    out('  Nothing pending. Every parsed document has been through the extractor.');
    out('');
    return;
  }

  out(
    `  ${'document'.padEnd(34)}${'passages'.padStart(9)}${'sending'.padStart(9)}` +
      `${'calls'.padStart(7)}${'tokens'.padStart(11)}`,
  );

  let total = 0;
  for (const row of rows) {
    total += row.tokens;
    const name = row.citation.length > 33 ? `${row.citation.slice(0, 32)}…` : row.citation;
    out(
      `  ${name.padEnd(34)}${String(row.passages).padStart(9)}${String(row.sending).padStart(9)}` +
        `${String(row.calls).padStart(7)}${row.tokens.toLocaleString('en-US').padStart(11)}`,
    );
  }

  out('─'.repeat(72));
  out(`  ${'total'.padEnd(34)}${''.padStart(25)}${total.toLocaleString('en-US').padStart(11)}`);
  out('');
  out('  "sending" is what survives screening. The rest are contents listings,');
  out('  transmittal notices and prose carrying no rule, and cost nothing.');
  out('');
  out('  Compare the total against your account\'s daily token allowance. If it is');
  out('  larger, the smallest documents above will still finish today, and');
  out('  MODEL_NAME_CORPUS can point extraction at a model with more headroom.');
  out('');
}

/**
 * Ask every question a run depends on, before the run.
 *
 * Each of the four failures this exists for was a single question with a
 * definite answer, and each of them was instead discovered as an HTTP status in
 * the middle of a forty minute run.
 */
async function doctor(): Promise<void> {
  const checks = await runChecks();

  out('');
  for (const check of checks) {
    out(`  ${check.ok ? 'ok  ' : 'FAIL'}  ${check.name.padEnd(16)} ${check.detail}`);
    if (check.extra && check.extra.length > 0) {
      // A provider's model list runs to dozens. Enough to choose from, not so
      // many that the failure above scrolls away.
      for (const line of check.extra.slice(0, 25)) out(`          ${line}`);
      if (check.extra.length > 25) out(`          ... and ${check.extra.length - 25} more`);
    }
  }
  out('');

  const failed = checks.filter((c) => !c.ok);
  if (failed.length > 0) {
    out(`  ${failed.length} check${failed.length === 1 ? '' : 's'} failed. Fix those first:`);
    out('  a corpus run will hit the same thing, later and less clearly.');
    out('');
    process.exitCode = 1;
  }
}

async function status(): Promise<void> {
  const health = await corpusHealth();

  out('');
  out('Corpus');
  out('─'.repeat(64));

  if (health.documentsBySource.length === 0) {
    out('  No documents ingested.');
    out('');
    out('  Run: pnpm corpus:fetch --source=ecfr');
    out('  If every fetch fails with a proxy error, see BLOCKED.md: government');
    out('  hosts are unreachable from some environments by network policy.');
  } else {
    for (const row of health.documentsBySource) {
      const last = row.lastRetrieved
        ? new Date(row.lastRetrieved).toISOString().slice(0, 10)
        : 'never';
      out(`  ${row.sourceType.padEnd(16)} ${String(row.count).padStart(6)}  last ${last}`);
    }
  }

  if (health.documents.length > 0) {
    out('');
    out('Documents');
    out('─'.repeat(78));
    out(
      `  ${'retrieved'.padEnd(12)}${'holdings'.padStart(9)}  ${'citation'.padEnd(32)}source`,
    );

    // Every document, named. A summary that says "regulation: 2" cannot answer
    // the question that matters about a legal corpus, which is whether what is
    // in it is real and where it came from. A citation and a URL can be checked
    // in a browser in ten seconds.
    for (const doc of health.documents) {
      const when = new Date(doc.retrievedAt).toISOString().slice(0, 10);
      const cite = doc.citation.length > 31 ? `${doc.citation.slice(0, 30)}…` : doc.citation;
      const mark = doc.provenance === 'crawled' ? ' ' : '!';
      out(
        `${mark} ${when.padEnd(12)}${String(doc.holdings).padStart(9)}  ${cite.padEnd(32)}${doc.url}`,
      );
    }

    const seeded = health.documents.filter((d) => d.provenance !== 'crawled');
    if (seeded.length > 0) {
      const seededHoldings = seeded.reduce((n, d) => n + d.holdings, 0);
      out('');
      out(`  ! ${seeded.length} document${seeded.length === 1 ? ' was' : 's were'} written by the demonstration seeder, not fetched.`);
      out(`    They hold ${seededHoldings} holding${seededHoldings === 1 ? '' : 's'}, and retrieval will not offer any of them to`);
      out('    an appeal. They are here so the demonstration has something to show.');
    }

    const unattributed = health.documents.filter(
      (d) =>
        d.provenance === 'crawled' &&
        !/^https?:\/\/(www\.)?(ecfr|cms|hhs|govinfo|federalregister)\.gov/i.test(d.url),
    );
    if (unattributed.length > 0) {
      out('');
      out(`  ${unattributed.length} document${unattributed.length === 1 ? ' does' : 's do'} not come from a government source.`);
      out('  Anything cited from these is only as trustworthy as wherever it came from.');
    }
  }

  out('');
  out('Holdings');
  out('─'.repeat(64));
  out(`  total                  ${String(health.holdingsTotal).padStart(6)}`);
  out(`  verified               ${String(health.holdingsVerified).padStart(6)}`);
  out(`  embedded               ${String(health.holdingsEmbedded).padStart(6)}`);
  out(
    `  verification failures  ${(health.verificationFailureRate * 100).toFixed(1).padStart(6)}%` +
      (health.verificationFailureRate > 0.05 ? '   ABOVE THRESHOLD' : ''),
  );
  out(`  embedding coverage     ${(health.embeddingCoverage * 100).toFixed(1).padStart(6)}%`);

  if (health.holdingsByServiceType.length > 0) {
    out('');
    out('By service type');
    out('─'.repeat(64));
    for (const row of health.holdingsByServiceType) {
      out(`  ${(row.serviceType ?? 'unstated').padEnd(24)} ${String(row.count).padStart(6)}`);
    }
  }

  if (health.holdingsByDenialBasis.length > 0) {
    out('');
    out('By denial basis');
    out('─'.repeat(64));
    for (const row of health.holdingsByDenialBasis) {
      out(`  ${(row.denialBasis ?? 'unstated').padEnd(24)} ${String(row.count).padStart(6)}`);
    }
  }

  out('');
}

async function main(): Promise<void> {
  const command = process.argv[2];

  switch (command) {
    case 'fetch': {
      const requested = flag('source') ?? 'dab';

      // "all" rather than three separate invocations. Fetching costs no model
      // allowance, only bandwidth, so there is no reason to make someone press
      // a button once per source and every reason not to: a corpus missing its
      // regulations because a step was forgotten is worse than a slower run.
      const sources =
        requested === 'all'
          ? (Object.keys(SOURCES) as SourceKey[])
          : [requested as SourceKey];

      for (const source of sources) {
        if (!SOURCES[source]) {
          throw new Error(
            `Unknown source "${source}". Available: ${Object.keys(SOURCES).join(', ')}, ` +
              'or "all". LCD and NCD are deliberately absent; see CORPUS.md section 5.',
          );
        }
      }

      const since = flag('since') ? new Date(flag('since')!) : undefined;
      const limit = flag('limit') ? Number(flag('limit')) : undefined;

      // One source failing must not stop the others. They are independent
      // hosts with independent outages, and a corpus with two of three sources
      // is worth having today.
      let failures = 0;
      for (const source of sources) {
        try {
          reportStage(
            `fetch ${source}`,
            await fetchStage(source, {
              ...(since ? { since } : {}),
              ...(limit ? { limit } : {}),
            }),
          );
        } catch (error) {
          failures += 1;
          out(`fetch ${source}: failed. ${(error as Error).message}`);
        }
      }

      if (failures > 0 && failures === sources.length) process.exitCode = 1;
      break;
    }

    case 'parse':
      reportStage('parse', await parseStage());
      break;

    case 'extract': {
      if (!llmConfigured()) {
        throw new Error(
          'Extraction reads decisions with a model, so MODEL_API_KEY must be set. ' +
            'Nothing was transmitted.',
        );
      }
      const limit = flag('limit') ? Number(flag('limit')) : undefined;
      await extract(limit);
      break;
    }

    case 'verify': {
      const result = await verifyStage();
      reportStage('verify', result);
      if (result.failureRate > 0.05) process.exitCode = 1;
      break;
    }

    case 'embed':
      reportStage('embed', await embedStage());
      break;

    case 'doctor':
      await doctor();
      break;

    case 'estimate':
      await estimate();
      break;

    case 'status':
      await status();
      break;

    default:
      throw new Error(
        `Unknown command "${command ?? ''}". ` +
          'Use one of: doctor, fetch, parse, extract, estimate, verify, embed, status.',
      );
  }
}

/**
 * Set the exit code and let Node close on its own rather than calling
 * process.exit().
 *
 * process.exit() tears the process down while the database driver still has
 * handles open. On Windows libuv notices and aborts with
 * "Assertion failed: !(handle->flags & UV_HANDLE_CLOSING)" and exit code
 * 3221226505, after the work has already finished and committed. So a command
 * that fully succeeded reported itself as a crash, which is a good way to spend
 * an evening debugging something that already worked.
 */
main()
  .catch((error: unknown) => {
    log.error('corpus command failed', { error });
    process.stderr.write(`\n${(error as Error).message}\n\n`);
    process.exitCode = 1;
  });
