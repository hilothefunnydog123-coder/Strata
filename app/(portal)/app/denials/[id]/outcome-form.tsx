'use client';

import { useActionState } from 'react';
import { useRouter } from 'next/navigation';
import { recordOutcome, type OutcomeState } from './outcome-actions';
import { Button } from '@/components/ui/button';
import { Field, Input, Select } from '@/components/ui/field';
import { ErrorState, Notice, Panel, PanelHeader } from '@/components/ui/primitives';

const INITIAL: OutcomeState = { status: 'idle' };

const RESULTS: Record<string, string> = {
  won: 'Won, fully overturned',
  partial: 'Partial, some of it came back',
  lost: 'Lost, upheld',
  withdrawn: 'Withdrawn',
};

/**
 * Recording what happened.
 *
 * This is the billing system rather than a report: the invoice is computed from
 * what is entered here, so the amount is the amount the contingency fee is
 * charged on. The evidence upload matters for the same reason.
 */
export function OutcomeForm({
  denialId,
  existing,
}: {
  denialId: string;
  existing: {
    result: string;
    decidedAt: string;
    amountRecoveredCents: number;
    invoiced: boolean;
  } | null;
}) {
  const router = useRouter();
  const [state, action, pending] = useActionState(recordOutcome, INITIAL);
  const errors = state.status === 'error' ? state.fieldErrors : {};

  if (existing?.invoiced) {
    return (
      <Panel>
        <PanelHeader title="Outcome" />
        <div className="p-4 text-sm">
          <p>
            Recorded as <strong>{RESULTS[existing.result] ?? existing.result}</strong> on{' '}
            <span className="id">{existing.decidedAt}</span>, recovering{' '}
            <strong>
              {(existing.amountRecoveredCents / 100).toLocaleString('en-US', {
                style: 'currency',
                currency: 'USD',
              })}
            </strong>
            .
          </p>
          <p className="mt-2 text-ink-2">
            This has been billed on an invoice, so it cannot be changed here. If
            something needs correcting, tell us and we will issue a credit rather
            than rewrite history.
          </p>
        </div>
      </Panel>
    );
  }

  return (
    <Panel>
      <PanelHeader title={existing ? 'Outcome' : 'Record the outcome'} />
      <form
        action={async (formData) => {
          await action(formData);
          router.refresh();
        }}
        className="space-y-4 p-4"
        noValidate
      >
        <input type="hidden" name="denialId" value={denialId} />

        {state.status === 'error' ? (
          <ErrorState title="Not recorded" body={state.message} />
        ) : null}
        {state.status === 'ok' ? <Notice tone="recovered">{state.message}</Notice> : null}

        <div className="grid gap-4 sm:grid-cols-3">
          <Field label="Result" name="result" required error={errors.result}>
            {(props) => (
              <Select {...props} defaultValue={existing?.result ?? 'won'}>
                {Object.entries(RESULTS).map(([value, label]) => (
                  <option key={value} value={value}>
                    {label}
                  </option>
                ))}
              </Select>
            )}
          </Field>

          <Field label="Decided on" name="decidedAt" required error={errors.decidedAt}>
            {(props) => (
              <Input
                {...props}
                type="date"
                className="id"
                defaultValue={existing?.decidedAt ?? ''}
                invalid={Boolean(errors.decidedAt)}
              />
            )}
          </Field>

          <Field
            label="Amount recovered"
            name="amountRecovered"
            error={errors.amountRecoveredCents}
            hint="Zero for a loss or a withdrawal."
          >
            {(props) => (
              <Input
                {...props}
                className="id"
                inputMode="decimal"
                placeholder="0.00"
                defaultValue={
                  existing ? (existing.amountRecoveredCents / 100).toFixed(2) : ''
                }
                invalid={Boolean(errors.amountRecoveredCents)}
              />
            )}
          </Field>
        </div>

        <Field
          label="Remittance evidence"
          name="evidence"
          error={errors.evidence}
          hint="Optional but worth attaching: it is what an invoice is checked against."
        >
          {(props) => (
            <Input
              {...props}
              type="file"
              accept=".pdf,.txt,application/pdf,text/plain"
              className="py-1"
            />
          )}
        </Field>

        <Button type="submit" intent="primary" disabled={pending}>
          {pending ? 'Recording' : existing ? 'Update outcome' : 'Record outcome'}
        </Button>
      </form>
    </Panel>
  );
}
