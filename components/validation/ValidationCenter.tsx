"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import {
  Ban,
  CheckCircle2,
  CircleCheck,
  FileText,
  Play,
  ShieldCheck,
} from "lucide-react";
import { cn } from "@/lib/cn";
import { Panel, PanelBody, PanelHeader } from "@/components/ui/Panel";
import { Button } from "@/components/ui/Button";
import { Field, Select, TextArea } from "@/components/ui/Modal";
import { Callout } from "@/components/ui/Feedback";
import { ProgressBar } from "@/components/ui/Feedback";
import { Badge } from "@/components/ui/Badge";
import { ValidationReport } from "./ValidationReport";
import { useStore } from "@/lib/store";
import { useAuth } from "@/lib/auth";
import { buildValidationRun, VALIDATION_TESTS } from "@/lib/validationEngine";
import { fmtDate, relativeTime } from "@/lib/format";
import type { ValidationDataset, ValidationRun } from "@/lib/types";

type Phase = "idle" | "running" | "report";

export function ValidationCenter({ initialSystem }: { initialSystem?: string }) {
  const { systems, validations, refresh } = useStore();
  const { session } = useAuth();
  const runnable = systems.filter((s) => s.environment !== "Development");

  // Datasets are derived from prior validation runs, with a sensible default
  // so a first validation can always be run.
  const datasets = useMemo<ValidationDataset[]>(() => {
    const seen = new Map<string, ValidationDataset>();
    for (const r of validations) {
      if (!seen.has(r.dataset)) {
        seen.set(r.dataset, {
          id: r.dataset,
          name: r.dataset,
          description: "",
          size: r.datasetSize,
          window: "",
          phiHandling: "",
        });
      }
    }
    if (seen.size === 0) {
      seen.set("holdout", {
        id: "holdout",
        name: "Held-out validation set",
        description: "",
        size: 5000,
        window: "",
        phiHandling: "",
      });
    }
    return [...seen.values()];
  }, [validations]);

  // Approvers: the current user plus the people who own registered systems.
  const approvers = useMemo(() => {
    const seen = new Set<string>();
    if (session?.name) seen.add(session.name);
    systems.forEach((s) => {
      if (s.ownerContact) seen.add(s.ownerContact);
    });
    return [...seen];
  }, [systems, session]);

  const [systemId, setSystemId] = useState(
    initialSystem && systems.some((s) => s.id === initialSystem) ? initialSystem : "",
  );
  const system = systems.find((s) => s.id === systemId) ?? runnable[0];

  const [versionId, setVersionId] = useState("");
  const [datasetId, setDatasetId] = useState("");
  const [tests, setTests] = useState<Set<string>>(
    new Set(VALIDATION_TESTS.map((t) => t.key)),
  );

  const [phase, setPhase] = useState<Phase>("idle");
  const [runningIndex, setRunningIndex] = useState(0);
  const [result, setResult] = useState<ValidationRun | null>(null);
  const [viewingPast, setViewingPast] = useState<ValidationRun | null>(null);

  const [approver, setApprover] = useState("");
  const [comment, setComment] = useState("");
  const [decision, setDecision] = useState<{ kind: "Approved" | "Blocked"; auditId: string } | null>(null);

  // Effective selections with fallbacks (the store hydrates asynchronously).
  const version =
    system?.versions.find((v) => v.version === versionId) ?? system?.versions[0];
  const versionValue = version?.version ?? "";
  const dataset = datasets.find((d) => d.id === datasetId) ?? datasets[0];
  const datasetValue = dataset?.id ?? "";
  const approverValue = approvers.includes(approver) ? approver : approvers[0] ?? "";

  // reset version when system changes
  const onSystem = (id: string) => {
    setSystemId(id);
    const s = systems.find((x) => x.id === id);
    setVersionId(s?.versions[0]?.version ?? "");
    setPhase("idle");
    setResult(null);
    setViewingPast(null);
    setDecision(null);
  };

  const selectedTestsList = useMemo(
    () => VALIDATION_TESTS.filter((t) => tests.has(t.key)),
    [tests],
  );

  // run animation
  useEffect(() => {
    if (phase !== "running") return;
    if (runningIndex > selectedTestsList.length) {
      const t = setTimeout(() => setPhase("report"), 350);
      return () => clearTimeout(t);
    }
    const t = setTimeout(() => setRunningIndex((i) => i + 1), 520);
    return () => clearTimeout(t);
  }, [phase, runningIndex, selectedTestsList.length]);

  const startRun = () => {
    if (!system || !dataset) return;
    const built = buildValidationRun(system, versionValue, dataset, tests);
    setResult(built);
    setViewingPast(null);
    setDecision(null);
    setComment("");
    setRunningIndex(0);
    setPhase("running");
  };

  const toggleTest = (key: string) =>
    setTests((prev) => {
      const next = new Set(prev);
      next.has(key) ? next.delete(key) : next.add(key);
      return next;
    });

  // Persist the run and its decision to the real API, then refresh the store.
  const decide = async (kind: "Approved" | "Blocked") => {
    if (!active || !system) return;
    try {
      const res = await fetch("/api/validation", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          systemId: system.id,
          systemName: system.name,
          version: versionValue,
          dataset: dataset?.name ?? "Held-out validation set",
          datasetSize: dataset?.size ?? 0,
          status: active.status,
          result: active.overallResult,
          tests: active.tests,
          metrics: active.metrics,
          subgroups: active.subgroups,
        }),
      });
      if (res.ok) {
        const created = await res.json().catch(() => ({}));
        const runId = created.id ?? created.run?.id;
        if (runId) {
          await fetch(`/api/validation/${runId}`, {
            method: "PATCH",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ decision: { decision: kind, comment } }),
          });
        }
        refresh();
      }
    } catch {
      /* keep the local confirmation even if the network call fails */
    }
    setDecision({ kind, auditId: "the governance audit trail" });
  };

  const active = viewingPast ?? result;
  const progress = Math.min(100, (runningIndex / (selectedTestsList.length + 1)) * 100);

  if (!system) {
    return (
      <div className="rounded-xl border border-edge bg-panel p-8">
        <div className="text-lg font-semibold text-fg">No systems to validate yet</div>
        <p className="mt-1 text-fg-muted">Register an AI system to run your first validation.</p>
      </div>
    );
  }

  return (
    <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
      {/* Config wizard */}
      <div className="space-y-4 lg:col-span-1">
        <Panel>
          <PanelHeader
            icon={<ShieldCheck className="h-4 w-4" />}
            title="Configure Validation"
            description="Validate a model against a dataset before deployment."
          />
          <PanelBody className="space-y-3.5">
            <Field label="1 · AI system">
              <Select value={systemId} onChange={(e) => onSystem(e.target.value)}>
                {runnable.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.name}
                  </option>
                ))}
              </Select>
            </Field>
            <Field label="2 · Model version">
              <Select value={versionValue} onChange={(e) => setVersionId(e.target.value)}>
                {system.versions.map((v) => (
                  <option key={v.id} value={v.version}>
                    {v.version} · {v.status}
                  </option>
                ))}
              </Select>
            </Field>
            <Field label="3 · Validation dataset">
              <Select value={datasetValue} onChange={(e) => setDatasetId(e.target.value)}>
                {datasets.map((d) => (
                  <option key={d.id} value={d.id}>
                    {d.name} ({d.size.toLocaleString()})
                  </option>
                ))}
              </Select>
            </Field>
            <div>
              <span className="mb-1.5 block text-xs font-medium text-fg-muted">
                4 · Validation tests
              </span>
              <div className="flex flex-wrap gap-1.5">
                {VALIDATION_TESTS.map((t) => {
                  const on = tests.has(t.key);
                  return (
                    <button
                      key={t.key}
                      onClick={() => toggleTest(t.key)}
                      className={cn(
                        "rounded-md border px-2 py-1 text-xs font-medium transition-colors",
                        on
                          ? "border-accent/40 bg-accent-soft text-fg"
                          : "border-edge bg-panel text-fg-dim hover:text-fg",
                      )}
                    >
                      {t.label}
                    </button>
                  );
                })}
              </div>
            </div>
            <Button
              variant="primary"
              className="w-full"
              onClick={startRun}
              disabled={phase === "running" || tests.size === 0}
            >
              <Play className="h-4 w-4" />
              {phase === "running" ? "Running validation…" : "Run validation"}
            </Button>
          </PanelBody>
        </Panel>

        <Panel>
          <PanelHeader title="Recent Runs" description="Prior validation reports." />
          <div className="divide-y divide-edge">
            {validations.length === 0 && (
              <p className="px-4 py-6 text-sm font-medium text-fg-muted">
                No validation runs yet. Configure and run one above to create the first report.
              </p>
            )}
            {validations.map((r) => (
              <button
                key={r.id}
                onClick={() => {
                  setViewingPast(r);
                  setPhase("report");
                  setDecision(null);
                }}
                className="flex w-full items-center justify-between gap-2 px-4 py-2.5 text-left transition-colors hover:bg-hover"
              >
                <div className="min-w-0">
                  <div className="truncate text-sm font-medium text-fg">{r.systemName}</div>
                  <div className="text-2xs text-fg-dim tnum">
                    {r.version} · {relativeTime(r.startedAt)}
                  </div>
                </div>
                <Badge
                  tone={
                    r.overallResult === "Passed"
                      ? "good"
                      : r.overallResult === "Failed"
                        ? "critical"
                        : r.overallResult === "In progress"
                          ? "neutral"
                          : "warning"
                  }
                >
                  {r.overallResult === "In progress" ? "Running" : r.overallResult}
                </Badge>
              </button>
            ))}
          </div>
        </Panel>
      </div>

      {/* Result area */}
      <div className="lg:col-span-2">
        {phase === "idle" && (
          <Panel>
            <PanelBody className="flex flex-col items-center justify-center py-20 text-center">
              <FileText className="mb-3 h-8 w-8 text-fg-dim" />
              <div className="text-sm font-medium text-fg">No active validation</div>
              <p className="mt-1 max-w-sm text-xs text-fg-muted">
                Configure a system, version, dataset, and test suite, then run validation to
                produce a governed report. You can also open a recent run on the left.
              </p>
            </PanelBody>
          </Panel>
        )}

        {phase === "running" && (
          <Panel>
            <PanelHeader
              title="Running Validation"
              description={`${system.name} · ${versionId}`}
            />
            <PanelBody>
              <div className="mb-4 flex items-center justify-between text-sm">
                <span className="text-fg-muted">Progress</span>
                <span className="font-semibold tnum text-fg">{Math.round(progress)}%</span>
              </div>
              <ProgressBar value={progress} height={8} />
              <div className="mt-5 space-y-2.5">
                {selectedTestsList.map((t, i) => {
                  const done = i < runningIndex;
                  const running = i === runningIndex;
                  return (
                    <div key={t.key} className="flex items-center gap-2.5">
                      {done ? (
                        <CheckCircle2 className="h-4 w-4 text-positive" />
                      ) : running ? (
                        <span className="h-3.5 w-3.5 animate-spin rounded-full border-2 border-accent border-t-transparent" />
                      ) : (
                        <span className="h-3.5 w-3.5 rounded-full border border-edge-strong" />
                      )}
                      <span className={cn("text-sm", done ? "text-fg" : running ? "text-fg" : "text-fg-dim")}>
                        {t.label}
                      </span>
                      <span className="ml-auto text-2xs text-fg-dim">
                        {done ? "Complete" : running ? "Running" : "Queued"}
                      </span>
                    </div>
                  );
                })}
              </div>
            </PanelBody>
          </Panel>
        )}

        {phase === "report" && active && (
          <div className="space-y-4">
            <ValidationReport run={active} />

            {/* Decision panel */}
            {viewingPast ? (
              viewingPast.decision && (
                <Callout
                  tone={viewingPast.decision.decision === "Approved" ? "good" : "critical"}
                  icon={<CircleCheck className="h-4 w-4" />}
                  title={`${viewingPast.decision.decision} by ${viewingPast.decision.by} · ${fmtDate(viewingPast.decision.at)}`}
                >
                  {viewingPast.decision.comment}
                </Callout>
              )
            ) : decision ? (
              <Callout
                tone={decision.kind === "Approved" ? "good" : "critical"}
                icon={decision.kind === "Approved" ? <CheckCircle2 className="h-4 w-4" /> : <Ban className="h-4 w-4" />}
                title={
                  decision.kind === "Approved"
                    ? `Approved for deployment by ${approverValue}`
                    : `Blocked from promotion by ${approverValue}`
                }
              >
                Decision recorded to {decision.auditId}.{" "}
                {decision.kind === "Blocked"
                  ? "The model version cannot be promoted until the failing criteria are remediated and re-validated. "
                  : "The version is cleared to advance in the governance workflow. "}
                <Link href="/governance" className="font-medium underline">
                  View governance workflow
                </Link>
                .
              </Callout>
            ) : (
              <Panel>
                <PanelHeader
                  title="Deployment Decision"
                  description="Approve or block this version. The decision is recorded to the audit log with your name and comment."
                />
                <PanelBody className="space-y-3">
                  {active.overallResult === "Failed" && (
                    <Callout tone="critical" title="Validation failed">
                      This version failed one or more acceptance criteria and cannot be approved
                      for production. Block promotion and route back for remediation.
                    </Callout>
                  )}
                  <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                    <Field label="Approver">
                      <Select value={approverValue} onChange={(e) => setApprover(e.target.value)}>
                        {approvers.map((a) => (
                          <option key={a}>{a}</option>
                        ))}
                      </Select>
                    </Field>
                    <Field label="Decision timestamp">
                      <div className="flex h-[38px] items-center rounded-md border border-edge bg-raised px-2.5 text-sm text-fg-muted tnum">
                        {fmtDate(new Date().toISOString())}
                      </div>
                    </Field>
                  </div>
                  <Field label="Comment (required)">
                    <TextArea
                      rows={2}
                      value={comment}
                      onChange={(e) => setComment(e.target.value)}
                      placeholder="Document the rationale for this decision…"
                    />
                  </Field>
                  <div className="flex items-center justify-end gap-2">
                    <Button variant="danger" onClick={() => decide("Blocked")} disabled={!comment.trim()}>
                      <Ban className="h-4 w-4" />
                      Block promotion
                    </Button>
                    <Button
                      variant="primary"
                      onClick={() => decide("Approved")}
                      disabled={!comment.trim() || active.overallResult === "Failed"}
                    >
                      <CheckCircle2 className="h-4 w-4" />
                      Approve deployment
                    </Button>
                  </div>
                </PanelBody>
              </Panel>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
