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
  className?: string;
}

export function CitationView({ spans, activeSpanId, activeQuote, onSpanClick, className }: CitationViewProps) {
  const activeRef = useRef<HTMLParagraphElement | null>(null);

  useEffect(() => {
    if (!activeSpanId || !activeRef.current) return;
    const reduce = typeof window !== "undefined" && window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
    activeRef.current.scrollIntoView({ behavior: reduce ? "auto" : "smooth", block: "center" });
  }, [activeSpanId, activeQuote]);

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
