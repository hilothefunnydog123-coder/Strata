import { cn } from "@/lib/cn";
import { Panel, PanelBody, PanelHeader } from "@/components/ui/Panel";
import { Badge } from "@/components/ui/Badge";
import { DistributionCompare, Meter } from "@/components/charts/Bars";
import { LineChart } from "@/components/charts/LineChart";
import { EmptyState } from "@/components/ui/Feedback";
import { CHART } from "@/lib/constants";
import { statusColor } from "@/lib/format";
import type { AISystem, MetricStatus } from "@/lib/types";
import { ShieldCheck } from "lucide-react";

const toneColor = (t: MetricStatus) =>
  t === "critical"
    ? "rgb(var(--critical))"
    : t === "warning"
      ? "rgb(var(--warning))"
      : "rgb(var(--positive))";

function DriftDim({ label, value, status }: { label: string; value: number; status: MetricStatus }) {
  return (
    <div className="rounded-lg border border-edge bg-raised p-3">
      <div className="flex items-center justify-between">
        <span className="text-xs text-fg-muted">{label}</span>
        <span className={cn("text-sm font-semibold tnum", statusColor[status])}>
          {value.toFixed(2)}
        </span>
      </div>
      <Meter value={value} max={0.3} threshold={0.15} tone={toneColor(status)} className="mt-2" height={6} />
    </div>
  );
}

export function DriftTab({ system }: { system: AISystem }) {
  const d = system.drift;
  const dimStatus = (v: number): MetricStatus =>
    v >= 0.15 ? "warning" : v >= 0.25 ? "critical" : "good";

  return (
    <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
      <div className="space-y-4 lg:col-span-2">
        <Panel>
          <PanelHeader
            title="Drift Over Time"
            description="Population Stability Index against the training reference distribution."
            actions={
              <Badge tone={d.status}>
                Overall {d.overall.toFixed(2)} · {d.status === "good" ? "Stable" : "Warning"}
              </Badge>
            }
          />
          <PanelBody>
            <LineChart
              series={[
                {
                  key: "drift",
                  label: "Overall drift score",
                  color: CHART.amber,
                  points: d.series,
                },
              ]}
              thresholds={[{ value: 0.15, label: "Warning 0.15", color: "#F26064" }]}
              yDomain={[0, Math.max(0.3, Math.max(...d.series.map((p) => p.v)) * 1.2)]}
              yFormat={(v) => v.toFixed(2)}
              height={220}
              area
              showLegend={false}
            />
          </PanelBody>
        </Panel>

        <Panel>
          <PanelHeader
            title="Top Features Driving Drift"
            description="Features ranked by contribution to the overall drift score, previous vs. current distribution."
          />
          <PanelBody>
            {d.topFeatures.length === 0 ? (
              <EmptyState
                icon={<ShieldCheck className="h-6 w-6" />}
                title="No significant feature drift"
                description="No individual feature exceeds the contribution threshold. Input distributions are consistent with training."
              />
            ) : (
              <div className="space-y-4">
                {d.topFeatures.map((f) => (
                  <div key={f.feature} className="rounded-lg border border-edge bg-raised p-3.5">
                    <div className="flex items-start justify-between gap-4">
                      <div>
                        <div className="text-sm font-medium text-fg">{f.feature}</div>
                        <div className="mt-0.5 text-2xs text-fg-dim">
                          Previous{" "}
                          <span className="tnum text-fg-muted">
                            {f.previousMean} {f.unit}
                          </span>{" "}
                          → Current{" "}
                          <span className="tnum text-fg-muted">
                            {f.currentMean} {f.unit}
                          </span>{" "}
                          <span
                            className={cn(
                              "tnum",
                              Math.abs(f.changePct) > 10 ? "text-warning" : "text-fg-dim",
                            )}
                          >
                            ({f.changePct > 0 ? "+" : ""}
                            {f.changePct}%)
                          </span>
                        </div>
                      </div>
                      <div className="text-right">
                        <div className="text-sm font-semibold tnum text-fg">
                          {Math.round(f.contribution * 100)}%
                        </div>
                        <div className="text-2xs text-fg-dim">contribution</div>
                      </div>
                    </div>
                    <div className="mt-3 grid grid-cols-[1fr_auto] items-end gap-4">
                      <DistributionCompare
                        previous={f.previousDist}
                        current={f.currentDist}
                        height={52}
                      />
                      <div className="flex flex-col gap-1 text-2xs text-fg-dim">
                        <span className="inline-flex items-center gap-1.5">
                          <span className="h-2 w-2 rounded-[2px] border border-fg-dim/60" />
                          Previous
                        </span>
                        <span className="inline-flex items-center gap-1.5">
                          <span className="h-2 w-2 rounded-[2px] bg-warning/70" />
                          Current
                        </span>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </PanelBody>
        </Panel>
      </div>

      <div className="space-y-4">
        <Panel>
          <PanelHeader title="Drift Decomposition" description="By distribution type." />
          <PanelBody className="grid grid-cols-1 gap-2.5">
            <DriftDim label="Input distribution" value={d.input} status={dimStatus(d.input)} />
            <DriftDim label="Output distribution" value={d.output} status={dimStatus(d.output)} />
            <DriftDim label="Feature drift" value={d.feature} status={dimStatus(d.feature)} />
            <DriftDim label="Population drift" value={d.population} status={dimStatus(d.population)} />
          </PanelBody>
        </Panel>

        <Panel>
          <PanelHeader title="What this means" />
          <PanelBody className="text-xs leading-relaxed text-fg-muted">
            {d.status === "good" ? (
              <>
                Input and output distributions remain close to the training reference. No drift
                remediation is required; monitoring continues at the standard cadence.
              </>
            ) : (
              <>
                Elevated drift is concentrated in a small number of input features. Because
                output drift is lower than input drift, the model is partially compensating, but
                the shift is large enough to degrade performance. Confirm the upstream data
                source before retraining.
              </>
            )}
          </PanelBody>
        </Panel>
      </div>
    </div>
  );
}
