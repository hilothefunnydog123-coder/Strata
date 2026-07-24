import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { IncidentWorkspace } from "@/components/incidents/IncidentWorkspace";
import {
  alertById,
  auditForSystem,
  getSystem,
  incidentById,
  incidents,
} from "@/lib/data";

export function generateStaticParams() {
  return incidents.map((i) => ({ id: i.id }));
}

export function generateMetadata({ params }: { params: { id: string } }): Metadata {
  const incident = incidentById[params.id];
  return { title: incident ? `${incident.id} · Incident` : "Incident" };
}

export default function IncidentPage({ params }: { params: { id: string } }) {
  const incident = incidentById[params.id];
  if (!incident) notFound();

  const system = getSystem(incident.systemId);
  const alerts = incident.relatedAlertIds
    .map((id) => alertById[id])
    .filter(Boolean);
  const changes = auditForSystem(incident.systemId)
    .filter((e) => ["Deployment", "Version", "Configuration"].includes(e.category))
    .slice(0, 4);

  return (
    <IncidentWorkspace
      incident={incident}
      system={system}
      alerts={alerts}
      changes={changes}
    />
  );
}
