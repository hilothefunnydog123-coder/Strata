import { sql } from "drizzle-orm";
import { schema } from "@assent/db";
import { openStore } from "./store";

/**
 * `pnpm corpus:status` — how real is the data in this database?
 *
 * The product's promise is that a requirement traces to a real payer document, so
 * the honest answer to "can I act on this?" has to be one command away and
 * impossible to misread. Provenance is recorded per document at ingest; this reads
 * it back and says plainly what you have.
 */
async function main() {
  const store = openStore();
  try {
    const rows = (await store.db
      .select({ provenance: schema.policyDocument.provenance, n: sql<number>`count(*)::int` })
      .from(schema.policyDocument)
      .groupBy(schema.policyDocument.provenance)) as Array<{ provenance: string; n: number }>;

    const total = rows.reduce((s, r) => s + r.n, 0);
    const fetched = rows.find((r) => r.provenance === "fetched")?.n ?? 0;
    const sample = rows.find((r) => r.provenance === "sample")?.n ?? 0;
    const scale = rows.find((r) => r.provenance === "synthetic_scale")?.n ?? 0;

    const criteria = (await store.db.select({ n: sql<number>`count(*)::int` }).from(schema.criterion))[0]?.n ?? 0;
    const payers = (await store.db.select({ n: sql<number>`count(distinct payer_id)::int` }).from(schema.policyDocument))[0]?.n ?? 0;

    console.log("\n═══ Corpus status ═══════════════════════════════════════════\n");
    if (total === 0) {
      console.log("  The corpus is empty. Run `pnpm pipeline` (sample) or");
      console.log("  `pnpm corpus:live` (real CMS documents).\n");
      return;
    }
    console.log(`  documents            ${total}   across ${payers} payer(s)`);
    console.log(`  criteria             ${criteria}`);
    console.log("");
    console.log(`  REAL (fetched)       ${fetched}`);
    console.log(`  sample text          ${sample}`);
    console.log(`  synthetic scale      ${scale}`);
    console.log("");

    const pct = total === 0 ? 0 : Math.round((fetched / total) * 100);
    if (fetched === total) {
      console.log("  ✅ Every document was fetched from its real source.");
      console.log("     Requirements here can be relied on, subject to the citation shown.\n");
    } else if (fetched === 0) {
      console.log("  ⚠️  NO document in this corpus is real.");
      console.log("     Everything here is development text written to match the shape of");
      console.log("     coverage policy. It must NOT be used for a coverage or trial decision.");
      console.log("     Fix with:  PIPELINE_MODE=live pnpm corpus:live\n");
    } else {
      console.log(`  ⚠️  MIXED — ${pct}% of documents are real.`);
      console.log("     Treat any requirement whose document is not 'fetched' as illustrative only.\n");
    }
  } finally {
    await store.client.end();
  }
}

main().catch((err) => {
  console.error("[corpus:status]", err instanceof Error ? err.message : err);
  process.exit(1);
});
