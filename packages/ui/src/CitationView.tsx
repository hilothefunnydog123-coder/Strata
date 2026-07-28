"use client";
import { useEffect, useMemo, useRef } from "react";
import { locateQuote } from "@assent/core";

/**
 * THE SIGNATURE ELEMENT (PROMPT §8). A source document rendered as a document
 * (serif, paper), where selecting a requirement illuminates the exact supporting
 * span. Clicking a criterion elsewhere sets `activeSpanId` + `activeQuote`; this
 * component locates the verbatim quote inside that span (via the same normalizer
 * that verified it) and lights it up, scrolling it into view. Boldness is spent
 * here and nowhere else.
 */
export interface CitationSpan {
  id: string;
  text: string;
  headingPath: string[];
}

export interface CitationViewProps {
  spans: CitationSpan[];
  activeSpanId?: string | null;
  activeQuote?: string | null;
  /** Optional: called when a span is clicked (for two-way rail interactions). */
  onSpanClick?: (spanId: string) => void;
  /**
   * How to bring the active span into view.
   *
   *   "element"   scrollIntoView — correct inside the desktop reading pane, where
   *               the document IS the page.
   *   "container" scroll only the nearest scrollable ancestor. Per the CSSOM spec
   *               scrollIntoView scrolls EVERY ancestor scrolling box, including
   *               the window, which on a marketing page that auto-advances would
   *               drag the visitor down the page. Assigning scrollTop cannot.
   *   "none"      do not scroll.
   */
  scrollMode?: "element" | "container" | "none";
  className?: string;
}

/** Nearest ancestor that can actually scroll, or null. */
function scrollableParent(el: HTMLElement | null): HTMLElement | null {
  let node = el?.parentElement ?? null;
  while (node) {
    const overflowY = getComputedStyle(node).overflowY;
    if ((overflowY === "auto" || overflowY === "scroll") && node.scrollHeight > node.clientHeight) {
      return node;
    }
    node = node.parentElement;
  }
  return null;
}

export function CitationView({
  spans,
  activeSpanId,
  activeQuote,
  onSpanClick,
  scrollMode = "element",
  className,
}: CitationViewProps) {
  const activeRef = useRef<HTMLParagraphElement | null>(null);

  useEffect(() => {
    if (scrollMode === "none" || !activeSpanId || !activeRef.current) return;
    const el = activeRef.current;
    const reduce =
      typeof window !== "undefined" && window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;

    if (scrollMode === "container") {
      const pane = scrollableParent(el);
      if (!pane) return;
      const target = el.offsetTop - pane.clientHeight / 2 + el.offsetHeight / 2;
      const top = Math.max(0, Math.min(target, pane.scrollHeight - pane.clientHeight));
      pane.scrollTo({ top, behavior: reduce ? "auto" : "smooth" });
      return;
    }
    el.scrollIntoView({ behavior: reduce ? "auto" : "smooth", block: "center" });
  }, [activeSpanId, activeQuote, scrollMode]);

  let lastHeading = "";
  return (
    <div className={`a-doc ${className ?? ""}`}>
      {spans.map((span) => {
        const leaf = span.headingPath[span.headingPath.length - 1] ?? "";
        const showHeading = leaf && leaf !== lastHeading;
        lastHeading = leaf || lastHeading;
        const isActive = span.id === activeSpanId;
        return (
          <div key={span.id}>
            {showHeading && <div className="a-doc-heading">{leaf}</div>}
            <p
              ref={isActive ? activeRef : undefined}
              className={`a-doc-span a-focusable${isActive ? " a-doc-span--active" : ""}`}
              tabIndex={onSpanClick ? 0 : undefined}
              onClick={onSpanClick ? () => onSpanClick(span.id) : undefined}
              onKeyDown={onSpanClick ? (e) => { if (e.key === "Enter") onSpanClick(span.id); } : undefined}
              style={{ cursor: onSpanClick ? "pointer" : undefined }}
            >
              <HighlightedText text={span.text} quote={isActive ? activeQuote ?? null : null} />
            </p>
          </div>
        );
      })}
    </div>
  );
}

function HighlightedText({ text, quote }: { text: string; quote: string | null }) {
  const loc = useMemo(() => (quote ? locateQuote(text, quote) : null), [text, quote]);
  if (!loc) return <>{text}</>;
  return (
    <>
      {text.slice(0, loc.start)}
      <mark className="a-cite-mark a-cite-mark--on">{text.slice(loc.start, loc.end)}</mark>
      {text.slice(loc.end)}
    </>
  );
}
