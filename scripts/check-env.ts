/**
 * Validate the environment before anything else in a deploy runs.
 *
 * `next build` needs the runtime environment. Not because building should, in
 * principle, but because some pages render values that come from it: the
 * contact page prints the address demo requests go to, for one. A page like
 * that is static output derived from configuration, so the configuration has to
 * exist when the output is produced.
 *
 * Without this, a missing variable surfaces two minutes into a build as a
 * prerender error naming one page, and the actual cause, that nothing is
 * configured, has to be inferred. Running the same validation first turns that
 * into one message at the top of the log listing every variable that is
 * missing, before a single second is spent compiling.
 */
import 'dotenv/config';
import { assertEnv, envStatus } from '../lib/env';

try {
  // A deployment with nothing set is a new one. Let the build through so there
  // is something to look at, and say clearly what it will and will not do.
  // envStatus() throws rather than returning here if a database is reachable
  // while secrets are missing, which is the shape that must not be waved past.
  const status = envStatus();
  if (!status.configured) {
    process.stdout.write(
      `\nNot configured: ${status.missing.join(', ')} are not set.\n\n` +
        'Building anyway. The deploy will serve its public pages behind a banner\n' +
        'saying so. Sign in, uploads and appeals need the variables above; set\n' +
        'them and deploy again and the first operator account is created then.\n\n',
    );
    process.exit(0);
  }

  const env = assertEnv();
  process.stdout.write(
    `Environment is valid. PHI mode ${env.PHI_MODE}, storage ` +
      `${env.storageIsR2 ? 'R2' : 'local disk'}, origin ${env.APP_URL}\n`,
  );
  process.exit(0);
} catch (error) {
  const message = error instanceof Error ? error.message : String(error);
  process.stderr.write(`\n${message}\n\n`);
  process.exit(1);
}
