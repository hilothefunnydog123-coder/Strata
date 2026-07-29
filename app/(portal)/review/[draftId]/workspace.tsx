'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import type { DetailAssertion, ResolvedSource } from '@/lib/denials/detail';
import { decideDraft, editAssertion, markAssertion } from '../actions';
import { LetterView } from '@/components/appeal/letter-view';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/field';
import { ErrorState, Notice } from '@/components/ui/primitives';

type Mark = { verified: boolean; notes: string | null };

/**
 * The review workspace.
 *
 * The letter with a per-assertion checklist down the left of it, and the source
 * panel on the right showing the passage behind whichever assertion is
 * selected. A reviewer works down the list, and each mark is saved as it is
 * made rather than at the end, because a reviewer interrupted halfway through a
 * twenty assertion letter should not lose their work.
 */
export function ReviewWorkspace({
  draftId,
  reviewType,
  assertions,
  sources,
  gaps,
  proprietaryFlag,
  version,
  initialMarks,
}: {
  draftId: string;
  reviewType: 'clinical' | 'legal';
  assertions: DetailAssertion[];
  sources: Record<string, ResolvedSource>;
  gaps: { criterion: string; why: string }[];
  proprietaryFlag: boolean;
  version: number;
  initialMarks: Record<string, Mark>;
}) {
  const router = useRouter();
  const [marks, setMarks] = useState<Record<string, Mark>>(initialMarks);
  const [notes, setNotes] = useState('');
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null);
  const [pending, start] = useTransition();
  const [editing, setEditing] = useState<string | null>(null);

  const verifiedCount = Object.values(marks).filter((m) => m.verified).length;
  const flagged = assertions.filter((a) => marks[a.id]?.verified === false);

  function mark(assertionId: string, verified: boolean) {
    // Optimistic, because a checklist that lags is a checklist nobody uses.
    setMarks((prev) => ({ ...prev, [assertionId]: { verified, notes: null } }));
    start(async () => {
      const result = await markAssertion(assertionId, verified);
      if (result.status === 'error') {
        setMarks((prev) => {
          const next = { ...prev };
          delete next[assertionId];
          return next;
        });
        setMessage({ ok: false, text: result.message });
      }
    });
  }

  function decide(decision: 'approved' | 'rejected') {
    start(async () => {
      setMessage(null);
      const result = await decideDraft(draftId, decision, notes);
      if (result.status === 'error') {
        setMessage({ ok: false, text: result.message });
        return;
      }
      setMessage({ ok: true, text: result.message });
      router.push('/review');
      router.refresh();
    });
  }

  return (
    <div>
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-rule px-3 py-2 text-xs">
        <span className="text-ink-2">
          {verifiedCount} of {assertions.length} checked
          {flagged.length > 0 ? (
            <span className="ml-2 font-medium text-denied">
              {flagged.length} flagged
            </span>
          ) : null}
        </span>
        <span className="text-ink-2">
          Tick each assertion once you have read it against its source. You do not
          have to tick them all to approve, but a flag is a reason to send it back.
        </span>
      </div>

      <LetterView
        assertions={assertions}
        sources={sources}
        gaps={gaps}
        proprietaryFlag={proprietaryFlag}
        version={version}
        renderChecklist={(a) => (
          <ChecklistControl
            assertion={a}
            mark={marks[a.id]}
            editing={editing === a.id}
            onMark={mark}
            onStartEdit={() => setEditing(a.id)}
            onCancelEdit={() => setEditing(null)}
            onSaveEdit={(text, quote) =>
              start(async () => {
                const result = await editAssertion(a.id, text, quote);
                setMessage({ ok: result.status === 'ok', text: result.message });
                if (result.status === 'ok') {
                  setEditing(null);
                  router.refresh();
                }
              })
            }
          />
        )}
      />

      <div className="border-t border-rule bg-paper-2 p-4">
        {message ? (
          message.ok ? (
            <div className="mb-3">
              <Notice tone="recovered">{message.text}</Notice>
            </div>
          ) : (
            <div className="mb-3">
              <ErrorState title="Not recorded" body={message.text} />
            </div>
          )
        ) : null}

        <label className="block text-sm font-medium" htmlFor="review-notes">
          Notes
        </label>
        <p className="mt-0.5 text-xs text-ink-2">
          Required when sending back. The specialist sees exactly this, and it is
          what shapes the next draft.
        </p>
        <Textarea
          id="review-notes"
          rows={3}
          className="mt-2 max-w-3xl"
          value={notes}
          onChange={(e) => setNotes(e.target.value)}
          placeholder={
            reviewType === 'legal'
              ? 'For example: assertion 7 cites DAB No. 3145 for a proposition that decision does not reach.'
              : 'For example: assertion 4 says daily skilled need, but the note it cites covers one shift.'
          }
        />

        <div className="mt-3 flex flex-wrap items-center gap-3">
          <Button intent="primary" disabled={pending} onClick={() => decide('approved')}>
            {pending ? 'Recording' : 'Approve'}
          </Button>
          <Button intent="danger" disabled={pending} onClick={() => decide('rejected')}>
            Send back
          </Button>
          <span className="text-xs text-ink-2">
            Approving records your verdict. The appeal cannot be exported until
            both clinical and legal review have approved it.
          </span>
        </div>
      </div>
    </div>
  );
}

function ChecklistControl({
  assertion,
  mark,
  editing,
  onMark,
  onStartEdit,
  onCancelEdit,
  onSaveEdit,
}: {
  assertion: DetailAssertion;
  mark: Mark | undefined;
  editing: boolean;
  onMark: (id: string, verified: boolean) => void;
  onStartEdit: () => void;
  onCancelEdit: () => void;
  onSaveEdit: (text: string, quote?: string) => void;
}) {
  const [text, setText] = useState(assertion.text);
  const [quote, setQuote] = useState(assertion.verbatimQuote);

  // Associated by id, so each control has a real label rather than a heading
  // that happens to sit above it. Unassociated labels are invisible to a screen
  // reader and to anything else matching by label.
  const textId = `assertion-${assertion.id}-text`;
  const quoteId = `assertion-${assertion.id}-quote`;

  if (editing) {
    return (
      <div className="w-72 shrink-0 border border-action bg-paper-2 p-2">
        <label
          htmlFor={textId}
          className="block text-2xs font-semibold uppercase tracking-wider text-ink-2"
        >
          Assertion text
        </label>
        <Textarea
          id={textId}
          rows={4}
          className="mt-1 text-xs"
          value={text}
          onChange={(e) => setText(e.target.value)}
        />
        <label
          htmlFor={quoteId}
          className="mt-2 block text-2xs font-semibold uppercase tracking-wider text-ink-2"
        >
          Quoted passage
        </label>
        <p className="mt-0.5 text-2xs text-ink-2">
          Copy it exactly from the source panel. It is checked against the source
          before the edit is saved.
        </p>
        <Textarea
          id={quoteId}
          rows={4}
          className="mt-1 text-xs"
          value={quote}
          onChange={(e) => setQuote(e.target.value)}
        />
        <div className="mt-2 flex gap-2">
          <Button size="sm" intent="primary" onClick={() => onSaveEdit(text, quote)}>
            Save and re-verify
          </Button>
          <Button size="sm" onClick={onCancelEdit}>
            Cancel
          </Button>
        </div>
      </div>
    );
  }

  return (
    <div className="flex w-20 shrink-0 flex-col items-start gap-1">
      <div className="flex gap-1">
        <button
          type="button"
          aria-label={`Mark assertion ${assertion.ordinal} verified`}
          aria-pressed={mark?.verified === true}
          onClick={() => onMark(assertion.id, true)}
          className={`flex h-6 w-6 items-center justify-center rounded-[2px] border ${
            mark?.verified === true
              ? 'border-recovered bg-recovered text-white'
              : 'border-rule-strong bg-paper-2 text-ink-2 hover:bg-paper-sunk'
          }`}
        >
          <CheckMark />
        </button>
        <button
          type="button"
          aria-label={`Flag assertion ${assertion.ordinal}`}
          aria-pressed={mark?.verified === false}
          onClick={() => onMark(assertion.id, false)}
          className={`h-6 w-6 rounded-[2px] border text-xs font-bold ${
            mark?.verified === false
              ? 'border-denied bg-denied text-white'
              : 'border-rule-strong bg-paper-2 text-ink-2 hover:bg-paper-sunk'
          }`}
        >
          !
        </button>
      </div>
      <button
        type="button"
        onClick={onStartEdit}
        className="text-2xs text-action underline"
      >
        Edit
      </button>
    </div>
  );
}

/** A tick drawn rather than typed, so no glyph or emoji is involved. */
function CheckMark() {
  return (
    <svg
      width="12"
      height="12"
      viewBox="0 0 12 12"
      fill="none"
      aria-hidden="true"
      focusable="false"
    >
      <path
        d="M2 6.5L4.8 9.2L10 3.4"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="square"
      />
    </svg>
  );
}
