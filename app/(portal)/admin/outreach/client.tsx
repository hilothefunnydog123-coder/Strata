'use client';

import { useActionState, useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import {
  addTargets,
  readTargets,
  sendDueNow,
  startOutreach,
  stopWriting,
  theyReplied,
  type OutreachState,
} from './actions';
import { Button } from '@/components/ui/button';
import { Field, Input, Textarea } from '@/components/ui/field';
import { ErrorState, Notice, Panel, PanelHeader, Tag } from '@/components/ui/primitives';

const INITIAL: OutreachState = { status: 'idle' };

function Feedback({ state }: { state: OutreachState }) {
  if (state.status === 'idle') return null;
  return (
    <div className="mt-3">
      {state.status === 'ok' ? (
        <Notice tone="recovered">{state.message}</Notice>
      ) : (
        <ErrorState title="Not done" body={state.message} />
      )}
      {state.notes && state.notes.length > 0 ? (
        <ul className="mt-2 space-y-0.5 border border-rule bg-paper px-3 py-2 text-xs">
          {state.notes.map((note) => (
            <li key={note}>{note}</li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}

/**
 * Paste anything, and let the model find the contacts in it.
 *
 * The CSV form below still exists for a tidy spreadsheet, but this is the one
 * that gets used, because the reason a list never gets loaded is the twenty
 * minutes of formatting rather than the paste itself.
 */
export function ReadTargetsForm() {
  const [state, action, pending] = useActionState(readTargets, INITIAL);

  return (
    <Panel>
      <PanelHeader title="1. Add the people to write to" />
      <form action={action} className="space-y-3 p-4">
        <p className="text-sm font-medium">
          Paste anything: a contact page copied from a website, an email signature, a
          directory listing, or a few lines typed out. It will be read for names, titles
          and organisations.
        </p>
        <p className="text-sm font-medium">
          Only addresses that actually appear in what you paste are used. Nothing is
          guessed at from a name and a company, because a guessed address either bounces
          or reaches a stranger, and both are permanent.
        </p>
        <Field label="Paste it here" name="text" required>
          {(field) => (
            <Textarea
              {...field}
              rows={8}
              placeholder={
                'Windsor Gardens Care Center of Hayward\n' +
                'Contact us: (510) 537-8848\n' +
                'Dana Whitfield, Business Office Manager\n' +
                'dana.whitfield@example.com'
              }
            />
          )}
        </Field>
        <Button type="submit" intent="primary" disabled={pending}>
          {pending ? 'Reading' : 'Find the contacts'}
        </Button>
        <Feedback state={state} />
      </form>
    </Panel>
  );
}

export function AddTargetsForm() {
  const [state, action, pending] = useActionState(addTargets, INITIAL);

  return (
    <Panel>
      <PanelHeader title="Or paste a spreadsheet" />
      <form action={action} className="space-y-3 p-4">
        <p className="text-sm font-medium">
          One per line, comma separated. The first line names the columns. A row without
          an email address is skipped rather than guessed at.
        </p>
        <Field label="Paste your list" name="csv" required>
          {(field) => (
            <Textarea
              {...field}
              rows={7}
              className="font-mono text-xs"
              defaultValue={'email,first_name,org_name,title\n'}
              placeholder={
                'email,first_name,org_name,title\n' +
                'dana@example.com,Dana,Windsor Oakland,Business Office Manager'
              }
            />
          )}
        </Field>
        <Button type="submit" disabled={pending}>
          {pending ? 'Adding' : 'Add these'}
        </Button>
        <Feedback state={state} />
      </form>
    </Panel>
  );
}

export function StartForm({
  ready,
  waiting,
}: {
  ready: boolean;
  waiting: number;
}) {
  const [state, action, pending] = useActionState(startOutreach, INITIAL);

  return (
    <Panel>
      <PanelHeader title="2. Start writing to them">
        <span className="text-2xs">
          {waiting} not yet started
        </span>
      </PanelHeader>
      <form action={action} className="space-y-3 p-4">
        <p className="text-sm font-medium">
          Four messages: the first one now, then follow-ups on days 4, 10 and 20. Anyone
          who replies is dropped from the rest automatically.
        </p>

        {!ready ? (
          <ErrorState
            title="Mail is not configured yet, so nothing would leave"
            body={
              'Set RESEND_API_KEY, EMAIL_FROM and MAILING_ADDRESS in the hosting ' +
              'dashboard, then redeploy. You can still add targets and press start: ' +
              'nothing is lost, and the first message waits until mail works.'
            }
          />
        ) : null}

        <Field
          label="How many first emails a day"
          name="perDay"
          hint="Twenty is a sensible pace. Sending a hundred at once gets a new domain filtered, and after that nothing arrives at all."
        >
          {(field) => (
            <Input {...field} type="number" min={1} max={50} defaultValue={20} />
          )}
        </Field>

        <label className="flex items-start gap-2 text-sm font-medium">
          <input type="checkbox" name="alreadyWritten" className="mt-1" />
          <span>
            I already wrote to these people myself. Skip the first email and start at the
            follow-ups.
          </span>
        </label>

        <Button type="submit" disabled={pending}>
          {pending ? 'Starting' : 'Start the sequence'}
        </Button>
        <Feedback state={state} />
      </form>
    </Panel>
  );
}

export function SendNowButton() {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [state, setState] = useState<OutreachState>(INITIAL);

  return (
    <div className="p-4">
      <p className="text-sm font-medium">
        Messages send on their own on a schedule. This sends anything due right now, which
        is the quickest way to watch the first one actually leave.
      </p>
      <div className="mt-3">
        <Button
          type="button"
          disabled={pending}
          onClick={() =>
            start(async () => {
              setState(await sendDueNow());
              router.refresh();
            })
          }
        >
          {pending ? 'Sending' : 'Send whatever is due now'}
        </Button>
      </div>
      <Feedback state={state} />
    </div>
  );
}

export interface BoardRow {
  contactId: string;
  email: string;
  firstName: string | null;
  orgName: string | null;
  title: string | null;
  unsubscribedAt: Date | null;
  status: string | null;
  stepsSent: number | null;
  nextRunAt: Date | null;
  totalSteps: number;
}

function statusTone(row: BoardRow): 'recovered' | 'denied' | 'neutral' {
  if (row.status === 'replied') return 'recovered';
  if (row.status === 'unsubscribed' || row.status === 'stopped') return 'denied';
  return 'neutral';
}

function statusLabel(row: BoardRow): string {
  if (row.unsubscribedAt) return 'Unsubscribed';
  switch (row.status) {
    case 'replied':
      return 'Replied';
    case 'stopped':
      return 'Stopped';
    case 'unsubscribed':
      return 'Unsubscribed';
    case 'completed':
      return 'All sent';
    case 'active':
      return `${row.stepsSent ?? 0} of ${row.totalSteps} sent`;
    default:
      return 'Not started';
  }
}

/**
 * One person, and the two buttons that matter.
 *
 * Reply is first and the only one with weight, because it is the button whose
 * moment is urgent: a reply that lands while the next message is still pending
 * is the one case where being slow is actively rude.
 */
export function ContactRow({ row }: { row: BoardRow }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [state, setState] = useState<OutreachState>(INITIAL);

  const finished =
    row.status === 'replied' ||
    row.status === 'stopped' ||
    row.status === 'unsubscribed' ||
    Boolean(row.unsubscribedAt);

  return (
    <div className="border-b border-rule px-4 py-3 last:border-b-0">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <div>
          <p className="font-semibold">
            {row.orgName ?? row.email}
          </p>
          <p className="text-sm">
            {[row.firstName, row.title].filter(Boolean).join(', ') || 'no name recorded'}
            {' · '}
            <span className="font-mono text-xs">{row.email}</span>
          </p>
        </div>
        <Tag tone={statusTone(row)}>{statusLabel(row)}</Tag>
      </div>

      {row.status === 'active' && row.nextRunAt ? (
        <p className="mt-1 text-xs">
          next message {new Date(row.nextRunAt).toLocaleString()}
        </p>
      ) : null}

      {!finished ? (
        <div className="mt-2 flex flex-wrap gap-2">
          <Button
            type="button"
            intent="primary"
            disabled={pending}
            onClick={() =>
              start(async () => {
                setState(await theyReplied(row.contactId));
                router.refresh();
              })
            }
          >
            They replied
          </Button>
          <Button
            type="button"
            intent="quiet"
            disabled={pending}
            onClick={() =>
              start(async () => {
                setState(await stopWriting(row.contactId));
                router.refresh();
              })
            }
          >
            Stop writing
          </Button>
        </div>
      ) : null}

      <Feedback state={state} />
    </div>
  );
}
