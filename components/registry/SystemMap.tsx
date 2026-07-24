import Link from "next/link";
import { cn } from "@/lib/cn";
import { RiskBadge, StatusBadge } from "@/components/ui/Badge";
import { Sparkline } from "@/components/charts/Sparkline";
import { fmtSignedPct, relativeTime } from "@/lib/format";
import type { AISystem, MetricStatus } from "@/lib/types";

const toneStroke: Record<MetricStatus, string> = {
  good: "rgb(var(--positive))",
  warning: "rgb(var(--warning))",
  critical: "rgb(var(--critical))",
  neutral: "rgb(var(--fg-dim))",
};

const GRID =
  "grid grid-cols-[minmax(0,2.3fr)_0.85fr_0.85fr_1fr_1.1fr_0.9fr_1fr] gap-3 items-center";

export function SystemMap({
  systems,
  className,
  maxHeight = 520,
}: {
  systems: AISystem[];
  className?: string;
  maxHeight?: number;
}) {
  return (
    <div className={cn("overflow-x-auto", className)}>
      <div className="min-w-[900px]">
        <div
          className={cn(
            GRID,
            "border-b border-edge px-4 py-2 text-2xs font-semibold uppercase tracking-wider text-fg-dim",
          )}
        >
          <span>AI System</span>
          <span>Environment</span>
          <span>Risk</span>
          <span>Status</span>
          <span>30-day trend</span>
          <span>Version</span>
          <span>Last validation</span>
        </div>
        <div className="overflow-y-auto" style={{ maxHeight }}>
          {systems.map((s) => (
            <Link
              key={s.id}
              href={`/registry/${s.id}`}
              className={cn(
                GRID,
                "border-b border-edge/60 px-4 py-2.5 transition-colors hover:bg-hover",
              )}
            >
              <div className="min-w-0">
                <div className="flex items-center gap-2">
                  <span className="truncate text-sm font-medium text-fg">{s.name}</span>
                  {s.isAgent && (
                    <span className="shrink-0 rounded bg-info/10 px-1 py-px text-[0.6rem] font-semibold uppercase text-info">
                      Agent
                    </span>
                  )}
                </div>
                <div className="truncate text-2xs text-fg-dim">{s.category}</div>
              </div>
              <div className="text-xs text-fg-muted">{s.environment}</div>
              <div>
                <RiskBadge risk={s.riskLevel} />
              </div>
              <div>
                <StatusBadge status={s.status} />
              </div>
              <div className="flex items-center gap-2">
                <Sparkline
                  data={s.performance.sparkline}
                  width={64}
                  height={22}
                  stroke={toneStroke[s.performance.headline.status]}
                />
                <span
                  className={cn(
                    "text-2xs font-semibold tnum",
                    (s.performance.headline.delta ?? 0) < -0.2
                      ? "text-critical"
                      : (s.performance.headline.delta ?? 0) > 0.2
                        ? "text-positive"
                        : "text-fg-dim",
                  )}
                >
                  {fmtSignedPct(s.performance.headline.delta ?? 0)}
                </span>
              </div>
              <div className="font-mono text-xs text-fg-muted">{s.currentVersion}</div>
              <div
                className={cn(
                  "text-xs",
                  s.flags.overdueValidation ? "text-critical" : "text-fg-muted",
                )}
              >
                {s.flags.overdueValidation ? "Overdue" : relativeTime(s.lastValidatedAt)}
              </div>
            </Link>
          ))}
        </div>
      </div>
    </div>
  );
}
