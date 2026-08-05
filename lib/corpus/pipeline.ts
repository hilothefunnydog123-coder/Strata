/**
 * The five corpus stages.
 *
 * Each runs independently and resumes from where it stopped, because a crawl
 * that has to start over is a crawl that never finishes. Checkpointing is by
 * database state rather than a progress file: `parsed_at`, `extracted_at`, and
 * `verified_at` live on the rows themselves, so interrupting any stage and
 * re-running it picks up exactly the unfinished work.
 *
 * Idempotence comes from the content hash. A document whose bytes have not
 * changed is skipped, which is what makes re-running the whole pipeline safe.
 */
import { and, eq, inArray, isNotNull, isNull, sql } from 'drizzle-orm';
import { db } from '@/lib/db';
import { holding, sourceDocument, sourceSpan } from '@/lib/db/schema';
import { log } from '@/lib/log';
import { storage } from '@/lib/storage';
import { verifyQuote } from '@/lib/appeals/verify';
import { parseEcfrXml, parseHtml, parseText } from '@/lib/documents/parse';
import { extractPdfText } from '@/lib/denials/pdf';
import { ModelRateLimitedError, ModelRequestTooLargeError } from '@/lib/llm/client';
import {
  batchSpans,
  EXTRACTION_MAX_OUTPUT_TOKENS,
  EXTRACTION_SYSTEM_TOKENS,
  extractHoldings,
  halveBatch,
} from './extract';
import { estimateTokens, screen } from './screen';
import { cosine, embed, holdingEmbeddingText } from './embed';
import { RobotsDisallowedError } from './fetch';
import { SOURCES, type SourceKey } from './sources';

export interface StageResult {
  processed: number;
  skipped: number;
  failed: number;
  notes: string[];
}

const empty = (): StageResult => ({ processed: 0, skipped: 0, failed: 0, notes: [] });

/**
 * The most ids to put in one `in (...)` clause.
 *
 * A manual chapter screens out around a thousand passages at once, and marking
 * them in a single statement means a thousand bound parameters in one query.
 * PostgreSQL itself allows far more than that, and against node-postgres it
 * works, which is exactly the reasoning that produced the transaction that
 * threw on Neon: the local driver agreeing proves nothing about the driver
 * production uses. Neon's HTTP driver sends every statement as a JSON body over
 * a request that has its own size limits, and those limits are not documented
 * anywhere either of us can check.
 *
 * So the size is bounded, which costs three round trips instead of one on the
 * largest document in the corpus and removes the question.
 */
const IDS_PER_STATEMENT = 400;

function chunked<T>(items: readonly T[], size = IDS_PER_STATEMENT): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size));
  return out;
}

/* ─── 1. Fetch ────────────────────────────────────────────────────────────── */

export async function fetchStage(
  key: SourceKey,
  options: { since?: Date; limit?: number } = {},
): Promise<StageResult> {
  const source = SOURCES[key];
  const result = empty();

  const discovered = await source.discover(options);
  log.info('discovered documents', { source: key, count: discovered.length });

  for (const document of discovered) {
    try {
      const fetched = await source.fetch(document);

      // Unchanged bytes are a no-op. This is what makes a re-run create no
      // duplicates rather than a second copy of everything.
      const existing = await db.query.sourceDocument.findFirst({
        where: eq(sourceDocument.contentHash, fetched.contentHash),
      });

      const key_ = `corpus/${document.sourceType}/${fetched.contentHash}`;

      if (existing) {
        // The row is not proof the bytes are still there.
        //
        // The database outlives the storage when storage is a directory on a
        // CI runner. A fetch on one runner wrote eleven chapters and their
        // rows; the runner went away with the files; the next run saw the
        // hashes, skipped all eleven, and then the parse stage failed ten
        // times with ENOENT on blobs nothing would ever write again. The
        // document was stuck: fetch would not re-store it because the row
        // existed, and parse could not read it because the bytes did not.
        //
        // So the skip now depends on the bytes as well as the row. Re-storing
        // costs one write of something already downloaded, and it is the only
        // thing that makes this state recoverable without deleting rows by
        // hand.
        let present = true;
        try {
          await storage().get(key_);
        } catch {
          present = false;
        }

        if (present) {
          result.skipped += 1;
          continue;
        }

        await storage().put(key_, fetched.bytes, fetched.contentType);

        // Re-parse it, if there is nothing to lose by doing so.
        //
        // A document whose bytes had to be rewritten was parsed in an
        // environment that no longer exists, and on this project that parse was
        // usually wrong: chapter 8 was read as binary and still carries its
        // parsed flag, so the stage skips it and no amount of re-running fixes
        // it. Clearing the flag is the only way back.
        //
        // Only when it produced no holdings. A document that yielded some was
        // parsed well enough to be worth something, and re-parsing replaces its
        // passages and takes those holdings with them, which would spend model
        // allowance to arrive back where we started.
        const [held] = await db
          .select({ n: sql<number>`count(*)::int` })
          .from(holding)
          .where(eq(holding.sourceDocumentId, existing.id));

        if ((held?.n ?? 0) === 0) {
          await db
            .update(sourceDocument)
            .set({ parsedAt: null, extractedAt: null })
            .where(eq(sourceDocument.id, existing.id));
          result.notes.push(
            `${document.citation}: stored bytes were missing and have been written again. ` +
              'It held no holdings, so it will be parsed again from them.',
          );
        } else {
          result.notes.push(
            `${document.citation}: stored bytes were missing and have been written again. ` +
              `Its ${held!.n} holdings are kept, so it is not re-parsed.`,
          );
        }

        result.processed += 1;
        continue;
      }

      // Raw bytes are stored before anything reads them, and never mutated.
      await storage().put(key_, fetched.bytes, fetched.contentType);

      await db
        .insert(sourceDocument)
        .values({
          sourceType: document.sourceType,
          citation: document.citation,
          title: document.title,
          url: document.url,
          decidedAt: document.decidedAt,
          retrievedAt: fetched.retrievedAt,
          contentHash: fetched.contentHash,
          rawPath: key_,
        })
        // A citation that already exists with different bytes is a revision of
        // the same document, not a new one.
        .onConflictDoNothing();

      result.processed += 1;
    } catch (error) {
      if (error instanceof RobotsDisallowedError) {
        result.skipped += 1;
        result.notes.push(`robots.txt disallows ${document.url}`);
        continue;
      }
      result.failed += 1;
      log.error('could not fetch a source document', { url: document.url, error });
    }
  }

  return result;
}

/* ─── 2. Parse ────────────────────────────────────────────────────────────── */

/**
 * How much of a document has to be letters and spaces before it is text.
 *
 * Deliberately generous. English prose sits around 0.85, a page of a rate table
 * nearer 0.6, and compressed PDF bytes around 0.2. This is not trying to judge
 * quality, only to catch a document that is not text at all, which is a
 * mistake this pipeline made silently for a week.
 */
const MINIMUM_PROSE_RATIO = 0.5;

function proseRatio(text: string): number {
  if (text.length === 0) return 0;
  // Sampled rather than measured whole: a 400 page chapter is megabytes, the
  // answer does not move after a few thousand characters, and this runs on
  // every document of every run.
  const sample = text.length > 20_000 ? text.slice(0, 20_000) : text;
  return sample.replace(/[^A-Za-z\s]/g, '').length / sample.length;
}

/**
 * A PDF, by its magic bytes rather than by its file extension.
 *
 * The extension lies both ways here: the CMS chapter that works is served at
 * bp102c08pdf.pdf, and a URL ending .pdf can still answer with an HTML error
 * page. The first five bytes do not lie.
 */
function isPdf(bytes: Buffer): boolean {
  return bytes.subarray(0, 5).toString('latin1') === '%PDF-';
}

async function parseByContentType(bytes: Buffer, sourceType: string, url: string) {
  // Extract a PDF before anything else looks at it.
  //
  // This branch did not exist, and its absence is the reason the corpus has no
  // holdings. Benefit Policy Manual chapter 8 is a PDF. It was read as UTF-8,
  // which turns compressed object streams into replacement characters, and the
  // spanner then split that into 1,302 "paragraphs" of binary. They went into
  // the database as passages, the screen threw 1,019 of them away as unreadable
  // furniture, and the 279 it did send produced no holdings because there was
  // nothing in them to find. Every stage reported success.
  //
  // What made it invisible: nothing downstream of the parser has any idea what
  // text is supposed to look like. The screen was right, the extractor was
  // right, verification was right, and the answer was still zero.
  if (isPdf(bytes)) {
    const text = await extractPdfText(bytes);

    // A PDF with no text layer is a scan. The corpus has no business guessing
    // at one: OCR belongs to uploaded denial documents, where a human reviewer
    // sees the recognised text beside the page image before anything is signed.
    // A misread word in a manual would become a citation nobody could check.
    if (text.trim().length === 0) {
      throw new Error(
        'This PDF has no text layer, so it is a scan. The corpus does not OCR: a ' +
          'misrecognised word would become a citation that verifies against its own ' +
          'misreading. Find a text edition of this document.',
      );
    }

    return parseText(text);
  }

  const text = bytes.toString('utf8');
  if (sourceType === 'regulation' || url.endsWith('.xml')) return parseEcfrXml(text);
  if (/<html|<body|<div/i.test(text.slice(0, 2000))) return parseHtml(text);
  return parseText(text);
}

export async function parseStage(options: { reparse?: boolean } = {}): Promise<StageResult> {
  const result = empty();

  if (options.reparse) {
    // Everything crawled goes through the parser again.
    //
    // Needed when the parser itself was wrong rather than the document: a
    // chapter parsed as binary is stored, flagged parsed, and never looked at
    // again, and no amount of re-running fixes it because the flag says the
    // work is done. Demonstration rows are left alone; they were written
    // directly and have no stored bytes to re-read.
    const reset = await db
      .update(sourceDocument)
      .set({ parsedAt: null, extractedAt: null })
      .where(eq(sourceDocument.provenance, 'crawled'))
      .returning({ id: sourceDocument.id });

    result.notes.push(
      `${reset.length} crawled document${reset.length === 1 ? '' : 's'} were reset for ` +
        're-parsing. Their passages and any holdings drawn from them are replaced.',
    );
  }

  const pending = await db
    .select()
    .from(sourceDocument)
    .where(isNull(sourceDocument.parsedAt));

  for (const document of pending) {
    try {
      const bytes = await storage().get(document.rawPath);
      const parsed = await parseByContentType(bytes, document.sourceType, document.url);

      if (parsed.spans.length === 0) {
        result.failed += 1;
        result.notes.push(`${document.citation} produced no spans`);
        continue;
      }

      // Does this look like something a person wrote?
      //
      // The one question no stage was asking, and the reason a chapter of
      // compressed PDF bytes travelled the entire pipeline reporting success at
      // every step. It became 1,302 passages, the screen discarded most of them
      // as furniture, the model found no holdings in the rest, and each of
      // those was the correct response to the input. Correct responses all the
      // way down to an empty corpus.
      //
      // Prose is overwhelmingly letters and spaces. Compressed bytes are not,
      // and neither is a page of a table, so the threshold is set low enough
      // that a genuinely tabular document passes and only something that is not
      // text at all fails.
      const ratio = proseRatio(parsed.text);
      if (ratio < MINIMUM_PROSE_RATIO) {
        result.failed += 1;
        result.notes.push(
          `${document.citation}: the parsed text is ${(ratio * 100).toFixed(0)} percent ` +
            'letters and spaces, so it is not prose. The parser is reading the wrong ' +
            'format for this document, and nothing was stored. Check what the URL ' +
            'actually serves.',
        );
        continue;
      }

      // Replace rather than append, so re-parsing after a parser fix does not
      // leave two generations of spans behind.
      await db.delete(sourceSpan).where(eq(sourceSpan.sourceDocumentId, document.id));

      // Chunked for the same reason the id lists are: a 400 page chapter is
      // over a thousand rows, each carrying its full text, and one insert of
      // that is a multi megabyte request body.
      for (const group of chunked(parsed.spans, 200)) {
        await db.insert(sourceSpan).values(
          group.map((span) => ({
            sourceDocumentId: document.id,
            ordinal: span.ordinal,
            page: span.page,
            charStart: span.charStart,
            charEnd: span.charEnd,
            text: span.text,
            headingPath: span.headingPath,
          })),
        );
      }

      // Re-parsing replaced every span, so whatever was extracted from the old
      // ones is gone with them and the document has to go through the extractor
      // again. Without clearing this, a document re-parsed after a parser fix
      // would keep its completed flag and never be looked at again.
      await db
        .update(sourceDocument)
        .set({ parsedAt: new Date(), extractedAt: null })
        .where(eq(sourceDocument.id, document.id));

      result.processed += 1;
    } catch (error) {
      result.failed += 1;
      log.error('could not parse a source document', {
        citation: document.citation,
        error,
      });
    }
  }

  return result;
}

/* ─── 3. Extract ──────────────────────────────────────────────────────────── */

/**
 * How many times one document will wait out a rate limit before giving up.
 *
 * Generous, because on a free tier this is the normal case rather than a fault
 * and the alternative is a person re-running the command every four minutes.
 * Bounded, because a provider that has stopped answering should end the run
 * rather than hold it open all night: at the default interval this is a little
 * over half an hour of waiting per document, and the spans already done are
 * committed, so the next run starts from them.
 */
const RATE_LIMIT_WAITS_PER_DOCUMENT = 40;

/** Used when the provider does not say how long to wait. */
const DEFAULT_RATE_LIMIT_WAIT_SECONDS = 45;

/**
 * Above this, the wait is telling us about a different limit.
 *
 * A per minute allowance rolls over within the minute, so a provider asking to
 * be left alone for ten minutes is not talking about one. It is an hourly or
 * daily quota, and the distinction matters because the two have opposite
 * remedies: a per minute limit is waited out and the run finishes, a daily one
 * is not going to clear during this run no matter how patient it is.
 *
 * The run that made this obvious sat asking for the same batch every ten
 * minutes, each time being told ten minutes, with the passage count unchanged.
 * Left alone it would have spent almost seven hours reaching exactly as far as
 * it had in the first minute.
 */
const QUOTA_WAIT_THRESHOLD_SECONDS = 150;

const wait = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

export interface ExtractOptions {
  /** Injected by tests, which must not actually sleep for three quarters of an hour. */
  sleep?: (ms: number) => Promise<void>;
}

export interface ExtractResult extends StageResult {
  /**
   * Passages got through this run, whether or not their document finished.
   *
   * The document counts alone cannot tell a run that achieved nothing from one
   * that got three quarters of the way through a chapter: both report zero
   * processed and one failed. That distinction is what decides whether running
   * the command again is worth anything, so it has to be measurable.
   */
  spansExtracted: number;
  /**
   * The provider is refusing on a window longer than a minute.
   *
   * Separate from a failure, because the remedy is different and so is the
   * timescale: nothing about running the command again in the next few minutes
   * will help, and the caller should stop rather than start another round.
   */
  quotaExhausted: boolean;
}

export async function extractStage(
  limit = 100,
  options: ExtractOptions = {},
): Promise<ExtractResult> {
  const sleep = options.sleep ?? wait;
  const result = empty();
  let spansExtracted = 0;
  let quotaExhausted = false;

  const pending = await db
    .select()
    .from(sourceDocument)
    .where(
      and(isNotNull(sourceDocument.parsedAt), isNull(sourceDocument.extractedAt)),
    )
    .limit(limit);

  for (const document of pending) {
    try {
      // Only the spans not already done. On a first attempt that is all of
      // them; on a resumed one it is what the last attempt did not reach.
      const pendingSpans = await db
        .select()
        .from(sourceSpan)
        .where(
          and(
            eq(sourceSpan.sourceDocumentId, document.id),
            isNull(sourceSpan.extractedAt),
          ),
        )
        .orderBy(sourceSpan.ordinal);

      // Drop what cannot hold a rule before spending anything on it. This is
      // the difference between a chapter costing a day of allowance and costing
      // an hour, and it happens locally for nothing.
      const screened = pendingSpans.map((span) => ({
        span,
        verdict: screen(span.text, span.headingPath),
      }));

      const skipped = screened.filter((s) => !s.verdict.keep);
      const spans = screened.filter((s) => s.verdict.keep).map((s) => s.span);

      if (skipped.length > 0) {
        // Marked done with their reason, in one statement per reason rather
        // than one per row: a chapter skips a thousand passages and a thousand
        // round trips to a serverless database is its own kind of slow.
        const byReason = new Map<string, string[]>();
        for (const { span, verdict } of skipped) {
          const ids = byReason.get(verdict.reason!) ?? [];
          ids.push(span.id);
          byReason.set(verdict.reason!, ids);
        }

        for (const [reason, ids] of byReason) {
          for (const batch of chunked(ids)) {
            await db
              .update(sourceSpan)
              .set({ extractedAt: new Date(), screenedOut: reason })
              .where(inArray(sourceSpan.id, batch));
          }
        }

        log.info('screened out passages that cannot hold a rule', {
          citation: document.citation,
          skipped: skipped.length,
          sending: spans.length,
          reasons: Object.fromEntries([...byReason].map(([r, ids]) => [r, ids.length])),
        });

        // Screening is progress: those passages are settled and will not be
        // looked at again. Counting only the ones sent to the model would make
        // a round that screened a thousand passages and then hit a quota look
        // like a round that achieved nothing, and the caller stops on that.
        spansExtracted += skipped.length;
      }

      const alreadyDone = await db
        .select({ n: sql<number>`count(*)::int` })
        .from(sourceSpan)
        .where(
          and(
            eq(sourceSpan.sourceDocumentId, document.id),
            isNotNull(sourceSpan.extractedAt),
          ),
        );

      if ((alreadyDone[0]?.n ?? 0) > 0) {
        log.info('resuming a document from where it stopped', {
          citation: document.citation,
          done: alreadyDone[0]!.n,
          remaining: spans.length,
        });
      }

      let kept = 0;
      let waits = 0;
      let done = 0;

      // A worklist rather than a for loop, so a batch the provider refuses can
      // be replaced by its two halves and tried again.
      const queue = batchSpans(spans);

      while (queue.length > 0) {
        const batch = queue.shift();
        if (!batch) break;

        let response;
        try {
          response = await extractHoldings(
            document.citation,
            document.title,
            batch.map((s) => ({
              ordinal: s.ordinal,
              text: s.text,
              headingPath: s.headingPath,
            })),
          );
        } catch (error) {
          // A spent per minute allowance is not a failure, it is a wait. The
          // provider will take the same request again shortly, and it says how
          // long to leave it. Putting the batch back and sleeping is what turns
          // a free tier from unusable into slow.
          if (error instanceof ModelRateLimitedError) {
            const seconds = error.retryAfterSeconds ?? DEFAULT_RATE_LIMIT_WAIT_SECONDS;

            if (seconds > QUOTA_WAIT_THRESHOLD_SECONDS) {
              quotaExhausted = true;
              result.notes.push(
                `${document.citation}: the provider asked to be left alone for ` +
                  `${Math.ceil(seconds / 60)} minutes, which is an hourly or daily quota ` +
                  'rather than a per minute limit. Waiting will not clear it during this ' +
                  'run, so the run stopped here. Everything already extracted is saved.',
              );
              throw error;
            }

            waits += 1;
            if (waits > RATE_LIMIT_WAITS_PER_DOCUMENT) {
              result.notes.push(
                `${document.citation}: the provider was still rate limiting after ` +
                  `${RATE_LIMIT_WAITS_PER_DOCUMENT} waits, so this run stopped. The ` +
                  'passages already done are saved.',
              );
              throw error;
            }

            log.info('rate limited, waiting before trying the same batch again', {
              citation: document.citation,
              seconds: Math.ceil(seconds),
              attempt: waits,
              spansRemaining: queue.reduce((n, b) => n + b.length, batch.length),
            });
            queue.unshift(batch);
            await sleep(seconds * 1000);
            continue;
          }

          if (!(error instanceof ModelRequestTooLargeError)) throw error;

          const halves = halveBatch(batch);
          if (halves === null) {
            // One span the provider will not accept at any size. Skipping it
            // loses whatever it held, so it is recorded by ordinal rather than
            // counted: someone can go and look at that passage. Marked done, or
            // every future run would retry it and fail the same way.
            result.notes.push(
              `${document.citation}: span ${batch[0]?.ordinal} is too large for the model ` +
                'to accept on its own and was skipped. Nothing was extracted from it.',
            );
            if (batch[0]) {
              await db
                .update(sourceSpan)
                .set({ extractedAt: new Date() })
                .where(eq(sourceSpan.id, batch[0].id));
            }
            continue;
          }

          log.info('batch refused as too large, splitting', {
            citation: document.citation,
            from: batch.length,
            to: halves.map((h) => h.length),
          });
          queue.unshift(...halves);
          continue;
        }

        // Anchored within the batch, not the document.
        //
        // Only this batch's passages were in the prompt, so a holding citing an
        // ordinal from outside it did not come from a passage the model read.
        // Accepting one would attach a quote to text that was never shown,
        // which usually fails verification and occasionally does not, when the
        // same sentence appears in both places. That is the worst outcome
        // available: a citation that checks out and points somewhere else.
        const byOrdinal = new Map(batch.map((s) => [s.ordinal, s]));

        const rows: (typeof holding.$inferInsert)[] = [];
        for (const extracted of response.value.holdings) {
          const span = byOrdinal.get(extracted.spanOrdinal);
          if (!span) {
            result.notes.push(
              `${document.citation}: a holding cited span ${extracted.spanOrdinal}, which ` +
                'was not among the passages sent in that call, so it was discarded',
            );
            continue;
          }

          rows.push({
            sourceDocumentId: document.id,
            spanId: span.id,
            verbatimQuote: extracted.verbatimQuote,
            issue: extracted.issue,
            ruleApplied: extracted.ruleApplied,
            outcome: extracted.outcome,
            serviceType: extracted.serviceType,
            payerType: extracted.payerType,
            denialBasis: extracted.denialBasis,
          });
        }

        // Three statements in an order that survives being interrupted between
        // any two of them, rather than one transaction.
        //
        // Not a stylistic choice. The Neon HTTP driver has no interactive
        // transactions, and it is the driver production runs on, so a
        // transaction here is an outage there. It is also unnecessary: what is
        // actually required is that a re-run cannot double anything, and
        // ordering gives that without atomicity.
        //
        //   after the delete   the passage is still pending and its holdings
        //                      are gone, so the re-run redoes it
        //   after the insert   the passage is still pending and its holdings
        //                      are present, so the re-run deletes them and
        //                      writes them again
        //   after the mark     done
        //
        // The delete is what makes the middle case safe, and it is scoped to
        // this batch's passages, which is sound because a holding can only cite
        // a passage from the batch it came from.
        const batchIds = batch.map((s) => s.id);

        await db.delete(holding).where(inArray(holding.spanId, batchIds));
        if (rows.length > 0) await db.insert(holding).values(rows);
        await db
          .update(sourceSpan)
          .set({ extractedAt: new Date() })
          .where(inArray(sourceSpan.id, batchIds));
        kept += rows.length;
        spansExtracted += batch.length;
        done += batch.length;

        // Said every batch, because the alternative is minutes of nothing.
        // A chapter is dozens of calls with waits between them, and a run that
        // prints one line at the start and one at the end is indistinguishable
        // from a run that has hung, which is how the last one got killed and
        // restarted by hand.
        log.info('extracted a batch', {
          citation: document.citation,
          passages: `${done}/${spans.length}`,
          holdings: kept,
        });
      }

      await db
        .update(sourceDocument)
        .set({ extractedAt: new Date() })
        .where(eq(sourceDocument.id, document.id));

      result.processed += 1;
      if (kept === 0) {
        // Not a failure. A dismissal on timeliness holds nothing of general
        // application, and the prompt is written so that saying so is correct.
        result.notes.push(`${document.citation}: no holdings of general application`);
      }
    } catch (error) {
      result.failed += 1;
      // Whatever batches did commit are kept, and their spans are checkpointed,
      // so this document resumes rather than restarts. Saying so here matters:
      // the same line used to mean all of this document's work was gone.
      result.notes.push(
        `${document.citation}: stopped partway through. Re-running resumes from the ` +
          'next unextracted passage rather than starting the document again.',
      );
      log.error('could not extract holdings', { citation: document.citation, error });
    }
  }

  return { ...result, spansExtracted, quotaExhausted };
}

/* ─── 4. Verify ───────────────────────────────────────────────────────────── */

/**
 * Check every unverified holding's quote against the span it claims to come
 * from. A holding that fails is deleted, not flagged: the corpus is what the
 * product cites from, and a citation that does not check out has no business
 * being available to cite.
 */
export async function verifyStage(): Promise<StageResult & { failureRate: number }> {
  const result = empty();

  const pending = await db
    .select({
      id: holding.id,
      quote: holding.verbatimQuote,
      spanText: sourceSpan.text,
      citation: sourceDocument.citation,
    })
    .from(holding)
    .innerJoin(sourceSpan, eq(holding.spanId, sourceSpan.id))
    .innerJoin(sourceDocument, eq(holding.sourceDocumentId, sourceDocument.id))
    .where(isNull(holding.verifiedAt));

  const discarded: string[] = [];

  for (const row of pending) {
    const check = verifyQuote(row.quote, row.spanText);
    if (check.ok) {
      await db
        .update(holding)
        .set({ verifiedAt: new Date() })
        .where(eq(holding.id, row.id));
      result.processed += 1;
    } else {
      discarded.push(row.id);
      result.failed += 1;
      log.warn('holding discarded: the quote is not in the span it cites', {
        citation: row.citation,
        reason: check.reason,
      });
    }
  }

  for (const id of discarded) {
    await db.delete(holding).where(eq(holding.id, id));
  }

  const total = pending.length;
  const failureRate = total === 0 ? 0 : result.failed / total;

  if (failureRate > 0.05) {
    result.notes.push(
      `Verification failure rate is ${(failureRate * 100).toFixed(1)} percent, above the ` +
        '5 percent threshold. The extraction prompt is producing quotes that are not in ' +
        'the source. Fix the prompt rather than the threshold.',
    );
  }

  return { ...result, failureRate };
}

/* ─── 5. Embed ────────────────────────────────────────────────────────────── */

export async function embedStage(): Promise<StageResult> {
  const result = empty();

  const pending = await db
    .select()
    .from(holding)
    .where(and(isNotNull(holding.verifiedAt), isNull(holding.embedding)));

  for (const row of pending) {
    try {
      await db
        .update(holding)
        .set({ embedding: embed(holdingEmbeddingText(row)) })
        .where(eq(holding.id, row.id));
      result.processed += 1;
    } catch (error) {
      result.failed += 1;
      log.error('could not embed a holding', { holdingId: row.id, error });
    }
  }

  return result;
}

/* ─── Estimate ────────────────────────────────────────────────────────────── */

export interface DocumentEstimate {
  citation: string;
  passages: number;
  sending: number;
  calls: number;
  tokens: number;
}

/**
 * What the outstanding extraction work will cost, before any of it is spent.
 *
 * Written because the answer for one CMS chapter turned out to be more than a
 * day's allowance on a free account, and there was no way to learn that except
 * by running it for forty minutes and watching it stall. A number available in
 * two seconds changes the decision: a different model, a smaller document
 * first, or a paid account for an afternoon.
 *
 * Deliberately counts the overhead. Every call is charged its prompt plus the
 * system prompt plus the completion reservation whether the model uses it or
 * not, and on small batches that fixed cost was half the bill. An estimate that
 * counted only the document's own text would understate it by that much.
 */
export async function estimateExtraction(): Promise<DocumentEstimate[]> {
  const pending = await db
    .select()
    .from(sourceDocument)
    .where(and(isNotNull(sourceDocument.parsedAt), isNull(sourceDocument.extractedAt)));

  const estimates: DocumentEstimate[] = [];

  for (const document of pending) {
    const spans = await db
      .select()
      .from(sourceSpan)
      .where(and(eq(sourceSpan.sourceDocumentId, document.id), isNull(sourceSpan.extractedAt)));

    const keeping = spans.filter((s) => screen(s.text, s.headingPath).keep);
    const chars = keeping.reduce((n, s) => n + s.text.length + 64, 0);
    const calls = batchSpans(keeping).length;

    estimates.push({
      citation: document.citation,
      passages: spans.length,
      sending: keeping.length,
      calls,
      tokens: estimateTokens(chars) + calls * (EXTRACTION_SYSTEM_TOKENS + EXTRACTION_MAX_OUTPUT_TOKENS),
    });
  }

  return estimates.sort((a, b) => a.tokens - b.tokens);
}

/* ─── Status ──────────────────────────────────────────────────────────────── */

export interface CorpusDocument {
  sourceType: string;
  citation: string;
  url: string;
  retrievedAt: Date;
  holdings: number;
  provenance: string;
}

export interface CorpusHealth {
  documentsBySource: { sourceType: string; count: number; lastRetrieved: Date | null }[];
  /**
   * Every document, named, with where it came from.
   *
   * A count cannot answer the only question that matters about a legal corpus,
   * which is whether what is in it is real. Five rows and two holdings looked
   * healthy on every summary this reported for a week, while nobody could say
   * what four of those rows were or who put them there. A citation and a URL
   * are checkable in a browser; "regulation: 2" is not.
   */
  documents: CorpusDocument[];
  holdingsTotal: number;
  holdingsVerified: number;
  holdingsEmbedded: number;
  holdingsByServiceType: { serviceType: string | null; count: number }[];
  holdingsByDenialBasis: { denialBasis: string | null; count: number }[];
  verificationFailureRate: number;
  embeddingCoverage: number;
}

export async function corpusHealth(): Promise<CorpusHealth> {
  const [bySource, totals, byService, byBasis, documents] = await Promise.all([
    db
      .select({
        sourceType: sourceDocument.sourceType,
        count: sql<number>`count(*)::int`,
        lastRetrieved: sql<Date | null>`max(${sourceDocument.retrievedAt})`,
      })
      .from(sourceDocument)
      .groupBy(sourceDocument.sourceType),
    db
      .select({
        total: sql<number>`count(*)::int`,
        verified: sql<number>`count(${holding.verifiedAt})::int`,
        embedded: sql<number>`count(${holding.embedding})::int`,
      })
      .from(holding),
    db
      .select({
        serviceType: holding.serviceType,
        count: sql<number>`count(*)::int`,
      })
      .from(holding)
      .where(isNotNull(holding.verifiedAt))
      .groupBy(holding.serviceType),
    db
      .select({
        denialBasis: holding.denialBasis,
        count: sql<number>`count(*)::int`,
      })
      .from(holding)
      .where(isNotNull(holding.verifiedAt))
      .groupBy(holding.denialBasis),
    db
      .select({
        sourceType: sourceDocument.sourceType,
        citation: sourceDocument.citation,
        url: sourceDocument.url,
        retrievedAt: sourceDocument.retrievedAt,
        provenance: sourceDocument.provenance,
        holdings: sql<number>`count(${holding.id})::int`,
      })
      .from(sourceDocument)
      .leftJoin(holding, eq(holding.sourceDocumentId, sourceDocument.id))
      .groupBy(
        sourceDocument.id,
        sourceDocument.sourceType,
        sourceDocument.citation,
        sourceDocument.url,
        sourceDocument.retrievedAt,
        sourceDocument.provenance,
      )
      .orderBy(sourceDocument.retrievedAt),
  ]);

  const total = totals[0]?.total ?? 0;
  const verified = totals[0]?.verified ?? 0;
  const embedded = totals[0]?.embedded ?? 0;

  return {
    documentsBySource: bySource,
    documents,
    holdingsTotal: total,
    holdingsVerified: verified,
    holdingsEmbedded: embedded,
    holdingsByServiceType: byService,
    holdingsByDenialBasis: byBasis,
    // Holdings that failed verification were deleted, so what remains
    // unverified is work not yet done rather than work that failed.
    verificationFailureRate: total === 0 ? 0 : (total - verified) / total,
    embeddingCoverage: verified === 0 ? 0 : embedded / verified,
  };
}

export { cosine };
