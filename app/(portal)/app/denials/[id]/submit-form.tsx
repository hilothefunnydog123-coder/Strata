'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { markSubmitted } from './outcome-actions';
import { Button } from '@/components/ui/button';
import { Input, Select } from '@/components/ui/field';
import { ErrorState } from '@/components/ui/primitives';

const METHODS = ['Payer portal', 'Fax', 'Post', 'Email', 'Clearinghouse'];

/**
 * Recording an appeal that was filed outside this product.
 *
 * This used to be the only way an appeal got filed: export a PDF, send it by
 * hand, come back and say you had. File appeal does that now, and a filing made
 * through it records itself.
 *
 * This stays for the appeals that go another way, and there will always be
 * some: a plan that only takes its own portal, a channel this deployment has
 * not been given an account for, a specialist standing at a fax machine. An
 * appeal that went out and cannot be recorded is an appeal the system believes
 * is still sitting there, and it would count the deadline down to nothing.
 */
export function SubmitForm({ denialId }: { denialId: string }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [method, setMethod] = useState(METHODS[0]!);
  const [trackingRef, setTrackingRef] = useState('');
  const [error, setError] = useState<string | null>(null);

  return (
    <div className="border-b border-rule bg-recovered-wash px-4 py-3">
      <p className="text-sm font-semibold text-recovered">
        Approved by both reviews, ready to file
      </p>
      <p className="mt-1 text-xs text-ink">
        Press File appeal to send it. If it went out another way, record it here so the
        deadline stops counting.
      </p>

      {error ? (
        <div className="mt-2 max-w-lg">
          <ErrorState title="Not recorded" body={error} />
        </div>
      ) : null}

      <div className="mt-3 flex flex-wrap items-end gap-2">
        <label className="text-xs">
          <span className="block text-ink-2">How it went</span>
          <Select
            className="mt-1 h-7 py-0 text-xs"
            value={method}
            onChange={(e) => setMethod(e.target.value)}
          >
            {METHODS.map((m) => (
              <option key={m} value={m}>
                {m}
              </option>
            ))}
          </Select>
        </label>

        <label className="text-xs">
          <span className="block text-ink-2">Tracking reference, if any</span>
          <Input
            className="id mt-1 h-7 w-56 py-0 text-xs"
            value={trackingRef}
            onChange={(e) => setTrackingRef(e.target.value)}
          />
        </label>

        <Button
          size="sm"
          intent="primary"
          disabled={pending}
          onClick={() =>
            start(async () => {
              setError(null);
              const result = await markSubmitted(denialId, method, trackingRef);
              if (result.status === 'error') {
                setError(result.message);
                return;
              }
              router.refresh();
            })
          }
        >
          {pending ? 'Recording' : 'Mark as filed'}
        </Button>
      </div>
    </div>
  );
}
