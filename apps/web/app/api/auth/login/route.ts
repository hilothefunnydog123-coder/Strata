import { NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { z } from "zod";
import { db, schema } from "@/lib/db";
import { verifyPassword, verifyTotp } from "@/lib/auth";
import { createSession } from "@/lib/session";

export const runtime = "nodejs";

const LoginSchema = z.object({
  email: z.string().email(),
  password: z.string().min(1),
  totp: z.string().min(6).max(10),
});

/** Credentials + TOTP sign-in. Generic errors only (no user enumeration). */
export async function POST(req: Request) {
  const parsed = LoginSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "Invalid input." }, { status: 422 });
  const { email, password, totp } = parsed.data;

  const rows = await db().select().from(schema.appUser).where(eq(schema.appUser.email, email.toLowerCase())).limit(1);
  const user = rows[0];
  const invalid = () => NextResponse.json({ error: "Incorrect email, password, or code." }, { status: 401 });
  if (!user) return invalid();
  if (!verifyPassword(password, user.passwordHash)) return invalid();
  if (!user.totpSecret || !verifyTotp(totp, user.totpSecret)) return invalid();

  await createSession(user.id);
  return NextResponse.json({ ok: true });
}
