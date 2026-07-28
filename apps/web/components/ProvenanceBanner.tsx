import { sql } from "drizzle-orm";
import { db, schema } from "@/lib/db";
import { isStandalone, standaloneCorpus } from "@/lib/standalone";
import { CorpusFetchButton } from "./CorpusFetchButton";

/**
 * Corpus provenance, stated plainly and unmissably.
 *
 * The product's entire promise is that a requirement traces to a real payer
 * document. Until the pipeline has actually fetched those documents, the corpus
 * holds RECONSTRUCTED text used for development — faithful in structure, but not
 * a real policy. Showing that as though it were a live payer requirement would be
 * the single most damaging thing this product could do, so the banner is rendered
 * on every console page and cannot be dismissed.
 *
 * It disappears on its own once every document has provenance = 'fetched'.
 */
export async function ProvenanceBanner() {
  // Standalone reads the bundled corpus, which is entirely sample text by
  // definition. Two things are true at once and both belong on the page: the
  // documents are not real, and the console is running without a database.
  if (isStandalone()) {
    const corpus = await standaloneCorpus();
    const total = corpus?.documents.length ?? 0;
    return (
      <div role="status" className="mb-6 border-l-2 border-ink bg-chrome-50 px-4 py-3">
        <div className="a-mono text-[10px] uppercase tracking-[0.12em] text-ink">
          Standalone mode — sample corpus, no database
        </div>
        <p className="mt-1.5 max-w-reading text-[13px] leading-relaxed text-chrome-700">
          All {total} documents here are{" "}
          <strong className="font-medium text-ink">reconstructed sample text</strong> bundled in
          this build, and they are{" "}
          <strong className="font-medium text-ink">not real payer requirements</strong>. Sign-in
          and authenticator enrollment survive a restart but not a redeploy, and there is one account.
        </p>
        <p className="a-mono mt-2 text-[11px] text-chrome-500">
          set DATABASE_URL to return to the database-backed console — nothing to undo
        </p>
      </div>
    );
  }

  let counts: Array<{ provenance: string; n: number }> = [];
  try {
    counts = (await db()
      .select({ provenance: schema.policyDocument.provenance, n: sql<number>`count(*)::int` })
      .from(schema.policyDocument)
      .groupBy(schema.policyDocument.provenance)) as Array<{ provenance: string; n: number }>;
  } catch {
    return null; // never let the banner break the page
  }

  const total = counts.reduce((s, c) => s + c.n, 0);
  if (total === 0) return null;
  const unfetched = counts.filter((c) => c.provenance !== "fetched").reduce((s, c) => s + c.n, 0);
  if (unfetched === 0) return null;

  const sample = counts.find((c) => c.provenance === "sample")?.n ?? 0;
  const scale = counts.find((c) => c.provenance === "synthetic_scale")?.n ?? 0;

  return (
    <div role="status" className="mb-6 border-l-2 border-ink bg-chrome-50 px-4 py-3">
      <div className="a-mono text-[10px] uppercase tracking-[0.12em] text-ink">
        Sample corpus — not live payer policy
      </div>
      <p className="mt-1.5 max-w-reading text-[13px] leading-relaxed text-chrome-700">
        {unfetched} of {total} documents in this corpus are{" "}
        <strong className="font-medium text-ink">reconstructed sample text</strong>, written to
        match the structure of real coverage policy for development. They are{" "}
        <strong className="font-medium text-ink">not real payer requirements</strong> and must not
        be relied on for a coverage or trial-design decision.
      </p>
      <p className="a-mono mt-2 text-[11px] text-chrome-500">
        {sample > 0 && <>sample {sample} · </>}
        {scale > 0 && <>synthetic-scale {scale} · </>}
        Medicare policy is public domain and can be fetched directly
      </p>
      {/* The fix is one tap from the page that states the problem, rather than a
          redeploy or a shell somewhere else. */}
      <CorpusFetchButton />
    </div>
  );
}
