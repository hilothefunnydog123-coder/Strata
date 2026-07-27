import { NextResponse } from "next/server";
import { randomUUID } from "node:crypto";
import { db, schema } from "@/lib/db";
import { randomToken } from "@/lib/auth";

export const runtime = "nodejs";

/**
 * OAuth device-flow, step 1 (PROMPT §3). The desktop app (no password) requests a
 * pairing code; the user approves it in this browser dashboard.
 */
export async function POST() {
  const deviceCode = randomToken(32);
  const userCode = `${rand4()}-${rand4()}`;
  const expiresAt = new Date(Date.now() + 10 * 60 * 1000);
  await db().insert(schema.deviceAuth).values({ id: randomUUID(), deviceCode, userCode, expiresAt });
  return NextResponse.json({
    device_code: deviceCode,
    user_code: userCode,
    verification_uri: "/dashboard/device",
    interval: 5,
    expires_in: 600,
  });
}

function rand4(): string {
  const abc = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  let s = "";
  for (let i = 0; i < 4; i++) s += abc[Math.floor(Math.random() * abc.length)];
  return s;
}
