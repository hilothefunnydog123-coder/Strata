import "server-only";
import { cookies } from "next/headers";
import { eq } from "drizzle-orm";
import { db, schema } from "./db";
import { hashToken, randomToken } from "./auth";

const COOKIE = "assent_session";
const TTL_MS = 1000 * 60 * 60 * 24 * 14; // 14 days

export interface SessionUser {
  id: string;
  email: string;
  role: "admin" | "member" | "viewer";
  accountId: string;
}

/** Create a session, store only its hash, set the httpOnly cookie. */
export async function createSession(userId: string): Promise<void> {
  const token = randomToken();
  const id = hashToken(token);
  const expiresAt = new Date(Date.now() + TTL_MS);
  await db().insert(schema.session).values({ id, userId, expiresAt });
  cookies().set(COOKIE, token, {
    httpOnly: true, sameSite: "lax", secure: process.env.NODE_ENV === "production",
    path: "/", expires: expiresAt,
  });
}

export async function destroySession(): Promise<void> {
  const token = cookies().get(COOKIE)?.value;
  if (token) await db().delete(schema.session).where(eq(schema.session.id, hashToken(token)));
  cookies().delete(COOKIE);
}

/** Resolve the current user from the session cookie, or null. */
export async function currentUser(): Promise<SessionUser | null> {
  const token = cookies().get(COOKIE)?.value;
  if (!token) return null;
  const rows = await db()
    .select({
      id: schema.appUser.id, email: schema.appUser.email, role: schema.appUser.role,
      accountId: schema.appUser.accountId, expiresAt: schema.session.expiresAt,
    })
    .from(schema.session)
    .innerJoin(schema.appUser, eq(schema.appUser.id, schema.session.userId))
    .where(eq(schema.session.id, hashToken(token)))
    .limit(1);
  const row = rows[0];
  if (!row || row.expiresAt.getTime() < Date.now()) return null;
  return { id: row.id, email: row.email, role: row.role, accountId: row.accountId };
}
