import { parseHtmlToSpans } from "@assent/parse";
import { cms } from "@assent/ingest";
import { extractDocument, makePolicyDocId } from "@assent/extract";
import {
  openStore, seedReference, upsertPolicyDocument, insertSpans,
  getSpans, insertExtraction, codeIdMap, type Store,
} from "./store";

/**
 * `pnpm corpus:live` — replace the sample corpus with real CMS documents.
 *
 * This is the single command that turns the product from a working demo into
 * something whose answers can be acted on. It needs exactly one thing this build
 * environment could not provide: ordinary outbound internet access.
 *
 * Why CMS first, and why that is not a compromise: Medicare coverage documents are
 * US government works. They are public domain, they need no licence and no legal
 * review, and MolDX — which sets the analytical-validity / clinical-validity /
 * clinical-utility bar that the whole diagnostics industry is judged against — is
 * administered through them. It is both the easiest corpus to obtain and the most
 * consequential one.
 *
 * Every safeguard here exists so this can never quietly produce something that
 * LOOKS real. It refuses to mark anything 'fetched' unless it genuinely came off
 * the wire, and it fails with a specific message rather than a partial corpus.
 */

interface Options {
  limit: number;
  kind: "ncd" | "lcd";
  keepSample: boolean;
  /** Boot mode: do nothing if the corpus is already real, and never exit non-zero. */
  ifNeeded: boolean;
}

/**
 * Where the last attempt is recorded.
 *
 * The one machine that can reach CMS is the deployment, and the person who needs to
 * know whether it worked is holding a phone. So the outcome — including the exact
 * status, content-type and body head from each candidate endpoint — is written here
 * and served by /api/diagnostics. A failed fetch stops being invisible.
 */
const REPORT_PATH = process.env.ASSENT_CORPUS_REPORT ?? "/tmp/assent-corpus-fetch.json";

async function writeReport(report: Record<string, unknown>): Promise<void> {
  try {
    const { writeFile } = await import("node:fs/promises");
    await writeFile(REPORT_PATH, JSON.stringify({ ...report, at: new Date().toISOString() }, null, 2));
  } catch {
    /* reporting must never be the thing that fails a boot */
  }
}

function parseArgs(): Options {
  const flags = new Map<string, string>();
  for (const a of process.argv.slice(2)) {
    const m = a.match(/^--([^=]+)(?:=(.*))?$/);
    if (m) flags.set(m[1]!, m[2] ?? "true");
  }
  return {
    limit: Number(flags.get("limit") ?? "50"),
    kind: (flags.get("kind") as "ncd" | "lcd") ?? "ncd",
    keepSample: flags.get("keep-sample") === "true",
    ifNeeded: flags.get("if-needed") === "true",
  };
}

/** Documents already carrying provenance 'fetched'. Non-zero means the corpus is real. */
async function realDocumentCount(store: Store): Promise<number> {
  const { sql } = await import("drizzle-orm");
  const res = await store.db.execute(
    sql`SELECT count(*)::int AS n FROM policy_document WHERE provenance = 'fetched'`,
  );
  const rows = res as unknown as Array<{ n?: number }>;
  return rows[0]?.n ?? 0;
}

async function clearSample(store: Store): Promise<number> {
  // Sample documents and everything derived from them go together — a half-cleared
  // corpus would mix real and invented requirements under one asset.
  const { sql } = await import("drizzle-orm");
  const res = await store.db.execute(sql`
    WITH doomed AS (SELECT id FROM policy_document WHERE provenance <> 'fetched'),
    a AS (DELETE FROM criterion_change WHERE policy_document_id IN (SELECT id FROM doomed)),
    b AS (DELETE FROM coverage_stance  WHERE policy_document_id IN (SELECT id FROM doomed)),
    c AS (DELETE FROM rejected_extraction WHERE span_id IN (SELECT id FROM document_span WHERE policy_document_id IN (SELECT id FROM doomed))),
    d AS (DELETE FROM criterion        WHERE policy_document_id IN (SELECT id FROM doomed)),
    e AS (DELETE FROM document_span    WHERE policy_document_id IN (SELECT id FROM doomed)),
    f AS (DELETE FROM policy_code_link WHERE policy_document_id IN (SELECT id FROM doomed))
    DELETE FROM policy_document WHERE id IN (SELECT id FROM doomed)
  `);
  return (res as unknown as { count?: number }).count ?? 0;
}

async function main() {
  const opts = parseArgs();

  // Interactive runs stay opt-in. `--if-needed` is the boot path, which is allowed to
  // try on its own because a corpus that is quietly fake is the worse failure.
  if (process.env.PIPELINE_MODE !== "live" && !opts.ifNeeded) {
    console.error(
      "\n[corpus:live] PIPELINE_MODE must be 'live'.\n" +
        "  This command reaches the real Medicare Coverage Database, so it is opt-in.\n\n" +
        "  PIPELINE_MODE=live pnpm corpus:live\n",
    );
    process.exit(1);
  }

  console.log("\n═══ Fetching the real CMS corpus ════════════════════════════\n");
  const store = openStore();
  try {
    await seedReference(store);

    if (opts.ifNeeded) {
      const already = await realDocumentCount(store);
      if (already > 0) {
        console.log(`  ${already} real document(s) already present — nothing to do`);
        await writeReport({ outcome: "already-real", realDocuments: already });
        return;
      }
    }

    console.log(`  requesting ${opts.kind.toUpperCase()}s from the Medicare Coverage Database…`);
    let raws;
    try {
      raws = await cms.ingestCms({ kind: opts.kind, limit: opts.limit, filter: undefined });
    } catch (err) {
      // Capture what each candidate endpoint actually said. This is the difference
      // between "the fetch failed" and a URL, a status and a body somebody can fix.
      const probe = await cms.probeCms(opts.kind).catch(() => []);
      await writeReport({
        outcome: "failed",
        error: err instanceof Error ? err.message : String(err),
        probe,
      });
      console.error(
        `\n[corpus:live] FAILED to fetch: ${err instanceof Error ? err.message : err}\n\n` +
          "  Nothing was written. The corpus is unchanged.\n" +
          "  The exact response from each candidate endpoint is in /api/diagnostics.\n",
      );
      // On the boot path a failed fetch must not fail the deploy — the sample corpus
      // still serves, and the banner still says it is sample.
      if (opts.ifNeeded) return;
      process.exit(1);
    }

    console.log(`  fetched ${raws.length} document(s) from the wire`);
    if (!opts.keepSample) {
      const removed = await clearSample(store);
      console.log(`  removed ${removed} sample document(s) so nothing invented remains`);
    }

    const codes = await codeIdMap(store);
    const resolveCode = (c: string) => codes.get(c) ?? null;
    let docs = 0;
    let criteria = 0;

    for (const raw of raws) {
      if (raw.provenance !== "fetched") {
        throw new Error(`refusing to store ${raw.externalId}: provenance is '${raw.provenance}', not 'fetched'`);
      }
      const docId = makePolicyDocId(raw.source, raw.externalId, raw.version);
      await upsertPolicyDocument(store, raw, docId, null);
      const { spans } = parseHtmlToSpans(new TextDecoder().decode(raw.bytes));
      await insertSpans(store, docId, spans);

      const stored = await getSpans(store, docId);
      const result = await extractDocument(stored, {
        source: raw.source, externalId: raw.externalId, version: raw.version,
        documentTitle: raw.title, resolveCode, documentCodes: raw.codes.map((c) => c.code),
      });
      await insertExtraction(store, result);
      docs++;
      criteria += result.criteria.length;
    }

    await writeReport({ outcome: "fetched", documents: docs, criteria });
    console.log(`\n  ✅ ${docs} REAL documents, ${criteria} requirements, every one carrying a`);
    console.log("     verbatim quote that exists in the fetched source.\n");
    console.log("  Confirm at any time with:  pnpm corpus:status\n");
  } finally {
    await store.client.end();
  }
}

main().catch((err) => {
  console.error("[corpus:live]", err instanceof Error ? err.message : err);
  process.exit(1);
});
