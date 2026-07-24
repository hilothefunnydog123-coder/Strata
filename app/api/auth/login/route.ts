import { NextResponse } from "next/server";
import { prisma } from "@/lib/server/db";
import { verifyPassword } from "@/lib/server/auth";
import { SESSION_COOKIE, sessionCookieOptions, signSession } from "@/lib/server/session";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  const body = await req.json().catch(() => ({}));
  const email = String(body.email ?? "").trim().toLowerCase();
  const password = String(body.password ?? "");
  if (!email || !password) {
    return NextResponse.json({ error: "Email and password are required." }, { status: 400 });
  }

  const user = await prisma.user.findUnique({ where: { email }, include: { org: true } });
  if (!user || !user.active) {
    return NextResponse.json({ error: "Invalid email or password." }, { status: 401 });
  }
  if (user.org && !user.org.active) {
    return NextResponse.json({ error: "This organization has been suspended." }, { status: 403 });
  }
  const ok = await verifyPassword(password, user.passwordHash);
  if (!ok) {
    return NextResponse.json({ error: "Invalid email or password." }, { status: 401 });
  }

  await prisma.user.update({ where: { id: user.id }, data: { lastLoginAt: new Date() } });

  const res = NextResponse.json({ ok: true, isOwner: user.isOwner });
  res.cookies.set(SESSION_COOKIE, signSession(user.id), sessionCookieOptions());
  return res;
}
