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
import { and, eq, isNotNull, isNull, sql } from 'drizzle-orm';
import { db } from '@/lib/db';
import { holding, sourceDocument, sourceSpan } from '@/lib/db/schema';
import { log } from '@/lib/log';
import { storage } from '@/lib/storage';
import { verifyQuote } from '@/lib/appeals/verify';
import { parseEcfrXml, parseHtml, parseText } from '@/lib/documents/parse';
import { ModelRequestTooLargeError } from '@/lib/llm/client';
import { batchSpans, extractHoldings, halveBatch } from './extract';
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
      if (existing) {
        result.skipped += 1;
        continue;
      }

      // Raw bytes are stored before anything reads them, and never mutated.
      const key_ = `corpus/${document.sourceType}/${fetched.contentHash}`;
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

function parseByContentType(bytes: Buffer, sourceType: string, url: string) {
  const text = bytes.toString('utf8');
  if (sourceType === 'regulation' || url.endsWith('.xml')) return parseEcfrXml(text);
  if (/<html|<body|<div/i.test(text.slice(0, 2000))) return parseHtml(text);
  return parseText(text);
}

export async function parseStage(): Promise<StageResult> {
  const result = empty();

  const pending = await db
    .select()
    .from(sourceDocument)
    .where(isNull(sourceDocument.parsedAt));

  for (const document of pending) {
    try {
      const bytes = await storage().get(document.rawPath);
      const parsed = parseByContentType(bytes, document.sourceType, document.url);

      if (parsed.spans.length === 0) {
        result.failed += 1;
        result.notes.push(`${document.citation} produced no spans`);
        continue;
      }

      // Replace rather than append, so re-parsing after a parser fix does not
      // leave two generations of spans behind.
      await db.delete(sourceSpan).where(eq(sourceSpan.sourceDocumentId, document.id));

      await db.insert(sourceSpan).values(
        parsed.spans.map((span) => ({
          sourceDocumentId: document.id,
          ordinal: span.ordinal,
          page: span.page,
          charStart: span.charStart,
          charEnd: span.charEnd,
          text: span.text,
          headingPath: span.headingPath,
        })),
      );

      await db
        .update(sourceDocument)
        .set({ parsedAt: new Date() })
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

export async function extractStage(limit = 100): Promise<StageResult> {
  const result = empty();

  const pending = await db
    .select()
    .from(sourceDocument)
    .where(
      and(isNotNull(sourceDocument.parsedAt), isNull(sourceDocument.extractedAt)),
    )
    .limit(limit);

  for (const document of pending) {
    try {
      const spans = await db
        .select()
        .from(sourceSpan)
        .where(eq(sourceSpan.sourceDocumentId, document.id))
        .orderBy(sourceSpan.ordinal);

      const byOrdinal = new Map(spans.map((s) => [s.ordinal, s]));

      // Clear anything a previous interrupted run left behind, exactly as the
      // parse stage does with spans.
      //
      // Without this, a document whose fourth batch fails keeps the holdings
      // from its first three and never gets extracted_at set, so the next run
      // extracts those same three batches again and inserts a second copy of
      // every holding. Nothing downstream would catch it: the duplicates verify
      // cleanly, because they are genuine quotes from a genuine span. The
      // corpus would just quietly gain weight, and a retrieval that surfaces
      // the same authority three times looks like three sources agreeing.
      //
      // A document that has already been extracted is not selected above, so
      // this can only ever delete the debris of a failed run.
      await db.delete(holding).where(eq(holding.sourceDocumentId, document.id));

      let kept = 0;

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
          if (!(error instanceof ModelRequestTooLargeError)) throw error;

          const halves = halveBatch(batch);
          if (halves === null) {
            // One span the provider will not accept at any size. Skipping it
            // loses whatever it held, so it is recorded by ordinal rather than
            // counted: someone can go and look at that passage.
            result.notes.push(
              `${document.citation}: span ${batch[0]?.ordinal} is too large for the model ` +
                'to accept on its own and was skipped. Nothing was extracted from it.',
            );
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

        for (const extracted of response.value.holdings) {
          const span = byOrdinal.get(extracted.spanOrdinal);
          if (!span) {
            result.notes.push(
              `${document.citation}: holding cites span ${extracted.spanOrdinal}, which does not exist`,
            );
            continue;
          }

          await db.insert(holding).values({
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
          kept += 1;
        }
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
      log.error('could not extract holdings', { citation: document.citation, error });
    }
  }

  return result;
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

/* ─── Status ──────────────────────────────────────────────────────────────── */

export interface CorpusHealth {
  documentsBySource: { sourceType: string; count: number; lastRetrieved: Date | null }[];
  holdingsTotal: number;
  holdingsVerified: number;
  holdingsEmbedded: number;
  holdingsByServiceType: { serviceType: string | null; count: number }[];
  holdingsByDenialBasis: { denialBasis: string | null; count: number }[];
  verificationFailureRate: number;
  embeddingCoverage: number;
}

export async function corpusHealth(): Promise<CorpusHealth> {
  const [bySource, totals, byService, byBasis] = await Promise.all([
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
  ]);

  const total = totals[0]?.total ?? 0;
  const verified = totals[0]?.verified ?? 0;
  const embedded = totals[0]?.embedded ?? 0;

  return {
    documentsBySource: bySource,
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
