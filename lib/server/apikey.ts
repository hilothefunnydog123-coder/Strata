import crypto from "crypto";
import { prisma } from "./db";
import { AuthError } from "./auth";

// Per-org ingestion API keys. The plaintext key is shown to the customer once;
// only its SHA-256 hash is persisted. Ingestion endpoints authenticate with
// `Authorization: Bearer <key>`.

const PREFIX = "wk_live_";

export interface GeneratedKey {
  plaintext: string;
  prefix: string;
  hash: string;
}

export function generateApiKey(): GeneratedKey {
  const secret = crypto.randomBytes(24).toString("hex"); // 48 hex chars
  const plaintext = `${PREFIX}${secret}`;
  return {
    plaintext,
    prefix: plaintext.slice(0, 12), // "wk_live_ab12"
    hash: hashKey(plaintext),
  };
}

export function hashKey(plaintext: string): string {
  return crypto.createHash("sha256").update(plaintext.trim()).digest("hex");
}

/** Resolve the org for a Bearer ingestion key, or throw AuthError(401). */
export async function requireApiKey(req: Request): Promise<{ orgId: string; keyId: string }> {
  const header = req.headers.get("authorization") || req.headers.get("Authorization");
  const token = header?.toLowerCase().startsWith("bearer ")
    ? header.slice(7).trim()
    : header?.trim();
  if (!token) throw new AuthError("Missing API key", 401);

  const key = await prisma.apiKey.findUnique({
    where: { hash: hashKey(token) },
    include: { org: true },
  });
  if (!key || key.revokedAt || !key.org?.active) {
    throw new AuthError("Invalid or revoked API key", 401);
  }

  // Best-effort last-used stamp; never block ingestion on it.
  prisma.apiKey
    .update({ where: { id: key.id }, data: { lastUsedAt: new Date() } })
    .catch(() => {});

  return { orgId: key.orgId, keyId: key.id };
}
