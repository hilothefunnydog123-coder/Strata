"use client";

import Link from "next/link";
import { useState } from "react";
import {
  AlertTriangle,
  CheckCircle2,
  CircleDashed,
  Clock,
  FileCheck,
  FileX,
  XCircle,
} from "lucide-react";
import { cn } from "@/lib/cn";
import { Panel, PanelBody, PanelHeader } from "@/components/ui/Panel";
import { RiskBadge, Badge } from "@/components/ui/Badge";
import { Callout } from "@/components/ui/Feedback";
import { fmtDate } from "@/lib/format";
import type { GovernanceWorkflow, GovStepStatus, MetricStatus } from "@/lib/types";

const STEP_TONE: Record<GovStepStatus, MetricStatus> = {
  Complete: "good",
  "In progress": "warning",
  Blocked: "critical",
  Pending: "neutral",
  Rejected: "critical",
};

const STEP_ICON: Record<GovStepStatus, React.ReactNode> = {
  Complete: <CheckCircle2 className="h-4 w-4" />,
  "In progress": <Clock className="h-4 w-4" />,
  Blocked: <AlertTriangle className="h-4 w-4" />,
  Pending: <CircleDashed className="h-4 w-4" />,
  Rejected: <XCircle className="h-4 w-4" />,
};

const WF_TONE: Record<GovernanceWorkflow["status"], MetricStatus> = {
  Draft: "neutral",
  "In review": "warning",
  Blocked: "critical",
  Approved: "good",
  Rejected: "critical",
};

export function GovernanceBoard({ workflows }: { workflows: GovernanceWorkflow[] }) {
  const [selectedId, setSelectedId] = useState(workflows[0].id);
  const wf = workflows.find((w) => w.id === selectedId)!;
  const completed = wf.steps.filter((s) => s.status === "Complete").length;

  return (
    <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
      {/* Workflow list */}
      <div className="lg:col-span-1">
        <Panel>
          <PanelHeader title="Approval Workflows" description="AI systems in the governance pipeline." />
          <div className="divide-y divide-edge">
            {workflows.map((w) => {
              const done = w.steps.filter((s) => s.status === "Complete").length;
              return (
                <button
                  key={w.id}
                  onClick={() => setSelectedId(w.id)}
                  className={cn(
                    "flex w-full flex-col gap-1.5 px-4 py-3 text-left transition-colors",
                    w.id === selectedId ? "bg-accent-soft" : "hover:bg-hover",
                  )}
                >
                  <div className="flex items-start justify-between gap-2">
                    <span className="text-sm font-medium text-fg">{w.systemName}</span>
                    <Badge tone={WF_TONE[w.status]}>{w.status}</Badge>
                  </div>
                  <div className="flex items-center gap-2 text-2xs text-fg-dim">
                    <RiskBadge risk={w.riskLevel} />
                    <span>·</span>
                    <span>{w.currentStage}</span>
                  </div>
                  <div className="mt-0.5 flex items-center gap-1">
                    {w.steps.map((s, i) => (
                      <span
                        key={i}
                        className={cn(
                          "h-1 flex-1 rounded-full",
                          s.status === "Complete"
                            ? "bg-positive"
                            : s.status === "Blocked" || s.status === "Rejected"
                              ? "bg-critical"
                              : s.status === "In progress"
                                ? "bg-warning"
                                : "bg-raised",
                        )}
                      />
                    ))}
                  </div>
                </button>
              );
            })}
          </div>
        </Panel>
      </div>

      {/* Workflow detail */}
      <div className="lg:col-span-2">
        <Panel>
          <PanelHeader
            title={wf.systemName}
            description={`${wf.vendor === "Internal" ? "Internal" : wf.vendor} · ${wf.category} · Submitted by ${wf.submittedBy} on ${fmtDate(wf.submittedAt)}`}
            actions={<Badge tone={WF_TONE[wf.status]}>{wf.status}</Badge>}
          />
          <PanelBody>
            <div className="mb-4 flex flex-wrap items-center gap-x-6 gap-y-2 text-xs">
              <span className="text-fg-dim">
                Risk <span className="ml-1"><RiskBadge risk={wf.riskLevel} /></span>
              </span>
              <span className="text-fg-dim">
                Stage <span className="font-medium text-fg">{wf.currentStage}</span>
              </span>
              <span className="text-fg-dim">
                Progress <span className="font-medium text-fg tnum">{completed}/{wf.steps.length}</span>
              </span>
              {wf.targetGoLive && (
                <span className="text-fg-dim">
                  Target go-live <span className="font-medium text-fg">{fmtDate(wf.targetGoLive)}</span>
                </span>
              )}
            </div>

            {wf.blockingReason && (
              <Callout tone="critical" icon={<AlertTriangle className="h-4 w-4" />} title="Blocking this approval" className="mb-4">
                {wf.blockingReason}
              </Callout>
            )}

            <div className="relative">
              <div className="absolute bottom-4 left-[15px] top-4 w-px bg-edge" />
              <ul className="space-y-3">
                {wf.steps.map((step) => {
                  const tone = STEP_TONE[step.status];
                  const t =
                    tone === "good"
                      ? "border-positive/40 bg-positive/10 text-positive"
                      : tone === "critical"
                        ? "border-critical/40 bg-critical/10 text-critical"
                        : tone === "warning"
                          ? "border-warning/40 bg-warning/10 text-warning"
                          : "border-edge bg-raised text-fg-dim";
                  return (
                    <li key={step.key} className="relative flex gap-3">
                      <span className={cn("relative z-10 mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-full border", t)}>
                        {STEP_ICON[step.status]}
                      </span>
                      <div className="min-w-0 flex-1 rounded-lg border border-edge bg-raised p-3">
                        <div className="flex flex-wrap items-center justify-between gap-2">
                          <span className="text-sm font-medium text-fg">{step.name}</span>
                          <Badge tone={tone}>{step.status}</Badge>
                        </div>
                        <div className="mt-1 flex flex-wrap items-center gap-x-4 gap-y-1 text-2xs text-fg-dim">
                          <span>
                            Owner <span className="text-fg-muted">{step.owner}</span> · {step.ownerRole}
                          </span>
                          {step.completedAt && <span>Completed {fmtDate(step.completedAt)}</span>}
                          {step.dueDate && !step.completedAt && (
                            <span className={step.status === "Blocked" ? "text-critical" : undefined}>
                              Due {fmtDate(step.dueDate)}
                            </span>
                          )}
                        </div>
                        {step.comment && (
                          <p className="mt-1.5 text-xs text-fg-muted">{step.comment}</p>
                        )}
                        {step.requiredDocs.length > 0 && (
                          <div className="mt-2 flex flex-wrap gap-1.5">
                            {step.requiredDocs.map((doc, i) => (
                              <span
                                key={i}
                                className={cn(
                                  "inline-flex items-center gap-1 rounded border px-1.5 py-0.5 text-2xs",
                                  doc.status === "Provided"
                                    ? "border-positive/30 text-positive"
                                    : doc.status === "Missing"
                                      ? "border-critical/30 text-critical"
                                      : "border-warning/30 text-warning",
                                )}
                              >
                                {doc.status === "Missing" ? (
                                  <FileX className="h-3 w-3" />
                                ) : (
                                  <FileCheck className="h-3 w-3" />
                                )}
                                {doc.name}
                              </span>
                            ))}
                          </div>
                        )}
                      </div>
                    </li>
                  );
                })}
              </ul>
            </div>

            {wf.systemId && (
              <div className="mt-4 border-t border-edge pt-3">
                <Link
                  href={`/registry/${wf.systemId}`}
                  className="text-xs font-medium text-accent hover:underline"
                >
                  Open control center →
                </Link>
              </div>
            )}
          </PanelBody>
        </Panel>
      </div>
    </div>
  );
}
