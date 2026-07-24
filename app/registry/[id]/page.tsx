import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { ControlCenter } from "@/components/system/ControlCenter";
import {
  alerts,
  auditForSystem,
  getSystem,
  incidents,
  systems,
} from "@/lib/data";

export function generateStaticParams() {
  return systems.map((s) => ({ id: s.id }));
}

export function generateMetadata({ params }: { params: { id: string } }): Metadata {
  const system = getSystem(params.id);
  return { title: system ? system.name : "AI System" };
}

export default function SystemPage({
  params,
  searchParams,
}: {
  params: { id: string };
  searchParams: { tab?: string };
}) {
  const system = getSystem(params.id);
  if (!system) notFound();

  const systemIncidents = incidents.filter((i) => i.systemId === system.id);
  const systemAudit = auditForSystem(system.id);
  const systemAlerts = alerts.filter(
    (a) => a.systemId === system.id && !["Resolved", "Muted"].includes(a.status),
  );

  return (
    <ControlCenter
      system={system}
      incidents={systemIncidents}
      auditEvents={systemAudit}
      alerts={systemAlerts}
      initialTab={searchParams.tab}
    />
  );
}
