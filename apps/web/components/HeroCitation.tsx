"use client";
import { useEffect, useState } from "react";
import { CitationView, type CitationSpan } from "@assent/ui";
import { CRITERION_KIND_LABEL, type CriterionKind } from "@assent/core";

/**
 * The marketing hero (PROMPT §8): open with the most characteristic thing in this
 * world — real policy prose, with the binding requirements being marked up in front
 * of the visitor. The product doing its one trick in the first three seconds.
 */

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

export function HeroCitation() {
  const [active, setActive] = useState(0);
  const [auto, setAuto] = useState(true);

  useEffect(() => {
    if (!auto) return;
    const t = setInterval(() => setActive((a) => (a + 1) % MARKS.length), 2400);
    return () => clearInterval(t);
  }, [auto]);

  const mark = MARKS[active]!;
  return (
    <div className="grid gap-0 md:grid-cols-[1.35fr_1fr] rounded-lg overflow-hidden border border-chrome-200 bg-paper shadow-sm">
      <div className="border-b md:border-b-0 md:border-r border-chrome-200 p-5 md:p-7 max-h-[420px] overflow-y-auto">
        <div className="a-mono text-[11px] uppercase tracking-wider text-chrome-500 mb-3">
          Source · Local Coverage Determination L38045
        </div>
        <CitationView spans={SPANS} activeSpanId={mark.spanId} activeQuote={mark.quote} />
      </div>
      <div className="p-5 md:p-6 bg-chrome-50">
        <div className="a-mono text-[11px] uppercase tracking-wider text-chrome-500 mb-3">
          Extracted requirements
        </div>
        <ul className="flex flex-col gap-1.5">
          {MARKS.map((m, i) => (
            <li key={m.spanId}>
              <button
                onMouseEnter={() => { setAuto(false); setActive(i); }}
                onFocus={() => { setAuto(false); setActive(i); }}
                onClick={() => { setAuto(false); setActive(i); }}
                className={`a-focusable w-full text-left rounded px-3 py-2 border transition-colors ${
                  i === active ? "border-citation bg-white" : "border-transparent hover:bg-white/60"
                }`}
              >
                <div className="a-mono text-[10px] uppercase tracking-wide text-chrome-500">
                  {CRITERION_KIND_LABEL[m.kind]}
                </div>
                <div className="text-[13px] leading-snug text-ink mt-0.5">
                  {m.quote.length > 74 ? m.quote.slice(0, 74) + "…" : m.quote}
                </div>
              </button>
            </li>
          ))}
        </ul>
        <p className="text-[12px] text-chrome-500 mt-4 leading-relaxed">
          Every requirement is click-to-source. Nothing enters the system without a
          verbatim sentence that is <span className="text-ink">programmatically verified</span> to
          exist in the original document.
        </p>
      </div>
    </div>
  );
}
