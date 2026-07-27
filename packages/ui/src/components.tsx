import type { CoverageStance, ChangeType } from "@assent/core";
import { COVERAGE_STANCE_LABEL, CHANGE_TYPE_LABEL, formatLives } from "@assent/core";

/** Coverage stance dot + label. Uses the reserved coverage colors only. */
export function StanceBadge({ stance, showLabel = true }: { stance: CoverageStance; showLabel?: boolean }) {
  return (
    <span className={`a-stance a-stance--${stance}`} title={COVERAGE_STANCE_LABEL[stance]}>
      <span className="a-stance-dot" aria-hidden />
      {showLabel && <span>{COVERAGE_STANCE_LABEL[stance]}</span>}
    </span>
  );
}

/** Change-direction chip. Uses the reserved diff colors only. */
export function ChangeChip({ change }: { change: ChangeType }) {
  return <span className={`a-change a-change--${change}`}>{CHANGE_TYPE_LABEL[change]}</span>;
}

/** A code / identifier set in mono (data, scannable down a column). */
export function CodeChip({ children }: { children: React.ReactNode }) {
  return <span className="a-mono" style={{ fontSize: "0.8125rem" }}>{children}</span>;
}

/** A labeled lives bar. The denominator MUST be shown next to any percentage. */
export function LivesBar({
  lives, total, label, denominatorLabel, color = "var(--a-citation)",
}: {
  lives: number; total: number; label?: string; denominatorLabel: string; color?: string;
}) {
  const pct = total > 0 ? Math.round((lives / total) * 100) : 0;
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 3 }}>
      <div style={{ display: "flex", justifyContent: "space-between", fontSize: "0.75rem", color: "var(--a-chrome-500)" }}>
        <span>{label}</span>
        <span className="a-mono">{formatLives(lives)} · {pct}% {denominatorLabel}</span>
      </div>
      <div style={{ height: 8, background: "var(--a-chrome-100)", borderRadius: 2, overflow: "hidden" }}>
        <div style={{ width: `${pct}%`, height: "100%", background: color, transition: "width 240ms ease" }} />
      </div>
    </div>
  );
}

/** The reserved-color legend, so state is always readable from color alone. */
export function StanceLegend() {
  const stances: CoverageStance[] = ["covered", "conditional", "investigational", "not_covered", "silent"];
  return (
    <div style={{ display: "flex", gap: 14, flexWrap: "wrap" }}>
      {stances.map((s) => <StanceBadge key={s} stance={s} />)}
    </div>
  );
}
