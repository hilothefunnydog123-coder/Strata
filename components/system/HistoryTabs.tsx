import { ShieldCheck } from "lucide-react";
import { Panel, PanelHeader, PanelBody } from "@/components/ui/Panel";
import { EmptyState } from "@/components/ui/Feedback";
import { AuditLog } from "@/components/audit/AuditLog";
import { IncidentListItem } from "@/components/incidents/IncidentListItem";
import type { AuditEvent, Incident } from "@/lib/types";

export function IncidentsTab({ incidents }: { incidents: Incident[] }) {
  if (incidents.length === 0) {
    return (
      <EmptyState
        icon={<ShieldCheck className="h-6 w-6" />}
        title="No incidents recorded"
        description="This system has no incident history. Incidents are opened automatically when monitors detect a threshold breach, or manually by an operator."
      />
    );
  }
  return (
    <Panel>
      <PanelHeader
        title="Incident History"
        description={`${incidents.length} incident${incidents.length === 1 ? "" : "s"} for this system.`}
      />
      <div className="divide-y divide-edge">
        {incidents.map((inc) => (
          <IncidentListItem key={inc.id} incident={inc} showSystem={false} />
        ))}
      </div>
    </Panel>
  );
}

export function AuditTab({ events }: { events: AuditEvent[] }) {
  return (
    <Panel>
      <PanelHeader
        title="Audit Log"
        description="Immutable record of every significant event for this system."
      />
      <PanelBody className="p-2">
        <AuditLog events={events} />
      </PanelBody>
    </Panel>
  );
}
