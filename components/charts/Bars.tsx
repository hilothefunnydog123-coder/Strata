import { cn } from "@/lib/cn";
import { RISK_ORDER } from "@/lib/constants";
import type { RiskLevel } from "@/lib/types";

const RISK_VAR: Record<RiskLevel, string> = {
  Low: "positive",
  Moderate: "warning",
  High: "elevated",
  Critical: "critical",
};

/** Stacked horizontal bar of risk distribution across the estate. */
export function RiskDistributionBar({
  counts,
  className,
}: {
  counts: Record<RiskLevel, number>;
  className?: string;
}) {
  const total = RISK_ORDER.reduce((s, r) => s + counts[r], 0) || 1;
  return (
    <div className={className}>
      <div className="flex h-2.5 w-full overflow-hidden rounded-full bg-raised">
        {RISK_ORDER.map((r) => (
          <div
            key={r}
            className="h-full"
            style={{
              width: `${(counts[r] / total) * 100}%`,
              background: `rgb(var(--${RISK_VAR[r]}))`,
            }}
            title={`${r}: ${counts[r]}`}
          />
        ))}
      </div>
      <div className="mt-3 grid grid-cols-2 gap-x-4 gap-y-2 sm:grid-cols-4">
        {RISK_ORDER.map((r) => (
          <div key={r} className="flex items-center gap-2">
            <span
              className="h-2.5 w-2.5 rounded-[3px]"
              style={{ background: `rgb(var(--${RISK_VAR[r]}))` }}
            />
            <div className="flex flex-col">
              <span className="text-lg font-semibold leading-none text-fg tnum">
                {counts[r]}
              </span>
              <span className="mt-0.5 text-2xs text-fg-dim">{r} risk</span>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

/** Vertical column chart for counts over time (incidents, growth). */
export function ColumnChart({
  data,
  height = 120,
  color = "#4A8CF5",
  className,
  valueSuffix = "",
}: {
  data: { label: string; value: number }[];
  height?: number;
  color?: string;
  className?: string;
  valueSuffix?: string;
}) {
  const max = Math.max(...data.map((d) => d.value), 1);
  return (
    <div className={cn("flex items-end justify-between gap-2", className)} style={{ height }}>
      {data.map((d, i) => (
        <div key={i} className="flex min-w-0 flex-1 flex-col items-center gap-1.5">
          <div className="relative flex w-full flex-1 items-end justify-center">
            <div
              className="w-full max-w-[38px] rounded-t-[3px] transition-all"
              style={{
                height: `${(d.value / max) * 100}%`,
                background: color,
                opacity: i === data.length - 1 ? 1 : 0.55,
                minHeight: d.value > 0 ? 3 : 0,
              }}
              title={`${d.label}: ${d.value}${valueSuffix}`}
            />
          </div>
          <span className="text-2xs text-fg-dim">{d.label}</span>
        </div>
      ))}
    </div>
  );
}

/** Horizontal bar list for categorical breakdowns. */
export function HBarList({
  data,
  color = "#4A8CF5",
  className,
  format = (v: number) => `${v}`,
}: {
  data: { label: string; value: number; sub?: string }[];
  color?: string;
  className?: string;
  format?: (v: number) => string;
}) {
  const max = Math.max(...data.map((d) => d.value), 1);
  return (
    <div className={cn("space-y-2.5", className)}>
      {data.map((d, i) => (
        <div key={i} className="grid grid-cols-[1fr_auto] items-center gap-3">
          <div className="min-w-0">
            <div className="flex items-center justify-between gap-2">
              <span className="truncate text-xs text-fg-muted">{d.label}</span>
              <span className="shrink-0 text-xs font-semibold tnum text-fg">
                {format(d.value)}
              </span>
            </div>
            <div className="mt-1 h-1.5 w-full overflow-hidden rounded-full bg-raised">
              <div
                className="h-full rounded-full"
                style={{ width: `${(d.value / max) * 100}%`, background: color }}
              />
            </div>
          </div>
        </div>
      ))}
    </div>
  );
}

/** A meter with an optional threshold marker (drift scores, utilization). */
export function Meter({
  value,
  max = 1,
  threshold,
  tone = "#4A8CF5",
  className,
  height = 8,
}: {
  value: number;
  max?: number;
  threshold?: number;
  tone?: string;
  className?: string;
  height?: number;
}) {
  const pct = Math.max(0, Math.min(100, (value / max) * 100));
  return (
    <div
      className={cn("relative w-full overflow-hidden rounded-full bg-raised", className)}
      style={{ height }}
    >
      <div
        className="h-full rounded-full transition-all"
        style={{ width: `${pct}%`, background: tone }}
      />
      {threshold !== undefined && (
        <div
          className="absolute top-0 h-full w-0.5 bg-fg/60"
          style={{ left: `${(threshold / max) * 100}%` }}
          title={`Threshold ${threshold}`}
        />
      )}
    </div>
  );
}

/** Overlaid previous/current histograms for a drifting feature. */
export function DistributionCompare({
  previous,
  current,
  className,
  height = 64,
}: {
  previous: number[];
  current: number[];
  className?: string;
  height?: number;
}) {
  const max = Math.max(...previous, ...current, 0.0001);
  return (
    <div className={cn("flex items-end gap-[3px]", className)} style={{ height }}>
      {current.map((c, i) => {
        const p = previous[i] ?? 0;
        return (
          <div key={i} className="relative flex flex-1 items-end" style={{ height }}>
            {/* previous outline */}
            <div
              className="absolute bottom-0 w-full rounded-t-[2px] border border-fg-dim/50"
              style={{ height: `${(p / max) * 100}%` }}
            />
            {/* current filled */}
            <div
              className="w-full rounded-t-[2px] bg-warning/70"
              style={{ height: `${(c / max) * 100}%` }}
            />
          </div>
        );
      })}
    </div>
  );
}
