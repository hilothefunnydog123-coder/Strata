/**
 * Create the demonstration data from the command line.
 *
 * A thin wrapper. The work lives in lib/demo/seed.ts so that the operator
 * console can run exactly the same thing on a host with no shell, which is
 * where most deployments now are.
 *
 *   pnpm seed:demo            create it
 *   pnpm seed:demo --reset    delete it first, then create it again
 */
import 'dotenv/config';
import { seedDemo } from '../lib/demo/seed';
import { log } from '../lib/log';

async function main(): Promise<void> {
  const result = await seedDemo({ reset: process.argv.includes('--reset') });

  const line = '─'.repeat(72);
  process.stdout.write(
    `\n${line}\n` +
      'Demonstration data created.\n\n' +
      `  Organisation      ${result.organisation} (${result.contingencyRateBps / 100}% contingency)\n` +
      `  Denials           ${result.denials}, one in clinical review with a verified draft\n` +
      `  Assertions        ${result.assertions}, every quote verified against its source\n` +
      `  Invoice           ${result.invoiceNumber}, ` +
      `$${(result.feeCents / 100).toFixed(2)} on $${(result.recoveredCents / 100).toFixed(2)} recovered\n\n` +
      'Sign in with any of these. Each will force a password change, and every\n' +
      'role except read only will then require two-factor enrolment.\n\n',
  );
  for (const c of result.credentials) {
    process.stdout.write(`  ${c.role.padEnd(20)} ${c.email}\n${' '.repeat(22)}${c.password}\n\n`);
  }
  process.stdout.write(
    'All of it is synthetic and tagged as such. The verification is not: every\n' +
      'quote above was checked with the same code that runs in production.\n' +
      `${line}\n\n`,
  );
}

main()
  .then(() => process.exit(0))
  .catch((error: unknown) => {
    log.error('seeding the demonstration failed', { error });
    process.exit(1);
  });
