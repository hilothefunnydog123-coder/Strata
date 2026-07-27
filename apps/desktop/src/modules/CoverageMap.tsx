import { useMemo } from "react";
import { StanceBadge, StanceLegend, COVERAGE_COLOR } from "@assent/ui";
import {
  formatLives,
  COVERAGE_STANCES,
  COVERAGE_STANCE_LABEL,
  COVERAGE_STANCE_RANK,
  LIVES_DENOMINATOR_LABEL,
} from "@assent/core";
import type { CoverageStance } from "@assent/core";
import { useCorpus } from "../data/corpus";
import { useAsset } from "../state/asset";

const DENOM = LIVES_DENOMINATOR_LABEL.modeled_corpus;

/** M4 — Coverage Map. Every payer weighted by covered lives, colored by its stance
 *  on the asset's target codes. Most cells are silent grey — shown honestly. */
export function CoverageMap() {
  const corpus = useCorpus();
  const { asset } = useAsset();
  const codes = asset.targetCodes;

  // The most favorable stance a payer holds across the asset's target codes.
  const aggStance = (payerId: string): CoverageStance => {
    if (codes.length === 0) return "silent";
    let best: CoverageStance = "silent";
    for (const code of codes) {
      const s = corpus.deriveStance(payerId, code);
      if (COVERAGE_STANCE_RANK[s] < COVERAGE_STANCE_RANK[best]) best = s;
    }
    return best;
  };

  const rows = useMemo(
    () =>
      corpus.payers
        .map((p) => ({ payer: p, lives: corpus.livesForPayer(p.id), stance: aggStance(p.id) }))
        .sort((a, b) => b.lives - a.lives),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [corpus, codes.join(",")],
  );

  const total = corpus.totalCorpusLives;
  const maxLives = rows.reduce((m, r) => Math.max(m, r.lives), 0) || 1;

  const rollup = useMemo(() => {
    const m = new Map<CoverageStance, number>();
    for (const s of COVERAGE_STANCES) m.set(s, 0);
    for (const r of rows) m.set(r.stance, (m.get(r.stance) ?? 0) + r.lives);
    return m;
  }, [rows]);

  return (
    <div className="d-flush-scroll">
      <div className="d-head">
        <h1>Coverage Map</h1>
        <p>
          Stance on <b>{asset.name}</b>{" "}
          <span className="a-mono">{codes.join(" · ") || "no target codes"}</span> across {corpus.payers.length} payers,{" "}
          {formatLives(total)} covered lives modeled. A payer is silent unless it has spoken to one of these codes.
        </p>
      </div>

      <div className="d-cov-rollup" style={{ marginBottom: 12 }}>
        {COVERAGE_STANCES.map((s) => {
          const lives = rollup.get(s) ?? 0;
          const pct = total > 0 ? Math.round((lives / total) * 100) : 0;
          return (
            <div className="d-cov-stat" key={s}>
              <div style={{ display: "flex", alignItems: "center", gap: 7 }}>
                <span className="a-stance-dot" style={{ width: "0.6rem", height: "0.6rem", borderRadius: 2, background: COVERAGE_COLOR[s], outline: s === "silent" ? "1px solid var(--a-chrome-200)" : undefined, outlineOffset: -1 }} aria-hidden />
                <span className="d-cov-stat-pct">{pct}%</span>
              </div>
              <div className="d-cov-stat-label">
                {COVERAGE_STANCE_LABEL[s]} · {formatLives(lives)} {DENOM}
              </div>
            </div>
          );
        })}
      </div>

      <div style={{ marginBottom: 10 }}>
        <StanceLegend />
      </div>

      <div className="d-panel">
        <table className="d-table d-cov-table">
          <thead>
            <tr>
              <th>Payer</th>
              <th>Type</th>
              <th style={{ width: "26%" }}>Covered lives</th>
              {codes.map((c) => (
                <th key={c} className="a-mono">{corpus.codeById(c)?.code ?? c}</th>
              ))}
              <th>Position</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.payer.id}>
                <td className="d-strong">{r.payer.name}</td>
                <td className="d-dim" style={{ textTransform: "uppercase", fontSize: 10, letterSpacing: "0.05em" }}>{r.payer.type}</td>
                <td>
                  <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                    <span className="a-mono d-nowrap" style={{ width: 46 }}>{formatLives(r.lives)}</span>
                    <span className="d-cov-bar-wrap" title={`${formatLives(r.lives)} covered lives`}>
                      <span className="d-cov-bar" style={{ width: `${Math.round((r.lives / maxLives) * 100)}%`, background: COVERAGE_COLOR[r.stance] }} />
                    </span>
                  </div>
                </td>
                {codes.map((c) => (
                  <td key={c}>
                    <StanceBadge stance={corpus.deriveStance(r.payer.id, c)} showLabel={false} />
                  </td>
                ))}
                <td><StanceBadge stance={r.stance} /></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <p className="d-dim" style={{ fontSize: 11, marginTop: 8 }}>
        Position is the most favorable stance a payer holds across the asset's codes. Percentages are {DENOM}; the
        denominator is the sum of covered lives across the modeled payers, never the whole US market.
      </p>
    </div>
  );
}
