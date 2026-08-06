'use client';

/**
 * The setting behind the one click filing button.
 *
 * Channels that cannot be used are listed with the reason and cannot be
 * selected. Letting one be saved would make every filing take two clicks again
 * while the settings page insisted it was configured, which is the most
 * annoying possible outcome and the hardest to work out from the outside.
 */
import { useState, useTransition } from 'react';
import { Button } from '@/components/ui/button';
import { saveDefaultChannel } from './actions';
import type { SubmissionChannel } from '@/lib/filing/types';

export interface ChannelChoice {
  key: SubmissionChannel;
  label: string;
  summary: string;
  evidence: string;
  available: boolean;
  reason: string | null;
}

export function FilingChannelForm({
  organizationId,
  choices,
  current,
}: {
  organizationId: string;
  choices: ChannelChoice[];
  current: SubmissionChannel | null;
}) {
  const [pending, start] = useTransition();
  const [selected, setSelected] = useState<SubmissionChannel | null>(current);
  const [message, setMessage] = useState<{ tone: 'ok' | 'error'; text: string } | null>(null);

  function save() {
    start(async () => {
      const result = await saveDefaultChannel(organizationId, selected);
      setMessage(
        result.status === 'ok'
          ? { tone: 'ok', text: result.message }
          : { tone: 'error', text: result.message },
      );
    });
  }

  return (
    <div>
      <fieldset className="divide-y divide-rule">
        <legend className="sr-only">How appeals are filed</legend>

        <label className="flex cursor-pointer gap-2 px-3 py-2 hover:bg-paper">
          <input
            type="radio"
            name="default-channel"
            className="mt-1"
            checked={selected === null}
            onChange={() => setSelected(null)}
          />
          <span>
            <span className="block text-sm font-medium">Ask every time</span>
            <span className="block text-xs text-ink-2">
              The filing panel offers the channels and nothing is remembered.
            </span>
          </span>
        </label>

        {choices.map((choice) => (
          <label
            key={choice.key}
            className={`flex gap-2 px-3 py-2 ${
              choice.available ? 'cursor-pointer hover:bg-paper' : 'cursor-not-allowed opacity-70'
            }`}
          >
            <input
              type="radio"
              name="default-channel"
              className="mt-1"
              checked={selected === choice.key}
              disabled={!choice.available}
              onChange={() => setSelected(choice.key)}
            />
            <span>
              <span className="block text-sm font-medium">{choice.label}</span>
              <span className="block text-xs text-ink-2">{choice.summary}</span>
              <span className="block text-xs">
                {choice.available ? (
                  <span className="text-ink-2">{choice.evidence}</span>
                ) : (
                  <span className="font-medium">Not set up. {choice.reason}</span>
                )}
              </span>
            </span>
          </label>
        ))}
      </fieldset>

      <div className="flex items-center gap-3 border-t border-rule px-3 py-2">
        <Button intent="primary" size="sm" disabled={pending} onClick={save}>
          {pending ? 'Saving' : 'Save'}
        </Button>
        {message ? (
          <span
            role="status"
            className={`text-xs ${message.tone === 'ok' ? 'text-recovered' : 'font-medium text-denied'}`}
          >
            {message.text}
          </span>
        ) : null}
      </div>
    </div>
  );
}
