'use client';

/**
 * The press that sends the appeal.
 *
 * The whole of this component exists to make the fiftieth filing of the week
 * cost one click and the first one cost a question asked once. Those pull in
 * opposite directions, and the resolution is that the question is asked on the
 * first filing, the answer is offered for saving, and every filing after it is
 * a single press of a button that already says where it is going.
 *
 * Two rules it keeps that are easy to get wrong:
 *
 * The destination is on the button before the press, never after it. A control
 * that reads "File appeal" and silently sends to an address the specialist
 * cannot see is a control that files to a stale fax number for a year before
 * anybody notices, and every one of those filings is a missed deadline that
 * looked fine on screen.
 *
 * A channel that is not set up is shown, disabled, with the reason. Hiding it
 * would make this look like a product that only ever supported one way of
 * filing, and would leave a hospital no way to ask for the one they need.
 */

import { useState, useTransition } from 'react';
import { Button } from '@/components/ui/button';
import { fileNow, type FilingOption, type FilingPromptState } from './filing-actions';
import type { SubmissionChannel } from '@/lib/filing/types';

export function FileAppealButton({
  denialId,
  draftId,
  enabled,
  initial,
}: {
  denialId: string;
  draftId: string;
  /** Both reviews approved. The server checks this again; this is the courtesy. */
  enabled: boolean;
  initial: FilingPromptState;
}) {
  const [pending, start] = useTransition();
  const [open, setOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<string | null>(null);

  const ready = initial.status === 'ready' ? initial : null;
  const options = initial.status === 'error' ? [] : initial.options;

  // What the panel starts on: the saved channel, else the best available one,
  // and otherwise nothing.
  //
  // Selecting an unusable channel to have something selected was the first
  // version, and it produced a panel where the destination field was disabled,
  // the file button was disabled, and nothing said why. Nothing selected, with
  // the reason stated once at the top, is the honest version of that screen.
  const suggested = ready?.channel ?? options.find((o) => o.available)?.key ?? null;
  const noneAvailable = options.length > 0 && !options.some((o) => o.available);

  const [channel, setChannel] = useState<SubmissionChannel | null>(suggested);
  const chosen = options.find((o) => o.key === channel) ?? null;

  const [destination, setDestination] = useState(
    ready?.destination ?? chosen?.destination ?? '',
  );
  const [touchedDestination, setTouchedDestination] = useState(false);
  const [remember, setRemember] = useState(initial.status === 'choose');

  function pick(option: FilingOption) {
    setChannel(option.key);
    setError(null);
    // Only overwrite what they typed if they have not typed anything. Switching
    // channel should fill the field in, not throw away an address in progress.
    if (!touchedDestination) setDestination(option.destination ?? '');
  }

  function submit(useChannel: SubmissionChannel, useDestination: string) {
    start(async () => {
      setError(null);
      const result = await fileNow({
        denialId,
        draftId,
        channel: useChannel,
        destination: useDestination,
        remember,
      });

      if (result.status === 'error') {
        setError(result.message);
        setOpen(true);
        return;
      }

      setDone(result.message);
      setOpen(false);
    });
  }

  if (initial.status === 'error') {
    return <span className="text-xs text-ink-2">{initial.message}</span>;
  }

  if (done) {
    return (
      <span className="text-xs font-medium text-recovered" role="status">
        {done}
      </span>
    );
  }

  // The one press path. A saved channel and a known destination, both named on
  // the control, so the press is informed without being asked twice.
  const oneClick = ready !== null && ready.destination !== null;

  return (
    <div className="relative flex items-center gap-2">
      <Button
        intent="primary"
        size="sm"
        disabled={!enabled || pending}
        aria-expanded={open}
        onClick={() => {
          if (pending) return;
          if (oneClick && !open) {
            submit(ready.channel, ready.destination!);
            return;
          }
          setOpen((v) => !v);
        }}
      >
        {pending ? 'Filing' : ready ? `File appeal by ${ready.label.toLowerCase()}` : 'File appeal'}
      </Button>

      {oneClick && !open ? (
        <span className="text-xs text-ink-2">
          to <span className="id">{ready.destination}</span>
          <button
            type="button"
            className="ml-2 underline"
            onClick={() => setOpen(true)}
          >
            change
          </button>
        </span>
      ) : null}

      {!enabled ? (
        <span className="text-xs text-ink-2">Both reviews must approve first</span>
      ) : null}

      {open ? (
        <div className="absolute right-0 top-9 z-20 w-[26rem] border border-rule-strong bg-paper-2 shadow-sm">
          <div className="border-b border-rule bg-paper px-3 py-2">
            <h3 className="text-xs font-semibold uppercase tracking-wider">How to file</h3>
            <p className="mt-1 text-xs text-ink-2">
              Ordered by what you can prove afterwards, which is what decides a dispute
              about whether a filing was timely.
            </p>
          </div>

          {noneAvailable ? (
            <p className="border-b border-rule bg-denied-wash px-3 py-2 text-xs">
              No filing channel is set up on this deployment yet, so this appeal cannot be
              sent from here. Export it and file it the way this payer takes, then record it
              below so the deadline stops counting. Each channel says what it needs.
            </p>
          ) : null}

          {initial.status === 'choose' && initial.lapsed ? (
            <p className="border-b border-rule bg-denied-wash px-3 py-2 text-xs">
              {initial.lapsed.label} was your usual channel and can no longer be used, so
              this is asking again rather than filing another way. {initial.lapsed.reason}
            </p>
          ) : null}

          <fieldset className="max-h-[22rem] divide-y divide-rule overflow-y-auto">
            <legend className="sr-only">Filing channel</legend>
            {options.map((option) => (
              <label
                key={option.key}
                className={`flex gap-2 px-3 py-2 ${
                  option.available ? 'cursor-pointer hover:bg-paper' : 'cursor-not-allowed'
                }`}
              >
                <input
                  type="radio"
                  name="channel"
                  className="mt-1"
                  checked={channel === option.key}
                  disabled={!option.available}
                  onChange={() => pick(option)}
                />
                <span className="min-w-0">
                  <span className="block text-sm font-medium">
                    {option.label}
                    {option.destination ? (
                      <span className="ml-2 text-xs font-normal text-ink-2">
                        last used <span className="id">{option.destination}</span>
                      </span>
                    ) : null}
                  </span>
                  <span className="block text-xs text-ink-2">{option.summary}</span>
                  <span className="block text-xs">
                    {option.available ? (
                      <span className="text-ink-2">{option.evidence}</span>
                    ) : (
                      <span className="font-medium">Not set up. {option.reason}</span>
                    )}
                  </span>
                </span>
              </label>
            ))}
          </fieldset>

          <div className="border-t border-rule px-3 py-2">
            <label className="block text-xs font-medium" htmlFor="filing-destination">
              {chosen ? `Where ${chosen.label.toLowerCase()} goes for this payer` : 'Destination'}
            </label>
            <input
              id="filing-destination"
              className="mt-1 w-full border border-rule-strong bg-paper px-2 py-1 text-sm"
              value={destination}
              disabled={!chosen?.available}
              placeholder={chosen?.key === 'email' ? 'appeals@payer.example' : ''}
              onChange={(e) => {
                setTouchedDestination(true);
                setDestination(e.target.value);
              }}
            />
            <p className="mt-1 text-xs text-ink-2">
              Saved against this payer, so nobody types it twice.
            </p>

            <label className="mt-2 flex items-start gap-2 text-xs">
              <input
                type="checkbox"
                className="mt-0.5"
                checked={remember}
                onChange={(e) => setRemember(e.target.checked)}
              />
              <span>
                File this way from now on, without asking. Changeable under Settings.
              </span>
            </label>
          </div>

          {error ? (
            <p className="border-t border-denied/40 bg-denied-wash px-3 py-2 text-xs" role="alert">
              {error}
            </p>
          ) : null}

          <div className="flex items-center justify-end gap-2 border-t border-rule bg-paper px-3 py-2">
            <Button size="sm" onClick={() => setOpen(false)} disabled={pending}>
              Cancel
            </Button>
            <Button
              intent="primary"
              size="sm"
              disabled={pending || !chosen?.available || destination.trim().length === 0}
              onClick={() => chosen && submit(chosen.key, destination)}
            >
              {pending ? 'Filing' : 'File appeal'}
            </Button>
          </div>
        </div>
      ) : null}
    </div>
  );
}
