'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { createDemoData, type SeedState } from './actions';
import { Button } from '@/components/ui/button';
import { ErrorState, Notice, Panel, PanelHeader } from '@/components/ui/primitives';

/**
 * The one place the temporary passwords are readable.
 *
 * They are held in component state and never persisted, so a refresh loses
 * them, which is correct: they exist to be used once and then replaced. The
 * page says so rather than letting someone assume they can come back to it.
 */
export function DemoControls({ alreadySeeded }: { alreadySeeded: boolean }) {
  const router = useRouter();
  const [state, setState] = useState<SeedState>({ status: 'idle' });
  const [pending, start] = useTransition();

  function run(reset: boolean) {
    start(async () => {
      setState({ status: 'idle' });
      const result = await createDemoData(reset);
      setState(result);
      if (result.status === 'ok') router.refresh();
    });
  }

  return (
    <div>
      <div className="flex flex-wrap items-center gap-3">
        <Button intent="primary" disabled={pending} onClick={() => run(false)}>
          {pending ? 'Working' : 'Create demonstration data'}
        </Button>
        {alreadySeeded ? (
          <Button intent="danger" disabled={pending} onClick={() => run(true)}>
            Delete it and create it again
          </Button>
        ) : null}
      </div>

      {alreadySeeded && state.status === 'idle' ? (
        <p className="mt-3 max-w-2xl text-sm text-ink-2">
          The demonstration organisation already exists. Creating it again without
          deleting it first will fail on the unique constraints, which is the
          database refusing to make a second copy rather than a fault.
        </p>
      ) : null}

      {state.status === 'error' ? (
        <div className="mt-4 max-w-2xl">
          <ErrorState title="Not created" body={state.message} />
        </div>
      ) : null}

      {state.status === 'ok' ? (
        <div className="mt-6">
          <Notice tone="recovered">
            Created. {state.result.assertions} assertions written, every quote
            verified against its source before it was stored.
          </Notice>

          <div className="mt-4 max-w-3xl">
            <Panel>
              <PanelHeader title="Sign in with any of these">
                <span className="text-xs text-ink-2">Shown once</span>
              </PanelHeader>
              <div className="p-4">
                <p className="mb-4 text-sm text-ink-2">
                  These passwords are not stored in readable form and are not
                  shown again. Each account will demand a password change on
                  first sign in, and every role except read only will then
                  require two-factor enrolment.
                </p>
                <dl className="space-y-3">
                  {state.result.credentials.map((c) => (
                    <div key={c.email} className="rule-t pt-3">
                      <dt className="text-sm font-medium">{c.role}</dt>
                      <dd className="id mt-1 text-xs">{c.email}</dd>
                      <dd className="id mt-0.5 text-xs font-semibold">{c.password}</dd>
                    </div>
                  ))}
                </dl>
              </div>
            </Panel>
          </div>

          <p className="mt-4 max-w-2xl text-sm text-ink-2">
            The organisation is {state.result.organisation}, billing at{' '}
            {state.result.contingencyRateBps / 100} percent. Invoice{' '}
            <span className="id">{state.result.invoiceNumber}</span> was computed
            by the real billing code from the recorded outcome.
          </p>
        </div>
      ) : null}
    </div>
  );
}
