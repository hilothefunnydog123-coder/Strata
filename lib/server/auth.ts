import bcrypt from "bcryptjs";
import { cookies } from "next/headers";
import { prisma } from "./db";
import { SESSION_COOKIE, verifySession } from "./session";

export async function hashPassword(pw: string): Promise<string> {
  return bcrypt.hash(pw, 10);
}
export async function verifyPassword(pw: string, hash: string): Promise<boolean> {
  return bcrypt.compare(pw, hash);
}

export interface SessionUser {
  id: string;
  name: string;
  email: string;
  role: string;
  isOwner: boolean;
  initials: string;
  org: { id: string; name: string; slug: string; seededDemo: boolean } | null;
}

function initialsOf(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  const letters = parts
    .filter((p) => !/^(dr|mr|mrs|ms|prof)\.?$/i.test(p))
    .slice(0, 2)
    .map((p) => p[0]?.toUpperCase() ?? "");
  return (letters.join("") || name.slice(0, 2)).toUpperCase();
}

/** Resolve the current user from the session cookie, or null. */
export async function getSessionUser(): Promise<SessionUser | null> {
  const token = cookies().get(SESSION_COOKIE)?.value;
  const payload = verifySession(token);
  if (!payload) return null;
  const user = await prisma.user.findUnique({
    where: { id: payload.uid },
    include: { org: true },
  });
  if (!user || !user.active) return null;
  if (user.org && !user.org.active) return null;
  return {
    id: user.id,
    name: user.name,
    email: user.email,
    role: user.role,
    isOwner: user.isOwner,
    initials: initialsOf(user.name),
    org: user.org
      ? { id: user.org.id, name: user.org.name, slug: user.org.slug, seededDemo: user.org.seededDemo }
      : null,
  };
}

export async function requireUser(): Promise<SessionUser> {
  const u = await getSessionUser();
  if (!u) throw new AuthError("Not authenticated", 401);
  return u;
}

export async function requireOwner(): Promise<SessionUser> {
  const u = await requireUser();
  if (!u.isOwner) throw new AuthError("Owner access required", 403);
  return u;
}

export class AuthError extends Error {
  status: number;
  constructor(message: string, status = 401) {
    super(message);
    this.status = status;
  }
}
