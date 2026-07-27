import { NextResponse } from "next/server";
import { and, eq } from "drizzle-orm";
import { db, schema } from "@/lib/db";
import { currentUser } from "@/lib/session";
import { randomToken } from "@/lib/auth";

export const runtime = "nodejs";

/** OAuth device-flow approval (authed). Binds the pairing code to this user. */
export async function POST(req: Request) {
  const user = await currentUser();
  if (!user) return NextResponse.redirect(new URL("/login", req.url), { status: 303 });

  const form = await req.formData();
  const userCode = String(form.get("user_code") ?? "").toUpperCase().trim();
  if (!userCode) return NextResponse.redirect(new URL("/dashboard/device?e=missing", req.url), { status: 303 });

  const row = (await db().select().from(schema.deviceAuth).where(eq(schema.deviceAuth.userCode, userCode)).limit(1))[0];
  if (!row || row.expiresAt.getTime() < Date.now()) {
    return NextResponse.redirect(new URL("/dashboard/device?e=invalid", req.url), { status: 303 });
  }
  await db().update(schema.deviceAuth)
    .set({ approved: true, userId: user.id, refreshToken: randomToken(48) })
    .where(and(eq(schema.deviceAuth.id, row.id), eq(schema.deviceAuth.approved, false)));

  return NextResponse.redirect(new URL("/dashboard/device?ok=1", req.url), { status: 303 });
}
