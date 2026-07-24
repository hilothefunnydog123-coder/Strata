import { ArrowRight } from "lucide-react";
import Link from "next/link";
import { cn } from "@/lib/cn";
import { Panel, PanelBody, PanelHeader } from "@/components/ui/Panel";
import { MetricTile, MetricRow, DeltaBadge } from "@/components/ui/Metric";
import { Badge } from "@/components/ui/Badge";
import { Meter } from "@/components/charts/Bars";
import { Sparkline } from "@/components/charts/Sparkline";
import { AlertCard } from "@/components/alerts/AlertCard";
import { toneToClasses } from "@/lib/constants";
import { fmtMetric, relativeTime, statusColor } from "@/lib/format";
import type { AISystem, Alert, MetricStatus } from "@/lib/types";

function SignalRow({
  label,
  value,
  tone,
  onTab,
  detail,
}: {
  label: string;
  value: string;
  tone: MetricStatus;
  onTab: () => void;
  detail?: string;
}) {
  const t = toneToClasses(tone);
  return (
    <button
      onClick={onTab}
      className="flex w-full items-center justify-between gap-3 rounded-md px-2 py-2 text-left transition-colors hover:bg-hover"
    >
      <div className="flex items-center gap-2.5">
        <span className={cn("h-2 w-2 rounded-full", t.dot)} />
        <div>
          <div className="text-sm text-fg">{label}</div>
          {detail && <div className="text-2xs text-fg-dim">{detail}</div>}
        </div>
      </div>
      <div className="flex items-center gap-2">
        <span className={cn("text-sm font-semibold tnum", t.text)}>{value}</span>
        <ArrowRight className="h-3.5 w-3.5 text-fg-dim" />
      </div>
    </button>
  );
}

export function HealthTab({
  system,
  alerts,
  onTab,
}: {
  system: AISystem;
  alerts: Alert[];
  onTab: (key: string) => void;
}) {
  const h = system.health;
  const p = system.performance;
  const tiles = [h.availability, h.latency, h.errorRate, h.volume, h.confidence, h.overrideRate];

  return (
    <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
      <div className="space-y-4 lg:col-span-2">
        <Panel>
          <PanelHeader
            title="Current Health"
            description="Live operational metrics against their thresholds."
          />
          <PanelBody>
            <div className="grid grid-cols-2 gap-2.5 sm:grid-cols-3">
              {tiles.map((m) => (
                <MetricTile key={m.key} metric={m} />
              ))}
            </div>
          </PanelBody>
        </Panel>

        <Panel>
          <PanelHeader
            title="Model Performance"
            description={`Defining metric: ${p.headline.label}. Threshold ${p.headline.threshold ?? "—"}%.`}
            actions={
              <button
                onClick={() => onTab("performance")}
                className="inline-flex items-center gap-1 text-xs font-medium text-accent hover:underline"
              >
                Performance over time <ArrowRight className="h-3.5 w-3.5" />
              </button>
            }
          />
          <PanelBody>
            <div className="mb-4 flex items-end justify-between gap-4 rounded-lg border border-edge bg-raised p-4">
              <div>
                <div className="text-2xs font-medium uppercase tracking-wider text-fg-dim">
                  {p.headline.label}
                </div>
                <div className="mt-1 flex items-baseline gap-2.5">
                  <span className={cn("text-4xl font-semibold tracking-tight tnum", statusColor[p.headline.status])}>
                    {fmtMetric(p.headline)}
                  </span>
                  <DeltaBadge metric={p.headline} />
                </div>
                <div className="mt-1.5 text-2xs text-fg-dim">
                  {p.headline.thresholdLabel} · 30-day change
                </div>
              </div>
              <Sparkline
                data={p.sparkline}
                width={180}
                height={56}
                strokeWidth={2}
                stroke={
                  p.headline.status === "critical"
                    ? "rgb(var(--critical))"
                    : p.headline.status === "warning"
                      ? "rgb(var(--warning))"
                      : "rgb(var(--positive))"
                }
              />
            </div>
            <div className="divide-y divide-edge">
              {p.metrics.map((m) => (
                <MetricRow key={m.key} metric={m} />
              ))}
            </div>
          </PanelBody>
        </Panel>
      </div>

      <div className="space-y-4">
        <Panel>
          <PanelHeader title="Signals" description="Cross-cutting model health." />
          <PanelBody className="p-2">
            <SignalRow
              label="Model drift"
              detail={`Overall score ${system.drift.overall.toFixed(2)}`}
              value={system.drift.status === "good" ? "Stable" : "Warning"}
              tone={system.drift.status}
              onTab={() => onTab("drift")}
            />
            <SignalRow
              label="Fairness"
              detail={
                system.fairness.groups.length
                  ? `${system.fairness.parityGap.toFixed(1)} pt max subgroup gap`
                  : "No subgroup monitoring"
              }
              value={
                system.fairness.status === "good"
                  ? "Within policy"
                  : system.fairness.status === "critical"
                    ? "Threshold exceeded"
                    : "Review"
              }
              tone={system.fairness.status}
              onTab={() => onTab("fairness")}
            />
            <SignalRow
              label="Human override"
              detail="Acceptance vs. override trend"
              value={fmtMetric(h.overrideRate)}
              tone={h.overrideRate.status}
              onTab={() => onTab("behavior")}
            />
            <SignalRow
              label="Validation"
              detail={
                system.flags.overdueValidation
                  ? `Overdue ${Math.abs(system.validation.daysUntilDue)} days`
                  : `Due in ${system.validation.daysUntilDue} days`
              }
              value={system.validation.status}
              tone={
                system.flags.overdueValidation
                  ? "critical"
                  : system.validation.status === "Passed"
                    ? "good"
                    : "warning"
              }
              onTab={() => onTab("versions")}
            />
          </PanelBody>
        </Panel>

        {alerts.length > 0 && (
          <Panel>
            <PanelHeader title="Active Alerts" description={`${alerts.length} open for this system.`} />
            <div className="divide-y divide-edge">
              {alerts.slice(0, 4).map((a) => (
                <AlertCard key={a.id} alert={a} compact />
              ))}
            </div>
          </Panel>
        )}

        <Panel>
          <PanelHeader title="Drift Budget" description="Overall distribution shift vs. training." />
          <PanelBody>
            <div className="flex items-center justify-between text-sm">
              <span className="text-fg-muted">Overall drift score</span>
              <span className={cn("font-semibold tnum", statusColor[system.drift.status])}>
                {system.drift.overall.toFixed(2)}
              </span>
            </div>
            <Meter
              value={system.drift.overall}
              max={0.3}
              threshold={0.15}
              tone={
                system.drift.status === "critical"
                  ? "rgb(var(--critical))"
                  : system.drift.status === "warning"
                    ? "rgb(var(--warning))"
                    : "rgb(var(--positive))"
              }
              className="mt-2"
            />
            <div className="mt-1.5 flex justify-between text-2xs text-fg-dim">
              <span>0.00</span>
              <span>Threshold 0.15</span>
              <span>0.30</span>
            </div>
          </PanelBody>
        </Panel>
      </div>
    </div>
  );
}
