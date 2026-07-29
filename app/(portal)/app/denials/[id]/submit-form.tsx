'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { markSubmitted } from './outcome-actions';
import { Button } from '@/components/ui/button';
import { Input, Select } from '@/components/ui/field';
import { ErrorState } from '@/components/ui/primitives';

const METHODS = ['Payer portal', 'Fax', 'Post', 'Email', 'Clearinghouse'];

/**
 * Marking an approved appeal as filed.
 *
 * We do not file on the hospital's behalf: they send it through whatever channel
 * this payer takes. What this records is when it went and how, so the deadline
 * stops counting and the outcome has something to hang off.
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
        Export it, send it through whichever channel this payer takes, then record
        it here so the deadline stops counting.
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
