"use client";

import Link from "next/link";
import { cn } from "@/lib/cn";
import { Panel, PanelBody, PanelHeader } from "@/components/ui/Panel";
import { LineChart } from "@/components/charts/LineChart";
import { HBarList } from "@/components/charts/Bars";
import { CHART } from "@/lib/constants";
import { estate, systems } from "@/lib/data";
import { fmtCurrency } from "@/lib/format";
import type { AICategory } from "@/lib/types";

function BigStat({
  label,
  value,
  hint,
  tone,
}: {
  label: string;
  value: string;
  hint?: string;
  tone?: string;
}) {
  return (
    <Panel className="p-4">
      <div className="text-2xs font-medium uppercase tracking-wider text-fg-dim">{label}</div>
      <div className={cn("mt-1.5 text-3xl font-semibold tracking-tight tnum", tone ?? "text-fg")}>
        {value}
      </div>
      {hint && <div className="mt-1 text-2xs text-fg-dim">{hint}</div>}
    </Panel>
  );
}

export function RoiDashboard() {
  const totalImplementation = systems.reduce((s, x) => s + x.roi.implementationCost, 0);
  const totalOperating = systems.reduce((s, x) => s + x.roi.operatingCost, 0);
  const portfolioRoi = Math.round(
    (estate.netImpact / (totalImplementation + totalOperating)) * 100,
  );

  // Portfolio cumulative net value (sum of per-system weekly series)
  const len = systems[0].roi.series.length;
  const portfolioSeries = Array.from({ length: len }, (_, i) => ({
    t: systems[0].roi.series[i].t,
    v: systems.reduce((sum, s) => sum + (s.roi.series[i]?.v ?? 0), 0),
  }));

  const topSystems = [...systems]
    .filter((s) => s.roi.netImpact > 0)
    .sort((a, b) => b.roi.netImpact - a.roi.netImpact)
    .slice(0, 8)
    .map((s) => ({ label: s.shortName, value: s.roi.netImpact }));

  const byCategory = new Map<AICategory, number>();
  systems.forEach((s) => byCategory.set(s.category, (byCategory.get(s.category) ?? 0) + s.roi.netImpact));
  const categoryData = [...byCategory.entries()]
    .map(([label, value]) => ({ label, value }))
    .sort((a, b) => b.value - a.value);

  const tableRows = [...systems].sort((a, b) => b.roi.netImpact - a.roi.netImpact);

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <BigStat label="Estimated annual impact" value={fmtCurrency(estate.annualImpact)} hint="Across the AI portfolio" />
        <BigStat label="Net annual impact" value={fmtCurrency(estate.netImpact)} tone="text-positive" hint="After operating cost" />
        <BigStat label="Total investment" value={fmtCurrency(totalImplementation + totalOperating)} hint="Implementation + operating" />
        <BigStat label="Portfolio ROI" value={`${portfolioRoi}%`} tone="text-positive" hint="Return on total investment" />
      </div>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
        <div className="lg:col-span-2">
          <Panel>
            <PanelHeader
              title="Cumulative Net Value"
              description="Portfolio value net of investment over the trailing 12 months. The portfolio crossed breakeven and is compounding."
            />
            <PanelBody>
              <LineChart
                series={[
                  { key: "value", label: "Cumulative net value", color: CHART.green, points: portfolioSeries },
                ]}
                thresholds={[{ value: 0, label: "Breakeven", color: "#8A99B4" }]}
                yFormat={(v) => fmtCurrency(v)}
                height={260}
                area
                showLegend={false}
              />
            </PanelBody>
          </Panel>
        </div>
        <Panel>
          <PanelHeader title="Net Impact by Category" description="Where value is concentrated." />
          <PanelBody>
            <HBarList
              data={categoryData}
              color={CHART.azure}
              format={(v) => fmtCurrency(v)}
            />
          </PanelBody>
        </Panel>
      </div>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
        <Panel>
          <PanelHeader title="Top Systems by Net Impact" />
          <PanelBody>
            <HBarList data={topSystems} color={CHART.green} format={(v) => fmtCurrency(v)} />
          </PanelBody>
        </Panel>

        <div className="lg:col-span-2">
          <Panel>
            <PanelHeader title="Financial Detail" description="Per-system annual impact, cost, and return." />
            <div className="overflow-x-auto">
              <div className="min-w-[640px]">
                <div className="grid grid-cols-[minmax(0,2fr)_1fr_1fr_1fr_0.8fr] gap-3 border-b border-edge px-4 py-2 text-2xs font-semibold uppercase tracking-wider text-fg-dim">
                  <span>System</span>
                  <span className="justify-self-end">Annual impact</span>
                  <span className="justify-self-end">Annual cost</span>
                  <span className="justify-self-end">Net impact</span>
                  <span className="justify-self-end">ROI</span>
                </div>
                <div className="max-h-[420px] overflow-y-auto">
                  {tableRows.map((s) => (
                    <Link
                      key={s.id}
                      href={`/registry/${s.id}?tab=health`}
                      className="grid grid-cols-[minmax(0,2fr)_1fr_1fr_1fr_0.8fr] items-center gap-3 border-b border-edge/60 px-4 py-2.5 last:border-0 hover:bg-hover"
                    >
                      <div className="min-w-0">
                        <div className="truncate text-sm text-fg">{s.shortName}</div>
                        <div className="truncate text-2xs text-fg-dim">{s.roi.headlineMetricLabel}</div>
                      </div>
                      <span className="justify-self-end text-sm tnum text-fg-muted">
                        {s.roi.annualImpact > 0 ? fmtCurrency(s.roi.annualImpact) : "—"}
                      </span>
                      <span className="justify-self-end text-sm tnum text-fg-muted">
                        {fmtCurrency(s.roi.operatingCost)}
                      </span>
                      <span className="justify-self-end text-sm font-semibold tnum text-fg">
                        {fmtCurrency(s.roi.netImpact)}
                      </span>
                      <span
                        className={cn(
                          "justify-self-end text-sm font-semibold tnum",
                          s.roi.roiPct > 0 ? "text-positive" : "text-fg-dim",
                        )}
                      >
                        {s.roi.roiPct > 0 ? `${s.roi.roiPct}%` : "—"}
                      </span>
                    </Link>
                  ))}
                </div>
              </div>
            </div>
          </Panel>
        </div>
      </div>
    </div>
  );
}
