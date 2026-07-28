import { scryptSync, randomBytes } from "node:crypto";
import { authenticator } from "otplib";
import { eq } from "drizzle-orm";
import { schema } from "@assent/db";
import { parseHtmlToSpans, parsePdfToSpans } from "@assent/parse";
import { ingestSource, ingestAll, allSourceIds, loadFixtureRawDocuments, generateScaleDocuments, type RawDocument } from "@assent/ingest";
import { extractDocument, diffVersions, makePolicyDocId } from "@assent/extract";
import { verifyQuote, type Asset } from "@assent/core";
import { buildBlueprint, type EnrichedCriterion } from "@assent/blueprint";
import { openLocalDb, loadCorpus } from "@assent/local-db";
import {
  openStore, seedReference, upsertPolicyDocument, insertSpans, docIdsWithSpans, docIdsWithCriteria,
  getSpans, insertExtraction, getCriteria, insertChanges, exportCorpus, codeIdMap, type Store,
} from "./store";

// ── arg parsing ───────────────────────────────────────────────────────────────
const [, , stage, ...rest] = process.argv;
const flags = new Map<string, string>();
for (const a of rest) {
  const m = a.match(/^--([^=]+)(?:=(.*))?$/);
  if (m) flags.set(m[1]!, m[2] ?? "true");
}

/** Map every fixture RawDocument to its deterministic doc id (source==payerId in v0). */
function rawByDocId(source?: string): Map<string, RawDocument> {
  const raws = source ? loadFixtureRawDocuments(source) : loadFixtureRawDocuments();
  return new Map(raws.map((r) => [makePolicyDocId(r.source, r.externalId, r.version), r]));
}
function docContext(docId: string, raw: RawDocument, resolveCode: (c: string) => string | null) {
  const version = Number(docId.match(/_v(\d+)$/)?.[1] ?? raw.version);
  return {
    source: raw.source,
    externalId: raw.externalId,
    version,
    documentTitle: raw.title,
    resolveCode,
    // Codes this document covers/mentions, so a detected stance attaches to them.
    documentCodes: raw.codes.map((c) => c.code),
  };
}

// ── stages ────────────────────────────────────────────────────────────────────

async function ingest(store: Store) {
  await seedReference(store);
  const source = flags.get("source");
  const since = flags.get("since");
  const docs = source ? await ingestSource(source, { since }) : await ingestAll({ since });
  // Optionally synthesize structurally-real docs to reach corpus scale (M9's ≥300 count).
  const scaleN = Number(flags.get("generate-scale") ?? "0");
  const scale = scaleN > 0 ? generateScaleDocuments(scaleN) : [];
  let inserted = 0, unchanged = 0;
  for (const raw of [...docs, ...scale]) {
    const docId = makePolicyDocId(raw.source, raw.externalId, raw.version);
    const supersedesId = raw.supersedesExternalVersion
      ? makePolicyDocId(raw.source, raw.externalId, raw.supersedesExternalVersion) : null;
    const r = await upsertPolicyDocument(store, raw, docId, supersedesId);
    if (r.inserted) inserted++; else unchanged++;
  }
  // Scale docs are not in the fixtures manifest, so parse them inline here (we have
  // the bytes) rather than relying on the separate parse stage's fixture loader.
  for (const raw of scale) {
    const docId = makePolicyDocId(raw.source, raw.externalId, raw.version);
    const { spans } = parseHtmlToSpans(new TextDecoder().decode(raw.bytes));
    await insertSpans(store, docId, spans);
  }
  const scaleNote = scale.length ? ` (incl. ${scale.length} synthetic-scale, parsed inline)` : "";
  console.log(`[ingest] ${docs.length + scale.length} docs${scaleNote} → ${inserted} new versions, ${unchanged} seen/unchanged`);
}

async function parse(store: Store) {
  const withSpans = await docIdsWithSpans(store);
  const raws = rawByDocId();
  let parsed = 0;
  for (const [docId, raw] of raws) {
    if (withSpans.has(docId)) continue;
    const { spans } =
      raw.contentType === "pdf"
        ? await parsePdfToSpans(raw.bytes)
        : parseHtmlToSpans(new TextDecoder().decode(raw.bytes));
    await insertSpans(store, docId, spans);
    parsed++;
  }
  console.log(`[parse] parsed ${parsed} document(s)`);
}

async function extract(store: Store) {
  const limit = Number(flags.get("limit") ?? "1000");
  const withSpans = await docIdsWithSpans(store);
  const withCriteria = await docIdsWithCriteria(store);
  const raws = rawByDocId();
  const codes = await codeIdMap(store);
  const resolveCode = (c: string) => codes.get(c) ?? null;
  let done = 0, totalCrit = 0, totalRej = 0;
  for (const docId of withSpans) {
    if (withCriteria.has(docId) || done >= limit) continue;
    const raw = raws.get(docId);
    if (!raw) continue;
    const spans = await getSpans(store, docId);
    const result = await extractDocument(spans, docContext(docId, raw, resolveCode));
    await insertExtraction(store, result);
    totalCrit += result.criteria.length;
    totalRej += result.rejections.length;
    done++;
  }
  const rate = totalCrit + totalRej === 0 ? 0 : totalRej / (totalCrit + totalRej);
  console.log(`[extract] ${done} doc(s): ${totalCrit} criteria, ${totalRej} rejected (rejection rate ${(rate * 100).toFixed(1)}%)`);
  if (rate >= 0.05) { console.error(`[extract] rejection rate ${(rate * 100).toFixed(1)}% >= 5% — stop and fix the prompt (§5).`); process.exitCode = 1; }
}

async function verify(store: Store) {
  // Audit: re-check the invariant on stored criteria. Should be 0 failures.
  const rows = await store.db.select().from(schema.criterion);
  let checked = 0, failed = 0;
  for (const c of rows) {
    const span = (await store.db.select().from(schema.documentSpan).where(eq(schema.documentSpan.id, c.spanId)).limit(1))[0];
    checked++;
    if (!span || !verifyQuote(span.text, c.verbatimQuote).ok) failed++;
  }
  console.log(`[verify] audited ${checked} criteria — ${failed} failed the citation invariant`);
  if (failed > 0) process.exitCode = 1;
}

async function diff(store: Store) {
  const source = flags.get("payer") ?? flags.get("source");
  const docs = await store.db.select().from(schema.policyDocument);
  let changed = 0;
  for (const doc of docs) {
    if (!doc.supersedesId) continue;
    if (source && doc.payerId !== source) continue;
    const from = await getCriteria(store, doc.supersedesId);
    const to = await getCriteria(store, doc.id);
    const changes = await diffVersions(from, to, doc.id);
    await insertChanges(store, changes);
    changed += changes.length;
    const counts = changes.reduce((m, c) => ((m[c.changeType] = (m[c.changeType] ?? 0) + 1), m), {} as Record<string, number>);
    console.log(`[diff] ${doc.externalId} v(${doc.supersedesId} → ${doc.id}): ${JSON.stringify(counts)}`);
  }
  console.log(`[diff] ${changed} criterion-level change(s) recorded`);
}

async function blueprint(store: Store) {
  const assetId = flags.get("asset");
  if (!assetId) { console.error("[blueprint] --asset=<id> required"); process.exitCode = 1; return; }
  const assetRow = (await store.db.select().from(schema.asset).where(eq(schema.asset.id, assetId)).limit(1))[0];
  if (!assetRow) { console.error(`[blueprint] asset ${assetId} not found`); process.exitCode = 1; return; }
  const asset: Asset = {
    id: assetRow.id, accountId: assetRow.accountId, name: assetRow.name, indication: assetRow.indication,
    intendedUse: assetRow.intendedUse, targetCodes: assetRow.targetCodes, comparator: assetRow.comparator,
    targetPopulation: assetRow.targetPopulation,
  };

  const payers = (await store.db.select().from(schema.payer)) as never[];
  const coveredLives = (await store.db.select().from(schema.coveredLives)).map((l) => ({
    payerId: l.payerId, year: l.year, segment: l.segment, livesCount: l.livesCount, sourceUrl: l.sourceUrl, sourceNote: l.sourceNote,
  }));
  const docs = await store.db.select().from(schema.policyDocument);
  const payerByDoc = new Map(docs.map((d) => [d.id, d.payerId]));
  // Only current versions feed the blueprint — exclude any doc that has been superseded.
  const supersededIds = new Set(docs.map((d) => d.supersedesId).filter((x): x is string => !!x));
  const links = await store.db.select().from(schema.policyCodeLink);
  const codeById = new Map((await store.db.select().from(schema.code)).map((c) => [c.id, c.code]));
  const codesByDoc: Record<string, string[]> = {};
  for (const l of links) (codesByDoc[l.policyDocumentId] ??= []).push(codeById.get(l.codeId) ?? l.codeId);

  const criteria = (await store.db.select().from(schema.criterion)).filter((c) => !supersededIds.has(c.policyDocumentId));
  const enriched: EnrichedCriterion[] = criteria.map((c) => ({
    id: c.id, policyDocumentId: c.policyDocumentId, kind: c.kind, subject: c.subject, requirementText: c.requirementText,
    operator: c.operator, value: c.value, unit: c.unit, evidence: c.evidence, spanId: c.spanId,
    verbatimQuote: c.verbatimQuote, confidence: c.confidence, extractedByModel: c.extractedByModel,
    extractedAt: c.extractedAt.toISOString(), payerId: payerByDoc.get(c.policyDocumentId) ?? "unknown",
  }));

  const payload = await buildBlueprint({ asset, criteria: enriched, codesByDoc, payers, coveredLives });
  const inputsHash = `${asset.id}:${criteria.length}:${enriched.length}`;
  await store.db.insert(schema.blueprint).values({ id: `bp_${asset.id}`, assetId: asset.id, inputsHash, payload }).onConflictDoNothing();

  console.log(`\n[blueprint] ${asset.name} — ${payload.clusters.length} requirement clusters, ${payload.totalCorpusLives.toLocaleString()} modeled lives\n`);
  console.log(payload.narrative + "\n");
  console.log("Frontier:");
  for (const step of payload.frontier) {
    console.log(`  ${(step.cumulativePct * 100).toFixed(0).padStart(3)}%  +${step.livesUnlocked.toLocaleString().padStart(11)}  [${step.costHint}]  ${step.label}`);
  }
  console.log("\nTop clusters by lives:");
  for (const cl of payload.clusters.slice(0, 8)) {
    console.log(`  ${cl.livesCovered.toLocaleString().padStart(11)}  ${cl.payerCount}p  strict=${cl.strictness.toFixed(2)}  ${cl.label}  (${cl.citations.length} citations)`);
  }
}

async function exportJson(store: Store) {
  const { writeFileSync, mkdirSync } = await import("node:fs");
  const { dirname } = await import("node:path");
  const path = flags.get("out") ?? "./data/corpus.json";
  const corpus = await exportCorpus(store);
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, JSON.stringify(corpus, null, 2));
  console.log(`[export-json] ${corpus.documents.length} docs / ${corpus.spans.length} spans / ${corpus.criteria.length} criteria → ${path}`);
}

async function exportDesktop(store: Store) {
  const path = flags.get("out") ?? rest.find((a) => !a.startsWith("--")) ?? "./data/assent-desktop.sqlite";
  const corpus = await exportCorpus(store);
  const db = openLocalDb(path);
  loadCorpus(db, corpus);
  db.close();
  console.log(`[export-desktop] wrote ${corpus.documents.length} docs / ${corpus.spans.length} spans / ${corpus.criteria.length} criteria → ${path}`);
}

async function seed(store: Store) {
  await seedReference(store);
  // Demo account + admin user + asset (so blueprint has an object to key off).
  const salt = randomBytes(16).toString("hex");
  // A committed default password on a public URL is a door with the key taped to it.
  // Unset, the demo user gets a random one nobody holds — the account still exists so
  // the pipeline and blueprint have something to key off, but it cannot be signed
  // into. `pnpm founder` is how a real login is made.
  const generatedPassword = !process.env.OWNER_PASSWORD;
  const password = process.env.OWNER_PASSWORD ?? randomBytes(24).toString("base64url");
  const hash = `${salt}:${scryptSync(password, salt, 64).toString("hex")}`;
  await store.db.insert(schema.account).values({ id: "acct_demo", orgName: "Northwind Diagnostics", plan: "pilot", seatLimit: 5, createdByAdmin: "cli" }).onConflictDoNothing();
  // The old default here was otplib's PUBLISHED example secret, which meant anyone
  // who had read this repository could generate valid codes for any deployment that
  // ran the seed. Now it is generated per install; `pnpm ... totp` reads it back out
  // of the database, so local testing is unchanged. Set ASSENT_DEMO_TOTP_SECRET only
  // when a fixed value is genuinely needed (a scripted test), never in a deployment.
  const totpSecret = process.env.ASSENT_DEMO_TOTP_SECRET ?? authenticator.generateSecret();
  await store.db.insert(schema.appUser).values({
    id: "user_demo", accountId: "acct_demo", email: (process.env.OWNER_EMAIL ?? "vp@northwind.example.com").toLowerCase(),
    role: "admin", passwordHash: hash, totpSecret, totpEnrolled: true,
  }).onConflictDoNothing();
  await store.db.insert(schema.asset).values({
    id: "asset_demo", accountId: "acct_demo", name: "Northwind CGP (tissue)",
    indication: "Comprehensive genomic profiling for advanced or metastatic solid tumors",
    intendedUse: "Guide selection of targeted systemic therapy", targetCodes: ["81445", "81479"],
    comparator: "single-gene testing", targetPopulation: "Adults with advanced solid tumors",
  }).onConflictDoNothing();
  const demoEmail = process.env.OWNER_EMAIL ?? "vp@northwind.example.com";
  if (generatedPassword) {
    console.log(`[seed] account acct_demo, asset asset_demo ready`);
    console.log(`[seed] demo user ${demoEmail} has a RANDOM password that was not stored anywhere —`);
    console.log(`[seed] it exists to own the demo asset, not to be signed into. For a real login:`);
    console.log(`[seed]   pnpm founder --email you@yourdomain.com`);
    console.log(`[seed] (set OWNER_PASSWORD before seeding if you do want to sign in as the demo user)`);
  } else {
    console.log(`[seed] account acct_demo, user ${demoEmail} (pw: from OWNER_PASSWORD), asset asset_demo ready`);
    console.log(`[seed] TOTP enrolled — get the current code with:  pnpm --filter @assent/scripts exec tsx src/cli.ts totp`);
  }
}

async function totp(store: Store) {
  const email = flags.get("email") ?? process.env.OWNER_EMAIL ?? "vp@northwind.example.com";
  const row = (await store.db.select().from(schema.appUser).where(eq(schema.appUser.email, email.toLowerCase())).limit(1))[0];
  if (!row?.totpSecret) { console.error(`[totp] no TOTP secret for ${email}`); process.exitCode = 1; return; }
  console.log(`[totp] ${email} → ${authenticator.generate(row.totpSecret)}  (valid ~${authenticator.timeRemaining?.() ?? 30}s)`);
}

async function pipeline(store: Store) {
  await ingest(store);
  await parse(store);
  await extract(store);
  await verify(store);
  await diff(store);
  console.log("[pipeline] complete");
}

// ── dispatch ────────────────────────────────────────────────────────────────
const STAGES: Record<string, (s: Store) => Promise<void>> = {
  seed, ingest, parse, extract, verify, diff, blueprint, pipeline, totp,
  "export-desktop": exportDesktop, "export-json": exportJson,
};

async function main() {
  const fn = STAGES[stage ?? ""];
  if (!fn) {
    console.error(`Unknown stage "${stage}". Available: ${Object.keys(STAGES).join(", ")}`);
    process.exit(1);
  }
  const store = openStore();
  try {
    await fn(store);
  } finally {
    await store.client.end();
  }
}
main().catch((err) => { console.error(err); process.exit(1); });
