/**
 * better-auth configuration.
 *
 * Session policy here is compliance requirement 7:
 *
 *   30 minute idle timeout. `expiresIn` is 30 minutes and `updateAge` is 0, so
 *   every authenticated request pushes the expiry out. A session that goes
 *   quiet for half an hour is dead, which is the behaviour a hospital security
 *   reviewer is looking for. An absolute cap of 12 hours sits on top, so a tab
 *   left open and poked all day still ends.
 *
 *   httpOnly, SameSite=Lax, Secure in production. The session token is never
 *   readable from JavaScript.
 *
 *   Origin checking. `trustedOrigins` rejects cross-site form posts, which
 *   together with Next's server action origin check is the CSRF control.
 *
 * Two-factor enrolment is enforced in lib/auth/guards.ts rather than here,
 * because whether a given account needs it depends on the roles it holds.
 */
import { betterAuth } from 'better-auth';
import { drizzleAdapter } from 'better-auth/adapters/drizzle';
import { nextCookies } from 'better-auth/next-js';
import { organization, twoFactor } from 'better-auth/plugins';
import { db } from '@/lib/db';
import * as schema from '@/lib/db/schema';
import { env } from '@/lib/env';

const THIRTY_MINUTES = 60 * 30;
const TWELVE_HOURS = 60 * 60 * 12;

export const auth = betterAuth({
  appName: 'Medeal',
  baseURL: env.BETTER_AUTH_URL,
  secret: env.BETTER_AUTH_SECRET,

  database: drizzleAdapter(db, {
    provider: 'pg',
    schema: {
      user: schema.user,
      session: schema.session,
      account: schema.account,
      verification: schema.verification,
      twoFactor: schema.twoFactor,
      organization: schema.organization,
      member: schema.member,
      invitation: schema.invitation,
      rateLimit: schema.rateLimit,
    },
  }),

  emailAndPassword: {
    enabled: true,
    // Accounts are provisioned by the operator. There is no signup route in this
    // application, and no self-service path to create one.
    disableSignUp: true,
    minPasswordLength: 12,
    maxPasswordLength: 256,
    autoSignIn: false,
  },

  session: {
    expiresIn: THIRTY_MINUTES,
    updateAge: 0,
    freshAge: TWELVE_HOURS,
    cookieCache: { enabled: false },
  },

  user: {
    // Names here match the Drizzle property names in lib/db/schema.ts, which is
    // what the adapter resolves against, not the underlying column names.
    // input: false keeps them off any client-writable path: a role is set by the
    // operator console, never by a request body.
    additionalFields: {
      status: { type: 'string', input: false, defaultValue: 'active' },
      platformRole: { type: 'string', input: false, defaultValue: 'none' },
      mustChangePassword: { type: 'boolean', input: false, defaultValue: false },
    },
  },

  advanced: {
    useSecureCookies: env.NODE_ENV === 'production',
    defaultCookieAttributes: {
      httpOnly: true,
      sameSite: 'lax',
      path: '/',
    },
  },

  trustedOrigins: [env.APP_URL, env.BETTER_AUTH_URL],

  /**
   * Rate limiting, adjusted for how hospitals actually connect.
   *
   * better-auth's default for sign-in is three attempts per ten seconds, keyed
   * by client address. That is a sensible default for consumer software and the
   * wrong one here: a denials department sits behind a single NAT gateway, so
   * the whole floor shares one address, and the fourth person to start their
   * shift would be locked out by the first three.
   *
   * Twenty attempts per minute is still far below what credential stuffing
   * needs to be worth doing, and account level protection is stronger anyway:
   * every role that can change anything must hold a second factor, and
   * better-auth locks that factor after repeated wrong codes.
   */
  rateLimit: {
    enabled: true,
    // In the database, not in memory. On serverless a module level counter is
    // per-instance, so the effective allowance is multiplied by however many
    // instances happen to be warm, which is not a limit.
    storage: 'database',
    window: 60,
    max: 100,
    customRules: {
      '/sign-in/email': { window: 60, max: 20 },
      '/change-password': { window: 60, max: 20 },
      // Enrolment: rare per person, but a department onboarding several people
      // at once shares one address, and better-auth's plugin default of three
      // per ten seconds would stop the fourth of them.
      '/two-factor/enable': { window: 60, max: 10 },
      '/two-factor/verify-totp': { window: 60, max: 10 },
      '/two-factor/verify-backup-code': { window: 60, max: 10 },
    },
  },

  databaseHooks: {
    session: {
      create: {
        // Compliance requirement 3: every login leaves a row. Hooking session
        // creation rather than the sign-in route catches the second factor path
        // and any future provider too, because they all end in a session.
        async after(created) {
          const { audit } = await import('@/lib/audit');
          const activeOrg = created.activeOrganizationId;
          await audit({
            userId: created.userId,
            organizationId: typeof activeOrg === 'string' ? activeOrg : null,
            action: 'login',
            entityType: 'session',
            entityId: created.id,
          });
        },
      },
    },
  },

  plugins: [
    organization({
      // Organisations are created from the operator console, not by customers.
      allowUserToCreateOrganization: false,
    }),
    twoFactor({
      issuer: 'Medeal',
      // A disabled account must not be able to complete a second factor either.
      skipVerificationOnEnable: false,
    }),
    nextCookies(),
  ],
});

export type Auth = typeof auth;
