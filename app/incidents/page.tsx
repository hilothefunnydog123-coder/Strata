import type { Metadata } from "next";
import { PageHeader } from "@/components/ui/PageHeader";
import { Panel, PanelHeader } from "@/components/ui/Panel";
import { IncidentListItem } from "@/components/incidents/IncidentListItem";
import { incidents } from "@/lib/data";

export const metadata: Metadata = { title: "Incidents" };

function Stat({ label, value, tone }: { label: string; value: React.ReactNode; tone?: string }) {
  return (
    <div className="rounded-lg border border-edge bg-panel p-3">
      <div className="text-2xs font-medium uppercase tracking-wider text-fg-dim">{label}</div>
      <div className={`mt-1 text-2xl font-semibold tracking-tight tnum ${tone ?? "text-fg"}`}>
        {value}
      </div>
    </div>
  );
}

export default function IncidentsPage() {
  const open = incidents.filter((i) =>
    ["Investigating", "Contained", "Monitoring"].includes(i.status),
  );
  const closed = incidents.filter((i) => !["Investigating", "Contained", "Monitoring"].includes(i.status));
  const sev1and2 = open.filter((i) => i.severity === "SEV-1" || i.severity === "SEV-2").length;

  return (
    <div>
      <PageHeader
        title="Incident Response"
        description="Investigate AI failures with the full context: what happened, when it started, what changed before it, who was affected, and what was done."
        breadcrumb={[{ label: "Monitor" }, { label: "Incidents" }]}
      />

      <div className="mb-4 grid grid-cols-2 gap-2.5 sm:grid-cols-4">
        <Stat label="Open incidents" value={open.length} tone={open.length > 0 ? "text-critical" : "text-fg"} />
        <Stat label="SEV-1 / SEV-2 active" value={sev1and2} tone={sev1and2 > 0 ? "text-warning" : "text-fg"} />
        <Stat label="Resolved (30d)" value={closed.length} />
        <Stat label="Median time to contain" value="1.4 hrs" />
      </div>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <Panel>
          <PanelHeader title="Active" description="Incidents under investigation or containment." />
          <div className="divide-y divide-edge">
            {open.length > 0 ? (
              open.map((i) => <IncidentListItem key={i.id} incident={i} />)
            ) : (
              <div className="px-4 py-10 text-center text-sm text-fg-dim">No active incidents.</div>
            )}
          </div>
        </Panel>
        <Panel>
          <PanelHeader title="Resolved & Closed" description="Recent incident history." />
          <div className="divide-y divide-edge">
            {closed.map((i) => (
              <IncidentListItem key={i.id} incident={i} />
            ))}
          </div>
        </Panel>
      </div>
    </div>
  );
}
