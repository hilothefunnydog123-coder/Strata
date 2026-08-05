/**
 * The corpus command line.
 *
 *   pnpm corpus:fetch    --source=dab [--since=2020-01-01] [--limit=1000]
 *   pnpm corpus:parse    --unparsed
 *   pnpm corpus:extract  --unextracted [--limit=100]
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
  extractStage,
  fetchStage,
  parseStage,
  verifyStage,
} from '../lib/corpus/pipeline';
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
      const source = (flag('source') ?? 'dab') as SourceKey;
      if (!SOURCES[source]) {
        throw new Error(
          `Unknown source "${source}". Available: ${Object.keys(SOURCES).join(', ')}. ` +
            'LCD and NCD are deliberately absent; see CORPUS.md section 5.',
        );
      }
      const since = flag('since') ? new Date(flag('since')!) : undefined;
      const limit = flag('limit') ? Number(flag('limit')) : undefined;

      reportStage(
        `fetch ${source}`,
        await fetchStage(source, {
          ...(since ? { since } : {}),
          ...(limit ? { limit } : {}),
        }),
      );
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

    case 'status':
      await status();
      break;

    default:
      throw new Error(
        `Unknown command "${command ?? ''}". ` +
          'Use one of: fetch, parse, extract, verify, embed, status.',
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
