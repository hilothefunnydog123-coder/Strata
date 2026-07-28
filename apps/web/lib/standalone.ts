import "server-only";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { FOUNDER_BOOTSTRAP, FOUNDER_ASSET } from "@assent/core";
import type {
  Payer, Code, PolicyDocument, DocumentSpan, Criterion,
  CoverageStanceRecord, CriterionChange, PolicyCodeLink, CoveredLives,
} from "@assent/core";

/**
 * STANDALONE MODE — the console without a database.
 *
 * Attaching Postgres to a deployment is a dashboard action nobody can take from a
 * phone, and until it is taken the console is unreachable even though everything it
 * displays already ships inside the image. This mode closes that gap: the corpus is
 * read from the same committed `corpus.json` the desktop terminal loads, and the
 * one account is the committed founder bootstrap.
 *
 * REVERSIBILITY IS THE DESIGN CONSTRAINT.
 *
 * The mode is chosen by one question — is DATABASE_URL set? — asked at each call
 * site. There is no flag to unset, no migration to undo, and no data to move,
 * because standalone never writes anything durable. Set DATABASE_URL and every
 * branch below is skipped; the Postgres paths are the original code, untouched. To
 * confirm which one is live at any moment, read /api/diagnostics.
 *
 * What it deliberately is NOT:
 *
 *   · not persistent — sessions and TOTP enrollment live in this process and are
 *     gone on restart. A redeploy signs you out and un-enrols your authenticator.
 *   · not multi-user — one account, no seat management, no device pairing.
 *   · not a data layer — nothing here writes. Demo requests, device approvals and
 *     eval runs still need Postgres and say so rather than pretending to work.
 *
 * So: the right way to run this in front of anyone but yourself is to attach a
 * database. This is the mode that keeps the product usable until you can.
 */

export function isStandalone(): boolean {
  return !process.env.DATABASE_URL;
}

/** Explains itself in the UI and in diagnostics, so the mode is never a surprise. */
export const STANDALONE_REASON =
  "No DATABASE_URL is set, so the console is running from the corpus bundled in this image. Sessions and authenticator enrollment are held in memory and reset when the service restarts.";

// ── the single account ────────────────────────────────────────────────────────

export interface StandaloneUser {
  id: string;
  email: string;
  role: "admin";
  accountId: string;
  passwordHash: string;
  totpSecret: string | null;
  totpEnrolled: boolean;
}

/**
 * Held on globalThis, not in a module-level binding.
 *
 * Next bundles server code per route, so the same module can be instantiated more
 * than once in one process — sign in through the login handler and the dashboard
 * would consult a different, empty Map, sending a valid session back to /login.
 * (Found exactly that way.) globalThis is the one scope both bundles share, and it
 * survives dev hot-reload as a bonus.
 *
 * This is the whole durability story: one process, one memory. Nothing here is
 * written to disk, which is why a restart signs you out.
 */
interface StandaloneState {
  user: StandaloneUser;
  sessions: Map<string, { userId: string; expiresAt: number }>;
}

const STATE_KEY = Symbol.for("assent.standalone.state");
type GlobalWithState = typeof globalThis & { [STATE_KEY]?: StandaloneState };

function state(): StandaloneState {
  const g = globalThis as GlobalWithState;
  if (!g[STATE_KEY]) {
    g[STATE_KEY] = {
      user: {
        id: FOUNDER_BOOTSTRAP.userId,
        email: FOUNDER_BOOTSTRAP.email,
        role: "admin",
        accountId: FOUNDER_BOOTSTRAP.accountId,
        passwordHash: FOUNDER_BOOTSTRAP.passwordHash,
        totpSecret: null,
        totpEnrolled: false,
      },
      sessions: new Map(),
    };
  }
  return g[STATE_KEY]!;
}

export function standaloneUserByEmail(email: string): StandaloneUser | null {
  const { user } = state();
  return email.trim().toLowerCase() === user.email ? user : null;
}

export function standaloneUserById(id: string): StandaloneUser | null {
  const { user } = state();
  return id === user.id ? user : null;
}

export function standaloneEnrollTotp(secret: string): void {
  const { user } = state();
  user.totpSecret = secret;
  user.totpEnrolled = true;
}

export function standaloneAccount() {
  return {
    id: FOUNDER_BOOTSTRAP.accountId,
    orgName: FOUNDER_BOOTSTRAP.org,
    plan: "enterprise" as const,
    seatLimit: 25,
    createdByAdmin: "standalone",
    createdAt: new Date(0),
  };
}

export function standaloneAsset() {
  return {
    id: FOUNDER_ASSET.id,
    accountId: FOUNDER_BOOTSTRAP.accountId,
    name: FOUNDER_ASSET.name,
    indication: FOUNDER_ASSET.indication,
    intendedUse: FOUNDER_ASSET.intendedUse,
    targetCodes: [...FOUNDER_ASSET.targetCodes],
    comparator: FOUNDER_ASSET.comparator,
    targetPopulation: FOUNDER_ASSET.targetPopulation,
    createdAt: new Date(0),
  };
}

// ── sessions, in this process only ────────────────────────────────────────────

/**
 * Keyed by the same sha256 of the cookie token the database mode stores, so the raw
 * token is no more recoverable from memory than it is from a table.
 */
export function standaloneCreateSession(id: string, userId: string, expiresAt: Date): void {
  state().sessions.set(id, { userId, expiresAt: expiresAt.getTime() });
}

export function standaloneLookupSession(id: string): StandaloneUser | null {
  const { sessions } = state();
  const row = sessions.get(id);
  if (!row) return null;
  if (row.expiresAt < Date.now()) {
    sessions.delete(id);
    return null;
  }
  return standaloneUserById(row.userId);
}

export function standaloneDestroySession(id: string): void {
  state().sessions.delete(id);
}

// ── the corpus, read from the file the desktop terminal already ships ─────────

export interface StandaloneCorpus {
  payers: Payer[];
  coveredLives: CoveredLives[];
  codes: Code[];
  documents: PolicyDocument[];
  spans: DocumentSpan[];
  criteria: Criterion[];
  stances: CoverageStanceRecord[];
  changes: CriterionChange[];
  codeLinks: PolicyCodeLink[];
}

/** `public/` is committed and always in the image; `dist/` only exists post-build. */
const CORPUS_CANDIDATES = [
  join(process.cwd(), "..", "desktop", "public", "corpus.json"),
  join(process.cwd(), "..", "desktop", "dist", "corpus.json"),
  join(process.cwd(), "apps", "desktop", "public", "corpus.json"),
  join(process.cwd(), "..", "..", "apps", "desktop", "public", "corpus.json"),
];

let corpusCache: StandaloneCorpus | null | undefined;

export async function standaloneCorpus(): Promise<StandaloneCorpus | null> {
  if (corpusCache !== undefined) return corpusCache;
  for (const path of CORPUS_CANDIDATES) {
    try {
      corpusCache = JSON.parse(await readFile(path, "utf8")) as StandaloneCorpus;
      return corpusCache;
    } catch {
      /* try the next candidate */
    }
  }
  console.error("[standalone] corpus.json not found in", CORPUS_CANDIDATES);
  corpusCache = null;
  return null;
}
