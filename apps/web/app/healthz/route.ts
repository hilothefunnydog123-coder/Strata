import { NextResponse } from "next/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Liveness probe. Deliberately touches nothing: it answers "the server process is
 * up and serving", which is exactly what a platform health check should gate a
 * deploy on. Wiring it to the database would turn a recoverable data problem into
 * a failed deploy and a crash loop.
 */
export function GET() {
  return NextResponse.json({ ok: true, service: "assent-web" });
}
