"use client";

import Link from "next/link";
import { ArrowUpRight, FlaskConical, PlugZap, Plus } from "lucide-react";
import { PageHeader } from "@/components/ui/PageHeader";
import { Panel, PanelBody, PanelHeader } from "@/components/ui/Panel";
import { ButtonLink } from "@/components/ui/Button";
import { RiskBadge, StatusBadge } from "@/components/ui/Badge";
import { RiskDistributionBar } from "@/components/charts/Bars";
import { EstateHealth } from "@/components/overview/EstateHealth";
import { LiveAlerts } from "@/components/overview/LiveAlerts";
import { RecentActivity } from "@/components/overview/RecentActivity";
import { SystemMap } from "@/components/registry/SystemMap";
import { useStore } from "@/lib/store";
import { useAuth } from "@/lib/auth";
import { fmtDateTime, NOW } from "@/lib/format";
import type { SystemStatus } from "@/lib/types";

const statusRank: Record<SystemStatus, number> = {
  Critical: 0,
  Degraded: 1,
  Warning: 2,
  Operational: 3,
  Offline: 4,
};

function Onboarding({ orgName }: { orgName: string }) {
  return (
    <div>
      <PageHeader
        title="Command Center"
        description={`Welcome to Ward. Set up ${orgName}'s AI control plane in two steps.`}
      />
      <Panel>
        <PanelBody>
          <div className="mx-auto max-w-2xl py-8">
            <h2 className="text-xl font-bold text-fg">Get your estate under control</h2>
            <p className="mt-2 text-sm font-medium leading-relaxed text-fg-muted">
              Ward monitors accuracy and drift, catches fairness failures, oversees autonomous
              agents, and proves ROI. Start by registering a system, then point its telemetry at
              Ward to see everything come alive.
            </p>
            <div className="mt-6 grid gap-4 sm:grid-cols-2">
              <div className="rounded-xl border border-edge bg-raised p-5">
                <div className="flex h-10 w-10 items-center justify-center rounded-lg border border-edge bg-surface text-accent">
                  <Plus className="h-5 w-5" />
                </div>
                <h3 className="mt-3 text-base font-semibold text-fg">1. Register an AI system</h3>
                <p className="mt-1 text-sm font-medium leading-relaxed text-fg-muted">
                  Capture the model, owner, risk tier, and intended use. This creates its governance
                  record and control center.
                </p>
                <ButtonLink href="/registry?register=1" variant="primary" size="md" className="mt-4">
                  Register a system
                </ButtonLink>
              </div>
              <div className="rounded-xl border border-edge bg-raised p-5">
                <div className="flex h-10 w-10 items-center justify-center rounded-lg border border-edge bg-surface text-accent">
                  <PlugZap className="h-5 w-5" />
                </div>
                <h3 className="mt-3 text-base font-semibold text-fg">2. Connect telemetry</h3>
                <p className="mt-1 text-sm font-medium leading-relaxed text-fg-muted">
                  Create an ingestion key and stream real metrics (accuracy, latency, drift) from
                  your model infrastructure to the Ward API.
                </p>
                <ButtonLink href="/settings?tab=api" variant="secondary" size="md" className="mt-4">
                  Set up ingestion
                </ButtonLink>
              </div>
            </div>
          </div>
        </PanelBody>
      </Panel>
    </div>
  );
}

export default function OverviewPage() {
  const { systems, estate, alerts, ready } = useStore();
  const { session } = useAuth();
  const orgName = session?.org?.name ?? "your organization";

  if (ready && systems.length === 0) return <Onboarding orgName={orgName} />;
  if (!estate) return null;

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
            As of {fmtDateTime(NOW.toISOString())} · {orgName} · All environments
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
              {attention.length === 0 ? (
                <PanelBody>
                  <p className="py-2 text-sm font-medium text-fg-muted">
                    Every system is operating within thresholds. Nothing needs attention right now.
                  </p>
                </PanelBody>
              ) : (
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
              )}
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
