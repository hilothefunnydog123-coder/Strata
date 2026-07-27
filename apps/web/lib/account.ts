import "server-only";
import { eq, inArray } from "drizzle-orm";
import { db, schema } from "./db";
import { COVERAGE_STANCE_RANK, type CoverageStance, type BlueprintPayload } from "@assent/core";

export async function getAccount(accountId: string) {
  return (await db().select().from(schema.account).where(eq(schema.account.id, accountId)).limit(1))[0] ?? null;
}

export async function getSeats(accountId: string) {
  return db().select({ id: schema.appUser.id, email: schema.appUser.email, role: schema.appUser.role })
    .from(schema.appUser).where(eq(schema.appUser.accountId, accountId));
}

export async function getFirstAsset(accountId: string) {
  return (await db().select().from(schema.asset).where(eq(schema.asset.accountId, accountId)).limit(1))[0] ?? null;
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
  const payers = await db().select().from(schema.payer);
  const lives = await db().select().from(schema.coveredLives);
  const livesByPayer = new Map<string, number>();
  for (const l of lives) livesByPayer.set(l.payerId, Math.max(livesByPayer.get(l.payerId) ?? 0, l.livesCount));

  const codes = asset?.targetCodes ?? [];
  const codeRows = codes.length ? await db().select().from(schema.code).where(inArray(schema.code.code, codes)) : [];
  const codeIds = codeRows.map((c) => c.id);

  // Explicit stances on the asset's codes, plus doc→payer, and covers/excludes links.
  const stanceRows = codeIds.length
    ? await db().select().from(schema.coverageStance).where(inArray(schema.coverageStance.codeId, codeIds))
    : [];
  const docs = await db().select({ id: schema.policyDocument.id, payerId: schema.policyDocument.payerId }).from(schema.policyDocument);
  const payerByDoc = new Map(docs.map((d) => [d.id, d.payerId]));
  const links = codeIds.length
    ? await db().select().from(schema.policyCodeLink).where(inArray(schema.policyCodeLink.codeId, codeIds))
    : [];

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
  if (asset) {
    const bp = (await db().select().from(schema.blueprint).where(eq(schema.blueprint.assetId, asset.id)).limit(1))[0];
    blueprint = (bp?.payload as BlueprintPayload) ?? null;
  }
  return { rows, totalLives, coveredLives, blueprint, asset };
}
