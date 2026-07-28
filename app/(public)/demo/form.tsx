'use client';

import { useActionState } from 'react';
import { submitDemoRequest, type DemoRequestState } from './actions';
import { Button } from '@/components/ui/button';
import { Field, Input, Select, Textarea } from '@/components/ui/field';
import { ErrorState } from '@/components/ui/primitives';
import { ANNUAL_DENIAL_VOLUMES, VOLUME_LABELS } from '@/lib/validation/demo-request';

const INITIAL: DemoRequestState = { status: 'idle' };

export function DemoRequestForm() {
  const [state, action, pending] = useActionState(submitDemoRequest, INITIAL);

  if (state.status === 'ok') {
    return (
      <div
        role="status"
        className="mt-8 max-w-xl border border-recovered/40 bg-recovered-wash p-5"
      >
        <h2 className="font-semibold text-recovered">Request received</h2>
        <p className="mt-2 text-sm text-ink">
          We will reply within one business day. Check your inbox for a
          confirmation with what to bring.
        </p>
      </div>
    );
  }

  const errors = state.status === 'error' ? state.fieldErrors : {};

  return (
    <form action={action} className="mt-8 max-w-xl space-y-5" noValidate>
      {state.status === 'error' ? (
        <ErrorState title="Not sent yet" body={state.message} />
      ) : null}

      <Field label="Your name" name="name" required error={errors.name}>
        {(props) => (
          <Input {...props} autoComplete="name" invalid={Boolean(errors.name)} />
        )}
      </Field>

      <Field
        label="Work email"
        name="email"
        required
        error={errors.email}
        hint="We reply here, so use the address you actually read."
      >
        {(props) => (
          <Input
            {...props}
            type="email"
            autoComplete="email"
            invalid={Boolean(errors.email)}
          />
        )}
      </Field>

      <Field
        label="Hospital or health system"
        name="orgName"
        required
        error={errors.orgName}
      >
        {(props) => (
          <Input
            {...props}
            autoComplete="organization"
            invalid={Boolean(errors.orgName)}
          />
        )}
      </Field>

      <Field label="Your title" name="title" required error={errors.title}>
        {(props) => (
          <Input
            {...props}
            autoComplete="organization-title"
            invalid={Boolean(errors.title)}
          />
        )}
      </Field>

      <Field
        label="Denials a year"
        name="annualDenialVolume"
        required
        error={errors.annualDenialVolume}
        hint="A rough range is fine. It tells us which part of the system to show you."
      >
        {(props) => (
          <Select
            {...props}
            defaultValue=""
            invalid={Boolean(errors.annualDenialVolume)}
          >
            <option value="" disabled>
              Choose a range
            </option>
            {ANNUAL_DENIAL_VOLUMES.map((v) => (
              <option key={v} value={v}>
                {VOLUME_LABELS[v]}
              </option>
            ))}
          </Select>
        )}
      </Field>

      <Field
        label="Anything you want us to look at"
        name="message"
        error={errors.message}
        hint="Optional. A denial type that keeps coming back is a good place to start."
      >
        {(props) => (
          <Textarea {...props} rows={4} invalid={Boolean(errors.message)} />
        )}
      </Field>

      {/* Honeypot. Off screen rather than display:none, and marked so assistive
          technology skips it, since a screen reader user must not be trapped by
          a field they are not meant to fill. */}
      <div aria-hidden="true" className="absolute left-[-9999px] h-px w-px overflow-hidden">
        <label htmlFor="website">Do not fill this in</label>
        <input id="website" name="website" type="text" tabIndex={-1} autoComplete="off" />
      </div>

      <Button type="submit" intent="primary" disabled={pending}>
        {pending ? 'Sending' : 'Send request'}
      </Button>
    </form>
  );
}
