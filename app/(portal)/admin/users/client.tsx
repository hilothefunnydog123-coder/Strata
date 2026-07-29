'use client';

import { useActionState, useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { provision, resetPassword, setUserStatus, type AdminState } from '../actions';
import { Button } from '@/components/ui/button';
import { Field, Input, Select } from '@/components/ui/field';
import {
  ErrorState,
  Notice,
  Panel,
  PanelHeader,
  Tag,
  Td,
} from '@/components/ui/primitives';

const INITIAL: AdminState = { status: 'idle' };

const PLATFORM_ROLE_LABELS: Record<string, string> = {
  none: 'Customer staff',
  superadmin: 'Operator',
  clinical_reviewer: 'Clinical reviewer',
  legal_reviewer: 'Legal reviewer',
};

const ORG_ROLE_LABELS: Record<string, string> = {
  org_admin: 'Organisation admin',
  appeal_specialist: 'Appeal specialist',
  readonly: 'Read only',
};

export function ProvisionForm({
  organizations,
}: {
  organizations: { id: string; name: string }[];
}) {
  const router = useRouter();
  const [state, action, pending] = useActionState(provision, INITIAL);
  const [platformRole, setPlatformRole] = useState('none');
  const errors = state.status === 'error' ? state.fieldErrors : {};

  const isReviewer =
    platformRole === 'clinical_reviewer' || platformRole === 'legal_reviewer';

  return (
    <Panel className="mt-4 max-w-4xl">
      <PanelHeader title="Provision an account" />
      <form
        action={async (formData) => {
          await action(formData);
          router.refresh();
        }}
        className="space-y-4 p-4"
        noValidate
      >
        {state.status === 'error' ? (
          <ErrorState title="Not created" body={state.message} />
        ) : null}
        {state.status === 'ok' ? (
          <div>
            <Notice tone="recovered">{state.message}</Notice>
            {state.secret ? (
              <p className="id mt-2 select-all border border-rule bg-paper px-3 py-2 text-sm">
                {state.secret}
              </p>
            ) : null}
          </div>
        ) : null}

        <div className="grid gap-4 sm:grid-cols-3">
          <Field label="Work email" name="email" required error={errors.email}>
            {(props) => (
              <Input {...props} type="email" invalid={Boolean(errors.email)} />
            )}
          </Field>
          <Field label="Name" name="name" required error={errors.name}>
            {(props) => <Input {...props} invalid={Boolean(errors.name)} />}
          </Field>
          <Field label="Kind of account" name="platformRole" required>
            {(props) => (
              <Select
                {...props}
                value={platformRole}
                onChange={(e) => setPlatformRole(e.target.value)}
              >
                {Object.entries(PLATFORM_ROLE_LABELS).map(([value, label]) => (
                  <option key={value} value={value}>
                    {label}
                  </option>
                ))}
              </Select>
            )}
          </Field>
        </div>

        {platformRole === 'none' ? (
          <div className="grid gap-4 sm:grid-cols-2">
            <Field
              label="Organisation"
              name="organizationId"
              required
              error={errors.organizationId}
            >
              {(props) => (
                <Select {...props} defaultValue="">
                  <option value="" disabled>
                    Choose one
                  </option>
                  {organizations.map((o) => (
                    <option key={o.id} value={o.id}>
                      {o.name}
                    </option>
                  ))}
                </Select>
              )}
            </Field>
            <Field label="Role there" name="orgRole" required error={errors.orgRole}>
              {(props) => (
                <Select {...props} defaultValue="appeal_specialist">
                  {Object.entries(ORG_ROLE_LABELS).map(([value, label]) => (
                    <option key={value} value={value}>
                      {label}
                    </option>
                  ))}
                </Select>
              )}
            </Field>
          </div>
        ) : null}

        {isReviewer ? (
          <fieldset>
            <legend className="text-sm font-medium">Assigned organisations</legend>
            <p className="mt-0.5 text-xs text-ink-2">
              Reviewers see only the queues of the hospitals they are assigned to.
              An unassigned reviewer sees nothing, which is the safe default.
            </p>
            <div className="mt-2 grid gap-1.5 sm:grid-cols-3">
              {organizations.map((o) => (
                <label key={o.id} className="flex items-center gap-2 text-sm">
                  <input type="checkbox" name="reviewerOrgIds" value={o.id} />
                  {o.name}
                </label>
              ))}
              {organizations.length === 0 ? (
                <p className="text-xs text-ink-2">
                  No active organisations to assign yet.
                </p>
              ) : null}
            </div>
          </fieldset>
        ) : null}

        <Button type="submit" intent="primary" disabled={pending}>
          {pending ? 'Provisioning' : 'Provision account'}
        </Button>
      </form>
    </Panel>
  );
}

export function UserRow({
  id,
  email,
  name,
  status,
  platformRole,
  twoFactorEnabled,
  mustChangePassword,
  memberships,
  reviewerOrgs,
  isSelf,
}: {
  id: string;
  email: string;
  name: string;
  status: string;
  platformRole: string;
  twoFactorEnabled: boolean;
  mustChangePassword: boolean;
  memberships: string;
  reviewerOrgs: string;
  isSelf: boolean;
}) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [result, setResult] = useState<AdminState | null>(null);

  function run(fn: () => Promise<AdminState>) {
    start(async () => {
      const outcome = await fn();
      setResult(outcome);
      if (outcome.status === 'ok') router.refresh();
    });
  }

  return (
    <>
      <tr className="hover:bg-paper">
        <Td>
          <span className="id text-xs">{email}</span>
          {isSelf ? <span className="ml-1.5 text-2xs text-ink-2">you</span> : null}
        </Td>
        <Td>{name}</Td>
        <Td>{PLATFORM_ROLE_LABELS[platformRole] ?? platformRole}</Td>
        <Td className="max-w-xs text-xs">
          {memberships || reviewerOrgs || <span className="text-ink-2">none</span>}
          {reviewerOrgs ? (
            <span className="block text-2xs text-ink-2">assigned as reviewer</span>
          ) : null}
        </Td>
        <Td>
          {twoFactorEnabled ? (
            <Tag tone="recovered">on</Tag>
          ) : (
            <Tag tone="neutral">not yet</Tag>
          )}
        </Td>
        <Td>
          <Tag tone={status === 'active' ? 'recovered' : 'denied'}>{status}</Tag>
          {mustChangePassword ? (
            <span className="ml-1.5 text-2xs text-ink-2">password pending</span>
          ) : null}
        </Td>
        <Td>
          <span className="flex flex-wrap gap-2">
            <Button size="sm" disabled={pending} onClick={() => run(() => resetPassword(id))}>
              Reset password
            </Button>
            <Button
              size="sm"
              intent={status === 'active' ? 'danger' : 'secondary'}
              disabled={pending || (isSelf && status === 'active')}
              onClick={() =>
                run(() => setUserStatus(id, status === 'active' ? 'disabled' : 'active'))
              }
            >
              {status === 'active' ? 'Deactivate' : 'Reactivate'}
            </Button>
          </span>
        </Td>
      </tr>

      {result && result.status !== 'idle' ? (
        <tr>
          <Td colSpan={7}>
            {result.status === 'ok' ? (
              <div>
                <Notice tone="recovered">{result.message}</Notice>
                {result.secret ? (
                  <p className="id mt-2 select-all border border-rule bg-paper px-3 py-2 text-sm">
                    {result.secret}
                  </p>
                ) : null}
              </div>
            ) : (
              <ErrorState title="Not done" body={result.message} />
            )}
          </Td>
        </tr>
      ) : null}
    </>
  );
}
