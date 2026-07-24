"use client";

import { Bot } from "lucide-react";
import { PageHeader } from "@/components/ui/PageHeader";
import { Panel, PanelBody, PanelHeader } from "@/components/ui/Panel";
import { AgentFleet } from "@/components/agents/AgentFleet";
import { AgentMonitor } from "@/components/agents/AgentMonitor";
import { useStore } from "@/lib/store";
import { fmtNumber } from "@/lib/format";

function Stat({ label, value, tone }: { label: string; value: React.ReactNode; tone?: string }) {
  return (
    <div className="rounded-lg border border-edge bg-panel p-3">
      <div className="text-2xs font-medium uppercase tracking-wider text-fg-dim">{label}</div>
      <div className={`mt-1 text-xl font-semibold tracking-tight tnum ${tone ?? "text-fg"}`}>
        {value}
      </div>
    </div>
  );
}

export default function AgentsPage() {
  const { systems, agents, ready } = useStore();
  const agentSystems = systems.filter((s) => s.isAgent);

  const allActions = Object.values(agents.actions).flat();
  const sessions24h = agents.sessions.length;
  const actions24h = agents.sessions.reduce((sum, s) => sum + s.actionCount, 0);
  const toolCalls24h = agents.sessions.reduce((sum, s) => sum + s.toolCalls, 0);
  const blockedActions24h = allActions.filter((a) => a.status === "blocked").length;
  const anomaliesFlagged24h = agents.sessions.filter((s) => s.anomalyScore >= 0.8).length;

  return (
    <div>
      <PageHeader
        title="Agent Monitoring"
        description="Cybersecurity-grade oversight of autonomous AI agents: every action, tool call, data access, and human approval, with real-time anomaly detection."
        breadcrumb={[{ label: "Operate" }, { label: "Agent Monitoring" }]}
      />

      {!ready ? null : agentSystems.length === 0 ? (
        <div className="rounded-xl border border-edge bg-surface p-8">
          <h3 className="text-lg font-semibold text-fg">No agents registered yet</h3>
          <p className="mt-1 text-fg-muted">
            Register an autonomous AI system to monitor its actions, tool calls, data access, and
            human approvals here.
          </p>
        </div>
      ) : (
        <>
          <div className="mb-4 grid grid-cols-2 gap-2.5 sm:grid-cols-4 lg:grid-cols-6">
            <Stat label="Agents in production" value={agentSystems.filter((a) => a.environment === "Production").length} />
            <Stat label="Sessions · 24h" value={fmtNumber(sessions24h)} />
            <Stat label="Actions · 24h" value={fmtNumber(actions24h)} />
            <Stat label="Tool calls · 24h" value={fmtNumber(toolCalls24h)} />
            <Stat
              label="Blocked actions"
              value={blockedActions24h}
              tone={blockedActions24h > 0 ? "text-warning" : "text-fg"}
            />
            <Stat
              label="Anomalies flagged"
              value={anomaliesFlagged24h}
              tone={anomaliesFlagged24h > 0 ? "text-critical" : "text-fg"}
            />
          </div>

          <Panel className="mb-4">
            <PanelHeader
              icon={<Bot className="h-4 w-4" />}
              title="Agent Fleet"
              description="All autonomous agents with live action volume, human-approval rate, and behavior status."
            />
            <AgentFleet agents={agentSystems} />
          </Panel>

          <Panel>
            <PanelHeader
              title="Prior Authorization Agent — Session Trace"
              description="The most heavily instrumented agent. Every action is recorded and scored for anomalous behavior."
            />
            <PanelBody>
              <AgentMonitor systemId="prior-auth-agent" />
            </PanelBody>
          </Panel>
        </>
      )}
    </div>
  );
}
