'use client';

import { useState } from 'react';
import type { DetailAssertion, ResolvedSource } from '@/lib/denials/detail';
import { SECTION_HEADINGS, SECTIONS } from '@/lib/appeals/assertion';
import { Panel, PanelHeader, Tag } from '@/components/ui/primitives';

/**
 * The signature element.
 *
 * Every sentence in the letter is an assertion with a source and a verbatim
 * quote that was programmatically checked to appear in that source. Clicking a
 * sentence opens the source panel at the exact quoted passage, highlighted in
 * place, with the surrounding text so it can be read in context.
 *
 * The visual boldness of the product goes here and nowhere else. A sentence
 * carries a superscript index in mono and an underline in the action colour, so
 * it reads like a footnote in a brief, which is what it is. Everything around
 * it stays quiet.
 *
 * There is no state in which an assertion has no source, because a draft
 * containing an unverified assertion is discarded before a person sees it.
 */
export function LetterView({
  assertions,
  sources,
  gaps,
  proprietaryFlag,
  version,
  /** Rendered next to each assertion in the review portal. */
  renderChecklist,
}: {
  assertions: DetailAssertion[];
  sources: Record<string, ResolvedSource>;
  gaps: { criterion: string; why: string }[];
  proprietaryFlag: boolean;
  version: number;
  renderChecklist?: (assertion: DetailAssertion) => React.ReactNode;
}) {
  const [selected, setSelected] = useState<number | null>(
    assertions[0]?.ordinal ?? null,
  );

  const current = assertions.find((a) => a.ordinal === selected) ?? null;
  const source = current ? sources[`${current.sourceKind}:${current.sourceId}`] : undefined;

  const grouped = SECTIONS.map((section) => ({
    section,
    heading: SECTION_HEADINGS[section],
    items: assertions.filter((a) => a.section === section),
  })).filter((g) => g.items.length > 0);

  return (
    <div className="grid gap-px bg-rule lg:grid-cols-2">
      {/* The letter */}
      <Panel className="border-0">
        <PanelHeader title={`Appeal letter, version ${version}`}>
          <span className="text-2xs text-ink-2">
            {assertions.length} assertions, every one traced
          </span>
        </PanelHeader>

        {gaps.length > 0 ? (
          <div className="border-b border-denied/40 bg-denied-wash px-3 py-2.5">
            <p className="text-xs font-semibold text-denied">
              {gaps.length === 1
                ? 'One coverage criterion has no support in the record'
                : `${gaps.length} coverage criteria have no support in the record`}
            </p>
            <ul className="mt-1.5 space-y-1 text-xs text-ink">
              {gaps.map((gap) => (
                <li key={gap.criterion}>{gap.criterion}</li>
              ))}
            </ul>
            <p className="mt-1.5 text-xs text-ink">
              The letter does not claim these are met. Adding documentation that
              speaks to them would strengthen the appeal.
            </p>
          </div>
        ) : null}

        {proprietaryFlag ? (
          <div className="border-b border-rule bg-action-wash px-3 py-2 text-xs text-ink">
            <span className="font-semibold text-action">
              Proprietary criteria argument built.
            </span>{' '}
            This denial rests on the plan&apos;s own criteria rather than Medicare
            rules, so the letter argues 42 CFR 422.101(b).
          </div>
        ) : null}

        <div className="document max-h-[70vh] overflow-y-auto px-5 py-4">
          {grouped.map((group) => (
            <section key={group.section} className="mb-6">
              <h3 className="mb-2 font-sans text-2xs font-semibold uppercase tracking-wider text-ink-2">
                {group.heading}
              </h3>
              {group.items.map((a) => {
                const isSelected = a.ordinal === selected;
                return (
                  <div key={a.id} className="mb-2.5 flex items-start gap-2">
                    {renderChecklist ? (
                      <div className="pt-1">{renderChecklist(a)}</div>
                    ) : null}
                    <button
                      type="button"
                      onClick={() => setSelected(a.ordinal)}
                      aria-pressed={isSelected}
                      className={`flex-1 rounded-[2px] border-l-2 px-2 py-1 text-left transition-colors duration-75 ${
                        isSelected
                          ? 'border-action bg-action-wash'
                          : 'border-transparent hover:bg-paper'
                      }`}
                    >
                      <span
                        className={
                          isSelected
                            ? ''
                            : 'underline decoration-action/40 underline-offset-2'
                        }
                      >
                        {a.text}
                      </span>
                      <sup className="id ml-1 text-[0.65rem] font-semibold text-action">
                        [{a.ordinal}]
                      </sup>
                      {a.editedAt ? (
                        <span className="id ml-2 align-middle text-[0.65rem] text-ink-2">
                          edited
                        </span>
                      ) : null}
                    </button>
                  </div>
                );
              })}
            </section>
          ))}
        </div>
      </Panel>

      {/* The source */}
      <Panel className="border-0">
        <PanelHeader title="Source">
          {current ? (
            <Tag tone={current.kind === 'legal' ? 'action' : 'neutral'}>
              {current.kind === 'legal' ? 'Authority' : 'Record'}
            </Tag>
          ) : null}
        </PanelHeader>

        {!current || !source ? (
          <div className="px-5 py-10 text-center text-sm text-ink-2">
            Click any sentence in the letter to see the passage it rests on.
          </div>
        ) : (
          <div className="max-h-[70vh] overflow-y-auto px-5 py-4">
            <p className="id text-xs font-semibold text-ink">{source.label}</p>
            <p className="mt-0.5 text-xs text-ink-2">{source.detail}</p>
            {source.page ? (
              <p className="id mt-0.5 text-xs text-ink-2">page {source.page}</p>
            ) : null}
            {source.url ? (
              <p className="mt-1 text-xs">
                <a href={source.url} target="_blank" rel="noreferrer noopener">
                  Open the original
                </a>
              </p>
            ) : null}

            {source.fromOcr ? (
              // The one place in the product where a verified quote is not
              // fully proof. The quote was checked against the text below, and
              // the text below was recognised from a picture of a page, so the
              // check cannot see a misreading. Only a person with the scan can.
              <p className="mt-3 border border-denied/40 bg-denied-wash px-3 py-2 text-xs text-ink">
                This document was read by OCR at {source.ocrConfidence}% confidence. The
                passage below is a machine reading of a scan, so check it against the
                original image before approving this sentence.
              </p>
            ) : null}

            <div className="document mt-4 border-l-2 border-rule-strong pl-4">
              <Highlighted
                text={source.passage}
                start={source.highlightStart}
                end={source.highlightEnd}
              />
            </div>

            {source.highlightEnd === 0 ? (
              <p className="mt-4 border border-denied/40 bg-denied-wash px-3 py-2 text-xs text-ink">
                The quoted passage could not be located in this source just now.
                Do not rely on this assertion until it has been regenerated.
              </p>
            ) : null}
          </div>
        )}
      </Panel>
    </div>
  );
}

/**
 * The passage with the quoted characters marked.
 *
 * A background wash rather than a colour change on the text, so the quote reads
 * as part of the document rather than as a separate thing pasted into it.
 */
function Highlighted({
  text,
  start,
  end,
}: {
  text: string;
  start: number;
  end: number;
}) {
  if (end <= start) return <p>{text}</p>;

  return (
    <p>
      {text.slice(0, start)}
      <mark className="bg-action-wash px-0.5 text-ink">{text.slice(start, end)}</mark>
      {text.slice(end)}
    </p>
  );
}
