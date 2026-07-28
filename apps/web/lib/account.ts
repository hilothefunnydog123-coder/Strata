import "server-only";
import { eq, inArray } from "drizzle-orm";
import { db, schema } from "./db";
import { COVERAGE_STANCE_RANK, FOUNDER_BOOTSTRAP, type CoverageStance, type BlueprintPayload } from "@assent/core";
import { isStandalone, standaloneAccount, standaloneAsset, standaloneCorpus } from "./standalone";

export async function getAccount(accountId: string) {
  if (isStandalone()) return standaloneAccount();
  return (await db().select().from(schema.account).where(eq(schema.account.id, accountId)).limit(1))[0] ?? null;
}

export async function getSeats(accountId: string) {
  // Standalone has exactly one seat by construction — there is nowhere to store a second.
  if (isStandalone()) {
    return [{ id: FOUNDER_BOOTSTRAP.userId, email: FOUNDER_BOOTSTRAP.email, role: "admin" as const }];
  }
  return db().select({ id: schema.appUser.id, email: schema.appUser.email, role: schema.appUser.role })
    .from(schema.appUser).where(eq(schema.appUser.accountId, accountId));
}

export async function getFirstAsset(accountId: string) {
  if (isStandalone()) return standaloneAsset();
  return (await db().select().from(schema.asset).where(eq(schema.asset.accountId, accountId)).limit(1))[0] ?? null;
}

interface CoverageInputs {
  payers: { id: string; name: string }[];
  lives: { payerId: string; livesCount: number }[];
  codeRows: { id: string }[];
  stanceRows: { policyDocumentId: string; codeId: string; stance: CoverageStance; verbatimQuote: string | null }[];
  docs: { id: string; payerId: string }[];
  links: { policyDocumentId: string; codeId: string; relationship: string }[];
}

/**
 * The five collections the coverage summary derives from, out of Postgres or out of
 * the bundled corpus. Same rows either way — `corpus.json` is an export of these
 * very tables — so the caller does not branch and the derivation stays single-source.
 */
async function coverageInputs(codes: string[]): Promise<CoverageInputs> {
  if (isStandalone()) {
    const corpus = await standaloneCorpus();
    if (!corpus) return { payers: [], lives: [], codeRows: [], stanceRows: [], docs: [], links: [] };
    const codeRows = corpus.codes.filter((c) => codes.includes(c.code));
    const codeIds = new Set(codeRows.map((c) => c.id));
    return {
      payers: corpus.payers,
      lives: corpus.coveredLives,
      codeRows,
      stanceRows: corpus.stances.filter((s) => codeIds.has(s.codeId)),
      docs: corpus.documents,
      links: corpus.codeLinks.filter((l) => codeIds.has(l.codeId)),
    };
  }

  const [payers, lives, docs] = await Promise.all([
    db().select().from(schema.payer),
    db().select().from(schema.coveredLives),
    db().select({ id: schema.policyDocument.id, payerId: schema.policyDocument.payerId }).from(schema.policyDocument),
  ]);
  const codeRows = codes.length ? await db().select().from(schema.code).where(inArray(schema.code.code, codes)) : [];
  const codeIds = codeRows.map((c) => c.id);
  const [stanceRows, links] = await Promise.all([
    codeIds.length ? db().select().from(schema.coverageStance).where(inArray(schema.coverageStance.codeId, codeIds)) : [],
    codeIds.length ? db().select().from(schema.policyCodeLink).where(inArray(schema.policyCodeLink.codeId, codeIds)) : [],
  ]);
  return { payers, lives, codeRows, stanceRows, docs, links };
}

export interface CoverageRow {
  payerId: string;
  payerName: string;
  lives: number;
  stance: CoverageStance;
  quote: string | null;
}

/**
 * The thin, read-only coverage summary for executives who will never install the
 * desktop app. Stance per payer on the asset's codes, weighted by covered lives.
 * Silent is expected to dominate and is shown honestly.
 */
export async function getCoverageSummary(accountId: string): Promise<{
  rows: CoverageRow[];
  totalLives: number;
  coveredLives: number;
  blueprint: BlueprintPayload | null;
  asset: Awaited<ReturnType<typeof getFirstAsset>>;
}> {
  const asset = await getFirstAsset(accountId);
  const codes = asset?.targetCodes ?? [];

  // Only the READS differ between modes. Everything below this line — stance
  // ranking, the code-link fallback, lives weighting — is one implementation, so
  // the two modes cannot report different coverage from the same corpus.
  const { payers, lives, codeRows, stanceRows, docs, links } = await coverageInputs(codes);

  const livesByPayer = new Map<string, number>();
  for (const l of lives) livesByPayer.set(l.payerId, Math.max(livesByPayer.get(l.payerId) ?? 0, l.livesCount));

  const codeIds = codeRows.map((c) => c.id);
  const payerByDoc = new Map(docs.map((d) => [d.id, d.payerId]));

  const bestStance = new Map<string, { stance: CoverageStance; quote: string | null }>();
  const consider = (payerId: string, stance: CoverageStance, quote: string | null) => {
    const cur = bestStance.get(payerId);
    if (!cur || COVERAGE_STANCE_RANK[stance] < COVERAGE_STANCE_RANK[cur.stance]) bestStance.set(payerId, { stance, quote });
  };
  for (const s of stanceRows) {
    const payerId = payerByDoc.get(s.policyDocumentId);
    if (payerId) consider(payerId, s.stance, s.verbatimQuote);
  }
  // Fall back to code-link relationship where no explicit stance exists.
  for (const l of links) {
    const payerId = payerByDoc.get(l.policyDocumentId);
    if (!payerId || bestStance.has(payerId)) continue;
    if (l.relationship === "covers") consider(payerId, "conditional", null);
    else if (l.relationship === "excludes") consider(payerId, "not_covered", null);
  }

  const rows: CoverageRow[] = payers.map((p) => ({
    payerId: p.id, payerName: p.name, lives: livesByPayer.get(p.id) ?? 0,
    stance: bestStance.get(p.id)?.stance ?? "silent", quote: bestStance.get(p.id)?.quote ?? null,
  })).sort((a, b) => b.lives - a.lives);

  const totalLives = rows.reduce((s, r) => s + r.lives, 0);
  const coveredLives = rows.filter((r) => r.stance === "covered" || r.stance === "conditional").reduce((s, r) => s + r.lives, 0);

  let blueprint: BlueprintPayload | null = null;
  // Standalone has no blueprint table. The terminal computes the Evidence Blueprint
  // client-side from the same corpus, so nothing is lost — the console just links
  // there instead of rendering a stored payload.
  if (asset && !isStandalone()) {
    const bp = (await db().select().from(schema.blueprint).where(eq(schema.blueprint.assetId, asset.id)).limit(1))[0];
    blueprint = (bp?.payload as BlueprintPayload) ?? null;
  }
  return { rows, totalLives, coveredLives, blueprint, asset };
}
