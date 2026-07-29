'use client';

import { useActionState, useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import {
  createOrg,
  eraseOrg,
  setContingencyRate,
  setOrgStatus,
  type AdminState,
} from '../actions';
import { Button } from '@/components/ui/button';
import { Field, Input } from '@/components/ui/field';
import {
  ErrorState,
  Money,
  Notice,
  Panel,
  PanelHeader,
  Tag,
  Td,
} from '@/components/ui/primitives';

const INITIAL: AdminState = { status: 'idle' };

export function NewOrganizationForm() {
  const [state, action, pending] = useActionState(createOrg, INITIAL);
  const router = useRouter();
  const errors = state.status === 'error' ? state.fieldErrors : {};

  return (
    <Panel className="mt-4 max-w-3xl">
      <PanelHeader title="New organisation" />
      <form
        action={async (formData) => {
          await action(formData);
          router.refresh();
        }}
        className="grid gap-4 p-4 sm:grid-cols-3"
        noValidate
      >
        {state.status === 'error' ? (
          <div className="sm:col-span-3">
            <ErrorState title="Not created" body={state.message} />
          </div>
        ) : null}
        {state.status === 'ok' ? (
          <div className="sm:col-span-3">
            <Notice tone="recovered">{state.message}</Notice>
          </div>
        ) : null}

        <Field label="Name" name="name" required error={errors.name}>
          {(props) => <Input {...props} invalid={Boolean(errors.name)} />}
        </Field>
        <Field
          label="Slug"
          name="slug"
          required
          error={errors.slug}
          hint="Appears in invoice numbers."
        >
          {(props) => <Input {...props} className="id" invalid={Boolean(errors.slug)} />}
        </Field>
        <Field
          label="Contingency rate"
          name="contingencyRate"
          required
          error={errors.contingencyRateBps}
          hint="Percent, for example 15 or 12.5."
        >
          {(props) => (
            <Input
              {...props}
              className="id"
              defaultValue="15"
              inputMode="decimal"
              invalid={Boolean(errors.contingencyRateBps)}
            />
          )}
        </Field>

        <div className="sm:col-span-3">
          <Button type="submit" intent="primary" disabled={pending}>
            {pending ? 'Creating' : 'Create organisation'}
          </Button>
        </div>
      </form>
    </Panel>
  );
}

export function OrganizationRow({
  id,
  name,
  slug,
  status,
  members,
  ratePercent,
  rateLabel,
  feesCents,
}: {
  id: string;
  name: string;
  slug: string;
  status: string;
  members: number;
  ratePercent: number;
  rateLabel: string;
  feesCents: number;
}) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [editingRate, setEditingRate] = useState(false);
  const [rate, setRate] = useState(String(ratePercent));
  const [erasing, setErasing] = useState(false);
  const [confirmName, setConfirmName] = useState('');
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null);

  function run(fn: () => Promise<AdminState>) {
    start(async () => {
      const result = await fn();
      setMessage({
        ok: result.status === 'ok',
        text: result.status === 'idle' ? '' : result.message,
      });
      if (result.status === 'ok') router.refresh();
    });
  }

  return (
    <>
      <tr className="hover:bg-paper">
        <Td>{name}</Td>
        <Td>
          <span className="id">{slug}</span>
        </Td>
        <Td numeric>{members}</Td>
        <Td numeric>
          {editingRate ? (
            <span className="flex items-center justify-end gap-1">
              <Input
                className="id h-7 w-20 py-0 text-right text-xs"
                value={rate}
                inputMode="decimal"
                onChange={(e) => setRate(e.target.value)}
              />
              <Button
                size="sm"
                intent="primary"
                disabled={pending}
                onClick={() =>
                  run(async () => {
                    const result = await setContingencyRate(id, Number(rate));
                    if (result.status === 'ok') setEditingRate(false);
                    return result;
                  })
                }
              >
                Set
              </Button>
            </span>
          ) : (
            <button
              type="button"
              className="id text-action underline"
              onClick={() => setEditingRate(true)}
            >
              {rateLabel}
            </button>
          )}
        </Td>
        <Td numeric>
          <Money cents={feesCents} tone="recovered" />
        </Td>
        <Td>
          <Tag tone={status === 'active' ? 'recovered' : 'neutral'}>{status}</Tag>
        </Td>
        <Td>
          <span className="flex flex-wrap gap-2">
            <Button
              size="sm"
              disabled={pending}
              onClick={() =>
                run(() => setOrgStatus(id, status === 'active' ? 'inactive' : 'active'))
              }
            >
              {status === 'active' ? 'Deactivate' : 'Reactivate'}
            </Button>
            <Button size="sm" intent="danger" onClick={() => setErasing((v) => !v)}>
              Erase data
            </Button>
          </span>
        </Td>
      </tr>

      {erasing ? (
        <tr>
          <Td colSpan={7}>
            <div className="border border-denied/40 bg-denied-wash p-3">
              <p className="text-sm font-semibold text-denied">
                Erase everything belonging to {name}
              </p>
              <p className="mt-1 max-w-2xl text-xs text-ink">
                Every denial, document, draft, assertion, review, submission, and
                outcome, plus the stored files. Irreversible. A record of the
                deletion is kept with counts per table, so the erasure can be
                evidenced after the rows are gone.
              </p>
              <div className="mt-3 flex flex-wrap items-end gap-2">
                <label className="text-xs">
                  <span className="block text-ink-2">
                    Type {name} to confirm
                  </span>
                  <Input
                    className="mt-1 h-7 w-64 py-0 text-xs"
                    value={confirmName}
                    onChange={(e) => setConfirmName(e.target.value)}
                  />
                </label>
                <Button
                  size="sm"
                  intent="danger"
                  disabled={pending || confirmName !== name}
                  onClick={() =>
                    run(async () => {
                      const result = await eraseOrg(id, confirmName, 'Requested by customer');
                      if (result.status === 'ok') setErasing(false);
                      return result;
                    })
                  }
                >
                  {pending ? 'Erasing' : 'Erase permanently'}
                </Button>
                <Button size="sm" onClick={() => setErasing(false)}>
                  Cancel
                </Button>
              </div>
            </div>
          </Td>
        </tr>
      ) : null}

      {message?.text ? (
        <tr>
          <Td colSpan={7}>
            {message.ok ? (
              <Notice tone="recovered">{message.text}</Notice>
            ) : (
              <ErrorState title="Not done" body={message.text} />
            )}
          </Td>
        </tr>
      ) : null}
    </>
  );
}
