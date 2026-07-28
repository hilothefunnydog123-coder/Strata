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

async function main() {
  const opts = parseArgs();

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
