import Link from "next/link";
import { cn } from "@/lib/cn";
import { RiskBadge, StatusBadge } from "@/components/ui/Badge";
import { fmtNumber } from "@/lib/format";
import type { AISystem } from "@/lib/types";

const GRID =
  "grid grid-cols-[minmax(0,2fr)_0.85fr_1fr_1fr_1fr_1.1fr] gap-3 items-center";

export function AgentFleet({ agents }: { agents: AISystem[] }) {
  return (
    <div className="overflow-x-auto rounded-lg border border-edge bg-panel">
      <div className="min-w-[860px]">
        <div
          className={cn(
            GRID,
            "border-b border-edge px-4 py-2.5 text-2xs font-semibold uppercase tracking-wider text-fg-dim",
          )}
        >
          <span>Agent</span>
          <span>Env</span>
          <span>Status</span>
          <span className="justify-self-end">Actions / day</span>
          <span className="justify-self-end">Human approval</span>
          <span>Behavior</span>
        </div>
        {agents.map((a) => {
          const approval = 100 - a.health.overrideRate.value;
          const flagged = a.flags.needsAttention || a.id === "prior-auth-agent";
          return (
            <Link
              key={a.id}
              href={`/registry/${a.id}?tab=agent`}
              className={cn(GRID, "border-b border-edge/60 px-4 py-3 last:border-0 hover:bg-hover")}
            >
              <div className="min-w-0">
                <div className="truncate text-sm font-medium text-fg">{a.name}</div>
                <div className="truncate text-2xs text-fg-dim">{a.department} · v{a.currentVersion}</div>
              </div>
              <div className="text-xs text-fg-muted">{a.environment}</div>
              <div>
                <StatusBadge status={a.status} />
              </div>
              <div className="justify-self-end text-sm font-medium tnum text-fg">
                {fmtNumber(Math.round(a.health.volume.value))}
              </div>
              <div className="justify-self-end text-sm font-medium tnum text-fg">
                {approval.toFixed(0)}%
              </div>
              <div>
                {flagged ? (
                  <span className="inline-flex items-center gap-1.5 text-xs font-medium text-critical">
                    <span className="h-1.5 w-1.5 rounded-full bg-critical" />
                    {a.id === "prior-auth-agent" ? "1 anomaly" : "Review"}
                  </span>
                ) : (
                  <span className="inline-flex items-center gap-1.5 text-xs text-positive">
                    <span className="h-1.5 w-1.5 rounded-full bg-positive" />
                    Nominal
                  </span>
                )}
              </div>
            </Link>
          );
        })}
      </div>
    </div>
  );
}
