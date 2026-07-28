/**
 * The founder's bootstrap credential, in one place because two very different
 * callers need to agree on it: the boot script that writes the account into
 * Postgres, and the web app's standalone mode, which has no Postgres to write to.
 *
 * What is safe to commit here, and why:
 *
 *   email          an identity, not a secret.
 *   passwordHash   scrypt over ~116 bits of entropy. Publishing it concedes an
 *                  offline attack that is not computable; the password itself is
 *                  never in this repository.
 *   (no TOTP)      deliberately absent. A committed second factor is a shared
 *                  secret, which is not a second factor. It is generated in the
 *                  browser at /enroll so the only copy is on the owner's phone.
 *
 * Every field is overridable by environment variable, so a fork or a second
 * deployment never inherits this one.
 */
/**
 * `@assent/core` is consumed by the browser bundle too, where `process` does not
 * exist and node types are not compiled in. Declared narrowly and guarded so this
 * file is safe on both sides.
 */
declare const process: { env?: Record<string, string | undefined> } | undefined;
function env(name: string): string | undefined {
  return typeof process === "undefined" ? undefined : process?.env?.[name];
}

export const FOUNDER_BOOTSTRAP = {
  accountId: "acct_founder",
  userId: "user_founder",
  email: (env("FOUNDER_EMAIL") ?? "dlake003@gmail.com").trim().toLowerCase(),
  org: env("FOUNDER_ORG") ?? "Assent, Inc.",
  passwordHash:
    env("FOUNDER_PASSWORD_HASH") ??
    "30ca0c579d2424ef09dd11043aa277ec:473959b790d7bb5e33021094b83d053219ba08d36ba908406a6c972c1edf56d094b50a089f8eba950abf24e4c8a8ddf3670ccb8ee21ec04fe47b660f5f4a9ff8",
} as const;

/**
 * The asset the console computes against before a real one is entered. Matches what
 * the Postgres bootstrap seeds, so the two modes show the same figures.
 */
export const FOUNDER_ASSET = {
  id: "asset_founder",
  name: "Comprehensive genomic profiling (tissue)",
  indication: "Comprehensive genomic profiling for advanced or metastatic solid tumors",
  intendedUse: "Guide selection of targeted systemic therapy",
  targetCodes: ["81445", "81479"] as string[],
  comparator: "single-gene testing",
  targetPopulation: "Adults with advanced solid tumors",
} as const;
