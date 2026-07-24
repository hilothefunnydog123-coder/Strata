"use client";

import { useState } from "react";
import {
  AlertOctagon,
  Radar,
  ShieldAlert,
} from "lucide-react";
import { cn } from "@/lib/cn";
import { Panel, PanelBody, PanelHeader } from "@/components/ui/Panel";
import { Badge } from "@/components/ui/Badge";
import { Callout } from "@/components/ui/Feedback";
import { ActionTimeline } from "./ActionTimeline";
import {
  agentActionsBySession,
  agentPolicies,
  agentSessions,
  agentStats,
} from "@/lib/data";
import { relativeTime } from "@/lib/format";
import type { AgentSession, MetricStatus } from "@/lib/types";

const SESSION_TONE: Record<AgentSession["status"], MetricStatus> = {
  Completed: "good",
  "Awaiting approval": "warning",
  Blocked: "critical",
  "In progress": "neutral",
};

const DETECTIONS = [
  { label: "Unexpected tool use", triggered: false },
  { label: "Unusual action sequences", triggered: true },
  { label: "Abnormally high activity", triggered: true },
  { label: "Actions outside permissions", triggered: false },
  { label: "Human approval bypass", triggered: false },
  { label: "Sensitive data access", triggered: false },
];

function Stat({ label, value, tone }: { label: string; value: React.ReactNode; tone?: string }) {
  return (
    <div className="rounded-lg border border-edge bg-raised px-3 py-2.5">
      <div className="text-2xs font-medium uppercase tracking-wider text-fg-dim">{label}</div>
      <div className={cn("mt-1 text-xl font-semibold tracking-tight tnum", tone ?? "text-fg")}>
        {value}
      </div>
    </div>
  );
}

export function AgentMonitor({ systemId = "prior-auth-agent" }: { systemId?: string }) {
  const sessions = agentSessions.filter((s) => s.systemId === systemId);
  const [selected, setSelected] = useState(sessions[0]?.id ?? "");
  const actions = agentActionsBySession[selected] ?? [];
  const anomalySession = sessions.find((s) => s.anomalyScore >= 0.8);

  if (sessions.length === 0) {
    return (
      <Callout tone="neutral" icon={<Radar className="h-4 w-4" />} title="No session capture for this agent">
        Detailed action-level monitoring is enabled for this agent but no sessions are in the
        selected window. Fleet-level metrics remain available in Agent Monitoring.
      </Callout>
    );
  }

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 gap-2.5 sm:grid-cols-4">
        <Stat label="Active sessions" value={agentStats.activeSessions} />
        <Stat label="Actions · 24h" value={agentStats.actions24h.toLocaleString()} />
        <Stat label="Human approvals · 24h" value={agentStats.humanApprovals24h} />
        <Stat
          label="Blocked actions · 24h"
          value={agentStats.blockedActions24h}
          tone={agentStats.blockedActions24h > 0 ? "text-warning" : "text-fg"}
        />
      </div>

      {anomalySession && (
        <Callout
          tone="critical"
          icon={<ShieldAlert className="h-4 w-4" />}
          title="Behavior anomaly detected"
        >
          Session {anomalySession.id} scored {anomalySession.anomalyScore.toFixed(2)} on the
          behavior model with {anomalySession.actionCount} actions ({anomalySession.riskFlags.join(", ")}).
          Duplicate submissions were blocked and the session was halted for human review.
        </Callout>
      )}

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-5">
        <div className="lg:col-span-2">
          <Panel>
            <PanelHeader title="Sessions" description="Most recent agent sessions." />
            <div className="divide-y divide-edge">
              {sessions.map((s) => (
                <button
                  key={s.id}
                  onClick={() => setSelected(s.id)}
                  className={cn(
                    "flex w-full flex-col gap-1 px-4 py-3 text-left transition-colors",
                    s.id === selected ? "bg-accent-soft" : "hover:bg-hover",
                  )}
                >
                  <div className="flex items-center justify-between gap-2">
                    <span className="font-mono text-xs font-semibold text-fg">{s.id}</span>
                    <Badge tone={SESSION_TONE[s.status]}>{s.status}</Badge>
                  </div>
                  <div className="truncate text-2xs text-fg-muted">{s.subject}</div>
                  <div className="flex items-center gap-3 text-2xs text-fg-dim tnum">
                    <span>{s.actionCount} actions</span>
                    <span>{s.toolCalls} tools</span>
                    <span>anomaly {s.anomalyScore.toFixed(2)}</span>
                    <span>{relativeTime(s.startedAt)}</span>
                  </div>
                </button>
              ))}
            </div>
          </Panel>

          <Panel className="mt-4">
            <PanelHeader
              icon={<Radar className="h-4 w-4" />}
              title="Behavior Detections"
              description="What Ward watches for on every agent action."
            />
            <PanelBody className="space-y-1.5">
              {DETECTIONS.map((d) => (
                <div key={d.label} className="flex items-center justify-between text-sm">
                  <span className="text-fg-muted">{d.label}</span>
                  {d.triggered ? (
                    <span className="inline-flex items-center gap-1 text-2xs font-semibold text-critical">
                      <AlertOctagon className="h-3 w-3" /> Triggered
                    </span>
                  ) : (
                    <span className="text-2xs text-positive">Monitoring</span>
                  )}
                </div>
              ))}
            </PanelBody>
          </Panel>

          <Panel className="mt-4">
            <PanelHeader title="Tool & Permission Scope" description="Per-tool policy and 24h usage." />
            <PanelBody className="p-0">
              <div className="divide-y divide-edge">
                {agentPolicies.map((p) => (
                  <div key={p.tool} className="flex items-center justify-between gap-2 px-4 py-2">
                    <div className="min-w-0">
                      <div className="truncate font-mono text-2xs text-fg">{p.tool}</div>
                      <div className="truncate text-2xs text-fg-dim">{p.scope}</div>
                    </div>
                    <div className="flex shrink-0 items-center gap-2">
                      {p.requiresApproval && (
                        <span className="rounded bg-warning/10 px-1 py-px text-[0.6rem] font-medium text-warning">
                          Approval
                        </span>
                      )}
                      <span
                        className={cn(
                          "text-2xs font-medium",
                          p.status === "Violation"
                            ? "text-critical"
                            : p.status === "Elevated"
                              ? "text-warning"
                              : "text-fg-dim",
                        )}
                      >
                        {p.status}
                      </span>
                    </div>
                  </div>
                ))}
              </div>
            </PanelBody>
          </Panel>
        </div>

        <div className="lg:col-span-3">
          <Panel>
            <PanelHeader
              title="Session Timeline"
              description={sessions.find((s) => s.id === selected)?.subject}
              actions={
                <span className="font-mono text-2xs text-fg-dim">{selected}</span>
              }
            />
            <PanelBody>
              <ActionTimeline actions={actions} />
            </PanelBody>
          </Panel>
        </div>
      </div>
    </div>
  );
}
