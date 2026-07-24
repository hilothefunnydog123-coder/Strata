"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import { IncidentWorkspace } from "@/components/incidents/IncidentWorkspace";
import { useStore } from "@/lib/store";
import type { Alert } from "@/lib/types";

export default function IncidentPage() {
  const params = useParams<{ id: string }>();
  const id = typeof params?.id === "string" ? params.id : "";
  const { getIncident, getSystem, alerts, audit, ready } = useStore();

  const incident = getIncident(id);

  if (!ready && !incident) {
    return (
      <div className="flex min-h-[50vh] items-center justify-center">
        <div className="text-sm font-semibold text-fg-muted">Loading incident</div>
      </div>
    );
  }

  if (!incident) {
    return (
      <div className="rounded-xl border border-edge bg-surface p-8">
        <h3 className="text-lg font-semibold text-fg">Incident not found</h3>
        <p className="mt-1 text-fg-muted">
          This incident does not exist or is not part of your organization.{" "}
          <Link href="/incidents" className="text-accent hover:underline">
            Return to incidents
          </Link>
          .
        </p>
      </div>
    );
  }

  const system = getSystem(incident.systemId);
  const relatedAlerts = incident.relatedAlertIds
    .map((alertId) => alerts.find((a) => a.id === alertId))
    .filter((a): a is Alert => a !== undefined);
  const changes = audit
    .filter(
      (e) =>
        e.systemId === incident.systemId &&
        ["Deployment", "Version", "Configuration"].includes(e.category),
    )
    .slice(0, 4);

  return (
    <IncidentWorkspace
      incident={incident}
      system={system}
      alerts={relatedAlerts}
      changes={changes}
    />
  );
}
