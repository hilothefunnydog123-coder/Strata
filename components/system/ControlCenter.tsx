"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { ChevronRight, FileClock, ShieldCheck, Siren } from "lucide-react";
import { cn } from "@/lib/cn";
import { Button, ButtonLink } from "@/components/ui/Button";
import { RiskBadge, StatusBadge } from "@/components/ui/Badge";
import { Tabs, type TabDef } from "@/components/ui/Tabs";
import { Callout } from "@/components/ui/Feedback";
import { HealthTab } from "./HealthTab";
import { PerformanceTab } from "./PerformanceTab";
import { DriftTab } from "./DriftTab";
import { FairnessTab } from "./FairnessTab";
import { BehaviorTab } from "./BehaviorTab";
import { VersionsTab } from "./VersionsTab";
import { LineageTab } from "./LineageTab";
import { IncidentsTab, AuditTab } from "./HistoryTabs";
import { AgentMonitor } from "@/components/agents/AgentMonitor";
import { fmtDate, relativeTime } from "@/lib/format";
import type { AISystem, Alert, AuditEvent, Incident } from "@/lib/types";

function IdentityItem({ label, value, mono }: { label: string; value: React.ReactNode; mono?: boolean }) {
  return (
    <div className="flex flex-col">
      <span className="text-2xs font-medium uppercase tracking-wide text-fg-dim">{label}</span>
      <span className={cn("text-xs text-fg", mono && "font-mono")}>{value}</span>
    </div>
  );
}

export function ControlCenter({
  system,
  incidents,
  auditEvents,
  alerts,
  initialTab,
}: {
  system: AISystem;
  incidents: Incident[];
  auditEvents: AuditEvent[];
  alerts: Alert[];
  initialTab?: string;
}) {
  const tabs: TabDef[] = [
    { key: "health", label: "Health" },
    { key: "performance", label: "Performance" },
    { key: "drift", label: "Drift" },
    { key: "fairness", label: "Fairness" },
    { key: "behavior", label: "Human Behavior" },
    { key: "versions", label: "Versions" },
    { key: "lineage", label: "Data Lineage" },
    ...(system.isAgent ? [{ key: "agent", label: "Agent Activity" } as TabDef] : []),
    {
      key: "incidents",
      label: "Incidents",
      badge:
        incidents.length > 0 ? (
          <span className="ml-1 rounded-full bg-raised px-1.5 text-2xs text-fg-muted tnum">
            {incidents.length}
          </span>
        ) : undefined,
    },
    { key: "audit", label: "Audit Log" },
  ];

  const normalizeTab = (t?: string) => {
    if (!t) return "health";
    if (t === "validation") return "versions";
    return tabs.some((tab) => tab.key === t) ? t : "health";
  };

  const [tab, setTab] = useState(normalizeTab(initialTab));

  useEffect(() => {
    const url = new URL(window.location.href);
    if (tab === "health") url.searchParams.delete("tab");
    else url.searchParams.set("tab", tab);
    window.history.replaceState(null, "", url.toString());
  }, [tab]);

  const openIncident = incidents.find((i) =>
    ["Investigating", "Contained", "Monitoring"].includes(i.status),
  );

  return (
    <div>
      {/* Breadcrumb */}
      <nav className="mb-3 flex items-center gap-1 text-xs text-fg-dim">
        <Link href="/registry" className="hover:text-fg-muted">
          AI Registry
        </Link>
        <ChevronRight className="h-3 w-3" />
        <span className="text-fg-muted">{system.name}</span>
      </nav>

      {/* Header */}
      <div className="flex flex-col gap-4 border-b border-edge pb-5 lg:flex-row lg:items-start lg:justify-between">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-3">
            <h1 className="text-xl font-semibold tracking-tight text-fg sm:text-2xl">
              {system.name}
            </h1>
            {system.isAgent && (
              <span className="rounded bg-info/10 px-1.5 py-0.5 text-2xs font-semibold uppercase text-info">
                Autonomous Agent
              </span>
            )}
          </div>
          <p className="mt-1.5 max-w-2xl text-sm leading-relaxed text-fg-muted">
            {system.description}
          </p>
          <div className="mt-3 flex flex-wrap items-center gap-x-5 gap-y-2">
            <StatusBadge status={system.status} />
            <RiskBadge risk={system.riskLevel} />
            <IdentityItem label="Version" value={system.currentVersion} mono />
            <IdentityItem label="Environment" value={system.environment} />
            <IdentityItem label="Owner" value={`${system.ownerContact} · ${system.owner}`} />
            <IdentityItem label="Vendor" value={system.isInternal ? "Internal" : system.vendor} />
            <IdentityItem label="Regulatory" value={system.regulatoryClass} />
            <IdentityItem
              label="Next validation"
              value={
                system.flags.overdueValidation ? (
                  <span className="text-critical">Overdue</span>
                ) : (
                  fmtDate(system.nextValidationAt)
                )
              }
            />
          </div>
        </div>
        <div className="flex shrink-0 flex-wrap items-center gap-2">
          <Button variant="ghost" size="md" onClick={() => setTab("audit")}>
            <FileClock className="h-4 w-4" />
            Audit trail
          </Button>
          <ButtonLink href={`/validation?system=${system.id}`} variant="primary" size="md">
            <ShieldCheck className="h-4 w-4" />
            Run validation
          </ButtonLink>
        </div>
      </div>

      {openIncident && (
        <div className="mt-4">
          <Callout tone="critical" icon={<Siren className="h-4 w-4" />} title={`Active incident · ${openIncident.id}`}>
            <div className="flex flex-wrap items-center justify-between gap-2">
              <span>
                {openIncident.title} — opened {relativeTime(openIncident.openedAt)}, owned by{" "}
                {openIncident.owner}.
              </span>
              <Link
                href={`/incidents/${openIncident.id}`}
                className="font-medium text-critical hover:underline"
              >
                Open incident →
              </Link>
            </div>
          </Callout>
        </div>
      )}

      {/* Tabs */}
      <div className="mt-5">
        <Tabs tabs={tabs} value={tab} onChange={setTab} />
        <div className="mt-4">
          {tab === "health" && <HealthTab system={system} alerts={alerts} onTab={setTab} />}
          {tab === "performance" && <PerformanceTab system={system} />}
          {tab === "drift" && <DriftTab system={system} />}
          {tab === "fairness" && <FairnessTab system={system} />}
          {tab === "behavior" && <BehaviorTab system={system} />}
          {tab === "versions" && <VersionsTab system={system} />}
          {tab === "lineage" && <LineageTab system={system} />}
          {tab === "agent" && <AgentMonitor systemId={system.id} />}
          {tab === "incidents" && <IncidentsTab incidents={incidents} />}
          {tab === "audit" && <AuditTab events={auditEvents} />}
        </div>
      </div>
    </div>
  );
}
