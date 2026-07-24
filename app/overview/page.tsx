"use client";

import Link from "next/link";
import { ArrowUpRight, FlaskConical } from "lucide-react";
import { PageHeader } from "@/components/ui/PageHeader";
import { Panel, PanelBody, PanelHeader } from "@/components/ui/Panel";
import { ButtonLink } from "@/components/ui/Button";
import { RiskBadge, StatusBadge } from "@/components/ui/Badge";
import { RiskDistributionBar } from "@/components/charts/Bars";
import { EstateHealth } from "@/components/overview/EstateHealth";
import { LiveAlerts } from "@/components/overview/LiveAlerts";
import { RecentActivity } from "@/components/overview/RecentActivity";
import { SystemMap } from "@/components/registry/SystemMap";
import { alerts, deriveEstate } from "@/lib/data";
import { useStore } from "@/lib/store";
import { fmtDateTime, NOW } from "@/lib/format";
import type { SystemStatus } from "@/lib/types";

const statusRank: Record<SystemStatus, number> = {
  Critical: 0,
  Degraded: 1,
  Warning: 2,
  Operational: 3,
  Offline: 4,
};

export default function OverviewPage() {
  const { systems } = useStore();
  const estate = deriveEstate(systems);

  const mapped = [...systems].sort(
    (a, b) => statusRank[a.status] - statusRank[b.status] || a.name.localeCompare(b.name),
  );
  const attention = [...systems]
    .filter((s) => s.flags.needsAttention || s.flags.activeIncident || s.flags.overdueValidation)
    .sort((a, b) => statusRank[a.status] - statusRank[b.status])
    .slice(0, 5);

  return (
    <div>
      <PageHeader
        title="Command Center"
        description={`${estate.needsAttention} systems require attention and ${estate.activeIncidents} incidents are active across the AI estate.`}
        actions={
          <>
            <ButtonLink href="/simulation" variant="secondary" size="md">
              <FlaskConical className="h-4 w-4" />
              Run simulation
            </ButtonLink>
            <ButtonLink href="/registry?register=1" variant="primary" size="md">
              Register AI
            </ButtonLink>
          </>
        }
        meta={
          <div className="text-2xs font-medium text-fg-dim">
            As of {fmtDateTime(NOW.toISOString())} · Northstar Health System · All environments
          </div>
        }
      />

      <div className="space-y-4">
        <EstateHealth estate={estate} />

        <div className="grid grid-cols-1 gap-4 lg:grid-cols-12">
          <div className="space-y-4 lg:col-span-8">
            <LiveAlerts base={alerts} limit={5} />

            <Panel>
              <PanelHeader
                title="AI System Map"
                description="Every registered AI system, ordered by operational status."
                actions={
                  <Link
                    href="/registry"
                    className="inline-flex items-center gap-1 text-xs font-semibold text-accent hover:underline"
                  >
                    Open registry <ArrowUpRight className="h-3.5 w-3.5" />
                  </Link>
                }
              />
              <SystemMap systems={mapped} maxHeight={460} />
            </Panel>
          </div>

          <div className="space-y-4 lg:col-span-4">
            <Panel>
              <PanelHeader
                title="Risk Distribution"
                description="AI systems by governance risk classification."
              />
              <PanelBody>
                <RiskDistributionBar counts={estate.riskCounts} />
                <p className="mt-4 border-t border-edge pt-3 text-xs font-medium leading-relaxed text-fg-muted">
                  {estate.riskCounts.High + estate.riskCounts.Critical} systems are classified
                  High or Critical risk and carry mandatory clinical review and accelerated
                  validation cadence.
                </p>
              </PanelBody>
            </Panel>

            <Panel>
              <PanelHeader title="Requiring Attention" description="Prioritized by operational severity." />
              <div className="divide-y divide-edge">
                {attention.map((s) => (
                  <Link
                    key={s.id}
                    href={`/registry/${s.id}`}
                    className="flex items-center justify-between gap-3 px-4 py-2.5 transition-colors hover:bg-hover"
                  >
                    <div className="min-w-0">
                      <div className="truncate text-sm font-semibold text-fg">{s.name}</div>
                      <div className="mt-0.5 flex items-center gap-2">
                        <RiskBadge risk={s.riskLevel} />
                        <span className="text-2xs font-medium text-fg-dim">
                          {s.flags.activeIncident
                            ? "Active incident"
                            : s.flags.overdueValidation
                              ? "Validation overdue"
                              : "Needs review"}
                        </span>
                      </div>
                    </div>
                    <StatusBadge status={s.status} />
                  </Link>
                ))}
              </div>
            </Panel>

            <Panel>
              <PanelHeader title="Recent Activity" description="Governance and operational events." />
              <PanelBody>
                <RecentActivity limit={7} />
              </PanelBody>
            </Panel>
          </div>
        </div>
      </div>
    </div>
  );
}
