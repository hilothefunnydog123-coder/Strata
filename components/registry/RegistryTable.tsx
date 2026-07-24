"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import { ArrowDown, ArrowUp, Plus, Search, X } from "lucide-react";
import { cn } from "@/lib/cn";
import { Button } from "@/components/ui/Button";
import { RiskBadge, StatusBadge } from "@/components/ui/Badge";
import { Sparkline } from "@/components/charts/Sparkline";
import { RegisterSystemModal } from "./RegisterSystemModal";
import { incidents } from "@/lib/data";
import { useStore } from "@/lib/store";
import {
  fmtCurrency,
  fmtMetric,
  fmtSignedPct,
  relativeTime,
} from "@/lib/format";
import type { AISystem, Environment, MetricStatus } from "@/lib/types";

const toneStroke: Record<MetricStatus, string> = {
  good: "rgb(var(--positive))",
  warning: "rgb(var(--warning))",
  critical: "rgb(var(--critical))",
  neutral: "rgb(var(--fg-dim))",
};

const ADMIN_AGENTS = new Set(["prior-auth-agent", "patient-scheduling-agent", "referral-agent"]);
function domainOf(s: AISystem): "Clinical" | "Administrative" {
  if (s.category === "Revenue Cycle" || s.category === "Scheduling & Operations")
    return "Administrative";
  if (s.isAgent && ADMIN_AGENTS.has(s.id)) return "Administrative";
  return "Clinical";
}

const lastIncidentMap = new Map<string, { at: string; severity: string }>();
incidents.forEach((inc) => {
  const cur = lastIncidentMap.get(inc.systemId);
  if (!cur || new Date(inc.openedAt) > new Date(cur.at)) {
    lastIncidentMap.set(inc.systemId, { at: inc.openedAt, severity: inc.severity });
  }
});

const RISK_RANK = { Critical: 0, High: 1, Moderate: 2, Low: 3 };
const STATUS_RANK = { Critical: 0, Degraded: 1, Warning: 2, Operational: 3, Offline: 4 };

type SortKey = "name" | "risk" | "status" | "perf" | "validation" | "roi";

const GRID =
  "grid grid-cols-[minmax(190px,2fr)_1.1fr_1.2fr_0.9fr_0.7fr_0.85fr_0.85fr_0.95fr_1.25fr_1fr_1fr_1fr] gap-3 items-center";

interface FilterDef {
  id: string;
  label: string;
  group: "env" | "domain" | "source" | "flag";
}
const FILTERS: FilterDef[] = [
  { id: "env:Production", label: "Production", group: "env" },
  { id: "env:Staging", label: "Staging", group: "env" },
  { id: "env:Development", label: "Development", group: "env" },
  { id: "domain:Clinical", label: "Clinical", group: "domain" },
  { id: "domain:Administrative", label: "Administrative", group: "domain" },
  { id: "flag:high", label: "High risk", group: "flag" },
  { id: "flag:attention", label: "Needs attention", group: "flag" },
  { id: "flag:overdue", label: "Overdue validation", group: "flag" },
  { id: "source:Vendor", label: "Vendor AI", group: "source" },
  { id: "source:Internal", label: "Internal AI", group: "source" },
];

export function RegistryTable({ initialRegisterOpen = false }: { initialRegisterOpen?: boolean }) {
  const { systems } = useStore();
  const [q, setQ] = useState("");
  const [active, setActive] = useState<Set<string>>(new Set());
  const [sort, setSort] = useState<{ key: SortKey; dir: "asc" | "desc" }>({
    key: "status",
    dir: "asc",
  });
  const [registerOpen, setRegisterOpen] = useState(initialRegisterOpen);

  const toggle = (id: string) =>
    setActive((prev) => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });

  const groupValues = (group: string) =>
    FILTERS.filter((f) => f.group === group && active.has(f.id)).map((f) =>
      f.id.split(":")[1],
    );

  const filtered = useMemo(() => {
    const envs = groupValues("env");
    const domains = groupValues("domain");
    const sources = groupValues("source");
    const query = q.trim().toLowerCase();

    let list = systems.filter((s) => {
      if (envs.length && !envs.includes(s.environment)) return false;
      if (domains.length && !domains.includes(domainOf(s))) return false;
      if (sources.length) {
        const src = s.isInternal ? "Internal" : "Vendor";
        if (!sources.includes(src)) return false;
      }
      if (active.has("flag:high") && s.riskLevel !== "High" && s.riskLevel !== "Critical")
        return false;
      if (active.has("flag:attention") && !s.flags.needsAttention) return false;
      if (active.has("flag:overdue") && !s.flags.overdueValidation) return false;
      if (query) {
        const hay = `${s.name} ${s.shortName} ${s.category} ${s.owner} ${s.ownerContact} ${s.vendor} ${s.tags.join(" ")}`.toLowerCase();
        if (!hay.includes(query)) return false;
      }
      return true;
    });

    const dir = sort.dir === "asc" ? 1 : -1;
    list = [...list].sort((a, b) => {
      switch (sort.key) {
        case "name":
          return a.name.localeCompare(b.name) * dir;
        case "risk":
          return (RISK_RANK[a.riskLevel] - RISK_RANK[b.riskLevel]) * dir;
        case "status":
          return (STATUS_RANK[a.status] - STATUS_RANK[b.status]) * dir;
        case "perf":
          return ((a.performance.headline.delta ?? 0) - (b.performance.headline.delta ?? 0)) * dir;
        case "validation":
          return (a.validation.daysUntilDue - b.validation.daysUntilDue) * dir;
        case "roi":
          return (a.roi.netImpact - b.roi.netImpact) * dir;
      }
    });
    return list;
  }, [q, active, sort, systems]);

  const setSortKey = (key: SortKey) =>
    setSort((prev) =>
      prev.key === key
        ? { key, dir: prev.dir === "asc" ? "desc" : "asc" }
        : { key, dir: key === "name" ? "asc" : "asc" },
    );

  const SortHead = ({ label, k, className }: { label: string; k: SortKey; className?: string }) => (
    <button
      onClick={() => setSortKey(k)}
      className={cn(
        "inline-flex items-center gap-1 text-left hover:text-fg-muted",
        sort.key === k && "text-fg-muted",
        className,
      )}
    >
      {label}
      {sort.key === k &&
        (sort.dir === "asc" ? (
          <ArrowUp className="h-3 w-3" />
        ) : (
          <ArrowDown className="h-3 w-3" />
        ))}
    </button>
  );

  return (
    <div>
      {/* Toolbar */}
      <div className="mb-3 flex flex-col gap-3">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div className="relative w-full sm:max-w-xs">
            <Search className="pointer-events-none absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-fg-dim" />
            <input
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder="Search by name, owner, vendor, tag…"
              className="h-9 w-full rounded-md border border-edge bg-panel pl-8 pr-3 text-sm text-fg placeholder:text-fg-dim focus:border-accent focus:outline-none"
            />
          </div>
          <div className="flex items-center gap-2">
            <span className="text-xs text-fg-dim tnum">
              {filtered.length} of {systems.length} systems
            </span>
            <Button variant="primary" size="sm" onClick={() => setRegisterOpen(true)}>
              <Plus className="h-3.5 w-3.5" />
              Register AI
            </Button>
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-1.5">
          {FILTERS.map((f, i) => {
            const on = active.has(f.id);
            const prevGroup = FILTERS[i - 1]?.group;
            return (
              <span key={f.id} className="flex items-center gap-1.5">
                {prevGroup && prevGroup !== f.group && (
                  <span className="mx-0.5 h-4 w-px bg-edge" />
                )}
                <button
                  onClick={() => toggle(f.id)}
                  className={cn(
                    "rounded-md border px-2 py-1 text-xs font-medium transition-colors",
                    on
                      ? "border-accent/40 bg-accent-soft text-fg"
                      : "border-edge bg-panel text-fg-muted hover:bg-hover hover:text-fg",
                  )}
                >
                  {f.label}
                </button>
              </span>
            );
          })}
          {active.size > 0 && (
            <button
              onClick={() => setActive(new Set())}
              className="ml-1 inline-flex items-center gap-1 text-xs text-fg-dim hover:text-fg"
            >
              <X className="h-3 w-3" /> Clear
            </button>
          )}
        </div>
      </div>

      {/* Table */}
      <div className="overflow-x-auto rounded-lg border border-edge bg-panel">
        <div className="min-w-[1440px]">
          <div
            className={cn(
              GRID,
              "border-b border-edge px-4 py-2.5 text-2xs font-semibold uppercase tracking-wider text-fg-dim",
            )}
          >
            <SortHead label="Name" k="name" />
            <span>Type</span>
            <span>Owner</span>
            <span>Vendor</span>
            <span>Version</span>
            <span>Env</span>
            <SortHead label="Risk" k="risk" />
            <SortHead label="Status" k="status" />
            <SortHead label="Performance" k="perf" />
            <SortHead label="Validation" k="validation" />
            <span>Last incident</span>
            <SortHead label="ROI" k="roi" className="justify-self-end" />
          </div>

          {filtered.map((s) => {
            const inc = lastIncidentMap.get(s.id);
            const h = s.performance.headline;
            return (
              <Link
                key={s.id}
                href={`/registry/${s.id}`}
                className={cn(
                  GRID,
                  "border-b border-edge/60 px-4 py-3 transition-colors last:border-0 hover:bg-hover",
                )}
              >
                <div className="min-w-0">
                  <div className="flex items-center gap-1.5">
                    <span className="truncate text-sm font-medium text-fg">{s.name}</span>
                    {s.isAgent && (
                      <span className="shrink-0 rounded bg-info/10 px-1 text-[0.6rem] font-semibold uppercase text-info">
                        Agent
                      </span>
                    )}
                  </div>
                  <div className="truncate text-2xs text-fg-dim">{s.department}</div>
                </div>
                <div className="min-w-0 text-xs text-fg-muted">
                  <div className="truncate">{s.category}</div>
                  <div className="truncate text-2xs text-fg-dim">{s.modelClass}</div>
                </div>
                <div className="min-w-0 text-xs">
                  <div className="truncate text-fg-muted">{s.ownerContact}</div>
                  <div className="truncate text-2xs text-fg-dim">{s.owner}</div>
                </div>
                <div className="min-w-0 truncate text-xs text-fg-muted">
                  {s.isInternal ? (
                    <span className="text-fg-dim">Internal</span>
                  ) : (
                    s.vendor
                  )}
                </div>
                <div className="font-mono text-xs text-fg-muted">{s.currentVersion}</div>
                <div className="text-xs text-fg-muted">{s.environment}</div>
                <div>
                  <RiskBadge risk={s.riskLevel} />
                </div>
                <div>
                  <StatusBadge status={s.status} />
                </div>
                <div className="flex items-center gap-2">
                  <div className="min-w-0">
                    <div className="text-xs font-semibold tnum text-fg">{fmtMetric(h)}</div>
                    <div
                      className={cn(
                        "text-2xs font-medium tnum",
                        (h.delta ?? 0) < -0.2
                          ? "text-critical"
                          : (h.delta ?? 0) > 0.2
                            ? "text-positive"
                            : "text-fg-dim",
                      )}
                    >
                      {fmtSignedPct(h.delta ?? 0)} · {h.label}
                    </div>
                  </div>
                  <Sparkline
                    data={s.performance.sparkline}
                    width={52}
                    height={20}
                    stroke={toneStroke[h.status]}
                  />
                </div>
                <div
                  className={cn(
                    "text-xs",
                    s.flags.overdueValidation ? "text-critical" : "text-fg-muted",
                  )}
                >
                  {s.flags.overdueValidation
                    ? `Overdue ${Math.abs(s.validation.daysUntilDue)}d`
                    : `Due ${s.validation.daysUntilDue}d`}
                </div>
                <div className="text-xs">
                  {inc ? (
                    <span className="text-fg-muted">{relativeTime(inc.at)}</span>
                  ) : (
                    <span className="text-fg-dim">None</span>
                  )}
                </div>
                <div className="justify-self-end text-right">
                  <div className="text-xs font-semibold tnum text-fg">
                    {fmtCurrency(s.roi.netImpact)}
                  </div>
                  <div
                    className={cn(
                      "text-2xs tnum",
                      s.roi.roiPct > 0 ? "text-positive" : "text-fg-dim",
                    )}
                  >
                    {s.roi.roiPct > 0 ? `${s.roi.roiPct}% ROI` : "In validation"}
                  </div>
                </div>
              </Link>
            );
          })}

          {filtered.length === 0 && (
            <div className="px-4 py-16 text-center text-sm text-fg-dim">
              No AI systems match the current filters.
            </div>
          )}
        </div>
      </div>

      <RegisterSystemModal open={registerOpen} onClose={() => setRegisterOpen(false)} />
    </div>
  );
}
