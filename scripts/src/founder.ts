import { scryptSync, randomBytes, randomInt } from "node:crypto";
import { authenticator } from "otplib";
import { eq } from "drizzle-orm";
import { schema } from "@assent/db";
import { PRODUCT } from "@assent/core";
import { openStore, type Store } from "./store";

/**
 * `pnpm founder` — provision the founder's own console credential.
 *
 * `pnpm db:seed` already creates a demo login, but that one is a fixture, not an
 * account: its password is a constant in the source tree and its TOTP secret is
 * otplib's published example secret. Anyone who has read this repository can sign
 * into it. That is correct for a seeded demo and disqualifying for the founder.
 *
 * What this makes instead:
 *   · a separate account (the demo account keeps its own data — nothing is moved)
 *   · an admin user on it, with the license and seat views a real customer sees
 *   · a password generated here, shown once, and stored only as a scrypt hash
 *   · a TOTP secret generated here, unique to this install, never committed
 *
 * The secret is printed to this terminal and to nothing else. It is not written to
 * a file, not sent anywhere, and not recoverable later — `--rotate` issues a new
 * one rather than reminding you of the old one, which is the property that makes
 * the printout trustworthy.
 */

// Ambiguous glyphs removed: nobody should lose an evening to l/I/1 or O/0.
const PW_ALPHABET = "abcdefghijkmnopqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ23456789";
const FOUNDER_ACCOUNT_ID = "acct_founder";
const FOUNDER_USER_ID = "user_founder";

/**
 * `--bootstrap` — the founder account, created by the container on its own.
 *
 * Running the interactive command requires a shell on the box that can reach the
 * production database. Committing these three values instead means the deploy
 * provisions the account itself and the founder only has to open the site.
 *
 * What is safe to commit here, and why:
 *
 *   EMAIL          an identity, not a secret.
 *   PASSWORD_HASH  scrypt over ~116 bits of entropy. Publishing it concedes an
 *                  offline attack that is not computable; the password itself is
 *                  never in this repository.
 *   (no TOTP)      deliberately absent. A shared second factor is not a second
 *                  factor — that is the exact flaw in the seeded demo user, whose
 *                  secret is otplib's published example. This account is created
 *                  UNENROLLED and the browser generates its secret on first
 *                  sign-in, so the only copy is on the founder's phone.
 *
 * The window this opens is one password-only sign-in, closed permanently by
 * enrolling, which the console demands before it will render anything.
 */
const BOOTSTRAP = {
  email: process.env.FOUNDER_EMAIL ?? "dlake003@gmail.com",
  org: process.env.FOUNDER_ORG ?? "Assent, Inc.",
  passwordHash:
    process.env.FOUNDER_PASSWORD_HASH ??
    "30ca0c579d2424ef09dd11043aa277ec:473959b790d7bb5e33021094b83d053219ba08d36ba908406a6c972c1edf56d094b50a089f8eba950abf24e4c8a8ddf3670ccb8ee21ec04fe47b660f5f4a9ff8",
} as const;

/** 4×5 characters from a 56-glyph alphabet ≈ 116 bits. Grouped so it can be read aloud. */
function generatePassword(): string {
  const groups: string[] = [];
  for (let g = 0; g < 4; g++) {
    let s = "";
    for (let i = 0; i < 5; i++) s += PW_ALPHABET[randomInt(PW_ALPHABET.length)];
    groups.push(s);
  }
  return groups.join("-");
}

function hashPassword(password: string): string {
  // Byte-for-byte the format apps/web/lib/auth.ts verifies against ("salt:hex").
  const salt = randomBytes(16).toString("hex");
  return `${salt}:${scryptSync(password, salt, 64).toString("hex")}`;
}

/** Base32 in groups of four, for authenticator apps that want it typed by hand. */
function groupSecret(secret: string): string {
  return (secret.match(/.{1,4}/g) ?? [secret]).join(" ");
}

interface Options {
  email: string;
  org: string;
  rotate: boolean;
  bootstrap: boolean;
}

function parseArgs(): Options {
  const flags = new Map<string, string>();
  for (const a of process.argv.slice(2)) {
    const m = a.match(/^--([^=]+)(?:=(.*))?$/);
    if (m) flags.set(m[1]!, m[2] ?? "true");
  }
  return {
    email: (flags.get("email") ?? process.env.FOUNDER_EMAIL ?? "").trim().toLowerCase(),
    org: flags.get("org") ?? process.env.FOUNDER_ORG ?? PRODUCT.legalName,
    rotate: flags.get("rotate") === "true",
    bootstrap: flags.get("bootstrap") === "true",
  };
}

function loginUrl(): string {
  const base =
    process.env.ASSENT_PUBLIC_URL ??
    process.env.RENDER_EXTERNAL_URL ??
    "http://localhost:3000";
  return `${base.replace(/\/+$/, "")}/login`;
}

/**
 * Render the enrollment QR in the terminal. Deliberately local: handing a live TOTP
 * secret to a hosted QR generator would publish the second factor to a third party.
 */
async function qr(text: string): Promise<string | null> {
  try {
    const { toString } = await import("qrcode");
    return await toString(text, { type: "terminal", small: true, errorCorrectionLevel: "L" });
  } catch {
    return null; // Optional nicety — manual entry below always works.
  }
}

/**
 * The founder's console is empty until an asset exists: coverage, blueprint and the
 * gap frontier are all computed against one. Seeded only when the account has none,
 * so a real asset entered later is never overwritten.
 */
async function ensureAsset(store: Store): Promise<boolean> {
  const existing = await store.db
    .select({ id: schema.asset.id })
    .from(schema.asset)
    .where(eq(schema.asset.accountId, FOUNDER_ACCOUNT_ID))
    .limit(1);
  if (existing.length > 0) return false;

  await store.db.insert(schema.asset).values({
    id: "asset_founder",
    accountId: FOUNDER_ACCOUNT_ID,
    name: "Comprehensive genomic profiling (tissue)",
    indication: "Comprehensive genomic profiling for advanced or metastatic solid tumors",
    intendedUse: "Guide selection of targeted systemic therapy",
    targetCodes: ["81445", "81479"],
    comparator: "single-gene testing",
    targetPopulation: "Adults with advanced solid tumors",
  });
  return true;
}

/**
 * Provision the founder from committed values, with no terminal to print to.
 *
 * Runs on every boot, so it must be inert once the account exists — it never
 * rewrites a password, never re-enrols a second factor, never touches a session.
 * A redeploy that silently reset the owner's credentials would be worse than one
 * that failed outright.
 */
async function bootstrap(store: Store): Promise<void> {
  const email = BOOTSTRAP.email.trim().toLowerCase();
  if (!email || !BOOTSTRAP.passwordHash.includes(":")) {
    console.log("[founder] no bootstrap credential configured — skipping");
    return;
  }

  const existing = (
    await store.db.select().from(schema.appUser).where(eq(schema.appUser.email, email)).limit(1)
  )[0];
  if (existing) {
    const state = existing.totpEnrolled ? "enrolled" : "awaiting first sign-in";
    console.log(`[founder] ${email} already provisioned (${state}) — leaving it alone`);
    return;
  }

  await store.db
    .insert(schema.account)
    .values({
      id: FOUNDER_ACCOUNT_ID,
      orgName: BOOTSTRAP.org,
      plan: "enterprise",
      seatLimit: 25,
      createdByAdmin: "founder-bootstrap",
    })
    .onConflictDoNothing();

  await store.db
    .insert(schema.appUser)
    .values({
      id: FOUNDER_USER_ID,
      accountId: FOUNDER_ACCOUNT_ID,
      email,
      role: "admin",
      passwordHash: BOOTSTRAP.passwordHash,
      totpSecret: null,
      totpEnrolled: false, // the browser generates it on first sign-in
    })
    .onConflictDoNothing();

  await ensureAsset(store);
  console.log(`[founder] provisioned ${email} — second factor enrols on first sign-in`);
}

async function main() {
  const opts = parseArgs();

  if (opts.bootstrap) {
    const store = openStore();
    try {
      await bootstrap(store);
    } finally {
      await store.client.end();
    }
    return;
  }

  if (!opts.email || !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(opts.email)) {
    console.error(
      "\n[founder] an email address is required — it is the login identity.\n\n" +
        "  pnpm founder --email you@yourdomain.com\n" +
        '  pnpm founder --email you@yourdomain.com --org "Your Company, Inc."\n',
    );
    process.exit(1);
  }

  const store = openStore();
  try {
    const existing = (
      await store.db.select().from(schema.appUser).where(eq(schema.appUser.email, opts.email)).limit(1)
    )[0];

    // Never quietly seize an address that already belongs to a customer or the demo.
    if (existing && existing.accountId !== FOUNDER_ACCOUNT_ID) {
      console.error(
        `\n[founder] ${opts.email} already signs in on account ${existing.accountId}.\n\n` +
          "  Rotating it here would change a credential this command does not own.\n" +
          "  Use a different address for the founder account.\n",
      );
      process.exit(1);
    }

    if (existing && !opts.rotate) {
      console.error(
        `\n[founder] ${opts.email} already exists.\n\n` +
          "  The password and TOTP secret are stored hashed and cannot be read back.\n" +
          "  To issue new ones (this signs out every existing session):\n\n" +
          `    pnpm founder --email ${opts.email} --rotate\n`,
      );
      process.exit(1);
    }

    const password = generatePassword();
    const totpSecret = authenticator.generateSecret();

    await store.db
      .insert(schema.account)
      .values({
        id: FOUNDER_ACCOUNT_ID,
        orgName: opts.org,
        plan: "enterprise",
        seatLimit: 25,
        createdByAdmin: "founder-bootstrap",
      })
      .onConflictDoNothing();

    if (existing) {
      // A rotation exists to revoke, so it must also revoke what a stolen credential
      // already bought: live sessions and any paired desktop. Otherwise the old
      // password is dead and the attacker is still signed in.
      await store.db.delete(schema.session).where(eq(schema.session.userId, existing.id));
      await store.db.delete(schema.deviceAuth).where(eq(schema.deviceAuth.userId, existing.id));
      await store.db
        .update(schema.appUser)
        .set({ passwordHash: hashPassword(password), totpSecret, totpEnrolled: true, role: "admin" })
        .where(eq(schema.appUser.id, existing.id));
    } else {
      await store.db.insert(schema.appUser).values({
        id: FOUNDER_USER_ID,
        accountId: FOUNDER_ACCOUNT_ID,
        email: opts.email,
        role: "admin",
        passwordHash: hashPassword(password),
        totpSecret,
        totpEnrolled: true,
      });
    }

    const seededAsset = await ensureAsset(store);
    const uri = authenticator.keyuri(opts.email, PRODUCT.name, totpSecret);
    const code = await qr(uri);

    const rule = "─".repeat(64);
    console.log(`\n╭${rule}╮`);
    console.log(`  ${existing ? "ROTATED" : "CREATED"} — founder credential for ${PRODUCT.name}`);
    console.log(`╰${rule}╯\n`);
    console.log(`  Sign in    ${loginUrl()}`);
    console.log(`  Email      ${opts.email}`);
    console.log(`  Password   ${password}`);
    console.log(`  Account    ${FOUNDER_ACCOUNT_ID} · ${opts.org} · enterprise · 25 seats\n`);

    console.log("  ── Second factor ".padEnd(66, "─"));
    if (code) console.log(`\n${code}`);
    console.log(`  Scan the code above, or enter this key by hand:\n`);
    console.log(`      ${groupSecret(totpSecret)}\n`);
    console.log("  Works with 1Password, Authy, Google Authenticator, Bitwarden — any TOTP app.\n");

    if (seededAsset) {
      console.log("  Seeded a starter asset (CGP, tissue) so coverage and the blueprint have");
      console.log("  something to compute against. Replace it with your real asset when ready.\n");
    }

    console.log(`  ⚠  This is the only time the password and key are shown. Save them now —`);
    console.log(`     only a scrypt hash is stored, so nothing here can be recovered later.`);
    console.log(`     Lost them? Run the same command with --rotate to issue new ones.\n`);

    console.log("  Corpus reminder: the documents behind this console are still sample data");
    console.log("  until `pnpm corpus:live` is run somewhere with outbound internet.");
    console.log("  Check any time with `pnpm corpus:status`.\n");
  } finally {
    await store.client.end();
  }
}

main().catch((err) => {
  console.error("[founder]", err instanceof Error ? err.message : err);
  process.exit(1);
});
