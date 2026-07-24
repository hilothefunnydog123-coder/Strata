"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import {
  ArrowUpRight,
  BellOff,
  Check,
  ChevronsUp,
  CircleCheck,
  UserPlus,
} from "lucide-react";
import { cn } from "@/lib/cn";
import { Panel } from "@/components/ui/Panel";
import { SeverityBadge, Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { ALERT_CATEGORY_ORDER, SEVERITY_META, toneToClasses } from "@/lib/constants";
import { relativeTime } from "@/lib/format";
import { useSimulation } from "@/lib/simulation";
import type { Alert, AlertStatus, MetricStatus } from "@/lib/types";

const STATUS_TONE: Record<AlertStatus, MetricStatus> = {
  Active: "critical",
  Acknowledged: "warning",
  Assigned: "warning",
  Escalated: "critical",
  Muted: "neutral",
  Resolved: "good",
};

function AlertRow({
  alert,
  status,
  onStatus,
}: {
  alert: Alert;
  status: AlertStatus;
  onStatus: (s: AlertStatus) => void;
}) {
  const accent =
    alert.severity === "Critical"
      ? "var(--critical)"
      : alert.severity === "High"
        ? "var(--elevated)"
        : alert.severity === "Medium"
          ? "var(--warning)"
          : "var(--fg-dim)";
  const resolved = status === "Resolved" || status === "Muted";

  return (
    <div
      className={cn("border-l-2 px-4 py-3.5 transition-opacity", resolved && "opacity-60")}
      style={{ borderLeftColor: `rgb(${accent})` }}
    >
      <div className="flex items-start justify-between gap-3">
        <div className="flex flex-wrap items-center gap-2">
          <SeverityBadge severity={alert.severity} />
          <span className="text-2xs font-medium uppercase tracking-wide text-fg-dim">
            {alert.category}
          </span>
          <Badge tone={STATUS_TONE[status]}>{status}</Badge>
        </div>
        <span className="shrink-0 text-2xs text-fg-dim tnum">{relativeTime(alert.at)}</span>
      </div>

      <div className="mt-1.5 flex items-start justify-between gap-3">
        <div className="min-w-0">
          <h4 className="text-sm font-semibold text-fg">{alert.title}</h4>
          <Link
            href={`/registry/${alert.systemId}${alert.linkTab ? `?tab=${alert.linkTab}` : ""}`}
            className="text-xs text-accent hover:underline"
          >
            {alert.systemName}
          </Link>
        </div>
      </div>

      <p className="mt-2 text-xs leading-relaxed text-fg-muted">{alert.detail}</p>

      <div className="mt-2.5 flex flex-wrap gap-1.5">
        {alert.evidence.map((e, i) => {
          const t = toneToClasses(e.status ?? "neutral");
          return (
            <span key={i} className="inline-flex items-center gap-1 rounded border border-edge bg-raised px-1.5 py-0.5 text-2xs">
              <span className="text-fg-dim">{e.label}</span>
              <span className={cn("font-semibold tnum", t.text)}>{e.value}</span>
            </span>
          );
        })}
      </div>

      <div className="mt-2.5 rounded-md bg-raised px-2.5 py-1.5 text-2xs text-fg-muted">
        <span className="font-medium text-fg">Recommended:</span> {alert.recommendedAction}
      </div>

      <div className="mt-3 flex flex-wrap items-center gap-1.5">
        <Button size="sm" variant="ghost" onClick={() => onStatus("Acknowledged")} disabled={status !== "Active"}>
          <Check className="h-3.5 w-3.5" /> Acknowledge
        </Button>
        <Button size="sm" variant="ghost" onClick={() => onStatus("Assigned")}>
          <UserPlus className="h-3.5 w-3.5" /> Assign to me
        </Button>
        <Button size="sm" variant="ghost" onClick={() => onStatus("Escalated")}>
          <ChevronsUp className="h-3.5 w-3.5" /> Escalate
        </Button>
        <Button size="sm" variant="ghost" onClick={() => onStatus("Muted")}>
          <BellOff className="h-3.5 w-3.5" /> Mute
        </Button>
        <Button size="sm" variant="secondary" onClick={() => onStatus("Resolved")} className="ml-auto">
          <CircleCheck className="h-3.5 w-3.5" /> Resolve
        </Button>
        <Link
          href={`/registry/${alert.systemId}${alert.linkTab ? `?tab=${alert.linkTab}` : ""}`}
          className="inline-flex h-7 items-center gap-1 rounded-md border border-edge px-2.5 text-xs font-medium text-fg-muted hover:bg-hover hover:text-fg"
        >
          Evidence <ArrowUpRight className="h-3.5 w-3.5" />
        </Link>
      </div>
    </div>
  );
}

export function AlertCenter({ base }: { base: Alert[] }) {
  const { injectedAlerts } = useSimulation();
  const [overrides, setOverrides] = useState<Record<string, AlertStatus>>({});
  const [category, setCategory] = useState<string>("All");
  const [showResolved, setShowResolved] = useState(false);

  const all = useMemo(() => [...injectedAlerts, ...base], [injectedAlerts, base]);

  const statusOf = (a: Alert): AlertStatus => overrides[a.id] ?? a.status;

  const filtered = all
    .filter((a) => category === "All" || a.category === category)
    .filter((a) => {
      const s = statusOf(a);
      if (!showResolved && (s === "Resolved" || s === "Muted")) return false;
      return true;
    })
    .sort((a, b) => {
      const s = SEVERITY_META[a.severity].rank - SEVERITY_META[b.severity].rank;
      if (s !== 0) return s;
      return new Date(b.at).getTime() - new Date(a.at).getTime();
    });

  const activeCount = all.filter((a) => {
    const s = statusOf(a);
    return s !== "Resolved" && s !== "Muted";
  }).length;
  const criticalCount = all.filter(
    (a) => a.severity === "Critical" && statusOf(a) !== "Resolved" && statusOf(a) !== "Muted",
  ).length;

  const categories = ["All", ...ALERT_CATEGORY_ORDER];
  const countFor = (c: string) =>
    all.filter((a) => (c === "All" || a.category === c) && statusOf(a) !== "Resolved" && statusOf(a) !== "Muted").length;

  return (
    <div>
      <div className="mb-4 grid grid-cols-2 gap-2.5 sm:grid-cols-4">
        <div className="rounded-lg border border-edge bg-panel p-3">
          <div className="text-2xs font-medium uppercase tracking-wider text-fg-dim">Active alerts</div>
          <div className="mt-1 text-2xl font-semibold tnum text-fg">{activeCount}</div>
        </div>
        <div className="rounded-lg border border-edge bg-panel p-3">
          <div className="text-2xs font-medium uppercase tracking-wider text-fg-dim">Critical</div>
          <div className={cn("mt-1 text-2xl font-semibold tnum", criticalCount > 0 ? "text-critical" : "text-fg")}>
            {criticalCount}
          </div>
        </div>
        <div className="rounded-lg border border-edge bg-panel p-3">
          <div className="text-2xs font-medium uppercase tracking-wider text-fg-dim">Categories</div>
          <div className="mt-1 text-2xl font-semibold tnum text-fg">{ALERT_CATEGORY_ORDER.length}</div>
        </div>
        <div className="rounded-lg border border-edge bg-panel p-3">
          <div className="text-2xs font-medium uppercase tracking-wider text-fg-dim">Injected (sim)</div>
          <div className={cn("mt-1 text-2xl font-semibold tnum", injectedAlerts.length > 0 ? "text-warning" : "text-fg")}>
            {injectedAlerts.length}
          </div>
        </div>
      </div>

      <div className="mb-3 flex flex-wrap items-center gap-1.5">
        {categories.map((c) => (
          <button
            key={c}
            onClick={() => setCategory(c)}
            className={cn(
              "inline-flex items-center gap-1.5 rounded-md border px-2 py-1 text-xs font-medium transition-colors",
              category === c
                ? "border-accent/40 bg-accent-soft text-fg"
                : "border-edge bg-panel text-fg-muted hover:bg-hover hover:text-fg",
            )}
          >
            {c}
            <span className="text-2xs text-fg-dim tnum">{countFor(c)}</span>
          </button>
        ))}
        <label className="ml-auto flex cursor-pointer items-center gap-1.5 text-xs text-fg-muted">
          <input
            type="checkbox"
            checked={showResolved}
            onChange={(e) => setShowResolved(e.target.checked)}
            className="accent-[rgb(var(--accent))]"
          />
          Show resolved & muted
        </label>
      </div>

      <Panel>
        <div className="divide-y divide-edge">
          {filtered.map((a) => (
            <AlertRow
              key={a.id}
              alert={a}
              status={statusOf(a)}
              onStatus={(s) => setOverrides((prev) => ({ ...prev, [a.id]: s }))}
            />
          ))}
          {filtered.length === 0 && (
            <div className="px-4 py-16 text-center text-sm text-fg-dim">
              No alerts match the current filter.
            </div>
          )}
        </div>
      </Panel>
    </div>
  );
}
