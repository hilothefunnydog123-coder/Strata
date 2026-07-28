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
  // Optional only so an unenrolled account can reach enrollment; see below.
  totp: z.string().max(10).optional(),
});

/**
 * Credentials + TOTP sign-in. Generic errors only (no user enumeration).
 *
 * An account provisioned by `founder --bootstrap` has no second factor yet — there
 * is no secure channel to deliver one over, so the browser mints it at enrollment
 * and the only copy ends up on the owner's phone. Such an account signs in on the
 * password alone and can reach exactly one page: /enroll, which the console forces
 * before it renders anything. Enrolling flips totpEnrolled and this branch becomes
 * permanently unreachable for that user — the exemption cannot be re-entered.
 */
export async function POST(req: Request) {
  const parsed = LoginSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "Invalid input." }, { status: 422 });
  const { email, password, totp } = parsed.data;

  const rows = await db().select().from(schema.appUser).where(eq(schema.appUser.email, email.toLowerCase())).limit(1);
  const user = rows[0];
  const invalid = () => NextResponse.json({ error: "Incorrect email, password, or code." }, { status: 401 });
  if (!user) return invalid();
  if (!verifyPassword(password, user.passwordHash)) return invalid();

  const enrolled = user.totpEnrolled && !!user.totpSecret;
  if (enrolled) {
    if (!totp || !verifyTotp(totp, user.totpSecret!)) return invalid();
  }

  await createSession(user.id);
  return NextResponse.json({ ok: true, enroll: !enrolled });
}
