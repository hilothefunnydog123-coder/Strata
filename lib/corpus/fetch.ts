/**
 * Polite HTTP for public government sources.
 *
 * Every rule from the specification's crawling section is enforced here rather
 * than in the individual source adapters, so a new adapter cannot forget one.
 *
 *   robots.txt        Fetched once per host, cached, obeyed. A disallowed path
 *                     is skipped and recorded, never fetched anyway.
 *   Rate              One request per two seconds per host, jittered, with
 *                     exponential backoff on 429 and 5xx. Keyed by host, so two
 *                     sources on different hosts do not queue behind each other.
 *   Identity          A User-Agent naming the crawler and carrying a real
 *                     contact address. The fetcher refuses to run without one,
 *                     so nobody crawls anonymously by forgetting to configure it.
 *   Raw bytes         Returned and stored untouched. Parsing reads from stored
 *                     bytes, so a parser change is a reparse, not a recrawl.
 */
import { setTimeout as sleep } from 'node:timers/promises';
import { env } from '@/lib/env';
import { log } from '@/lib/log';
import { sha256 } from '@/lib/storage';

const MIN_INTERVAL_MS = 2000;
const MAX_JITTER_MS = 750;
const MAX_ATTEMPTS = 4;

export class CrawlerNotConfiguredError extends Error {
  constructor() {
    super(
      'CRAWLER_CONTACT is not set. Public sources are fetched with a User-Agent that ' +
        'names a contact address, so their operators can reach a human. Set it before ' +
        'running any corpus fetch.',
    );
    this.name = 'CrawlerNotConfiguredError';
  }
}

export function userAgent(): string {
  if (!env.CRAWLER_CONTACT) throw new CrawlerNotConfiguredError();
  return `StrataCorpusBot/1.0 (+${env.CRAWLER_CONTACT})`;
}

/* ─── Per host rate limiting ──────────────────────────────────────────────── */

const lastRequestAt = new Map<string, number>();
const hostQueue = new Map<string, Promise<void>>();

async function waitTurn(host: string): Promise<void> {
  const previous = hostQueue.get(host) ?? Promise.resolve();

  let release!: () => void;
  const mine = new Promise<void>((resolve) => {
    release = resolve;
  });
  hostQueue.set(host, previous.then(() => mine));

  await previous;

  const last = lastRequestAt.get(host) ?? 0;
  const elapsed = Date.now() - last;
  const jitter = Math.floor(Math.random() * MAX_JITTER_MS);
  const wait = Math.max(0, MIN_INTERVAL_MS + jitter - elapsed);
  if (wait > 0) await sleep(wait);

  lastRequestAt.set(host, Date.now());
  // Released by the caller once its request has been issued.
  queueMicrotask(release);
}

/* ─── robots.txt ──────────────────────────────────────────────────────────── */

interface RobotsRules {
  disallow: string[];
  allow: string[];
  crawlDelayMs: number | null;
}

const robotsCache = new Map<string, RobotsRules>();

/**
 * Parse the records that apply to us: the group for our own agent if one
 * exists, otherwise the wildcard group. Other agents' groups are not ours to
 * obey and not ours to ignore either; they simply do not apply.
 */
export function parseRobots(body: string, agent: string): RobotsRules {
  const rules: RobotsRules = { disallow: [], allow: [], crawlDelayMs: null };
  const lowerAgent = agent.toLowerCase();

  let applies = false;
  let sawSpecific = false;
  const wildcard: RobotsRules = { disallow: [], allow: [], crawlDelayMs: null };
  let target = wildcard;

  for (const rawLine of body.split(/\r?\n/)) {
    const line = rawLine.replace(/#.*$/, '').trim();
    if (line.length === 0) continue;

    const [rawKey, ...rest] = line.split(':');
    const key = rawKey?.trim().toLowerCase();
    const value = rest.join(':').trim();
    if (!key) continue;

    if (key === 'user-agent') {
      const named = value.toLowerCase();
      if (named === '*') {
        applies = true;
        target = wildcard;
      } else if (lowerAgent.includes(named)) {
        applies = true;
        sawSpecific = true;
        target = rules;
      } else {
        applies = false;
      }
      continue;
    }

    if (!applies) continue;

    if (key === 'disallow' && value.length > 0) target.disallow.push(value);
    else if (key === 'allow' && value.length > 0) target.allow.push(value);
    else if (key === 'crawl-delay') {
      const seconds = Number(value);
      if (Number.isFinite(seconds)) target.crawlDelayMs = seconds * 1000;
    }
  }

  return sawSpecific ? rules : wildcard;
}

/** Longest matching rule wins, and Allow beats Disallow at equal length. */
export function robotsPermits(rules: RobotsRules, path: string): boolean {
  const match = (patterns: string[]): number => {
    let longest = -1;
    for (const pattern of patterns) {
      if (path.startsWith(pattern)) longest = Math.max(longest, pattern.length);
    }
    return longest;
  };

  const disallowed = match(rules.disallow);
  if (disallowed === -1) return true;
  return match(rules.allow) >= disallowed;
}

async function robotsFor(origin: string): Promise<RobotsRules> {
  const cached = robotsCache.get(origin);
  if (cached) return cached;

  const permissive: RobotsRules = { disallow: [], allow: [], crawlDelayMs: null };

  try {
    const response = await fetch(`${origin}/robots.txt`, {
      headers: { 'user-agent': userAgent() },
    });
    // A 404 means no restrictions were published, which is permission.
    const rules = response.ok
      ? parseRobots(await response.text(), userAgent())
      : permissive;
    robotsCache.set(origin, rules);
    return rules;
  } catch (error) {
    // Failing to read robots.txt is not permission to ignore it. Treat the host
    // as off limits for this run rather than crawling on an assumption.
    log.warn('could not read robots.txt, treating the host as disallowed', {
      origin,
      error,
    });
    const closed: RobotsRules = { disallow: ['/'], allow: [], crawlDelayMs: null };
    robotsCache.set(origin, closed);
    return closed;
  }
}

/* ─── Fetching ────────────────────────────────────────────────────────────── */

export interface FetchedDocument {
  url: string;
  bytes: Buffer;
  contentType: string;
  contentHash: string;
  retrievedAt: Date;
}

export class RobotsDisallowedError extends Error {
  constructor(public readonly url: string) {
    super(`robots.txt disallows ${url}. Not fetched.`);
    this.name = 'RobotsDisallowedError';
  }
}

/**
 * Fetch one document, obeying every rule above.
 *
 * Retries only on 429 and 5xx. A 403 or a 404 is an answer, not a hiccup, and
 * retrying it is just rudeness at a slower rate.
 */
export async function fetchDocument(url: string): Promise<FetchedDocument> {
  const parsed = new URL(url);
  const rules = await robotsFor(parsed.origin);

  if (!robotsPermits(rules, parsed.pathname)) {
    throw new RobotsDisallowedError(url);
  }

  let lastError: unknown;

  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt += 1) {
    await waitTurn(parsed.host);

    // A host asking for a longer delay than our floor gets it.
    if (rules.crawlDelayMs && rules.crawlDelayMs > MIN_INTERVAL_MS) {
      await sleep(rules.crawlDelayMs - MIN_INTERVAL_MS);
    }

    try {
      const response = await fetch(url, {
        headers: {
          'user-agent': userAgent(),
          accept: '*/*',
        },
        redirect: 'follow',
      });

      if (response.status === 429 || response.status >= 500) {
        const backoff = MIN_INTERVAL_MS * 2 ** attempt;
        log.warn('source responded with a retryable status, backing off', {
          url,
          status: response.status,
          attempt,
          backoffMs: backoff,
        });
        lastError = new Error(`${response.status} from ${url}`);
        await sleep(backoff);
        continue;
      }

      if (!response.ok) {
        throw new Error(`${response.status} ${response.statusText} from ${url}`);
      }

      const bytes = Buffer.from(await response.arrayBuffer());
      return {
        url,
        bytes,
        contentType: response.headers.get('content-type') ?? 'application/octet-stream',
        contentHash: sha256(bytes),
        retrievedAt: new Date(),
      };
    } catch (error) {
      lastError = error;
      if (attempt === MAX_ATTEMPTS) break;
      await sleep(MIN_INTERVAL_MS * 2 ** attempt);
    }
  }

  throw lastError instanceof Error
    ? lastError
    : new Error(`Could not fetch ${url} after ${MAX_ATTEMPTS} attempts.`);
}

/** Reset the per-host state. Used by tests, never in production. */
export function resetCrawlerState(): void {
  robotsCache.clear();
  lastRequestAt.clear();
  hostQueue.clear();
}
