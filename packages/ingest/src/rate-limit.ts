import { PRODUCT } from "@assent/core";

/**
 * Per-domain rate limiting (PROMPT §6): at most one request per 2s per domain with
 * jittered backoff, and a real User-Agent naming the crawler and a contact address.
 */
const MIN_INTERVAL_MS = 2000;
const lastRequestAt = new Map<string, number>();

export function userAgent(): string {
  const contact = process.env.ASSENT_CRAWLER_CONTACT ?? PRODUCT.supportEmail;
  return `${PRODUCT.crawlerName}/0.1 (+coverage research; ${contact})`;
}

function jitter(): number {
  // Deterministic-ish small jitter without Math.random (avoids nondeterminism in tests):
  return 100 + (Date.now() % 400);
}

export async function throttle(domain: string): Promise<void> {
  const now = Date.now();
  const last = lastRequestAt.get(domain) ?? 0;
  const wait = Math.max(0, last + MIN_INTERVAL_MS + jitter() - now);
  if (wait > 0) await new Promise((r) => setTimeout(r, wait));
  lastRequestAt.set(domain, Date.now());
}

/** Fetch with retry + exponential backoff (2s,4s,8s,16s), throttled per domain. */
export async function politeFetch(url: string): Promise<Response> {
  const domain = new URL(url).host;
  let attempt = 0;
  const delays = [2000, 4000, 8000, 16000];
  for (;;) {
    await throttle(domain);
    try {
      const res = await fetch(url, { headers: { "User-Agent": userAgent() } });
      if (res.status >= 500 && attempt < delays.length) {
        await new Promise((r) => setTimeout(r, delays[attempt]!));
        attempt++;
        continue;
      }
      return res;
    } catch (err) {
      if (attempt >= delays.length) throw err;
      await new Promise((r) => setTimeout(r, delays[attempt]!));
      attempt++;
    }
  }
}
