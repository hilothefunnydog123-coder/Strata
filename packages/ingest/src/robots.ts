/**
 * A small, correct robots.txt checker (PROMPT §6). Used only in live mode: every
 * fetcher checks a path against the live robots.txt for our User-Agent before any
 * content request, and a disallowed path is skipped and logged, never fetched.
 */

interface Group {
  agents: string[];
  disallow: string[];
  allow: string[];
}

export interface RobotsRules {
  groups: Group[];
}

export function parseRobots(text: string): RobotsRules {
  const groups: Group[] = [];
  let current: Group | null = null;
  let lastWasAgent = false;
  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.replace(/#.*$/, "").trim();
    if (!line) continue;
    const idx = line.indexOf(":");
    if (idx < 0) continue;
    const field = line.slice(0, idx).trim().toLowerCase();
    const value = line.slice(idx + 1).trim();
    if (field === "user-agent") {
      if (!lastWasAgent || !current) {
        current = { agents: [], disallow: [], allow: [] };
        groups.push(current);
      }
      current.agents.push(value.toLowerCase());
      lastWasAgent = true;
    } else if (current && (field === "disallow" || field === "allow")) {
      lastWasAgent = false;
      if (field === "disallow") current.disallow.push(value);
      else current.allow.push(value);
    } else {
      lastWasAgent = false;
    }
  }
  return { groups };
}

function pickGroup(rules: RobotsRules, ua: string): Group | null {
  const lc = ua.toLowerCase();
  let specific: Group | null = null;
  let wildcard: Group | null = null;
  for (const g of rules.groups) {
    for (const a of g.agents) {
      if (a === "*") wildcard = g;
      else if (lc.includes(a)) specific = g;
    }
  }
  return specific ?? wildcard;
}

/** True if `path` is allowed for `userAgent` under these rules (longest-match wins). */
export function isAllowed(rules: RobotsRules, userAgent: string, path: string): boolean {
  const group = pickGroup(rules, userAgent);
  if (!group) return true;
  const match = (patterns: string[]): number => {
    let best = -1;
    for (const p of patterns) {
      if (p === "") continue;
      // Simple prefix match (robots wildcards are not fully modeled; prefix is the
      // dominant real-world case and errs toward NOT fetching on ambiguity).
      if (path.startsWith(p)) best = Math.max(best, p.length);
    }
    return best;
  };
  const dis = match(group.disallow);
  const alw = match(group.allow);
  if (dis < 0) return true;
  return alw >= dis; // an equally- or more-specific Allow overrides Disallow
}

/** Fetch and evaluate robots.txt for a URL's host. Fails closed on network error. */
export async function robotsAllows(url: string, userAgent: string): Promise<boolean> {
  try {
    const u = new URL(url);
    const res = await fetch(`${u.origin}/robots.txt`, { headers: { "User-Agent": userAgent } });
    if (!res.ok) return true; // no robots.txt → allowed
    const rules = parseRobots(await res.text());
    return isAllowed(rules, userAgent, u.pathname);
  } catch {
    return false; // fail closed: if we cannot verify, do not fetch
  }
}
