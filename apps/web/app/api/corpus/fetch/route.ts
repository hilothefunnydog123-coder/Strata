import { NextResponse } from "next/server";
import { spawn } from "node:child_process";
import { currentUser } from "@/lib/session";
import { isStandalone } from "@/lib/standalone";
import { check, recordFailure, type Limit } from "@/lib/ratelimit";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Re-run the live corpus fetch without redeploying.
 *
 * The machine that can reach CMS is this container, and the person who needs the
 * answer is holding a phone. Without this, every attempt costs a full redeploy —
 * minutes per iteration while chasing an endpoint shape. A tap costs seconds.
 *
 * Admin-only and throttled: it makes outbound requests to a government API, so it
 * is not something an unauthenticated visitor gets to trigger in a loop.
 */
const LIMIT: Limit = { max: 4, windowSec: 300 };

export async function POST() {
  const user = await currentUser();
  if (!user) return NextResponse.json({ error: "Not signed in." }, { status: 401 });
  if (user.role !== "admin") return NextResponse.json({ error: "Admins only." }, { status: 403 });

  if (isStandalone()) {
    return NextResponse.json(
      {
        error: "There is no database to store a fetched corpus in.",
        remedy: "Attach DATABASE_URL and the fetch runs on the next boot, or from this button.",
      },
      { status: 409 },
    );
  }

  const key = `corpus-fetch:${user.id}`;
  const gate = check(key, LIMIT);
  if (gate.blocked) {
    return NextResponse.json(
      { error: `Already tried a few times. Wait ${Math.ceil(gate.retryAfterSec / 60)} minute(s).` },
      { status: 429, headers: { "retry-after": String(gate.retryAfterSec) } },
    );
  }
  recordFailure(key, LIMIT); // counts attempts, not failures — this one is a cost limiter

  // Detached on purpose: fetching and extracting takes longer than a request should
  // live. The run writes its outcome where /api/diagnostics reads it, so the page
  // reports progress instead of the browser holding a connection open.
  const child = spawn("pnpm", ["corpus:live", "--if-needed", "--limit", process.env.ASSENT_CORPUS_LIMIT ?? "40"], {
    cwd: process.cwd().replace(/\/apps\/web$/, ""),
    env: { ...process.env, PIPELINE_MODE: "live" },
    detached: true,
    stdio: "ignore",
  });
  child.unref();

  return NextResponse.json({
    ok: true,
    started: true,
    note: "Fetching in the background. Reload /api/diagnostics in about a minute and read corpusFetch.",
  });
}
