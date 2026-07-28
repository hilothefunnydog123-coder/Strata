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
  BETTER_AUTH_URL: z.string().url('BETTER_AUTH_URL must be an absolute URL'),

  ANTHROPIC_API_KEY: optionalString,
  ANTHROPIC_BAA_CONFIRMED: boolish,

  PHI_MODE: z.enum(['synthetic', 'live']).default('synthetic'),
  PHI_ENCRYPTION_KEY: z
    .string()
    .min(1, 'PHI_ENCRYPTION_KEY is required, including in synthetic mode'),

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
  APP_URL: z.string().url('APP_URL must be an absolute URL'),
  CRON_SECRET: optionalString,

  CRAWLER_CONTACT: optionalString,
});

export type Env = z.infer<typeof schema> & {
  /** True when uploaded content may contain real patient data. */
  readonly phiLive: boolean;
  /** True when documents are stored in R2 rather than on local disk. */
  readonly storageIsR2: boolean;
};

function parse(): Env {
  const parsed = schema.safeParse(process.env);

  if (!parsed.success) {
    const lines = parsed.error.issues.map(
      (issue) => `  ${issue.path.join('.') || '(root)'}: ${issue.message}`,
    );
    throw new Error(
      `Environment is not valid, so the app will not start.\n${lines.join('\n')}\n` +
        'Copy .env.example to .env.local and fill in the values listed above.',
    );
  }

  const env = parsed.data;

  // PHI gate one: live mode requires a confirmed BAA with Anthropic on a
  // HIPAA-ready API organisation. There is deliberately no override.
  if (env.PHI_MODE === 'live' && !env.ANTHROPIC_BAA_CONFIRMED) {
    throw new Error(
      'PHI_MODE=live requires ANTHROPIC_BAA_CONFIRMED=true. Patient data may only ' +
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

  const phiKeyBytes = Buffer.from(env.PHI_ENCRYPTION_KEY, 'base64');
  if (phiKeyBytes.byteLength !== 32) {
    throw new Error(
      `PHI_ENCRYPTION_KEY must decode to exactly 32 bytes, got ${phiKeyBytes.byteLength}. ` +
        'Generate one with: node -e "console.log(require(\'crypto\').randomBytes(32).toString(\'base64\'))"',
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

  return Object.freeze({
    ...env,
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
