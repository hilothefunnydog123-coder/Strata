import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useNavigate, useParams, useSearchParams } from "react-router-dom";
import { CitationView } from "@assent/ui";
import type { CitationSpan } from "@assent/ui";
import { CRITERION_KIND_LABEL } from "@assent/core";
import type { Criterion } from "@assent/core";
import { useCorpus } from "../data/corpus";
import { CodeList, Facets } from "../components/bits";

/**
 * M2 — THE CRITERIA RAIL (the product's thesis made physical). The source policy
 * renders on the LEFT as a document (serif, paper) via `CitationView`; the
 * extracted criteria list on the RIGHT. Selecting a criterion sets the view's
 * `activeSpanId` + `activeQuote`, so the EXACT verbatim sentence that supports it
 * illuminates and scrolls into view. The reverse works too: clicking a paragraph
 * highlights the criteria drawn from it. Keyboard: ↑/↓ move, ↵ focuses the source.
 */
export function CriteriaRail() {
  const corpus = useCorpus();
  const navigate = useNavigate();
  const params = useParams<{ docId?: string }>();
  const [searchParams] = useSearchParams();
  const preselectId = searchParams.get("criterion");

  const defaultDocId =
    corpus.documentById("doc_moldx_l38045_v2")?.id ??
    corpus.activeDocuments[0]?.id ??
    corpus.documents[0]?.id;
  const docId = params.docId ?? defaultDocId;

  // Keep the URL in sync so the document switcher and deep-links agree.
  useEffect(() => {
    if (!params.docId && defaultDocId) navigate(`/criteria/${defaultDocId}`, { replace: true });
  }, [params.docId, defaultDocId, navigate]);

  const doc = docId ? corpus.documentById(docId) : undefined;
  const payer = doc ? corpus.payerById(doc.payerId) : undefined;

  const spans = useMemo(() => (docId ? corpus.spansByDoc(docId) : []), [corpus, docId]);
  const citationSpans: CitationSpan[] = useMemo(
    () => spans.map((s) => ({ id: s.id, text: s.text, headingPath: s.headingPath })),
    [spans],
  );

  // Criteria in document reading order, so ↑/↓ walks down the page.
  const criteria = useMemo(() => {
    const ordinal = new Map(spans.map((s) => [s.id, s.ordinal]));
    return (docId ? corpus.criteriaByDoc(docId) : [])
      .slice()
      .sort((a, b) => (ordinal.get(a.spanId) ?? 0) - (ordinal.get(b.spanId) ?? 0) || a.id.localeCompare(b.id));
  }, [corpus, docId, spans]);

  const [activeCriterionId, setActiveCriterionId] = useState<string | null>(null);
  const [activeSpanId, setActiveSpanId] = useState<string | null>(null);
  const [activeQuote, setActiveQuote] = useState<string | null>(null);

  const listRef = useRef<HTMLUListElement | null>(null);
  const docPaneRef = useRef<HTMLDivElement | null>(null);

  const selectCriterion = useCallback((c: Criterion, scrollList = false) => {
    setActiveCriterionId(c.id);
    setActiveSpanId(c.spanId);
    setActiveQuote(c.verbatimQuote);
    if (scrollList) {
      requestAnimationFrame(() => {
        listRef.current?.querySelector<HTMLElement>(`[data-cid="${c.id}"]`)?.scrollIntoView({ block: "nearest" });
      });
    }
  }, []);

  // Reverse interaction: clicking a source paragraph highlights its criteria.
  const selectSpan = useCallback(
    (spanId: string) => {
      const onSpan = corpus.criteriaBySpan(spanId);
      setActiveSpanId(spanId);
      if (onSpan.length > 0) {
        const first = onSpan[0]!;
        setActiveCriterionId(first.id);
        setActiveQuote(first.verbatimQuote);
        requestAnimationFrame(() => {
          listRef.current?.querySelector<HTMLElement>(`[data-cid="${first.id}"]`)?.scrollIntoView({ block: "nearest" });
        });
      } else {
        setActiveCriterionId(null);
        setActiveQuote(null);
      }
    },
    [corpus],
  );

  // On document change (or an incoming ?criterion= deep-link from M5), illuminate
  // the requested requirement immediately — the first one by default.
  useEffect(() => {
    const target = (preselectId ? criteria.find((c) => c.id === preselectId) : undefined) ?? criteria[0];
    if (target) {
      setActiveCriterionId(target.id);
      setActiveSpanId(target.spanId);
      setActiveQuote(target.verbatimQuote);
      requestAnimationFrame(() => {
        listRef.current?.querySelector<HTMLElement>(`[data-cid="${target.id}"]`)?.scrollIntoView({ block: "nearest" });
      });
    } else {
      setActiveCriterionId(null);
      setActiveSpanId(null);
      setActiveQuote(null);
    }
  }, [criteria, preselectId]);

  const focusCitation = useCallback(() => {
    const el = docPaneRef.current?.querySelector<HTMLElement>(".a-doc-span--active");
    if (el) {
      const reduce = window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
      el.scrollIntoView({ behavior: reduce ? "auto" : "smooth", block: "center" });
      el.focus();
    }
  }, []);

  const onListKeyDown = (e: React.KeyboardEvent) => {
    if (criteria.length === 0) return;
    const cur = criteria.findIndex((c) => c.id === activeCriterionId);
    if (e.key === "ArrowDown") {
      e.preventDefault();
      const next = cur < 0 ? 0 : (cur + 1) % criteria.length;
      selectCriterion(criteria[next]!, true);
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      const next = cur < 0 ? criteria.length - 1 : (cur - 1 + criteria.length) % criteria.length;
      selectCriterion(criteria[next]!, true);
    } else if (e.key === "Home") {
      e.preventDefault();
      selectCriterion(criteria[0]!, true);
    } else if (e.key === "End") {
      e.preventDefault();
      selectCriterion(criteria[criteria.length - 1]!, true);
    } else if (e.key === "Enter") {
      e.preventDefault();
      focusCitation();
    }
  };

  const relatedIds = useMemo(
    () => new Set(activeSpanId ? corpus.criteriaBySpan(activeSpanId).map((c) => c.id) : []),
    [corpus, activeSpanId],
  );
  const codeIds = docId ? corpus.codeIdsForDoc(docId) : [];

  return (
    <div className="d-content--flush">
      <div className="d-subbar">
        <span className="d-field-label">Policy</span>
        <select
          className="d-select"
          value={docId ?? ""}
          onChange={(e) => navigate(`/criteria/${e.target.value}`)}
          style={{ maxWidth: 460 }}
        >
          {corpus.documents.map((d) => (
            <option key={d.id} value={d.id}>
              {(corpus.payerById(d.payerId)?.name ?? d.payerId) + " — " + d.externalId + " · " + d.title}
              {corpus.isSuperseded(d.id) ? " (superseded)" : ""}
            </option>
          ))}
        </select>
        <span className="d-topbar-spacer" />
        <span className="d-dim">Select a requirement to illuminate its source sentence.</span>
      </div>

      {!doc ? (
        <div className="d-empty">Policy not found.</div>
      ) : (
        <div className="d-split">
          {/* LEFT — the source document */}
          <div className="d-doc-pane" ref={docPaneRef}>
            <div className="d-doc-head">
              <h2>{doc.title}</h2>
              <div className="d-doc-meta">
                <span>{payer?.name ?? doc.payerId}</span>
                <span className="a-mono">{doc.externalId}</span>
                <span className="a-mono">eff {doc.effectiveDate}</span>
                <CodeList codeIds={codeIds} />
                {corpus.isSuperseded(doc.id) && <span className="d-tag">superseded</span>}
              </div>
            </div>
            <CitationView
              spans={citationSpans}
              activeSpanId={activeSpanId}
              activeQuote={activeQuote}
              onSpanClick={selectSpan}
            />
          </div>

          {/* RIGHT — the extracted criteria */}
          <div className="d-crit-pane">
            <div className="d-crit-pane-head">
              <span>{criteria.length} criteria</span>
              <span className="d-topbar-spacer" />
              <span className="d-dim" style={{ textTransform: "none", letterSpacing: 0 }}>
                <span className="d-kbd" style={{ color: "var(--a-chrome-500)", borderColor: "var(--a-chrome-200)" }}>↑↓</span> move ·{" "}
                <span className="d-kbd" style={{ color: "var(--a-chrome-500)", borderColor: "var(--a-chrome-200)" }}>↵</span> focus source
              </span>
            </div>
            {criteria.length === 0 ? (
              <div className="d-empty">No criteria were extracted from this policy.</div>
            ) : (
              <ul
                className="d-crit-list"
                role="listbox"
                aria-label="Extracted criteria"
                tabIndex={0}
                ref={listRef}
                onKeyDown={onListKeyDown}
                aria-activedescendant={activeCriterionId ? `crit-opt-${activeCriterionId}` : undefined}
              >
                {criteria.map((c) => {
                  const isActive = c.id === activeCriterionId;
                  const isRelated = !isActive && relatedIds.has(c.id);
                  return (
                    <li
                      key={c.id}
                      id={`crit-opt-${c.id}`}
                      data-cid={c.id}
                      role="option"
                      aria-selected={isActive}
                      className={"d-crit" + (isActive ? " d-crit--active" : isRelated ? " d-crit--related" : "")}
                      onClick={() => selectCriterion(c)}
                    >
                      <div className="d-crit-top">
                        <span className="d-crit-kind">{CRITERION_KIND_LABEL[c.kind]}</span>
                        <span className="d-crit-conf">conf {c.confidence.toFixed(2)}</span>
                      </div>
                      <div className="d-crit-subject">{c.subject}</div>
                      <div className="d-crit-req">{c.requirementText}</div>
                      <Facets evidence={c.evidence} />
                      <div className="d-crit-quote">“{c.verbatimQuote}”</div>
                      <div className="d-crit-facets">
                        <CodeList codeIds={codeIds} />
                      </div>
                    </li>
                  );
                })}
              </ul>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
