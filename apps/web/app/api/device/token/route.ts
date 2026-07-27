import { NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { db, schema } from "@/lib/db";

export const runtime = "nodejs";

/**
 * OAuth device-flow, step 2 (PROMPT §3). The desktop polls with its device_code.
 * Until the user approves, this returns authorization_pending. Once approved it
 * returns the long-lived refresh token (stored in the OS keychain, app-side).
 */
export async function POST(req: Request) {
  const body = await req.json().catch(() => ({}));
  const deviceCode = typeof body?.device_code === "string" ? body.device_code : "";
  if (!deviceCode) return NextResponse.json({ error: "invalid_request" }, { status: 400 });

  const row = (await db().select().from(schema.deviceAuth).where(eq(schema.deviceAuth.deviceCode, deviceCode)).limit(1))[0];
  if (!row) return NextResponse.json({ error: "invalid_grant" }, { status: 400 });
  if (row.expiresAt.getTime() < Date.now()) return NextResponse.json({ error: "expired_token" }, { status: 400 });
  if (!row.approved || !row.refreshToken) return NextResponse.json({ error: "authorization_pending" }, { status: 202 });

  return NextResponse.json({ refresh_token: row.refreshToken, token_type: "refresh", user_id: row.userId });
}
