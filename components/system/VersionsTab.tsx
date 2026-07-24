"use client";

import { useState } from "react";
import { GitCompare, RotateCcw } from "lucide-react";
import { cn } from "@/lib/cn";
import { Panel, PanelBody, PanelHeader } from "@/components/ui/Panel";
import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { Select } from "@/components/ui/Modal";
import { fmtDate } from "@/lib/format";
import type { AISystem, MetricStatus, ModelVersion } from "@/lib/types";

const STATUS_TONE: Record<ModelVersion["status"], MetricStatus> = {
  "Current production": "good",
  Staging: "warning",
  Candidate: "neutral",
  Retired: "neutral",
  Blocked: "critical",
  "Rolled back": "warning",
};

function CompareRow({
  label,
  a,
  b,
  digits = 3,
  suffix = "",
}: {
  label: string;
  a: number;
  b: number;
  digits?: number;
  suffix?: string;
}) {
  const delta = b - a;
  return (
    <div className="grid grid-cols-[1.4fr_1fr_1fr_1fr] items-center gap-2 border-b border-edge/60 py-2 text-sm last:border-0">
      <span className="text-fg-muted">{label}</span>
      <span className="tnum text-fg">{a.toFixed(digits)}{suffix}</span>
      <span className="tnum text-fg">{b.toFixed(digits)}{suffix}</span>
      <span
        className={cn(
          "tnum font-semibold",
          Math.abs(delta) < 0.0005 ? "text-fg-dim" : delta > 0 ? "text-positive" : "text-critical",
        )}
      >
        {delta > 0 ? "+" : ""}
        {delta.toFixed(digits)}
      </span>
    </div>
  );
}

export function VersionsTab({ system }: { system: AISystem }) {
  const versions = system.versions;
  const [aId, setAId] = useState(versions[1]?.id ?? versions[0].id);
  const [bId, setBId] = useState(versions[0].id);
  const a = versions.find((v) => v.id === aId)!;
  const b = versions.find((v) => v.id === bId)!;

  return (
    <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
      <div className="space-y-3 lg:col-span-2">
        <PanelHeader
          title="Version History"
          description="Every release with approval, validation, and rollback status."
          className="rounded-lg border border-edge bg-panel"
        />
        {versions.map((v) => (
          <Panel key={v.id} className={cn(v.status === "Current production" && "border-positive/30")}>
            <PanelBody>
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div className="flex items-center gap-2.5">
                  <span className="font-mono text-sm font-semibold text-fg">{v.version}</span>
                  <Badge tone={STATUS_TONE[v.status]}>{v.status}</Badge>
                  {v.performanceDelta !== 0 && (
                    <span
                      className={cn(
                        "text-2xs font-medium tnum",
                        v.performanceDelta > 0 ? "text-positive" : "text-critical",
                      )}
                    >
                      {v.performanceDelta > 0 ? "+" : ""}
                      {v.performanceDelta} AUROC pts
                    </span>
                  )}
                </div>
                <div className="flex items-center gap-2">
                  {v.rollbackAvailable && (
                    <Button variant="ghost" size="sm">
                      <RotateCcw className="h-3.5 w-3.5" />
                      Roll back
                    </Button>
                  )}
                </div>
              </div>
              <div className="mt-2 grid grid-cols-2 gap-x-4 gap-y-1 text-2xs text-fg-dim sm:grid-cols-4">
                <span>
                  Released <span className="text-fg-muted">{fmtDate(v.releaseDate)}</span>
                </span>
                <span>
                  Approver <span className="text-fg-muted">{v.approvedBy ?? "Pending"}</span>
                </span>
                <span>
                  Validation <span className="text-fg-muted">{v.validationStatus}</span>
                </span>
                <span>
                  AUROC <span className="tnum text-fg-muted">{v.metrics.auroc.toFixed(3)}</span>
                </span>
              </div>
              {v.notes && (
                <p className="mt-2 rounded-md border border-edge bg-raised px-2.5 py-1.5 text-2xs text-fg-muted">
                  {v.notes}
                </p>
              )}
              <ul className="mt-2 space-y-0.5">
                {v.changelog.map((c, i) => (
                  <li key={i} className="flex gap-2 text-xs text-fg-muted">
                    <span className="text-fg-dim">•</span>
                    {c}
                  </li>
                ))}
              </ul>
            </PanelBody>
          </Panel>
        ))}
      </div>

      <div className="lg:col-span-1">
        <Panel className="sticky top-20">
          <PanelHeader
            icon={<GitCompare className="h-4 w-4" />}
            title="Compare Versions"
            description="Side-by-side validation metrics."
          />
          <PanelBody>
            <div className="grid grid-cols-2 gap-2">
              <label className="block">
                <span className="mb-1 block text-2xs font-medium uppercase tracking-wide text-fg-dim">
                  Baseline
                </span>
                <Select value={aId} onChange={(e) => setAId(e.target.value)}>
                  {versions.map((v) => (
                    <option key={v.id} value={v.id}>
                      {v.version}
                    </option>
                  ))}
                </Select>
              </label>
              <label className="block">
                <span className="mb-1 block text-2xs font-medium uppercase tracking-wide text-fg-dim">
                  Compare
                </span>
                <Select value={bId} onChange={(e) => setBId(e.target.value)}>
                  {versions.map((v) => (
                    <option key={v.id} value={v.id}>
                      {v.version}
                    </option>
                  ))}
                </Select>
              </label>
            </div>

            <div className="mt-4">
              <div className="grid grid-cols-[1.4fr_1fr_1fr_1fr] gap-2 border-b border-edge pb-1.5 text-2xs font-medium uppercase tracking-wide text-fg-dim">
                <span>Metric</span>
                <span className="font-mono normal-case tracking-normal">{a.version}</span>
                <span className="font-mono normal-case tracking-normal">{b.version}</span>
                <span>Δ</span>
              </div>
              <CompareRow label="AUROC" a={a.metrics.auroc} b={b.metrics.auroc} digits={3} />
              <CompareRow label="Sensitivity" a={a.metrics.sensitivity} b={b.metrics.sensitivity} digits={1} suffix="%" />
              <CompareRow label="Specificity" a={a.metrics.specificity} b={b.metrics.specificity} digits={1} suffix="%" />
            </div>

            <p className="mt-3 text-2xs leading-relaxed text-fg-dim">
              {b.metrics.auroc >= a.metrics.auroc
                ? `${b.version} improves AUROC over ${a.version}. Review subgroup metrics before promotion.`
                : `${b.version} underperforms ${a.version} on AUROC. Investigate before any rollback decision.`}
            </p>
          </PanelBody>
        </Panel>
      </div>
    </div>
  );
}
