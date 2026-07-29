'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { generate, type GenerateResult } from './actions';
import { Button } from '@/components/ui/button';
import { ErrorState } from '@/components/ui/primitives';

export function GenerateButton({
  denialId,
  hasDraft,
  ready,
}: {
  denialId: string;
  hasDraft: boolean;
  ready: boolean;
}) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [result, setResult] = useState<GenerateResult | null>(null);

  return (
    <div className="relative">
      <Button
        size="sm"
        intent={hasDraft ? 'secondary' : 'primary'}
        disabled={pending || !ready}
        onClick={() =>
          start(async () => {
            setResult(null);
            const outcome = await generate(denialId);
            setResult(outcome);
            if (outcome.status === 'ok') router.refresh();
          })
        }
      >
        {pending
          ? 'Drafting and verifying'
          : hasDraft
            ? 'Regenerate'
            : 'Generate appeal'}
      </Button>

      {result?.status === 'error' ? (
        <div className="absolute right-0 top-9 z-10 w-96">
          <ErrorState title="Not drafted" body={result.message} />
          {result.detail && result.detail.length > 0 ? (
            <ul className="mt-1 border border-rule bg-paper-2 p-2 text-xs text-ink-2">
              {result.detail.map((line) => (
                <li key={line} className="id">
                  {line}
                </li>
              ))}
            </ul>
          ) : null}
        </div>
      ) : null}

      {result?.status === 'ok' ? (
        <p className="absolute right-0 top-9 z-10 w-72 border border-recovered/40 bg-recovered-wash px-3 py-2 text-xs text-ink">
          {result.assertionCount} assertions, all verified against their sources
          {result.attempts > 1 ? `, after ${result.attempts} attempts` : ''}.
          {result.gapCount > 0
            ? ` ${result.gapCount} documentation ${result.gapCount === 1 ? 'gap' : 'gaps'} surfaced.`
            : ''}
        </p>
      ) : null}
    </div>
  );
}
