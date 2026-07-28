import "server-only";

/**
 * Failure throttling for the authentication routes.
 *
 * Without it, the console's whole defence is one password. An attacker who knows
 * the founder's address — it is in the repository — can try passwords as fast as
 * the network allows, and nothing in the app would notice or object. That is the
 * single cheapest attack against this deployment, so it is the first one closed.
 *
 * Deliberate choices:
 *
 *   Counts FAILURES, not requests. A successful sign-in clears the counter, so a
 *   legitimate person who mistypes twice and then succeeds is never penalised.
 *
 *   Two buckets that behave DIFFERENTLY, which is the important part. Per-IP denies
 *   outright: one host grinding an address is never legitimate. Per-account only
 *   slows down, with a high backstop, because a hard account lockout is a weapon
 *   pointed at the owner — see failureDelayMs below for how that was found.
 *
 *   Fixed windows, not a token bucket. The behaviour is explainable to whoever gets
 *   throttled — "wait until the window ends" — and Retry-After says exactly how long.
 *
 * LIMITS. State is in this process: it resets on restart and is not shared between
 * instances, so N instances allow N times the attempts. That is the correct trade
 * for a single-instance deployment with no Redis, and it is a real ceiling to raise
 * before running this at scale.
 */

interface Window {
  failures: number;
  resetAt: number;
}

/**
 * On globalThis for the same reason the standalone store is: Next bundles server
 * code per route, so a module-level Map can exist more than once in one process —
 * and a limiter that forgets half its counts is not a limiter.
 */
const KEY = Symbol.for("assent.ratelimit");
type GlobalWithLimiter = typeof globalThis & { [KEY]?: Map<string, Window> };

function windows(): Map<string, Window> {
  const g = globalThis as GlobalWithLimiter;
  if (!g[KEY]) g[KEY] = new Map();
  return g[KEY]!;
}

/** Bounded so a flood of distinct keys cannot grow this without limit. */
const MAX_TRACKED = 10_000;

function sweep(now: number): void {
  const map = windows();
  if (map.size < MAX_TRACKED) return;
  for (const [k, w] of map) if (w.resetAt <= now) map.delete(k);
  // Still full of live windows: drop the oldest rather than refuse to track.
  if (map.size >= MAX_TRACKED) {
    const oldest = [...map.entries()].sort((a, b) => a[1].resetAt - b[1].resetAt).slice(0, map.size - MAX_TRACKED + 1);
    for (const [k] of oldest) map.delete(k);
  }
}

export interface Limit {
  /** Failures tolerated inside one window. */
  max: number;
  windowSec: number;
}

export interface Decision {
  blocked: boolean;
  retryAfterSec: number;
  /** Failures recorded in the current window, for callers that slow rather than deny. */
  failures: number;
}

/**
 * Progressive delay for the per-account bucket.
 *
 * Denying an account outright after a handful of failures hands anyone who knows the
 * address a lockout: six requests every fifteen minutes and the owner can never sign
 * in. Found exactly that way — after brute-forcing this route in testing, the
 * CORRECT password was refused from a clean IP. NIST 800-63B warns about the same
 * thing, and prefers throttling over lockout for it.
 *
 * So wrong guesses get slower and slower while a right one still works immediately.
 * Capped at two seconds: enough to make online guessing hopeless, short enough that
 * holding the connection is not itself a way to exhaust the server.
 */
export function failureDelayMs(failures: number): number {
  if (failures <= 2) return 0;
  return Math.min(2000, 250 * (failures - 2));
}

export function sleep(ms: number): Promise<void> {
  return ms > 0 ? new Promise((r) => setTimeout(r, ms)) : Promise.resolve();
}

/** Is this key currently locked out? Does not itself count as an attempt. */
export function check(key: string, limit: Limit): Decision {
  const now = Date.now();
  const w = windows().get(key);
  if (!w || w.resetAt <= now) return { blocked: false, retryAfterSec: 0, failures: 0 };
  if (w.failures < limit.max) return { blocked: false, retryAfterSec: 0, failures: w.failures };
  return { blocked: true, retryAfterSec: Math.max(1, Math.ceil((w.resetAt - now) / 1000)), failures: w.failures };
}

/** Record one failed attempt and report whether that trips the limit. */
export function recordFailure(key: string, limit: Limit): Decision {
  const now = Date.now();
  sweep(now);
  const map = windows();
  const existing = map.get(key);
  const w = existing && existing.resetAt > now ? existing : { failures: 0, resetAt: now + limit.windowSec * 1000 };
  w.failures += 1;
  map.set(key, w);
  return w.failures >= limit.max
    ? { blocked: true, retryAfterSec: Math.max(1, Math.ceil((w.resetAt - now) / 1000)), failures: w.failures }
    : { blocked: false, retryAfterSec: 0, failures: w.failures };
}

/** Success wipes the slate, so honest mistakes never accumulate toward a lockout. */
export function clear(key: string): void {
  windows().delete(key);
}

/**
 * Best-effort client address.
 *
 * The leftmost x-forwarded-for entry is client-controlled and therefore spoofable,
 * which is exactly why the per-email bucket exists alongside this one: spoofing the
 * header changes the IP key but not the address being attacked.
 */
export function clientIp(req: Request): string {
  const fwd = req.headers.get("x-forwarded-for");
  if (fwd) {
    const first = fwd.split(",")[0]?.trim();
    if (first) return first;
  }
  return req.headers.get("x-real-ip")?.trim() || "unknown";
}
