import { openLocalDb, rebuildFts, searchCorpus, countCorpus } from "./index";

/**
 * Prove PROMPT §3: searching ~300k spans must return in under 50ms. This runs the
 * REAL path — insert spans into the mirror, rebuild FTS5, then time searchCorpus.
 *
 *   pnpm --filter @assent/local-db bench
 */

const N_DOCS = 300;
const SPANS_PER_DOC = 1000; // 300 docs × 1000 = 300,000 spans
const PAYERS = ["cms", "moldx", "aetna", "cigna", "uhc", "elevance", "bcbsmi", "humana"];

/**
 * Realistic corpus model. Real policy English is Zipfian over tens of thousands of
 * distinct tokens, so a two-content-word query is selective. We model that: a few
 * very-common function words, the policy content words (our query terms) at
 * MODERATE frequency, and a long tail of rare tokens. Uniform sampling over a tiny
 * vocabulary is not representative and would understate FTS5's real performance.
 */
const COMMON = ["the", "of", "and", "is", "a", "in", "for", "to", "be", "or", "with", "as", "that"];
const CONTENT = [
  "molecular", "oncology", "diagnostic", "prospective", "retrospective", "clinical",
  "validity", "utility", "analytical", "concordance", "prior", "therapy", "coverage",
  "medically", "necessary", "investigational", "endpoint", "outcomes", "specimen",
  "sequencing", "variant", "somatic", "germline", "registry", "moldx", "zcode",
  "documentation", "physician", "attestation", "cohort", "sensitivity", "specificity",
];
const TAIL_SIZE = 6000; // long tail of rare tokens
const VOCAB: string[] = [...COMMON, ...CONTENT, ...Array.from({ length: TAIL_SIZE }, (_, i) => `t${i}`)];
// Zipf cumulative weights: weight(rank) = 1/(rank+1).
const CUM: number[] = [];
{
  let acc = 0;
  for (let i = 0; i < VOCAB.length; i++) { acc += 1 / (i + 1); CUM.push(acc); }
}
const TOTAL_W = CUM[CUM.length - 1]!;

function pseudo(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 0xffffffff;
  };
}

function sampleZipf(rand: () => number): string {
  const target = rand() * TOTAL_W;
  // binary search into CUM
  let lo = 0, hi = CUM.length - 1;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (CUM[mid]! < target) lo = mid + 1; else hi = mid;
  }
  return VOCAB[lo]!;
}

function spanText(rand: () => number, uid: number): string {
  const n = 30 + Math.floor(rand() * 30); // realistic policy sentence length
  const words: string[] = [];
  for (let i = 0; i < n; i++) words.push(sampleZipf(rand));
  words.push(`u${uid}`); // a unique token per span
  return words.join(" ");
}

function main() {
  const db = openLocalDb(":memory:");
  const rand = pseudo(42);

  console.log(`[bench] generating ${N_DOCS} docs × ${SPANS_PER_DOC} spans = ${N_DOCS * SPANS_PER_DOC} spans…`);
  const t0 = performance.now();
  const insertPayer = db.prepare("INSERT OR IGNORE INTO payer (id,name,type) VALUES (?,?,?)");
  const insertDoc = db.prepare(
    "INSERT INTO policy_document (id,payer_id,external_id,title,url,effective_date,retrieved_at,content_hash,raw_storage_path) VALUES (?,?,?,?,?,?,?,?,?)",
  );
  const insertSpan = db.prepare(
    "INSERT INTO document_span (id,policy_document_id,ordinal,page_number,char_start,char_end,text,heading_path) VALUES (?,?,?,?,?,?,?,?)",
  );

  const load = db.transaction(() => {
    for (const p of PAYERS) insertPayer.run(p, p.toUpperCase(), "commercial");
    let uid = 0;
    for (let d = 0; d < N_DOCS; d++) {
      const payer = PAYERS[d % PAYERS.length]!;
      const docId = `doc_${d}`;
      insertDoc.run(docId, payer, `EX${d}`, `Policy ${d}`, "http://x", "2025-01-01", "2025-01-01T00:00:00Z", `h${d}`, `raw/${d}`);
      for (let s = 0; s < SPANS_PER_DOC; s++) {
        const text = spanText(rand, uid++);
        insertSpan.run(`${docId}_s${s}`, docId, s, 1, 0, text.length, text, "[]");
      }
    }
  });
  load();
  const t1 = performance.now();
  console.log(`[bench] insert: ${Math.round(t1 - t0)}ms`);

  rebuildFts(db);
  const t2 = performance.now();
  console.log(`[bench] FTS build: ${Math.round(t2 - t1)}ms`);
  console.log(`[bench] corpus:`, countCorpus(db));

  const queries = [
    "clinical utility",
    "prospective outcomes",
    "MolDX Z-code",
    "analytical validity concordance",
    "documentation physician attestation",
  ];
  const times: number[] = [];
  // Warm + measure each query several times.
  for (let round = 0; round < 20; round++) {
    for (const q of queries) {
      const a = performance.now();
      const hits = searchCorpus(db, q, { limit: 50 });
      const b = performance.now();
      times.push(b - a);
      if (round === 0) console.log(`[bench]   "${q}" → ${hits.length} hits`);
    }
  }
  times.sort((x, y) => x - y);
  const p = (q: number) => times[Math.min(times.length - 1, Math.floor(times.length * q))]!;
  const max = times[times.length - 1]!;
  console.log(`[bench] search over ${(N_DOCS * SPANS_PER_DOC).toLocaleString()} spans:`);
  console.log(`[bench]   p50=${p(0.5).toFixed(2)}ms  p95=${p(0.95).toFixed(2)}ms  max=${max.toFixed(2)}ms`);
  const pass = max < 50;
  console.log(`[bench] ${pass ? "✅ PASS" : "❌ FAIL"} — §3 target is <50ms (worst case ${max.toFixed(2)}ms)`);
  db.close();
  if (!pass) process.exit(1);
}

main();
