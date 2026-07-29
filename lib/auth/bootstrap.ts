/**
 * The first account, created at startup on a deployment with no shell.
 *
 * `pnpm provision:superadmin` is the intended way to do this, and it remains
 * the way on any host where a shell exists. But a hosting plan without shell
 * access has no way to run it, which leaves the application deployed, healthy,
 * and impossible to sign in to: there is no signup route, by design.
 *
 * So this runs once at startup, and the guard is what makes it safe:
 *
 *   1. SUPERADMIN_EMAIL must be set. Absent it, nothing happens at all.
 *   2. The user table must be completely empty. Not "no superadmin", empty. The
 *      moment any account exists, this is inert forever, so it can never be a
 *      way to acquire an account on a running system, and it cannot resurrect
 *      an operator account that was deliberately deactivated.
 *
 * The temporary password goes to the startup log because on a shell-less plan
 * that is the only channel back to the operator. It is worth being clear about
 * the tradeoff: anyone who can read the service's deploy logs can read that
 * password for as long as the log is retained. What limits the damage is that
 * the account is unusable as it stands. `mustChangePassword` is set, so the
 * first sign in leads to a forced password change, and superadmin is above read
 * only, so two factor enrolment is forced immediately after. An attacker
 * reading the log later finds a password that has already been replaced, and
 * even in the window before that, using it means changing it, which is loud.
 *
 * Rotate it anyway if the log has been shared: sign in, change the password,
 * enrol two factor.
 */
import { sql } from 'drizzle-orm';
import { db } from '@/lib/db';
import { user } from '@/lib/db/schema';
import { provisionUser } from '@/lib/auth/provision';
import { env } from '@/lib/env';

export interface BootstrapOutcome {
  status: 'created' | 'skipped';
  reason?: 'no-email-configured' | 'accounts-already-exist';
}

export async function bootstrapFirstOperator(): Promise<BootstrapOutcome> {
  const email = env.SUPERADMIN_EMAIL;
  if (!email) return { status: 'skipped', reason: 'no-email-configured' };

  const [row] = await db.select({ count: sql<number>`count(*)::int` }).from(user);
  if ((row?.count ?? 0) > 0) {
    return { status: 'skipped', reason: 'accounts-already-exist' };
  }

  const result = await provisionUser({
    email,
    name: 'Operator',
    platformRole: 'superadmin',
  });

  // Straight to stdout rather than through the logger, which redacts anything
  // shaped like a credential. That is correct everywhere else and wrong here:
  // this is the one moment the password is meant to be read by a human.
  const line = '─'.repeat(64);
  process.stdout.write(
    `\n${line}\n` +
      'First operator account created, because the database had no accounts\n' +
      'in it and SUPERADMIN_EMAIL is set.\n\n' +
      `  Email:              ${result.email}\n` +
      `  Temporary password: ${result.temporaryPassword}\n\n` +
      'Sign in now and change it. The application will require that, and then\n' +
      'two factor enrolment, before it lets you do anything else.\n\n' +
      'This password is in this log. Treat the log accordingly, and change the\n' +
      'password before sharing it.\n' +
      `${line}\n\n`,
  );

  return { status: 'created' };
}
