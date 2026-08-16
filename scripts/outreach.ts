/**
 * Outreach, run from one command.
 *
 * The whole point of this script is that following up stops being something a
 * person has to remember. Load the targets once, enrol them once, and every
 * later touch goes out on its own from the cron drain, stopping the moment
 * somebody answers.
 *
 *   pnpm outreach seed                     create or update the sequence
 *   pnpm outreach import targets.csv       load contacts (email,first,org,title)
 *   pnpm outreach enroll                   enrol everyone; the opener sends itself
 *   pnpm outreach enroll --sent=1          for contacts already written to by hand
 *   pnpm outreach replied someone@x.com    somebody answered: stop everything
 *   pnpm outreach status                   where every enrolment stands
 *   pnpm outreach run                      send whatever is due right now
 *
 * The cadence is four messages: the opener on the day of enrolment, then a
 * short bump, a useful fact, and a close-the-loop note on days 4, 10, and 20.
 * Openers are paced rather than blasted, because a new domain that sends
 * seventy cold messages at once stops reaching inboxes at all.
 *
 * The one rule worth repeating: `replied` is the command that matters. Run it
 * the moment anybody answers, and the machine will never talk over them.
 */
import 'dotenv/config';
import { readFileSync } from 'node:fs';
import { sql } from 'drizzle-orm';
import { db } from '../lib/db';
import { contact, user } from '../lib/db/schema';
import { parseContactsCsv, upsertContact } from '../lib/email/campaign';
import {
  enroll,
  markReplied,
  PILOT_SEQUENCE,
  PILOT_STEPS,
  runDueSteps,
  sequenceStatus,
  upsertSequence,
} from '../lib/email/sequence';
import { log } from '../lib/log';

const out = (line = ''): void => void process.stdout.write(`${line}\n`);

export const SEQUENCE_NAME = PILOT_SEQUENCE;

/** Create the cadence, or refresh its wording if it is already there. */
async function seed(): Promise<void> {
  // Any operator will do as the author: this records who set the cadence up,
  // and the script is only ever run by the operator themselves.
  const owner = await db.query.user.findFirst({ orderBy: user.createdAt });
  if (!owner) {
    out('No user exists yet. Run "pnpm db:bootstrap" first.');
    return;
  }

  const { created } = await upsertSequence(SEQUENCE_NAME, PILOT_STEPS, owner.id);
  out(
    `${created ? 'Created' : 'Updated'} "${SEQUENCE_NAME}" with ${PILOT_STEPS.length} steps.`,
  );

  for (const [i, step] of PILOT_STEPS.entries()) {
    out(`  step ${i + 1}: day ${step.dayOffset}  ${step.subject}`);
  }
}

async function importContacts(path: string): Promise<void> {
  const parsed = parseContactsCsv(readFileSync(path, 'utf8'));

  if (parsed.errors.length > 0) {
    out(`${parsed.errors.length} row(s) could not be read:`);
    for (const bad of parsed.errors.slice(0, 10)) out(`  ${bad}`);
  }

  // Through upsertContact rather than a raw insert, so every contact gets a
  // real unsubscribe token minted the same way the campaign path does it. A
  // contact without one cannot be mailed lawfully.
  let added = 0;
  for (const row of parsed.contacts) {
    const result = await upsertContact(row);
    if (result.created) added += 1;
  }

  out(`${added} new contact(s) added, ${parsed.contacts.length - added} already known.`);
}

/**
 * How many opening emails go out in a day, and how far apart.
 *
 * Not a politeness setting. A new sending domain that emits seventy cold
 * messages in one minute is a new sending domain that gets filtered, and once a
 * domain is classified as a spam source, every later message from it lands in a
 * junk folder no matter how good it is. That failure is invisible from this
 * side: the sends all report success and nobody ever replies.
 *
 * So enrolment spreads the start times instead of the runner throttling itself.
 * Contact number N is enrolled a little later than contact N minus one, which
 * staggers the opener and every follow-up behind it, using the due-date
 * machinery that already exists rather than a second mechanism that could
 * disagree with it.
 */
const DEFAULT_PER_DAY = 20;
const SPACING_MINUTES = 7;

async function enrollAll(alreadySent: number, perDay: number): Promise<void> {
  const everyone = await db
    .select({ id: contact.id, email: contact.email })
    .from(contact)
    .where(sql`${contact.unsubscribedAt} is null`);

  const start = new Date();
  let fresh = 0;
  let queued = 0;

  for (const person of everyone) {
    // Whole days first, then minutes within the day, so the shape is "twenty a
    // day, one every few minutes" rather than a burst at midnight.
    const dayShift = Math.floor(queued / perDay);
    const withinDay = (queued % perDay) * SPACING_MINUTES;
    const enrolledAt = new Date(
      start.getTime() + dayShift * 24 * 60 * 60 * 1000 + withinDay * 60 * 1000,
    );

    const result = await enroll({
      sequenceName: SEQUENCE_NAME,
      contactId: person.id,
      alreadySent,
      enrolledAt,
    });

    if (!result.alreadyEnrolled) {
      fresh += 1;
      queued += 1;
    }
  }

  out(`${fresh} contact(s) enrolled, ${everyone.length - fresh} already in the sequence.`);
  if (fresh > 0) {
    const days = Math.ceil(fresh / perDay);
    out(
      alreadySent === 0
        ? `Opening emails go out ${perDay} a day, one every ${SPACING_MINUTES} minutes, ` +
            `over ${days} day${days === 1 ? '' : 's'}.`
        : `Follow-ups are scheduled from each contact's enrolment date.`,
    );
  }
  out('');
  out('From here the drain sends everything on its own. Nothing else to remember,');
  out('except running "pnpm outreach replied <email>" when somebody answers.');
}

async function main(): Promise<void> {
  const [command, ...rest] = process.argv.slice(2);

  switch (command) {
    case 'seed':
      await seed();
      break;

    case 'import': {
      const path = rest[0];
      if (!path) {
        out('Usage: pnpm outreach import <file.csv>');
        break;
      }
      await importContacts(path);
      break;
    }

    case 'enroll': {
      // Default 0: the common case is a fresh list nobody has written to yet,
      // and the machine sends the opener. Pass --sent=1 for the contacts who
      // already got a first email by hand, so they start at the follow-ups.
      const sentArg = rest.find((a) => a.startsWith('--sent='));
      const perDayArg = rest.find((a) => a.startsWith('--per-day='));
      await enrollAll(
        Number(sentArg?.split('=')[1] ?? 0) || 0,
        Math.max(1, Number(perDayArg?.split('=')[1] ?? DEFAULT_PER_DAY) || DEFAULT_PER_DAY),
      );
      break;
    }

    case 'replied': {
      const email = rest[0];
      if (!email) {
        out('Usage: pnpm outreach replied <email>');
        break;
      }
      const stopped = await markReplied(email, 'reply received');
      out(
        stopped
          ? `Stopped every follow-up to ${email}. Go answer them.`
          : `${email} had no active sequence, so nothing was scheduled to them anyway.`,
      );
      break;
    }

    case 'run': {
      const result = await runDueSteps();
      out(`${result.considered} due, ${result.sent} sent.`);
      break;
    }

    case 'status': {
      const status = await sequenceStatus(SEQUENCE_NAME);
      out('');
      out(`  ${status.name}, ${status.steps} steps`);
      out('');
      for (const [state, count] of Object.entries(status.byStatus)) {
        out(`  ${state.padEnd(14)} ${count}`);
      }
      out('');
      out(`  due right now   ${status.dueNow}`);
      out('');
      break;
    }

    default:
      out('');
      out('  pnpm outreach seed                  create or update the sequence');
      out('  pnpm outreach import targets.csv    load contacts');
      out('  pnpm outreach enroll                enrol everyone, machine sends the opener');
      out('  pnpm outreach enroll --sent=1       for contacts you already wrote to by hand');
      out('  pnpm outreach replied a@b.com       somebody answered: stop everything');
      out('  pnpm outreach status                where every enrolment stands');
      out('  pnpm outreach run                   send whatever is due right now');
      out('');
  }
}

main()
  .then(() => process.exit(0))
  .catch((error: unknown) => {
    log.error('outreach command failed', { error });
    process.exit(1);
  });
