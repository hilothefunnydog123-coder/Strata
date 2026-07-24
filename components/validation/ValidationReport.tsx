import {
  AlertTriangle,
  CheckCircle2,
  CircleSlash,
  XCircle,
} from "lucide-react";
import { cn } from "@/lib/cn";
import { Panel, PanelBody, PanelHeader } from "@/components/ui/Panel";
import { statusColor } from "@/lib/format";
import { toneToClasses } from "@/lib/constants";
import type {
  MetricStatus,
  ValidationMetricResult,
  ValidationRun,
  ValidationTest,
} from "@/lib/types";

const TEST_ICON: Record<ValidationTest["status"], React.ReactNode> = {
  Passed: <CheckCircle2 className="h-4 w-4 text-positive" />,
  Warning: <AlertTriangle className="h-4 w-4 text-warning" />,
  Failed: <XCircle className="h-4 w-4 text-critical" />,
  Running: <span className="h-3.5 w-3.5 animate-spin rounded-full border-2 border-accent border-t-transparent" />,
  Queued: <CircleSlash className="h-4 w-4 text-fg-dim" />,
  Skipped: <CircleSlash className="h-4 w-4 text-fg-dim" />,
};

const RESULT_META: Record<
  string,
  { tone: MetricStatus; icon: React.ReactNode; label: string }
> = {
  Passed: { tone: "good", icon: <CheckCircle2 className="h-5 w-5" />, label: "Validation passed" },
  "Passed with warnings": { tone: "warning", icon: <AlertTriangle className="h-5 w-5" />, label: "Passed with warnings" },
  Failed: { tone: "critical", icon: <XCircle className="h-5 w-5" />, label: "Validation failed" },
  "In progress": { tone: "neutral", icon: <CircleSlash className="h-5 w-5" />, label: "In progress" },
};

function MetricResultRow({ m }: { m: ValidationMetricResult }) {
  const t = toneToClasses(m.status);
  return (
    <div className="grid grid-cols-[1.6fr_1fr_1fr_0.8fr] items-center gap-3 border-b border-edge/60 py-2.5 last:border-0">
      <span className="text-sm text-fg-muted">{m.metric}</span>
      <span className={cn("text-sm font-semibold tnum", statusColor[m.status])}>
        {m.value}
        {m.unit ?? (m.value < 1 ? "" : "")}
      </span>
      <span className="text-xs text-fg-dim tnum">
        {m.betterWhen === "higher" ? "≥" : "≤"} {m.threshold}
        {m.unit ?? ""}
      </span>
      <span className={cn("justify-self-end text-2xs font-semibold uppercase", t.text)}>
        {m.status === "good" ? "Pass" : m.status === "warning" ? "Warn" : "Fail"}
      </span>
    </div>
  );
}

export function ValidationReport({ run }: { run: ValidationRun }) {
  const meta = RESULT_META[run.overallResult] ?? RESULT_META["In progress"];
  const t = toneToClasses(meta.tone);

  return (
    <div className="space-y-4">
      <div className={cn("flex items-center gap-3 rounded-lg border p-4", t.bg, t.border)}>
        <span className={t.text}>{meta.icon}</span>
        <div className="flex-1">
          <div className={cn("text-base font-semibold", t.text)}>{meta.label}</div>
          <div className="mt-0.5 text-xs text-fg-muted">
            {run.systemName} · {run.version} · {run.dataset} ({run.datasetSize.toLocaleString()} cases)
          </div>
        </div>
      </div>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <Panel>
          <PanelHeader title="Validation Tests" />
          <PanelBody className="space-y-2">
            {run.tests.map((test) => (
              <div key={test.key} className="flex items-start gap-2.5">
                <span className="mt-0.5">{TEST_ICON[test.status]}</span>
                <div className="min-w-0 flex-1">
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-sm text-fg">{test.label}</span>
                    <span
                      className={cn(
                        "text-2xs font-semibold uppercase",
                        test.status === "Passed"
                          ? "text-positive"
                          : test.status === "Warning"
                            ? "text-warning"
                            : test.status === "Failed"
                              ? "text-critical"
                              : "text-fg-dim",
                      )}
                    >
                      {test.status}
                    </span>
                  </div>
                  <div className="text-2xs text-fg-dim">{test.detail ?? test.description}</div>
                </div>
              </div>
            ))}
          </PanelBody>
        </Panel>

        <Panel>
          <PanelHeader title="Metrics" description="Measured value against acceptance threshold." />
          <PanelBody>
            <div className="grid grid-cols-[1.6fr_1fr_1fr_0.8fr] gap-3 border-b border-edge pb-1.5 text-2xs font-medium uppercase tracking-wide text-fg-dim">
              <span>Metric</span>
              <span>Value</span>
              <span>Threshold</span>
              <span className="justify-self-end">Result</span>
            </div>
            {run.metrics.map((m) => (
              <MetricResultRow key={m.metric} m={m} />
            ))}
          </PanelBody>
        </Panel>
      </div>

      {run.subgroups.length > 0 && (
        <Panel>
          <PanelHeader
            title="Subgroup Performance"
            description="Minimum performance floor enforced within each subgroup."
          />
          <PanelBody>
            <div className="grid grid-cols-[1.4fr_0.8fr_1fr_1fr_1fr] gap-3 border-b border-edge pb-1.5 text-2xs font-medium uppercase tracking-wide text-fg-dim">
              <span>Subgroup</span>
              <span className="tnum">n</span>
              <span>Sensitivity</span>
              <span>Specificity</span>
              <span>FNR</span>
            </div>
            {run.subgroups.map((g) => (
              <div
                key={`${g.dimension}-${g.subgroup}`}
                className={cn(
                  "grid grid-cols-[1.4fr_0.8fr_1fr_1fr_1fr] items-center gap-3 border-b border-edge/50 py-2.5 last:border-0",
                  g.flagged && "rounded-md bg-critical/[0.06]",
                )}
              >
                <span className="flex items-center gap-1.5 text-sm text-fg">
                  {g.flagged && <AlertTriangle className="h-3.5 w-3.5 text-critical" />}
                  {g.dimension}: {g.subgroup}
                </span>
                <span className="text-sm text-fg-muted tnum">{g.n.toLocaleString()}</span>
                <span className={cn("text-sm tnum", g.flagged ? "font-semibold text-critical" : "text-fg")}>
                  {g.sensitivity.toFixed(1)}%
                </span>
                <span className="text-sm text-fg tnum">{g.specificity.toFixed(1)}%</span>
                <span className="text-sm text-fg tnum">{g.fnr.toFixed(1)}%</span>
              </div>
            ))}
          </PanelBody>
        </Panel>
      )}
    </div>
  );
}
