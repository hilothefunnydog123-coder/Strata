"use client";

import Link from "next/link";
import { useState } from "react";
import {
  ArrowRight,
  ChevronRight,
  CircleDot,
  GitCommitHorizontal,
  Plus,
} from "lucide-react";
import { cn } from "@/lib/cn";
import { Panel, PanelBody, PanelHeader } from "@/components/ui/Panel";
import { Button } from "@/components/ui/Button";
import { IncidentSeverityBadge, Badge } from "@/components/ui/Badge";
import { KeyValue } from "@/components/ui/Metric";
import { Sparkline } from "@/components/charts/Sparkline";
import { AlertCard } from "@/components/alerts/AlertCard";
import { fmtDateTime, relativeTime } from "@/lib/format";
import type {
  Alert,
  AuditEvent,
  AISystem,
  Incident,
  IncidentEvent,
  IncidentStatus,
  MetricStatus,
} from "@/lib/types";

const LIFECYCLE: IncidentStatus[] = ["Investigating", "Contained", "Monitoring", "Resolved", "Closed"];

const EVENT_TONE: Record<IncidentEvent["kind"], MetricStatus> = {
  detect: "critical",
  action: "neutral",
  comment: "neutral",
  status: "warning",
  deploy: "neutral",
  resolve: "good",
};

export function IncidentWorkspace({
  incident,
  system,
  alerts,
  changes,
}: {
  incident: Incident;
  system?: AISystem;
  alerts: Alert[];
  changes: AuditEvent[];
}) {
  const [status, setStatus] = useState<IncidentStatus>(incident.status);
  const [timeline, setTimeline] = useState<IncidentEvent[]>(incident.timeline);
  const [note, setNote] = useState("");
  const [adding, setAdding] = useState(false);

  const stageIndex = LIFECYCLE.indexOf(status);

  const advance = (to: IncidentStatus, text: string) => {
    setStatus(to);
    setTimeline((prev) => [
      ...prev,
      { at: new Date().toISOString(), actor: "You · Operator", kind: to === "Resolved" ? "resolve" : "status", text },
    ]);
  };

  const nextAction =
    status === "Investigating"
      ? { label: "Mark contained", to: "Contained" as IncidentStatus, text: "Incident contained." }
      : status === "Contained"
        ? { label: "Move to monitoring", to: "Monitoring" as IncidentStatus, text: "Fix deployed; monitoring for recovery." }
        : status === "Monitoring"
          ? { label: "Mark resolved", to: "Resolved" as IncidentStatus, text: "Metrics recovered; incident resolved." }
          : status === "Resolved"
            ? { label: "Close incident", to: "Closed" as IncidentStatus, text: "Incident closed after review." }
            : null;

  const addNote = () => {
    if (!note.trim()) return;
    setTimeline((prev) => [
      ...prev,
      { at: new Date().toISOString(), actor: "You · Operator", kind: "comment", text: note.trim() },
    ]);
    setNote("");
    setAdding(false);
  };

  return (
    <div>
      <nav className="mb-3 flex items-center gap-1 text-xs text-fg-dim">
        <Link href="/incidents" className="hover:text-fg-muted">
          Incidents
        </Link>
        <ChevronRight className="h-3 w-3" />
        <span className="font-mono text-fg-muted">{incident.id}</span>
      </nav>

      <div className="flex flex-col gap-4 border-b border-edge pb-5 lg:flex-row lg:items-start lg:justify-between">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2.5">
            <IncidentSeverityBadge severity={incident.severity} />
            <Badge tone={status === "Resolved" || status === "Closed" ? "good" : status === "Investigating" ? "critical" : "warning"}>
              {status}
            </Badge>
            <span className="font-mono text-2xs text-fg-dim">{incident.id}</span>
          </div>
          <h1 className="mt-2 text-xl font-semibold tracking-tight text-fg sm:text-2xl">
            {incident.title}
          </h1>
          <div className="mt-1.5 text-sm text-fg-muted">
            {system && (
              <Link href={`/registry/${system.id}`} className="font-medium text-accent hover:underline">
                {incident.systemName}
              </Link>
            )}{" "}
            · Opened {fmtDateTime(incident.openedAt)} · Owner {incident.owner} · Detected by{" "}
            {incident.detectedBy}
          </div>
        </div>
        <div className="flex shrink-0 flex-wrap items-center gap-2">
          <Button variant="secondary" onClick={() => setAdding((a) => !a)}>
            <Plus className="h-4 w-4" />
            Add update
          </Button>
          {nextAction && (
            <Button variant="primary" onClick={() => advance(nextAction.to, nextAction.text)}>
              {nextAction.label}
            </Button>
          )}
        </div>
      </div>

      {/* Lifecycle stepper */}
      <div className="mt-4 flex items-center gap-1 overflow-x-auto">
        {LIFECYCLE.map((s, i) => (
          <div key={s} className="flex items-center gap-1">
            <span
              className={cn(
                "flex items-center gap-1.5 rounded-md border px-2.5 py-1 text-xs font-medium",
                i < stageIndex
                  ? "border-positive/30 bg-positive/10 text-positive"
                  : i === stageIndex
                    ? "border-accent/40 bg-accent-soft text-fg"
                    : "border-edge bg-panel text-fg-dim",
              )}
            >
              {i === stageIndex && <CircleDot className="h-3 w-3" />}
              {s}
            </span>
            {i < LIFECYCLE.length - 1 && <ChevronRight className="h-3 w-3 text-fg-dim" />}
          </div>
        ))}
      </div>

      {adding && (
        <div className="mt-3 flex gap-2">
          <input
            value={note}
            onChange={(e) => setNote(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && addNote()}
            placeholder="Add an investigation update…"
            className="h-9 flex-1 rounded-md border border-edge bg-panel px-3 text-sm text-fg placeholder:text-fg-dim focus:border-accent focus:outline-none"
            autoFocus
          />
          <Button variant="primary" onClick={addNote}>
            Post
          </Button>
        </div>
      )}

      <div className="mt-5 grid grid-cols-1 gap-4 lg:grid-cols-3">
        <div className="space-y-4 lg:col-span-2">
          <Panel>
            <PanelHeader title="Summary" />
            <PanelBody>
              <p className="text-sm leading-relaxed text-fg-muted">{incident.description}</p>
              <div className="mt-4 grid grid-cols-1 gap-4 sm:grid-cols-2">
                <KeyValue label="Affected period" value={incident.affectedPeriod} />
                <KeyValue label="Suspected cause" value={incident.suspectedCause} />
                <KeyValue label="Affected population" value={incident.affectedPopulation} />
                {incident.rootCause && <KeyValue label="Root cause" value={incident.rootCause} />}
                {incident.resolution && <KeyValue label="Resolution" value={incident.resolution} />}
                <KeyValue label="Clinical impact" value={incident.impact} />
              </div>
            </PanelBody>
          </Panel>

          <Panel>
            <PanelHeader title="Timeline" description="Detection, investigation, and remediation events." />
            <PanelBody>
              <div className="relative pl-1">
                <div className="absolute bottom-2 left-[7px] top-2 w-px bg-edge" />
                <ul className="space-y-3.5">
                  {timeline.map((e, i) => {
                    const tone = EVENT_TONE[e.kind];
                    const dot =
                      tone === "critical"
                        ? "bg-critical"
                        : tone === "good"
                          ? "bg-positive"
                          : tone === "warning"
                            ? "bg-warning"
                            : "bg-fg-dim";
                    return (
                      <li key={i} className="relative flex gap-3">
                        <span className={cn("relative z-10 mt-1 h-3.5 w-3.5 shrink-0 rounded-full border-2 border-canvas", dot)} />
                        <div className="min-w-0 flex-1 pb-0.5">
                          <div className="flex flex-wrap items-center gap-2">
                            <span className="text-sm text-fg">{e.text}</span>
                          </div>
                          <div className="mt-0.5 flex items-center gap-2 text-2xs text-fg-dim">
                            <span className="font-medium">{e.actor}</span>
                            <span>·</span>
                            <span className="tnum">{fmtDateTime(e.at)}</span>
                          </div>
                        </div>
                      </li>
                    );
                  })}
                </ul>
              </div>
            </PanelBody>
          </Panel>
        </div>

        <div className="space-y-4">
          {system && (
            <Panel>
              <PanelHeader title="Affected System" />
              <PanelBody>
                <div className="text-sm font-medium text-fg">{system.name}</div>
                <div className="mt-0.5 text-2xs text-fg-dim">
                  {system.category} · v{system.currentVersion}
                </div>
                <div className="mt-3 flex items-end justify-between">
                  <div>
                    <div className="text-2xs uppercase tracking-wide text-fg-dim">
                      {system.performance.headline.label}
                    </div>
                    <div className="text-lg font-semibold tnum text-fg">
                      {system.performance.headline.value.toFixed(1)}%
                    </div>
                  </div>
                  <Sparkline
                    data={system.performance.sparkline}
                    width={120}
                    height={36}
                    stroke={
                      system.performance.headline.status === "critical"
                        ? "rgb(var(--critical))"
                        : "rgb(var(--warning))"
                    }
                  />
                </div>
                <Link
                  href={`/registry/${system.id}?tab=performance`}
                  className="mt-3 inline-flex items-center gap-1 text-xs font-medium text-accent hover:underline"
                >
                  Open control center <ArrowRight className="h-3.5 w-3.5" />
                </Link>
              </PanelBody>
            </Panel>
          )}

          {changes.length > 0 && (
            <Panel>
              <PanelHeader title="What Changed Before Onset" description="Deployments and configuration changes preceding the incident." />
              <PanelBody className="space-y-2.5">
                {changes.map((c) => (
                  <div key={c.id} className="flex items-start gap-2.5">
                    <GitCommitHorizontal className="mt-0.5 h-3.5 w-3.5 shrink-0 text-fg-dim" />
                    <div className="min-w-0">
                      <div className="text-xs text-fg">
                        {c.action} <span className="font-medium">{c.object}</span>
                      </div>
                      <div className="text-2xs text-fg-dim tnum">
                        {c.actor} · {relativeTime(c.at)}
                      </div>
                    </div>
                  </div>
                ))}
              </PanelBody>
            </Panel>
          )}

          {alerts.length > 0 && (
            <Panel>
              <PanelHeader title="Related Alerts" />
              <div className="divide-y divide-edge">
                {alerts.map((a) => (
                  <AlertCard key={a.id} alert={a} compact />
                ))}
              </div>
            </Panel>
          )}
        </div>
      </div>
    </div>
  );
}
