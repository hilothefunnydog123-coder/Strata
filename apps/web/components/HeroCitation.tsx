"use client";
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { CitationView, type CitationSpan } from "@assent/ui";
import { CRITERION_KIND_LABEL, type CriterionKind } from "@assent/core";

/**
 * The marketing hero (PROMPT §8): open with the most characteristic thing in this
 * world — real policy prose, with the binding requirements being marked up in front
 * of the visitor. The product doing its one trick in the first three seconds.
 *
 * Presented as a figure: a source artifact with its own metadata strip, a caption
 * that says what the reader is watching happen, and an auto-advance the reader can
 * take over at any time (and which never runs under `prefers-reduced-motion`).
 */

const DOC = {
  payer: "MolDX · Palmetto GBA",
  id: "L38045",
  title: "MolDX: Comprehensive Genomic Profiling for Advanced Solid Tumors",
  revision: "Rev 2",
  effective: "2024-09-15",
  codes: "81445 · 81479",
} as const;

const CYCLE_MS = 2400;

const SPANS: CitationSpan[] = [
  {
    id: "s0",
    headingPath: ["MolDX: Comprehensive Genomic Profiling (L38045)", "Coverage Indications, Limitations, and/or Medical Necessity"],
    text: "The patient has advanced (Stage III or IV) or metastatic solid tumor cancer at the time the test is ordered.",
  },
  {
    id: "s1",
    headingPath: ["MolDX: Comprehensive Genomic Profiling (L38045)", "Coverage Indications, Limitations, and/or Medical Necessity"],
    text: "The laboratory performing the test is CLIA-certified and the specific test has been registered in the MolDX DEX Diagnostics Exchange and has been assigned a Z-code identifier.",
  },
  {
    id: "s2",
    headingPath: ["MolDX: Comprehensive Genomic Profiling (L38045)", "Technical Assessment", "Analytical Validity"],
    text: "At minimum, the analytical validity submission must demonstrate an analytical concordance of at least 95% against an orthogonal validated method across the reportable range of variant types.",
  },
  {
    id: "s3",
    headingPath: ["MolDX: Comprehensive Genomic Profiling (L38045)", "Technical Assessment", "Clinical Utility"],
    text: "Clinical utility must be demonstrated through prospective studies with clinical outcomes as the endpoint. Retrospective analyses and change-in-management studies alone are not sufficient to establish clinical utility under this policy.",
  },
];

const MARKS: Array<{ spanId: string; quote: string; kind: CriterionKind }> = [
  { spanId: "s0", quote: "advanced (Stage III or IV) or metastatic solid tumor cancer", kind: "clinical_indication" },
  { spanId: "s1", quote: "registered in the MolDX DEX Diagnostics Exchange and has been assigned a Z-code identifier", kind: "test_specific_requirement" },
  { spanId: "s2", quote: "analytical concordance of at least 95%", kind: "analytical_validity" },
  { spanId: "s3", quote: "Clinical utility must be demonstrated through prospective studies with clinical outcomes as the endpoint", kind: "clinical_utility" },
];

/** useLayoutEffect that stays quiet during SSR. */
const useIsoLayoutEffect = typeof window === "undefined" ? useEffect : useLayoutEffect;

export function HeroCitation() {
  const [active, setActive] = useState(0);
  const [auto, setAuto] = useState(false);
  const [visible, setVisible] = useState(true);
  const frame = useRef<HTMLDivElement | null>(null);
  const pane = useRef<HTMLDivElement | null>(null);

  // Auto-advance is opt-out motion, so it is off until we know the reader wants it.
  useEffect(() => {
    if (window.matchMedia?.("(prefers-reduced-motion: reduce)").matches) return;
    setAuto(true);
  }, []);

  // Nothing moves while the figure is off screen.
  useEffect(() => {
    const el = frame.current;
    if (!el || typeof IntersectionObserver === "undefined") return;
    const io = new IntersectionObserver((entries) => setVisible(entries.some((e) => e.isIntersecting)), {
      threshold: 0.25,
    });
    io.observe(el);
    return () => io.disconnect();
  }, []);

  useEffect(() => {
    if (!auto || !visible) return;
    const t = setInterval(() => setActive((a) => (a + 1) % MARKS.length), CYCLE_MS);
    return () => clearInterval(t);
  }, [auto, visible]);

  // CitationView reveals the active span with scrollIntoView, which — per CSSOM —
  // walks *every* ancestor scrolling box up to the viewport. Inside the app's
  // reading pane that is exactly right; on a landing page that advances on its
  // own it would drag the visitor down the page every few seconds. The spans are
  // ours, so bound the gesture to the pane that owns them. A layout effect gets
  // there before CitationView's own effect runs.
  useIsoLayoutEffect(() => {
    const box = pane.current;
    if (!box) return;
    const smooth = !window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
    for (const span of Array.from(box.querySelectorAll<HTMLElement>(".a-doc-span"))) {
      span.scrollIntoView = function scrollWithinPane(this: HTMLElement) {
        const top = this.offsetTop - box.clientHeight / 2 + this.offsetHeight / 2;
        box.scrollTo({ top: Math.max(0, top), behavior: smooth ? "smooth" : "auto" });
      };
    }
  });

  const take = useCallback((i: number) => {
    setAuto(false);
    setActive(i);
  }, []);

  const mark = MARKS[active] ?? MARKS[0]!;

  return (
    <figure ref={frame} className="m-0 min-w-0">
      <figcaption className="mb-3 flex flex-wrap items-baseline gap-x-3 gap-y-1">
        <span className="a-eyebrow">Live example</span>
        <span className="text-[13px] leading-snug text-chrome-500">
          Watch the binding requirements get marked up.
        </span>
      </figcaption>

      <div className="a-artifact overflow-hidden rounded-lg border border-chrome-200 bg-paper">
        {/* Document header strip — identifiers, dates and codes, all monospace. */}
        <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1 border-b border-chrome-200 bg-chrome-50 px-4 py-2.5 sm:px-5">
          <span className="a-mono text-[11px] font-medium text-ink">{DOC.id}</span>
          <span className="a-mono text-[11px] text-chrome-500">{DOC.payer}</span>
          <span className="a-mono w-full text-[11px] text-chrome-500 sm:ml-auto sm:w-auto">
            {DOC.revision} · eff. {DOC.effective} · {DOC.codes}
          </span>
        </div>

        <div className="grid min-w-0 md:grid-cols-[1.3fr_1fr]">
          {/* Left: the source, rendered as a document. The label stays put; the paper scrolls. */}
          <div className="flex min-w-0 flex-col border-b border-chrome-200 md:border-b-0 md:border-r">
            {/* Outside the scroll box: padding inside one scrolls away with the text. */}
            <div className="a-eyebrow px-4 pb-3 pt-4 sm:px-6 sm:pt-5">Source policy</div>
            <div
              ref={pane}
              tabIndex={0}
              role="region"
              aria-label={`Source policy text, ${DOC.title}`}
              className="a-focusable relative min-w-0 max-h-[260px] overflow-y-auto px-4 pb-4 sm:px-6 sm:pb-6 md:max-h-[420px]"
            >
              <CitationView spans={SPANS} activeSpanId={mark.spanId} activeQuote={mark.quote} />
            </div>
          </div>

          {/* Right: what Assent pulled out of it. */}
          <div className="min-w-0 bg-chrome-50 p-4 sm:p-5">
            <div className="a-eyebrow mb-3">Extracted requirements</div>

            <ul className="flex flex-col">
              {MARKS.map((m, i) => {
                const on = i === active;
                return (
                  <li key={m.spanId} className="border-t border-chrome-200 first:border-t-0">
                    <button
                      type="button"
                      aria-current={on ? "true" : undefined}
                      onMouseEnter={() => take(i)}
                      onFocus={() => take(i)}
                      onClick={() => take(i)}
                      className={`a-focusable group relative block w-full px-3 py-2.5 text-left transition-colors ${
                        on ? "bg-white" : "hover:bg-white/70"
                      }`}
                    >
                      {/* The active marker and the highlight in the document are the same state. */}
                      <span
                        aria-hidden
                        className={`absolute inset-y-0 left-0 w-[2px] ${on ? "bg-citation" : "bg-transparent"}`}
                      />
                      <span className="a-mono block text-[10px] uppercase tracking-[0.08em] text-chrome-500">
                        {CRITERION_KIND_LABEL[m.kind]}
                      </span>
                      <span className={`mt-0.5 block text-[13px] leading-snug ${on ? "text-ink" : "text-chrome-700"}`}>
                        {m.quote.length > 74 ? `${m.quote.slice(0, 74)}…` : m.quote}
                      </span>
                      {on && auto && visible && (
                        <span aria-hidden className="mt-2 block h-px bg-chrome-200">
                          <span key={active} className="a-tick block h-px origin-left bg-chrome-500" />
                        </span>
                      )}
                    </button>
                  </li>
                );
              })}
            </ul>

            <div className="mt-3 flex justify-end">
              <button
                type="button"
                onClick={() => setAuto((a) => !a)}
                aria-label={auto ? "Pause the walkthrough" : "Play the walkthrough"}
                className="a-focusable a-mono rounded px-1 py-0.5 text-[10px] uppercase tracking-[0.12em] text-chrome-500 hover:text-ink"
              >
                {auto ? "Pause" : "Play"}
              </button>
            </div>
          </div>
        </div>
      </div>

      <p className="mt-3 max-w-reading text-[12.5px] leading-relaxed text-chrome-500">
        Every requirement is click-to-source. Nothing enters the system without a verbatim
        sentence <span className="text-chrome-700">programmatically verified</span> to exist in the
        original document — we discard rather than guess.
      </p>
    </figure>
  );
}
