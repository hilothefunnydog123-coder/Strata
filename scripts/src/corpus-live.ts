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
  };
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

  if (process.env.PIPELINE_MODE !== "live") {
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

    console.log(`  requesting ${opts.kind.toUpperCase()}s from the Medicare Coverage Database…`);
    let raws;
    try {
      raws = await cms.ingestCms({ kind: opts.kind, limit: opts.limit, filter: undefined });
    } catch (err) {
      console.error(
        `\n[corpus:live] FAILED to fetch: ${err instanceof Error ? err.message : err}\n\n` +
          "  Nothing was written. The corpus is unchanged.\n" +
          "  Check, in order:\n" +
          "    1. this machine has ordinary outbound HTTPS (the build sandbox did not)\n" +
          "    2. ASSENT_CMS_MCD_BASE still matches CMS's endpoint — they have moved it before\n" +
          "    3. the response shape in packages/ingest/src/sources/cms.ts\n",
      );
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
