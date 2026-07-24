import { Info, Users } from "lucide-react";
import { Panel, PanelBody, PanelHeader } from "@/components/ui/Panel";
import { MetricTile } from "@/components/ui/Metric";
import { Callout } from "@/components/ui/Feedback";
import { LineChart } from "@/components/charts/LineChart";
import { CHART } from "@/lib/constants";
import type { AISystem } from "@/lib/types";

export function BehaviorTab({ system }: { system: AISystem }) {
  const b = system.humanBehavior;
  const accept = b.acceptanceRate.value;
  const override = b.overrideRate.value;
  const ignored = b.ignoredRate.value;
  const total = accept + override + ignored || 100;

  const split = [
    { label: "Accepted", value: accept, color: CHART.green },
    { label: "Overridden", value: override, color: CHART.amber },
    { label: "Ignored", value: ignored, color: CHART.steel },
  ];

  return (
    <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
      <div className="space-y-4 lg:col-span-2">
        <Panel>
          <PanelHeader
            icon={<Users className="h-4 w-4" />}
            title="Human Override Rate Over Time"
            description="How clinicians act on this system's recommendations. Rising overrides can signal model degradation or a workflow change."
          />
          <PanelBody>
            <LineChart
              series={[
                { key: "override", label: "Override rate", color: CHART.amber, points: b.series },
              ]}
              thresholds={
                b.overrideRate.threshold
                  ? [{ value: b.overrideRate.threshold, label: `Baseline ${b.overrideRate.threshold}%`, color: "#8A99B4" }]
                  : []
              }
              ySuffix="%"
              yFormat={(v) => v.toFixed(0)}
              height={220}
              area
              showLegend={false}
            />
          </PanelBody>
        </Panel>

        {b.note && (
          <Callout tone={system.health.overrideRate.status === "neutral" ? "neutral" : "warning"} icon={<Info className="h-4 w-4" />} title="What the override trend indicates">
            {b.note}
          </Callout>
        )}
      </div>

      <div className="space-y-4">
        <Panel>
          <PanelHeader title="Interaction Metrics" />
          <PanelBody className="grid grid-cols-2 gap-2.5">
            <MetricTile metric={b.acceptanceRate} />
            <MetricTile metric={b.overrideRate} />
            <MetricTile metric={b.timeToOverride} />
            <MetricTile metric={b.manualEditRate} />
          </PanelBody>
        </Panel>

        <Panel>
          <PanelHeader title="Recommendation Disposition" description="Share of recommendations by clinician action." />
          <PanelBody>
            <div className="flex h-3 w-full overflow-hidden rounded-full bg-raised">
              {split.map((s) => (
                <div
                  key={s.label}
                  style={{ width: `${(s.value / total) * 100}%`, background: s.color }}
                  title={`${s.label}: ${s.value.toFixed(1)}%`}
                />
              ))}
            </div>
            <div className="mt-3 space-y-1.5">
              {split.map((s) => (
                <div key={s.label} className="flex items-center justify-between text-xs">
                  <span className="inline-flex items-center gap-2 text-fg-muted">
                    <span className="h-2 w-2 rounded-[3px]" style={{ background: s.color }} />
                    {s.label}
                  </span>
                  <span className="font-semibold tnum text-fg">{s.value.toFixed(1)}%</span>
                </div>
              ))}
            </div>
          </PanelBody>
        </Panel>
      </div>
    </div>
  );
}
