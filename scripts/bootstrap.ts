/**
 * Create the first operator account, if there is not one already.
 *
 * The same guarded bootstrap that runs at server startup, exposed as a command
 * so it can run from a deploy pipeline instead. On a host that runs a long
 * lived server, instrumentation.ts handles this and this script is unnecessary.
 * On a serverless host there is no startup to hook, so the build step runs it.
 *
 * Safe to run on every deploy: it does nothing unless the user table is
 * completely empty. It is not a password reset. Use provision:superadmin for
 * that, which is deliberately a separate, explicit command.
 */
import 'dotenv/config';
import { bootstrapFirstOperator } from '../lib/auth/bootstrap';
import { log } from '../lib/log';

async function main(): Promise<void> {
  const outcome = await bootstrapFirstOperator();

  if (outcome.status === 'created') return; // Already printed its own banner.

  if (outcome.reason === 'no-email-configured') {
    process.stdout.write(
      'SUPERADMIN_EMAIL is not set, so no operator account was created. Set it and\n' +
        'deploy again, or run provision:superadmin where a shell is available.\n',
    );
    return;
  }

  process.stdout.write('Accounts already exist, so nothing was created.\n');
}

main()
  .then(() => process.exit(0))
  .catch((error: unknown) => {
    log.error('could not create the first operator account', { error });
    process.exit(1);
  });
