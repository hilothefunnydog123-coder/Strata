import type { EvidenceFacet } from "@assent/core";

/** Prettify a snake_case enum value for display. */
export function humanize(s: string): string {
  return s.replace(/_/g, " ");
}

/** Code identifiers as mono chips (data, scannable down a column). */
export function CodeList({ codeIds }: { codeIds: string[] }) {
  if (codeIds.length === 0) return <span className="d-dim">—</span>;
  return (
    <span className="d-chips">
      {codeIds.map((id) => (
        <span className="d-chip" key={id}>{id}</span>
      ))}
    </span>
  );
}

/** The structured evidence facets (how a validity/utility bar must be met). */
export function Facets({ evidence }: { evidence: EvidenceFacet }) {
  const chips: string[] = [];
  if (evidence.studyDesign) chips.push(humanize(evidence.studyDesign));
  if (evidence.endpoint) chips.push(`endpoint: ${humanize(evidence.endpoint)}`);
  if (evidence.comparator) chips.push(`vs ${evidence.comparator}`);
  if (chips.length === 0) return null;
  return (
    <div className="d-crit-facets">
      {chips.map((c) => (
        <span className="d-facet" key={c}>{c}</span>
      ))}
    </div>
  );
}
