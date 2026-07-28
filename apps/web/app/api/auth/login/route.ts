import { NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { z } from "zod";
import { db, schema } from "@/lib/db";
import { verifyPassword, verifyTotp } from "@/lib/auth";
import { createSession } from "@/lib/session";
import { isStandalone, standaloneUserByEmail } from "@/lib/standalone";

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

  // A database outage used to surface as the same blank "Sign-in failed." the form
  // shows for any non-JSON response, which is indistinguishable from a wrong
  // password and sends you hunting for a typo that isn't there. Name it instead.
  //
  // Standalone resolves the same shape from memory; every rule below it — password
  // check, TOTP requirement, the one-time enrollment exemption — is shared, so the
  // two modes cannot drift apart on anything that decides access.
  let user: Pick<typeof schema.appUser.$inferSelect, "id" | "passwordHash" | "totpSecret" | "totpEnrolled"> | undefined;
  try {
    user = isStandalone()
      ? standaloneUserByEmail(email) ?? undefined
      : (await db().select().from(schema.appUser).where(eq(schema.appUser.email, email.toLowerCase())).limit(1))[0];
  } catch (err) {
    console.error("[login] database unavailable:", err);
    return NextResponse.json(
      { error: "The console's database is unavailable — this is a server problem, not your password. See /api/diagnostics." },
      { status: 503 },
    );
  }

  const invalid = () => NextResponse.json({ error: "Incorrect email, password, or code." }, { status: 401 });
  if (!user) return invalid();
  if (!verifyPassword(password, user.passwordHash)) return invalid();

  const enrolled = user.totpEnrolled && !!user.totpSecret;
  if (enrolled) {
    if (!totp || !verifyTotp(totp, user.totpSecret!)) return invalid();
  }

  try {
    await createSession(user.id);
  } catch (err) {
    console.error("[login] could not persist session:", err);
    return NextResponse.json(
      { error: "Signed in, but the session could not be stored. The database is degraded — see /api/diagnostics." },
      { status: 503 },
    );
  }
  return NextResponse.json({ ok: true, enroll: !enrolled });
}
