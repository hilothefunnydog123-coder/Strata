'use client';

import { useActionState, useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import {
  addContact,
  importContacts,
  saveCampaign,
  startCampaign,
  testSend,
  type EmailState,
} from './actions';
import { substitute, type Substitutable } from '@/lib/email/substitute';
import { Button } from '@/components/ui/button';
import { Field, Input, Textarea } from '@/components/ui/field';
import {
  ErrorState,
  Notice,
  Panel,
  PanelHeader,
  Tag,
  Td,
} from '@/components/ui/primitives';

const INITIAL: EmailState = { status: 'idle' };

/** The contact the live preview substitutes against. */
const PREVIEW: Substitutable = {
  firstName: 'Dana',
  lastName: 'Whitfield',
  title: 'Director of Revenue Integrity',
  orgName: 'Mercy Regional Health',
  email: 'dana@mercyregional.test',
  unsubscribeToken: 'preview-token',
};

function Feedback({ state }: { state: EmailState }) {
  if (state.status === 'idle') return null;
  return (
    <div>
      {state.status === 'ok' ? (
        <Notice tone="recovered">{state.message}</Notice>
      ) : (
        <ErrorState title="Not done" body={state.message} />
      )}
      {state.notes && state.notes.length > 0 ? (
        <ul className="mt-2 space-y-0.5 border border-rule bg-paper px-3 py-2 text-xs text-ink-2">
          {state.notes.map((note) => (
            <li key={note}>{note}</li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}

export function CampaignComposer({ canStart }: { canStart: boolean }) {
  const router = useRouter();
  const [state, action, pending] = useActionState(saveCampaign, INITIAL);
  const [subject, setSubject] = useState('');
  const [body, setBody] = useState('');

  return (
    <Panel>
      <PanelHeader title="Compose">
        <span className="text-2xs text-ink-2">
          {canStart ? 'Test send required before sending' : 'Postal address missing'}
        </span>
      </PanelHeader>
      <form
        action={async (formData) => {
          await action(formData);
          router.refresh();
        }}
        className="space-y-4 p-4"
        noValidate
      >
        <Feedback state={state} />

        <Field label="Campaign name" name="name" required hint="For you, not for the recipient.">
          {(props) => <Input {...props} />}
        </Field>

        <Field
          label="Subject"
          name="subject"
          required
          hint="Placeholders work here too."
        >
          {(props) => (
            <Input
              {...props}
              value={subject}
              onChange={(e) => setSubject(e.target.value)}
            />
          )}
        </Field>

        <Field
          label="Message"
          name="body"
          required
          hint="Use {{first_name}}, {{last_name}}, {{title}}, {{org_name}}. The unsubscribe link and postal address are appended for you."
        >
          {(props) => (
            <Textarea
              {...props}
              rows={12}
              value={body}
              onChange={(e) => setBody(e.target.value)}
            />
          )}
        </Field>

        <div>
          <p className="text-2xs font-semibold uppercase tracking-wider text-ink-2">
            Preview, against a sample contact
          </p>
          <div className="mt-1.5 border border-rule bg-paper p-3">
            <p className="text-sm font-semibold">
              {subject ? substitute(subject, PREVIEW) : 'No subject yet'}
            </p>
            <p className="mt-2 whitespace-pre-wrap text-sm text-ink">
              {body ? substitute(body, PREVIEW) : 'Nothing written yet.'}
            </p>
            <p className="mt-3 border-t border-rule pt-2 text-xs text-ink-2">
              The unsubscribe link and postal address are appended automatically
              and cannot be removed.
            </p>
          </div>
        </div>

        <Button type="submit" intent="primary" disabled={pending}>
          {pending ? 'Saving' : 'Save campaign'}
        </Button>
      </form>
    </Panel>
  );
}

export function ImportForm() {
  const router = useRouter();
  const [state, action, pending] = useActionState(importContacts, INITIAL);

  return (
    <Panel>
      <PanelHeader title="Import contacts" />
      <form
        action={async (formData) => {
          await action(formData);
          router.refresh();
        }}
        className="space-y-3 p-4"
        noValidate
      >
        <Feedback state={state} />
        <Field
          label="Paste CSV"
          name="csv"
          hint="A header row with an email column. first_name, last_name, title, and org_name are used if present, in any order."
        >
          {(props) => (
            <Textarea
              {...props}
              rows={6}
              className="id text-xs"
              placeholder="first_name,last_name,email,title,org_name"
            />
          )}
        </Field>
        <Button type="submit" disabled={pending}>
          {pending ? 'Importing' : 'Import'}
        </Button>
      </form>
    </Panel>
  );
}

export function AddContactForm() {
  const router = useRouter();
  const [state, action, pending] = useActionState(addContact, INITIAL);

  return (
    <Panel>
      <PanelHeader title="Add one contact" />
      <form
        action={async (formData) => {
          await action(formData);
          router.refresh();
        }}
        className="grid gap-3 p-4 sm:grid-cols-2"
        noValidate
      >
        <div className="sm:col-span-2">
          <Feedback state={state} />
        </div>
        <Field label="Email" name="email" required>
          {(props) => <Input {...props} type="email" />}
        </Field>
        <Field label="First name" name="firstName">
          {(props) => <Input {...props} />}
        </Field>
        <Field label="Organisation" name="orgName">
          {(props) => <Input {...props} />}
        </Field>
        <Field label="Title" name="title">
          {(props) => <Input {...props} />}
        </Field>
        <div className="sm:col-span-2">
          <Button type="submit" disabled={pending}>
            {pending ? 'Adding' : 'Add contact'}
          </Button>
        </div>
      </form>
    </Panel>
  );
}

export function CampaignRow({
  id,
  name,
  subject,
  testSentAt,
  startedAt,
  sent,
  queued,
  skipped,
  canStart,
}: {
  id: string;
  name: string;
  subject: string;
  testSentAt: string | null;
  startedAt: string | null;
  sent: number;
  queued: number;
  skipped: number;
  canStart: boolean;
}) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [state, setState] = useState<EmailState>(INITIAL);

  function run(fn: () => Promise<EmailState>) {
    start(async () => {
      const result = await fn();
      setState(result);
      router.refresh();
    });
  }

  return (
    <>
      <tr className="hover:bg-paper">
        <Td>{name}</Td>
        <Td className="max-w-xs text-xs">{subject}</Td>
        <Td>
          {testSentAt ? (
            <span className="id text-xs">{testSentAt}</span>
          ) : (
            <Tag tone="denied">not yet</Tag>
          )}
        </Td>
        <Td numeric>{sent}</Td>
        <Td numeric>{queued}</Td>
        <Td numeric>{skipped}</Td>
        <Td>
          <span className="flex flex-wrap gap-2">
            <Button size="sm" disabled={pending} onClick={() => run(() => testSend(id))}>
              Test to me
            </Button>
            <Button
              size="sm"
              intent="primary"
              disabled={pending || !testSentAt || !canStart || Boolean(startedAt)}
              onClick={() => run(() => startCampaign(id))}
            >
              {startedAt ? 'Started' : 'Start sending'}
            </Button>
          </span>
        </Td>
      </tr>
      {state.status !== 'idle' ? (
        <tr>
          <Td colSpan={7}>
            <Feedback state={state} />
          </Td>
        </tr>
      ) : null}
    </>
  );
}
