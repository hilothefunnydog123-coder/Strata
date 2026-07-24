import { ArrowDownRight, ArrowUpRight, Minus } from "lucide-react";
import { cn } from "@/lib/cn";
import { deltaStatus, fmtMetric, statusColor } from "@/lib/format";
import { toneToClasses } from "@/lib/constants";
import type { MetricStat, MetricStatus } from "@/lib/types";

export function DeltaBadge({
  metric,
  className,
  showIcon = true,
}: {
  metric: MetricStat;
  className?: string;
  showIcon?: boolean;
}) {
  if (metric.delta === undefined) return null;
  const tone = deltaStatus(metric);
  const up = metric.delta > 0;
  const flat = Math.abs(metric.delta) < 0.05;
  const Icon = flat ? Minus : up ? ArrowUpRight : ArrowDownRight;
  const suffix = metric.deltaKind === "pp" ? " pts" : metric.deltaKind === "abs" ? "" : "%";
  const sign = metric.delta > 0 ? "+" : "";
  return (
    <span
      className={cn(
        "inline-flex items-center gap-0.5 text-xs font-semibold tabular-nums tnum",
        statusColor[tone],
        className,
      )}
    >
      {showIcon && <Icon className="h-3.5 w-3.5" strokeWidth={2.5} />}
      {sign}
      {metric.delta.toFixed(metric.deltaKind === "pp" ? 1 : 1)}
      {suffix}
    </span>
  );
}

/** A large metric tile for the Current Health grid. */
export function MetricTile({
  metric,
  className,
}: {
  metric: MetricStat;
  className?: string;
}) {
  const tone = metric.status;
  const t = toneToClasses(tone);
  return (
    <div
      className={cn(
        "relative flex flex-col justify-between rounded-lg border border-edge bg-raised p-3.5",
        className,
      )}
    >
      <div className="flex items-start justify-between gap-2">
        <span className="text-xs font-semibold text-fg-muted">{metric.label}</span>
        {tone !== "neutral" && (
          <span className={cn("h-1.5 w-1.5 shrink-0 rounded-full", t.dot)} />
        )}
      </div>
      <div className="mt-2 flex items-baseline gap-2">
        <span className="text-[1.7rem] font-bold leading-none tracking-tight text-fg tnum">
          {fmtMetric(metric)}
        </span>
        <DeltaBadge metric={metric} />
      </div>
      <div className="mt-2.5 flex items-center justify-between text-2xs text-fg-dim">
        <span>
          {metric.previous !== undefined && (
            <>
              Prev{" "}
              <span className="tnum text-fg-muted">
                {fmtMetric({ ...metric, value: metric.previous })}
              </span>
            </>
          )}
        </span>
        {metric.thresholdLabel && <span className="tnum">{metric.thresholdLabel}</span>}
      </div>
    </div>
  );
}

/** A compact label/value/delta row for detail lists. */
export function MetricRow({
  metric,
  className,
}: {
  metric: MetricStat;
  className?: string;
}) {
  return (
    <div className={cn("flex items-center justify-between gap-3 py-2", className)}>
      <span className="text-sm font-medium text-fg-muted">{metric.label}</span>
      <div className="flex items-center gap-3">
        <span className={cn("text-sm font-bold tnum", statusColor[metric.status])}>
          {fmtMetric(metric)}
        </span>
        <DeltaBadge metric={metric} className="w-16 justify-end" />
      </div>
    </div>
  );
}

/** A simple label + value pair. */
export function KeyValue({
  label,
  value,
  tone,
  mono,
  className,
}: {
  label: React.ReactNode;
  value: React.ReactNode;
  tone?: MetricStatus;
  mono?: boolean;
  className?: string;
}) {
  return (
    <div className={cn("flex flex-col gap-1", className)}>
      <dt className="text-2xs font-bold uppercase tracking-wider text-fg-dim">
        {label}
      </dt>
      <dd
        className={cn(
          "text-sm font-semibold text-fg",
          mono && "font-mono text-[0.8rem]",
          tone && statusColor[tone],
        )}
      >
        {value}
      </dd>
    </div>
  );
}
