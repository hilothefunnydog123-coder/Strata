import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { eq } from "drizzle-orm";
import { z } from "zod";
import { PRODUCT } from "@assent/core";
import { db, schema } from "@/lib/db";
import { verifyTotp, newTotpSecret, totpAuthUri } from "@/lib/auth";
import { currentUser } from "@/lib/session";
import { isStandalone, standaloneEnrollTotp } from "@/lib/standalone";

export const runtime = "nodejs";

/**
 * First-factor-only accounts bind their authenticator here.
 *
 * The pending secret lives in an httpOnly cookie rather than in the page, for two
 * reasons. It survives a refresh, so reloading mid-enrollment does not invalidate a
 * code the phone has already stored. And POST reads the secret from that cookie
 * instead of from the request body, so the browser cannot enrol a secret of its own
 * choosing — the only thing it may submit is proof it can generate the right code.
 */
const PENDING = "assent_enroll";
const PENDING_TTL_MS = 1000 * 60 * 30;

function pendingCookieOptions(expires: Date) {
  return {
    httpOnly: true as const,
    sameSite: "lax" as const,
    secure: process.env.NODE_ENV === "production",
    path: "/",
    expires,
  };
}

/** Hand the browser a secret to display, stable across reloads. */
export async function GET() {
  const user = await currentUser();
  if (!user) return NextResponse.json({ error: "Not signed in." }, { status: 401 });
  if (user.totpEnrolled) return NextResponse.json({ error: "Already enrolled." }, { status: 409 });

  const jar = cookies();
  let secret = jar.get(PENDING)?.value;
  if (!secret || secret.length < 16) {
    secret = newTotpSecret();
    jar.set(PENDING, secret, pendingCookieOptions(new Date(Date.now() + PENDING_TTL_MS)));
  }

  const uri = totpAuthUri(user.email, secret);
  let qr: string | null = null;
  try {
    // Rendered here, never by a third party: a hosted QR service would be handed a
    // live second-factor secret.
    const { toDataURL } = await import("qrcode");
    qr = await toDataURL(uri, { margin: 1, width: 220, errorCorrectionLevel: "M" });
  } catch {
    qr = null; // Manual entry of `secret` still works.
  }

  return NextResponse.json({ secret, uri, qr, email: user.email, issuer: PRODUCT.name });
}

const ConfirmSchema = z.object({ totp: z.string().min(6).max(10) });

export async function POST(req: Request) {
  const user = await currentUser();
  if (!user) return NextResponse.json({ error: "Not signed in." }, { status: 401 });

  // Enrollment is one-time. Allowing it again would let a stolen session swap the
  // second factor out, which is the thing the second factor exists to prevent.
  if (user.totpEnrolled) {
    return NextResponse.json({ error: "This account already has an authenticator." }, { status: 409 });
  }

  const parsed = ConfirmSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "Enter the 6-digit code." }, { status: 422 });

  const jar = cookies();
  const secret = jar.get(PENDING)?.value;
  if (!secret) {
    return NextResponse.json({ error: "That enrollment expired. Reload the page for a fresh code." }, { status: 400 });
  }

  // Proving the authenticator holds the secret is the whole point: enrolling one it
  // never stored would lock the account out on the next sign-in with no way back.
  if (!verifyTotp(parsed.data.totp, secret)) {
    return NextResponse.json(
      { error: "That code doesn't match. Check your phone's clock and enter the current code." },
      { status: 400 },
    );
  }

  if (isStandalone()) standaloneEnrollTotp(secret);
  else
    await db()
      .update(schema.appUser)
      .set({ totpSecret: secret, totpEnrolled: true })
      .where(eq(schema.appUser.id, user.id));

  jar.delete(PENDING);
  return NextResponse.json({ ok: true });
}
