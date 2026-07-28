'use client';

import { useActionState } from 'react';
import { createDenial, type NewDenialState } from './actions';
import { Button } from '@/components/ui/button';
import { Field, Input, Select } from '@/components/ui/field';
import { ErrorState, Panel, PanelHeader } from '@/components/ui/primitives';
import {
  acceptedTypeList,
  PLAN_TYPE_LABELS,
  SERVICE_TYPE_LABELS,
} from '@/lib/denials/upload';

const INITIAL: NewDenialState = { status: 'idle' };

export function NewDenialForm({
  organizationId,
  organizationName,
  syntheticRequired,
}: {
  organizationId: string;
  organizationName: string;
  syntheticRequired: boolean;
}) {
  const [state, action, pending] = useActionState(createDenial, INITIAL);
  const errors = state.status === 'error' ? state.fieldErrors : {};

  return (
    <form action={action} className="mt-6 space-y-6" noValidate>
      <input type="hidden" name="organizationId" value={organizationId} />

      {state.status === 'error' ? (
        <ErrorState title="Not created yet" body={state.message} />
      ) : null}

      <Panel>
        <PanelHeader title="Documents" />
        <div className="space-y-5 p-4">
          <Field
            label="Denial letter"
            name="denialLetter"
            required
            error={errors.denialLetter}
            hint={`Accepted: ${acceptedTypeList()}. A scan needs to go through OCR first, because a citation has to point at text we can quote.`}
          >
            {(props) => (
              <Input
                {...props}
                type="file"
                accept=".pdf,.txt,application/pdf,text/plain"
                className="py-1"
                invalid={Boolean(errors.denialLetter)}
              />
            )}
          </Field>

          <Field
            label="Clinical record"
            name="clinicalRecord"
            error={errors.clinicalRecord}
            hint="Optional, but without it every coverage criterion comes back as a documentation gap."
          >
            {(props) => (
              <Input
                {...props}
                type="file"
                accept=".pdf,.txt,application/pdf,text/plain"
                className="py-1"
                invalid={Boolean(errors.clinicalRecord)}
              />
            )}
          </Field>

          {syntheticRequired ? (
            <div className="border border-denied/40 bg-denied-wash p-3">
              <label className="flex items-start gap-2.5 text-sm">
                <input
                  type="checkbox"
                  name="isSynthetic"
                  className="mt-0.5"
                  required
                  aria-describedby="synthetic-help"
                />
                <span>
                  <span className="font-medium text-denied">
                    These documents are fabricated.
                  </span>{' '}
                  They contain no real patient information.
                </span>
              </label>
              <p id="synthetic-help" className="mt-2 pl-6 text-xs text-ink">
                This environment is not approved for patient data. Uploads without
                this confirmation are rejected before anything is stored.
              </p>
              {errors.isSynthetic ? (
                <p className="mt-2 pl-6 text-xs font-medium text-denied">
                  {errors.isSynthetic}
                </p>
              ) : null}
            </div>
          ) : null}
        </div>
      </Panel>

      <Panel>
        <PanelHeader title={`Claim details, ${organizationName}`} />
        <div className="grid gap-5 p-4 sm:grid-cols-2">
          <Field
            label="Your reference"
            name="internalRef"
            required
            error={errors.internalRef}
            hint="However you track this case internally."
          >
            {(props) => (
              <Input {...props} className="id" invalid={Boolean(errors.internalRef)} />
            )}
          </Field>

          <Field label="Payer" name="payerName" required error={errors.payerName}>
            {(props) => <Input {...props} invalid={Boolean(errors.payerName)} />}
          </Field>

          <Field label="Plan type" name="planType" required error={errors.planType}>
            {(props) => (
              <Select {...props} defaultValue="medicare_advantage">
                {Object.entries(PLAN_TYPE_LABELS).map(([value, label]) => (
                  <option key={value} value={value}>
                    {label}
                  </option>
                ))}
              </Select>
            )}
          </Field>

          <Field label="Service" name="serviceType" required error={errors.serviceType}>
            {(props) => (
              <Select {...props} defaultValue="skilled_nursing">
                {Object.entries(SERVICE_TYPE_LABELS).map(([value, label]) => (
                  <option key={value} value={value}>
                    {label}
                  </option>
                ))}
              </Select>
            )}
          </Field>

          <Field
            label="Amount denied"
            name="claimAmount"
            required
            error={errors.claimAmountCents}
            hint="Dollars and cents, for example 18420.00"
          >
            {(props) => (
              <Input
                {...props}
                className="id"
                inputMode="decimal"
                placeholder="0.00"
                invalid={Boolean(errors.claimAmountCents)}
              />
            )}
          </Field>

          <Field
            label="Denial reason code"
            name="denialReasonCode"
            error={errors.denialReasonCode}
            hint="Optional. The code on the remittance, if there is one."
          >
            {(props) => <Input {...props} className="id" />}
          </Field>

          <Field
            label="Service from"
            name="serviceDateFrom"
            error={errors.serviceDateFrom}
          >
            {(props) => <Input {...props} type="date" className="id" />}
          </Field>

          <Field label="Service to" name="serviceDateTo" error={errors.serviceDateTo}>
            {(props) => (
              <Input
                {...props}
                type="date"
                className="id"
                invalid={Boolean(errors.serviceDateTo)}
              />
            )}
          </Field>

          <Field
            label="Appeal deadline"
            name="appealDeadline"
            error={errors.appealDeadline}
            hint="Shown everywhere this case appears, and in red inside seven days."
          >
            {(props) => <Input {...props} type="date" className="id" />}
          </Field>
        </div>
      </Panel>

      <div className="flex items-center gap-3">
        <Button type="submit" intent="primary" disabled={pending}>
          {pending ? 'Creating and parsing' : 'Create denial'}
        </Button>
        <p className="text-xs text-ink-2">
          Parsing runs immediately. Large documents take a few seconds.
        </p>
      </div>
    </form>
  );
}
