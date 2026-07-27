import { useEffect, useMemo, useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { StanceBadge } from "@assent/ui";
import { COVERAGE_STANCES, COVERAGE_STANCE_LABEL } from "@assent/core";
import type { CoverageStance } from "@assent/core";
import { useCorpus } from "../data/corpus";
import { CodeList } from "../components/bits";

/** M1 — the Corpus. Every policy in one dense, filterable index. */
export function CorpusModule() {
  const corpus = useCorpus();
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();

  const [payer, setPayer] = useState("all");
  const [code, setCode] = useState("all");
  const [stance, setStance] = useState("all");
  const [after, setAfter] = useState("");
  const [query, setQuery] = useState("");

  // Accept deep-links from the command palette (e.g. /corpus?payer=aetna).
  useEffect(() => {
    const p = searchParams.get("payer");
    if (p) setPayer(p);
    const q = searchParams.get("q");
    if (q !== null) setQuery(q);
  }, [searchParams]);

  const rows = useMemo(() => {
    return corpus.documents
      .filter((d) => {
        if (payer !== "all" && d.payerId !== payer) return false;
        if (code !== "all" && !corpus.codeIdsForDoc(d.id).includes(code)) return false;
        if (stance !== "all" && !corpus.stancesByDoc(d.id).some((s) => s.stance === stance)) return false;
        if (after && d.effectiveDate < after) return false;
        if (!corpus.documentMatchesText(d.id, query)) return false;
        return true;
      })
      .sort((a, b) => {
        const pa = corpus.payerById(a.payerId)?.name ?? "";
        const pb = corpus.payerById(b.payerId)?.name ?? "";
        return pa.localeCompare(pb) || a.externalId.localeCompare(b.externalId) || b.effectiveDate.localeCompare(a.effectiveDate);
      });
  }, [corpus, payer, code, stance, after, query]);

  const resetFilters = () => {
    setPayer("all");
    setCode("all");
    setStance("all");
    setAfter("");
    setQuery("");
  };

  return (
    <div className="d-flush-scroll">
      <div className="d-head">
        <h1>Corpus</h1>
        <p>{corpus.documents.length} policy documents across {corpus.payers.length} payers. Click a row to open its Criteria Rail.</p>
      </div>

      <div className="d-toolbar">
        <input
          className="d-input d-input--search"
          placeholder="Search titles, requirements, verbatim text…"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          aria-label="Full-text search"
        />
        <div className="d-field">
          <span className="d-field-label">Payer</span>
          <select className="d-select" value={payer} onChange={(e) => setPayer(e.target.value)}>
            <option value="all">All payers</option>
            {corpus.payers.map((p) => (
              <option key={p.id} value={p.id}>{p.name}</option>
            ))}
          </select>
        </div>
        <div className="d-field">
          <span className="d-field-label">Code</span>
          <select className="d-select" value={code} onChange={(e) => setCode(e.target.value)}>
            <option value="all">All codes</option>
            {corpus.codes.map((c) => (
              <option key={c.id} value={c.id}>{c.code} · {c.system}</option>
            ))}
          </select>
        </div>
        <div className="d-field">
          <span className="d-field-label">Stance</span>
          <select className="d-select" value={stance} onChange={(e) => setStance(e.target.value)}>
            <option value="all">Any stance</option>
            {COVERAGE_STANCES.map((s) => (
              <option key={s} value={s}>{COVERAGE_STANCE_LABEL[s]}</option>
            ))}
          </select>
        </div>
        <div className="d-field">
          <span className="d-field-label">Effective on/after</span>
          <input className="d-input a-mono" type="date" value={after} onChange={(e) => setAfter(e.target.value)} />
        </div>
        <button className="d-btn" onClick={resetFilters} style={{ alignSelf: "flex-end" }}>Reset</button>
      </div>

      <div className="d-panel">
        <table className="d-table">
          <thead>
            <tr>
              <th>Payer</th>
              <th>Policy</th>
              <th>Title</th>
              <th>Effective</th>
              <th>Codes</th>
              <th style={{ textAlign: "right" }}>Criteria</th>
              <th>Stance</th>
              <th>Version</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((d) => {
              const superseded = corpus.isSuperseded(d.id);
              const stances = [...new Set(corpus.stancesByDoc(d.id).map((s) => s.stance))] as CoverageStance[];
              return (
                <tr
                  key={d.id}
                  className={"d-row--clickable" + (superseded ? " d-row--muted" : "")}
                  onClick={() => navigate(`/criteria/${d.id}`)}
                >
                  <td>{corpus.payerById(d.payerId)?.name ?? d.payerId}</td>
                  <td className="a-mono">{d.externalId}</td>
                  <td style={{ maxWidth: 340 }}>{d.title}</td>
                  <td className="a-mono d-nowrap">{d.effectiveDate}</td>
                  <td><CodeList codeIds={corpus.codeIdsForDoc(d.id)} /></td>
                  <td className="a-mono" style={{ textAlign: "right" }}>{corpus.criteriaByDoc(d.id).length}</td>
                  <td>
                    <span className="d-chips">
                      {stances.length === 0
                        ? <span className="d-dim">—</span>
                        : stances.map((s) => <StanceBadge key={s} stance={s} showLabel={false} />)}
                    </span>
                  </td>
                  <td>
                    <span className="d-tag">{superseded ? "superseded" : "current"}</span>
                  </td>
                </tr>
              );
            })}
            {rows.length === 0 && (
              <tr><td colSpan={8}><div className="d-empty">No policies match these filters.</div></td></tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
