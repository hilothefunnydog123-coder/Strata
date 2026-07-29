/**
 * Create the operator account.
 *
 * The one bootstrap that cannot happen through the application, because until
 * it runs there is nobody who can sign in to run it. Everything after this,
 * including every other user and every organisation, is created from the
 * operator console.
 *
 *   pnpm provision:superadmin
 *
 * Reads SUPERADMIN_EMAIL, prints a temporary password once, and marks the
 * account as needing a password change. Two factor enrolment is then forced by
 * the portal layouts, because superadmin is a role above read only.
 *
 * Re-running against an existing account issues a fresh temporary password
 * rather than failing, so a locked out operator is recoverable without anyone
 * touching the database by hand.
 */
import 'dotenv/config';
import { provisionUser } from '../lib/auth/provision';
import { env } from '../lib/env';
import { log } from '../lib/log';

async function main(): Promise<void> {
  const email = env.SUPERADMIN_EMAIL;
  if (!email) {
    throw new Error(
      'SUPERADMIN_EMAIL is not set. Put the operator address in your environment and run this again.',
    );
  }

  const result = await provisionUser({
    email,
    name: 'Operator',
    platformRole: 'superadmin',
  });

  // Written to stdout directly rather than through the logger. The logger
  // redacts anything that looks like a credential, which is right everywhere
  // else and wrong here: this is the one moment the password is meant to be
  // read by a human, once.
  const line = '─'.repeat(64);
  process.stdout.write(
    `\n${line}\n` +
      `Operator account ${result.created ? 'created' : 'reset'}.\n\n` +
      `  Email:              ${result.email}\n` +
      `  Temporary password: ${result.temporaryPassword}\n\n` +
      'This is printed once and is not stored anywhere in readable form.\n' +
      'Sign in, change it immediately, then enrol two-factor. The application\n' +
      'will insist on both before it lets you do anything else.\n' +
      `${line}\n\n`,
  );
}

main()
  .then(() => process.exit(0))
  .catch((error: unknown) => {
    log.error('could not provision the operator account', { error });
    process.exit(1);
  });
