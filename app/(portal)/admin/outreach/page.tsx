import type { Metadata } from 'next';
import { assertPlatformOrForbid, requirePrincipal } from '@/lib/auth/guards';
import { analyticsQuery } from '@/lib/analytics/guard';
import { emailConfigured } from '@/lib/email/send';
import { env } from '@/lib/env';
import { enrollmentBoard, PILOT_SEQUENCE, PILOT_STEPS } from '@/lib/email/sequence';
import { EmptyState, Panel, PanelHeader } from '@/components/ui/primitives';
import { AddTargetsForm, ContactRow, SendNowButton, StartForm } from './client';

export const metadata: Metadata = { title: 'Outreach' };

/**
 * Outreach, as buttons.
 *
 * The command line version of this does the same work, and needs a computer
 * with the repository, a database URL, and a terminal. The operator has a
 * phone. So the whole cadence is here: add people, press start, and press one
 * button when somebody answers.
 *
 * The page is written to be read by somebody who has never sent a campaign
 * before, which is why the panels are numbered and the copy says what will
 * happen rather than naming the mechanism that does it.
 */
export default async function OutreachPage() {
  const principal = await requirePrincipal();
  assertPlatformOrForbid(principal, 'admin:email');

  const board = await analyticsQuery(['contact', 'sequence_enrollment'], () =>
    enrollmentBoard(PILOT_SEQUENCE),
  );

  const ready = emailConfigured() && Boolean(env.MAILING_ADDRESS);
  const waiting = board.filter((r) => r.status === null && !r.unsubscribedAt).length;
  const replied = board.filter((r) => r.status === 'replied').length;
  const active = board.filter((r) => r.status === 'active').length;

  return (
    <div className="mx-auto max-w-3xl space-y-6 px-5 py-8">
      <header>
        <h1 className="text-2xl font-semibold">Outreach</h1>
        <p className="mt-2 max-w-2xl font-medium">
          {board.length} on the list. {active} being written to, {replied} replied,{' '}
          {waiting} not started.
        </p>
      </header>

      <AddTargetsForm />

      <StartForm ready={ready} waiting={waiting} />

      <Panel>
        <PanelHeader title="3. Watch it go" />
        <SendNowButton />
      </Panel>

      <Panel>
        <PanelHeader title="Everyone on the list">
          <span className="text-2xs">press reply the moment somebody answers</span>
        </PanelHeader>
        {board.length === 0 ? (
          <EmptyState
            title="Nobody yet"
            body="Add targets above. Each one needs an email address; a row without one is skipped rather than guessed at."
          />
        ) : (
          <div>
            {board.map((row) => (
              <ContactRow key={row.contactId} row={row} />
            ))}
          </div>
        )}
      </Panel>

      <Panel>
        <PanelHeader title="What gets sent" />
        <div className="space-y-4 p-4">
          {/*
            Said before the messages rather than after them, because the first
            thing a reader sees below is "Hi {{first_name}}," and without this
            line the obvious conclusion is that the software mails people a
            sentence with braces in it.
          */}
          <p className="text-sm font-medium">
            The words in double braces are filled in per person before sending:{' '}
            <span className="font-mono text-xs">{'{{first_name}}'}</span> becomes their
            first name, <span className="font-mono text-xs">{'{{org_name}}'}</span> their
            organisation. Where a name is missing the sentence still reads properly, so
            nobody ever receives a half-filled greeting.
          </p>
          {PILOT_STEPS.map((step, i) => (
            <div key={step.subject} className="border border-rule bg-paper p-3">
              <p className="text-2xs font-semibold uppercase tracking-widest">
                {i === 0 ? 'First message, straight away' : `Day ${step.dayOffset}`}
              </p>
              <p className="mt-1 font-semibold">{step.subject}</p>
              <p className="document mt-2 whitespace-pre-wrap text-sm">{step.body}</p>
            </div>
          ))}
          <p className="text-sm font-medium">
            Every message carries an unsubscribe link and the postal address the law
            requires, added automatically. Anyone who unsubscribes or replies stops
            receiving the rest.
          </p>
        </div>
      </Panel>
    </div>
  );
}

export const dynamic = 'force-dynamic';
