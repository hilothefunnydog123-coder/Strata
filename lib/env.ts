/**
 * The single place this codebase reads process.env.
 *
 * Everything is parsed with Zod at module load. A missing or malformed required
 * variable throws here, before any request is served, rather than surfacing as a
 * confusing runtime failure later. The PHI mode gates are enforced in the same
 * pass: the app cannot start in live mode without a confirmed BAA and a
 * dedicated encryption key.
 *
 * Rule: no other file may touch process.env. This is enforced by the
 * no-restricted-properties rule in eslint.config.mjs.
 */
import { z } from 'zod';

const boolish = z
  .enum(['true', 'false', '1', '0', ''])
  .optional()
  .transform((v) => v === 'true' || v === '1');

const optionalString = z
  .string()
  .optional()
  .transform((v) => (v && v.trim().length > 0 ? v.trim() : undefined));

const schema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),

  DATABASE_URL: z.string().min(1, 'DATABASE_URL is required'),

  BETTER_AUTH_SECRET: z
    .string()
    .min(32, 'BETTER_AUTH_SECRET must be at least 32 characters'),
  // Optional here, but not optional in effect: resolveOrigin below fills both
  // from the platform's own URL variable and the parse fails if neither exists.
  BETTER_AUTH_URL: z
    .string()
    .url('BETTER_AUTH_URL must be an absolute URL')
    .optional(),

  // Named for the role rather than the vendor. The provider is a decision about
  // which Business Associate Agreement is obtainable, not an architectural one,
  // and lib/llm/client.ts is the only file that knows which provider is in use.
  MODEL_API_KEY: optionalString,
  MODEL_BAA_CONFIRMED: boolish,
  /**
   * The provider's OpenAI-compatible endpoint. Groq, Together, Cerebras,
   * OpenRouter, a local llama.cpp server, Gemini and Vertex AI all expose one,
   * so changing provider is this plus MODEL_NAME and a key.
   */
  MODEL_BASE_URL: z
    .string()
    .url('MODEL_BASE_URL must be an absolute URL')
    .default('https://api.groq.com/openai/v1'),
  MODEL_NAME: z.string().min(1).default('llama-3.3-70b-versatile'),
  /**
   * The model corpus extraction uses, when it should differ from the one that
   * drafts appeals. Falls back to MODEL_NAME.
   *
   * These two jobs have opposite shapes. Drafting is a handful of calls per
   * appeal where judgment decides whether a letter is any good. Ingesting a
   * manual chapter is hundreds of thousands of tokens of bulk reading, and on
   * a metered or free account that volume is the whole constraint.
   *
   * Splitting them is safe here for a specific reason rather than a general
   * one: no holding enters the corpus without its quote being found verbatim in
   * the span it cites, and one that fails is deleted rather than flagged. So a
   * weaker model extracting holdings produces fewer of them and more discards,
   * not wrong ones. That is a throughput cost, and it buys an order of
   * magnitude more allowance on every free tier that offers a small model.
   *
   * It would not be safe to reach for this on the drafting side, where nothing
   * downstream can tell a weak argument from a strong one.
   *
   * Defaulted rather than left empty, for the same reason MODEL_NAME above
   * carries a Groq model id: a default that works out of the box beats one that
   * is neutral and unusable. Measured on the eleven CMS manual chapters, this
   * decides whether the corpus builds at all. Extraction of them costs about
   * 433,000 tokens, the large model's daily allowance ran out on the first call
   * of a run, and providers meter per model, so this is a different allowance
   * rather than merely a larger one.
   *
   * Point it elsewhere for a paid account, where the reason to split the two
   * disappears.
   */
  MODEL_NAME_CORPUS: z.string().min(1).default('llama-3.1-8b-instant'),
  /** Off for a provider that rejects response_format outright. */
  MODEL_JSON_MODE: z
    .enum(['true', 'false', '1', '0', ''])
    .optional()
    .transform((v) => v !== 'false' && v !== '0'),
  /** Published price per million tokens, in cents. Reporting only. */
  MODEL_PRICE_INPUT_CENTS: z.coerce.number().nonnegative().default(0),
  MODEL_PRICE_OUTPUT_CENTS: z.coerce.number().nonnegative().default(0),

  /**
   * A free Socrata application token, for the healthdata.gov dataset the
   * Departmental Appeals Board decisions are published through.
   *
   * Optional, and the corpus fetcher works without it against any dataset that
   * still answers anonymously. It exists because that one does not: it returns
   * 403 to an anonymous caller while its own robots.txt permits the path, which
   * is Socrata's documented behaviour when the shared anonymous pool is
   * exhausted. A token moves a caller onto its own allowance.
   */
  SOCRATA_APP_TOKEN: optionalString,

  PHI_MODE: z.enum(['synthetic', 'live']).default('synthetic'),
  // Key material rather than the key: lib/db/crypto.ts turns this into the 32
  // bytes AES-256-GCM needs. The minimum length is enforced here so that a
  // short passphrase cannot be stretched into something that looks strong.
  PHI_ENCRYPTION_KEY: z
    .string()
    .min(
      32,
      'PHI_ENCRYPTION_KEY is required, including in synthetic mode, and must be ' +
        'at least 32 characters',
    ),

  RESEND_API_KEY: optionalString,
  EMAIL_FROM: optionalString,
  DEMO_REQUEST_TO: z.string().email('DEMO_REQUEST_TO must be an email address'),
  MAILING_ADDRESS: optionalString,

  R2_ACCOUNT_ID: optionalString,
  R2_ACCESS_KEY_ID: optionalString,
  R2_SECRET_ACCESS_KEY: optionalString,
  R2_BUCKET: optionalString,
  LOCAL_STORAGE_DIR: optionalString,

  SUPERADMIN_EMAIL: optionalString,
  APP_URL: z.string().url('APP_URL must be an absolute URL').optional(),
  CRON_SECRET: optionalString,

  CRAWLER_CONTACT: optionalString,

  /**
   * Platform supplied origins, read only as a fallback for APP_URL and
   * BETTER_AUTH_URL, which are otherwise impossible to know before a first
   * deploy assigns a hostname.
   *
   * RENDER_EXTERNAL_URL is present in the running service, so the fallback
   * genuinely works there and neither variable needs setting.
   *
   * Netlify's URL and DEPLOY_PRIME_URL are build variables. They are set while
   * the site compiles and are **not** present in the deployed function, which
   * is where this code runs, so on Netlify both APP_URL and BETTER_AUTH_URL
   * must be set explicitly. They are read here anyway because a build time
   * caller such as scripts/check-env.ts does see them, and because a platform
   * that does expose them at runtime costs nothing to support.
   *
   * DEPLOY_PRIME_URL is preferred over URL where both exist: on a preview
   * deploy they differ, and the browser is talking to the first. Issuing
   * cookies against the production origin instead gives a preview that accepts
   * a password and then does nothing.
   */
  RENDER_EXTERNAL_URL: optionalString,
  DEPLOY_PRIME_URL: optionalString,
  URL: optionalString,
});

export type Env = Omit<z.infer<typeof schema>, 'APP_URL' | 'BETTER_AUTH_URL'> & {
  /** Always resolved: from the variable if set, otherwise from the platform. */
  readonly APP_URL: string;
  readonly BETTER_AUTH_URL: string;
  /** True when uploaded content may contain real patient data. */
  readonly phiLive: boolean;
  /** True when documents are stored in R2 rather than on local disk. */
  readonly storageIsR2: boolean;
};

/**
 * The origin the app answers on.
 *
 * Explicit configuration wins. Failing that we take the platform's own value,
 * which is the only thing that knows the hostname on a first deploy. Failing
 * both, this is a configuration error rather than a guess: a wrong origin here
 * does not throw, it silently issues cookies nobody can use, and a sign in page
 * that accepts a password and then does nothing is far worse than a refusal.
 */
export function resolveOrigin(
  explicit: string | undefined,
  platform: readonly (string | undefined)[],
  name: string,
): string {
  const value = explicit ?? platform.find((candidate) => Boolean(candidate));
  if (!value) {
    throw new Error(
      `${name} is not set and no platform URL was found. Set ${name} to the ` +
        'absolute origin this app is served from, for example https://medeal.netlify.app.',
    );
  }

  try {
    new URL(value);
  } catch {
    throw new Error(
      `${name} must be an absolute URL including the scheme, got ${JSON.stringify(value)}.`,
    );
  }

  return value.replace(/\/+$/, '');
}

/**
 * Raised when something that needs configuration is reached in a deployment
 * that has none. Distinct from a crash: it means "not set up yet", and the
 * surfaces that can answer it do.
 */
export class NotConfiguredError extends Error {
  readonly missing: readonly string[];

  constructor(what: string, missing: readonly string[]) {
    super(
      `${what} needs configuration this deployment does not have. Missing: ` +
        `${missing.join(', ')}. Set them and deploy again.`,
    );
    this.name = 'NotConfiguredError';
    this.missing = missing;
  }
}

export interface EnvStatus {
  configured: boolean;
  /** Names of the required variables that are absent. Empty when configured. */
  missing: readonly string[];
}

let statusCache: EnvStatus | undefined;

/**
 * Whether this deployment is configured, without throwing if it is not.
 *
 * A brand new deployment has no variables set, and refusing to start means
 * nobody can see whether the thing deploys at all. So an environment that is
 * merely absent yields an unconfigured deployment: public pages render, a
 * banner says plainly that it is not set up, and anything touching the database
 * or a session answers with that rather than a stack trace.
 *
 * The safety of this rests on one condition, enforced below: unconfigured mode
 * is only available when there is no DATABASE_URL. No database means no data,
 * which means there is nothing a half configured instance could expose. The
 * dangerous shape, a real database reachable while the encryption key or the
 * session secret is missing, is not degraded, it is refused exactly as before.
 */
export function envStatus(): EnvStatus {
  if (statusCache) return statusCache;

  const parsed = schema.safeParse(process.env);
  if (parsed.success) {
    statusCache = { configured: true, missing: [] };
    return statusCache;
  }

  const missing = parsed.error.issues.map((issue) => String(issue.path[0] ?? '(root)'));

  // A database present alongside missing secrets is a misconfiguration, not an
  // unconfigured deployment. Refuse it.
  if (process.env.DATABASE_URL) {
    const lines = parsed.error.issues.map(
      (issue) => `  ${issue.path.join('.') || '(root)'}: ${issue.message}`,
    );
    throw new Error(
      `Environment is not valid, so the app will not start.\n${lines.join('\n')}\n` +
        'DATABASE_URL is set, so this is a partly configured deployment rather than a\n' +
        'new one. Set the variables above, or unset DATABASE_URL to run unconfigured.',
    );
  }

  statusCache = { configured: false, missing };
  return statusCache;
}

/**
 * The environment of a deployment that has none.
 *
 * Empty strings rather than a sentinel, and rather than throwing on every read.
 * Pages that display a configured value render nothing, which reads as absent
 * because the banner above them has already said the deployment is not set up.
 * Inventing a plausible looking address or account number instead would be
 * fabricating content, which is worse than a blank.
 *
 * The types stay honest: these fields are strings and they are strings. Nothing
 * that would act on them can be reached, because the database and the auth
 * instance check the same status and refuse before either is used.
 */
function unconfigured(): Env {
  const nodeEnv = process.env.NODE_ENV;
  const origin =
    process.env.RENDER_EXTERNAL_URL ??
    process.env.DEPLOY_PRIME_URL ??
    process.env.URL ??
    'http://localhost:3000';

  return Object.freeze({
    NODE_ENV:
      nodeEnv === 'production' || nodeEnv === 'test' ? nodeEnv : 'development',
    DATABASE_URL: '',
    BETTER_AUTH_SECRET: '',
    MODEL_API_KEY: undefined,
    MODEL_BAA_CONFIRMED: false,
    MODEL_BASE_URL: 'https://api.groq.com/openai/v1',
    MODEL_NAME: 'llama-3.3-70b-versatile',
    MODEL_NAME_CORPUS: 'llama-3.1-8b-instant',
    MODEL_JSON_MODE: true,
    MODEL_PRICE_INPUT_CENTS: 0,
    MODEL_PRICE_OUTPUT_CENTS: 0,
    PHI_MODE: 'synthetic' as const,
    PHI_ENCRYPTION_KEY: '',
    RESEND_API_KEY: undefined,
    EMAIL_FROM: undefined,
    DEMO_REQUEST_TO: '',
    MAILING_ADDRESS: undefined,
    R2_ACCOUNT_ID: undefined,
    R2_ACCESS_KEY_ID: undefined,
    R2_SECRET_ACCESS_KEY: undefined,
    SOCRATA_APP_TOKEN: undefined,
    R2_BUCKET: undefined,
    LOCAL_STORAGE_DIR: undefined,
    SUPERADMIN_EMAIL: undefined,
    CRON_SECRET: undefined,
    CRAWLER_CONTACT: undefined,
    RENDER_EXTERNAL_URL: process.env.RENDER_EXTERNAL_URL,
    DEPLOY_PRIME_URL: process.env.DEPLOY_PRIME_URL,
    URL: process.env.URL,
    APP_URL: origin.replace(/\/+$/, ''),
    BETTER_AUTH_URL: origin.replace(/\/+$/, ''),
    phiLive: false,
    storageIsR2: false,
  });
}

function parse(): Env {
  const parsed = schema.safeParse(process.env);

  if (!parsed.success) {
    envStatus(); // Throws here if a database is present alongside missing secrets.
    return unconfigured();
  }

  const env = parsed.data;

  // PHI gate one: live mode requires a confirmed BAA with Anthropic on a
  // HIPAA-ready API organisation. There is deliberately no override.
  if (env.PHI_MODE === 'live' && !env.MODEL_BAA_CONFIRMED) {
    throw new Error(
      'PHI_MODE=live requires MODEL_BAA_CONFIRMED=true. Patient data may only ' +
        'be transmitted to a HIPAA-ready Anthropic API organisation covered by a ' +
        'signed Business Associate Agreement. A default API organisation is not covered.',
    );
  }

  // PHI gate two: clinical columns are encrypted with a dedicated key in every
  // mode, not only live. Synthetic content is encrypted too, so the code path
  // that protects real records is the one exercised every day.
  if (env.PHI_ENCRYPTION_KEY === env.BETTER_AUTH_SECRET) {
    throw new Error(
      'PHI_ENCRYPTION_KEY must differ from BETTER_AUTH_SECRET. PHI is encrypted ' +
        'with its own key so that a session secret rotation or leak does not expose ' +
        'clinical records.',
    );
  }

  const r2Fields = [
    env.R2_ACCOUNT_ID,
    env.R2_ACCESS_KEY_ID,
    env.R2_SECRET_ACCESS_KEY,
    env.R2_BUCKET,
  ];
  const r2Configured = r2Fields.every(Boolean);
  const r2Partial = r2Fields.some(Boolean) && !r2Configured;

  if (r2Partial) {
    throw new Error(
      'R2 storage is partially configured. Set all of R2_ACCOUNT_ID, R2_ACCESS_KEY_ID, ' +
        'R2_SECRET_ACCESS_KEY and R2_BUCKET, or none of them.',
    );
  }

  if (!r2Configured && !env.LOCAL_STORAGE_DIR) {
    throw new Error(
      'No document storage is configured. Set the four R2_* variables for object ' +
        'storage, or LOCAL_STORAGE_DIR to write uploads to local disk in development.',
    );
  }

  if (env.PHI_MODE === 'live' && !r2Configured) {
    throw new Error(
      'PHI_MODE=live requires R2 object storage. Local disk storage is a development ' +
        'convenience and is not an acceptable location for patient documents.',
    );
  }

  // Ordered by how specific each is to the deploy actually being served.
  const platformOrigins = [
    env.RENDER_EXTERNAL_URL,
    env.DEPLOY_PRIME_URL,
    env.URL,
  ] as const;

  return Object.freeze({
    ...env,
    APP_URL: resolveOrigin(env.APP_URL, platformOrigins, 'APP_URL'),
    BETTER_AUTH_URL: resolveOrigin(
      env.BETTER_AUTH_URL,
      platformOrigins,
      'BETTER_AUTH_URL',
    ),
    phiLive: env.PHI_MODE === 'live',
    storageIsR2: r2Configured,
  });
}

let cached: Env | undefined;

/**
 * Parse and validate the environment, caching the result.
 *
 * Called explicitly from instrumentation.ts so the server refuses to boot on a
 * bad environment rather than failing on the first request that happens to
 * touch a variable.
 */
export function assertEnv(): Env {
  if (!cached) cached = parse();
  return cached;
}

/**
 * Read like a plain object, validated on first property access.
 *
 * The indirection exists so that build-time tooling which imports the schema
 * (drizzle-kit generating SQL, for instance) does not need a complete runtime
 * environment just to read column definitions. Anything that actually reads a
 * value still gets the full validation.
 */
export const env: Env = new Proxy({} as Env, {
  get(_target, prop: string) {
    return assertEnv()[prop as keyof Env];
  },
  has(_target, prop: string) {
    return prop in assertEnv();
  },
  ownKeys() {
    return Reflect.ownKeys(assertEnv());
  },
  getOwnPropertyDescriptor(_target, prop) {
    return Object.getOwnPropertyDescriptor(assertEnv(), prop);
  },
});
