/**
 * The ladder, and where this claim is on it.
 *
 * The thing this replaces is a single status word, which could not tell apart
 * "nothing filed", "filed and waiting", and "lost below, sixty days to reach an
 * ALJ". Only the last of those is worth money and it was the one the old view
 * rendered identically to giving up.
 *
 * Levels nobody has reached are drawn rather than hidden. A specialist deciding
 * whether a lost redetermination is the end of a claim needs to see the four
 * forums above it; a list that stops at the current rung answers that question
 * wrongly by omission.
 */
import { PanelHeader, Tag } from '@/components/ui/primitives';
import type { AppealRung, FilingStatus } from '@/lib/filing/status';

const DAY = 24 * 60 * 60 * 1000;

function day(value: Date): string {
  return value.toISOString().slice(0, 10);
}

function minute(value: Date): string {
  return value.toISOString().slice(0, 16).replace('T', ' ');
}

function daysUntil(due: Date): number {
  return Math.ceil((due.getTime() - Date.now()) / DAY);
}

const RESULT_TONE = {
  won: 'recovered',
  partial: 'recovered',
  lost: 'denied',
  withdrawn: 'neutral',
} as const;

const SUBMISSION_TONE = {
  prepared: 'neutral',
  sending: 'neutral',
  sent: 'action',
  acknowledged: 'recovered',
  rejected: 'denied',
  failed: 'denied',
} as const;

export function AppealProgress({ status }: { status: FilingStatus }) {
  if (status.unmodelled) {
    return (
      <section>
        <PanelHeader title="Appeal progress" />
        <p className="px-3 py-2 text-xs">{status.unmodelled}</p>
      </section>
    );
  }

  return (
    <section>
      <PanelHeader title="Appeal progress">
        <span className="text-2xs uppercase tracking-wider text-ink-2">
          {status.ladder === 'medicare_advantage' ? 'Medicare Advantage' : 'Traditional Medicare'}
        </span>
      </PanelHeader>
      <ol className="divide-y divide-rule">
        {status.rungs.map((rung) => (
          <Rung key={rung.ordinal} rung={rung} />
        ))}
      </ol>
    </section>
  );
}

function Rung({ rung }: { rung: AppealRung }) {
  const reached = rung.state !== 'not_reached';
  const left = rung.dueBy && !rung.filedAt ? daysUntil(rung.dueBy) : null;

  return (
    <li className={`px-3 py-2 ${reached ? '' : 'opacity-60'}`}>
      <div className="flex items-baseline justify-between gap-2">
        <p className="text-sm font-medium">
          <span className="id mr-1.5 text-xs text-ink-2">{rung.ordinal}</span>
          {rung.label}
        </p>
        {rung.result ? (
          <Tag tone={RESULT_TONE[rung.result]}>{rung.result}</Tag>
        ) : rung.state === 'filed' ? (
          <Tag tone="action">Filed</Tag>
        ) : rung.state === 'open' ? (
          <Tag tone="neutral">Open</Tag>
        ) : null}
      </div>

      <p className="text-xs text-ink-2">{rung.decidedBy}</p>

      {rung.filedAt ? (
        <p className="mt-0.5 text-xs">
          Filed <span className="id">{day(rung.filedAt)}</span>
        </p>
      ) : rung.dueBy ? (
        <p className={`mt-0.5 text-xs ${left !== null && left <= 7 ? 'font-medium text-denied' : ''}`}>
          Due <span className="id">{day(rung.dueBy)}</span>
          {left !== null
            ? left < 0
              ? `, ${Math.abs(left)} days ago`
              : left === 0
                ? ', today'
                : `, in ${left} days`
            : null}
        </p>
      ) : null}

      {rung.state === 'open' && !rung.dueBy && rung.ordinal > 1 ? (
        // A level opens when the one below it is decided, and the clock runs
        // from that notice rather than from the denial. Until the notice date
        // is recorded there is no honest date to show, so none is shown.
        <p className="mt-0.5 text-xs text-ink-2">
          Deadline runs from the notice below, which has not been recorded yet.
        </p>
      ) : null}

      {rung.amountInControversy && reached ? (
        <p className="mt-0.5 text-xs text-ink-2">
          Requires a minimum amount in controversy, which CMS adjusts each year.
        </p>
      ) : null}

      {rung.submissions.map((s) => (
        <div key={s.id} className="mt-1.5 border-l-2 border-rule pl-2">
          <p className="flex items-baseline gap-2 text-xs">
            <span className="font-medium">{s.channelLabel}</span>
            <Tag tone={SUBMISSION_TONE[s.status]}>{s.status}</Tag>
            {s.submittedAt ? <span className="id text-ink-2">{minute(s.submittedAt)}</span> : null}
          </p>
          {s.trackingRef ? (
            <p className="text-xs text-ink-2">
              Reference <span className="id">{s.trackingRef}</span>
            </p>
          ) : null}
          {s.failureReason ? (
            <p className="text-xs font-medium text-denied">{s.failureReason}</p>
          ) : null}
          {s.events.length > 0 ? (
            <ul className="mt-0.5">
              {s.events.map((e, i) => (
                <li key={i} className="text-xs text-ink-2">
                  <span className="id">{minute(e.at)}</span> {e.kind}, {e.detail}
                </li>
              ))}
            </ul>
          ) : null}
        </div>
      ))}

      <p className="mt-1 text-2xs text-ink-2">{rung.authority}</p>
    </li>
  );
}
