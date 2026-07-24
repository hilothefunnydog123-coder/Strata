import type { Metadata } from "next";
import { Bot } from "lucide-react";
import { PageHeader } from "@/components/ui/PageHeader";
import { Panel, PanelBody, PanelHeader } from "@/components/ui/Panel";
import { AgentFleet } from "@/components/agents/AgentFleet";
import { AgentMonitor } from "@/components/agents/AgentMonitor";
import { agentStats, systems } from "@/lib/data";
import { fmtNumber } from "@/lib/format";

export const metadata: Metadata = { title: "Agent Monitoring" };

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
  const agents = systems.filter((s) => s.isAgent);

  return (
    <div>
      <PageHeader
        title="Agent Monitoring"
        description="Cybersecurity-grade oversight of autonomous AI agents: every action, tool call, data access, and human approval, with real-time anomaly detection."
        breadcrumb={[{ label: "Operate" }, { label: "Agent Monitoring" }]}
      />

      <div className="mb-4 grid grid-cols-2 gap-2.5 sm:grid-cols-4 lg:grid-cols-6">
        <Stat label="Agents in production" value={agents.filter((a) => a.environment === "Production").length} />
        <Stat label="Sessions · 24h" value={fmtNumber(agentStats.sessions24h)} />
        <Stat label="Actions · 24h" value={fmtNumber(agentStats.actions24h)} />
        <Stat label="Tool calls · 24h" value={fmtNumber(agentStats.toolCalls24h)} />
        <Stat
          label="Blocked actions"
          value={agentStats.blockedActions24h}
          tone={agentStats.blockedActions24h > 0 ? "text-warning" : "text-fg"}
        />
        <Stat
          label="Anomalies flagged"
          value={agentStats.anomaliesFlagged24h}
          tone={agentStats.anomaliesFlagged24h > 0 ? "text-critical" : "text-fg"}
        />
      </div>

      <Panel className="mb-4">
        <PanelHeader
          icon={<Bot className="h-4 w-4" />}
          title="Agent Fleet"
          description="All autonomous agents with live action volume, human-approval rate, and behavior status."
        />
        <AgentFleet agents={agents} />
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
    </div>
  );
}
