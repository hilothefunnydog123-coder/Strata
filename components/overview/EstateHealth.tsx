import {
  AlertTriangle,
  Bot,
  CalendarClock,
  CircleCheck,
  Layers,
  Siren,
  TrendingDown,
  TrendingUp,
} from "lucide-react";
import { cn } from "@/lib/cn";
import { Panel, PanelBody, PanelHeader } from "@/components/ui/Panel";
import { Donut } from "@/components/charts/Donut";
import { estate } from "@/lib/data";
import { fmtCurrency, fmtSignedPct } from "@/lib/format";
import { CHART } from "@/lib/constants";

function Tile({
  icon,
  label,
  value,
  hint,
  tone,
}: {
  icon: React.ReactNode;
  label: string;
  value: React.ReactNode;
  hint?: string;
  tone?: string;
}) {
  return (
    <div className="flex flex-col rounded-lg border border-edge bg-raised p-3">
      <div className="flex items-center justify-between">
        <span className="text-2xs font-medium uppercase tracking-wider text-fg-dim">
          {label}
        </span>
        <span className="text-fg-dim">{icon}</span>
      </div>
      <div className={cn("mt-2 text-2xl font-semibold tracking-tight tnum", tone ?? "text-fg")}>
        {value}
      </div>
      {hint && <div className="mt-1 text-2xs text-fg-dim">{hint}</div>}
    </div>
  );
}

export function EstateHealth() {
  const s = estate;
  const healthy = s.statusCounts.Operational;
  const healthyPct = Math.round((healthy / s.total) * 100);
  const perfTone = s.avgPerformanceDelta30d >= 0 ? "text-positive" : "text-warning";

  const statusSegments = [
    { label: "Operational", value: s.statusCounts.Operational, color: CHART.green },
    { label: "Warning", value: s.statusCounts.Warning, color: CHART.amber },
    { label: "Degraded", value: s.statusCounts.Degraded, color: CHART.orange },
    { label: "Critical", value: s.statusCounts.Critical, color: CHART.red },
  ].filter((x) => x.value > 0);

  return (
    <Panel>
      <PanelHeader
        icon={<Layers className="h-4 w-4" />}
        title="AI Estate Health"
        description={`Live posture across ${s.total} registered AI systems and ${estate.hospitals} hospitals.`}
      />
      <PanelBody className="flex flex-col gap-5 lg:flex-row lg:items-center">
        <div className="flex items-center gap-4">
          <Donut
            segments={statusSegments}
            centerValue={`${healthyPct}%`}
            centerLabel="Healthy"
            size={128}
            thickness={13}
          />
          <div className="space-y-1.5">
            {statusSegments.map((seg) => (
              <div key={seg.label} className="flex items-center gap-2 text-xs">
                <span className="h-2 w-2 rounded-[3px]" style={{ background: seg.color }} />
                <span className="text-fg-muted">{seg.label}</span>
                <span className="font-semibold tnum text-fg">{seg.value}</span>
              </div>
            ))}
          </div>
        </div>

        <div className="grid flex-1 grid-cols-2 gap-2.5 sm:grid-cols-3">
          <Tile
            icon={<Layers className="h-3.5 w-3.5" />}
            label="AI systems"
            value={s.total}
            hint={`${s.production} in production · ${s.agents} agents`}
          />
          <Tile
            icon={<AlertTriangle className="h-3.5 w-3.5" />}
            label="Requiring attention"
            value={s.needsAttention}
            tone="text-warning"
            hint="Across performance, drift, fairness"
          />
          <Tile
            icon={<Siren className="h-3.5 w-3.5" />}
            label="Active incidents"
            value={s.activeIncidents}
            tone={s.activeIncidents > 0 ? "text-critical" : "text-fg"}
            hint="Open investigations"
          />
          <Tile
            icon={<CalendarClock className="h-3.5 w-3.5" />}
            label="Overdue validation"
            value={s.overdueValidation}
            tone="text-warning"
            hint="Past validation cadence"
          />
          <Tile
            icon={s.avgPerformanceDelta30d >= 0 ? <TrendingUp className="h-3.5 w-3.5" /> : <TrendingDown className="h-3.5 w-3.5" />}
            label="Avg performance 30d"
            value={fmtSignedPct(s.avgPerformanceDelta30d)}
            tone={perfTone}
            hint="Portfolio-weighted change"
          />
          <Tile
            icon={<CircleCheck className="h-3.5 w-3.5" />}
            label="Annual AI impact"
            value={fmtCurrency(s.annualImpact)}
            hint={`${fmtCurrency(s.netImpact)} net of cost`}
          />
        </div>
      </PanelBody>
    </Panel>
  );
}
