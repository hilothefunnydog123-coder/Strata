"use client";

import { useMemo, useState } from "react";
import { CalendarClock, Info } from "lucide-react";
import { cn } from "@/lib/cn";
import { Panel, PanelBody, PanelHeader } from "@/components/ui/Panel";
import { Segmented } from "@/components/ui/Tabs";
import { Callout } from "@/components/ui/Feedback";
import { LineChart } from "@/components/charts/LineChart";
import { MetricRow } from "@/components/ui/Metric";
import { fmtDate } from "@/lib/format";
import type { AISystem } from "@/lib/types";

const RANGES = [
  { value: "7d", label: "7D", days: 7 },
  { value: "30d", label: "30D", days: 30 },
  { value: "90d", label: "90D", days: 90 },
] as const;

type RangeKey = (typeof RANGES)[number]["value"];

export function PerformanceTab({ system }: { system: AISystem }) {
  const [range, setRange] = useState<RangeKey>("30d");
  const [hidden, setHidden] = useState<Set<string>>(new Set(["precision", "f1"]));

  const days = RANGES.find((r) => r.value === range)!.days;

  const series = useMemo(() => {
    return system.performance.series
      .filter((s) => !hidden.has(s.key))
      .map((s) => ({ ...s, points: s.points.slice(-days) }));
  }, [system, days, hidden]);

  const cutoff = system.performance.series[0].points.slice(-days)[0]?.t;
  const events = system.performance.events.filter(
    (e) => !cutoff || new Date(e.t) >= new Date(cutoff),
  );

  const threshold = system.performance.headline.threshold;

  const toggle = (key: string) =>
    setHidden((prev) => {
      const next = new Set(prev);
      next.has(key) ? next.delete(key) : next.add(key);
      return next;
    });

  return (
    <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
      <div className="lg:col-span-2">
        <Panel>
          <PanelHeader
            title="Performance Over Time"
            description="Accuracy, precision, recall, F1, and AUROC with deployment and data events."
            actions={
              <Segmented
                options={RANGES.map((r) => ({ value: r.value, label: r.label }))}
                value={range}
                onChange={(v) => setRange(v as RangeKey)}
              />
            }
          />
          <PanelBody>
            {/* Legend toggles */}
            <div className="mb-3 flex flex-wrap gap-2">
              {system.performance.series.map((s) => {
                const off = hidden.has(s.key);
                return (
                  <button
                    key={s.key}
                    onClick={() => toggle(s.key)}
                    className={cn(
                      "inline-flex items-center gap-1.5 rounded-md border px-2 py-1 text-xs font-medium transition-colors",
                      off
                        ? "border-edge bg-panel text-fg-dim"
                        : "border-edge bg-raised text-fg",
                    )}
                  >
                    <span
                      className="h-0.5 w-3 rounded-full"
                      style={{ background: off ? "rgb(var(--fg-dim))" : s.color }}
                    />
                    {s.label}
                  </button>
                );
              })}
            </div>

            <LineChart
              series={series}
              events={events}
              thresholds={
                threshold && !hidden.has("accuracy")
                  ? [{ value: threshold, label: `Threshold ${threshold}%`, color: "#F26064" }]
                  : []
              }
              ySuffix="%"
              yFormat={(v) => v.toFixed(0)}
              height={300}
              showLegend={false}
            />
          </PanelBody>
        </Panel>
      </div>

      <div className="space-y-4">
        {events.length > 0 && (
          <Callout
            tone="warning"
            icon={<Info className="h-4 w-4" />}
            title="Cause of change"
          >
            {events.map((e, i) => (
              <div key={i} className={i > 0 ? "mt-2" : undefined}>
                <span className="font-medium text-fg">
                  {fmtDate(e.t)} — {e.label}.
                </span>{" "}
                {e.detail}
              </div>
            ))}
          </Callout>
        )}

        <Panel>
          <PanelHeader
            icon={<CalendarClock className="h-4 w-4" />}
            title="Current Metrics"
            description="Latest value with 30-day change."
          />
          <PanelBody className="divide-y divide-edge py-0">
            {system.performance.metrics.map((m) => (
              <MetricRow key={m.key} metric={m} />
            ))}
          </PanelBody>
        </Panel>

        <Panel>
          <PanelHeader title="Interpretation" />
          <PanelBody className="text-xs leading-relaxed text-fg-muted">
            {system.performance.headline.status === "critical" ||
            system.performance.headline.status === "warning" ? (
              <>
                {system.name} is trending below its target. The decline aligns with the
                annotated event above rather than a gradual model regression, which points to
                an upstream data cause. Recall is the most affected metric, consistent with
                missed positives rather than false alarms.
              </>
            ) : (
              <>
                {system.name} is performing at or above its target across all monitored
                metrics, with no material regression in the selected window.
              </>
            )}
          </PanelBody>
        </Panel>
      </div>
    </div>
  );
}
