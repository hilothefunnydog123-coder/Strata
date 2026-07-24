"use client";

import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { ControlCenter } from "./ControlCenter";
import { StrataMark } from "@/components/shell/Brand";
import { ButtonLink } from "@/components/ui/Button";
import { alerts, auditForSystem, incidents } from "@/lib/data";
import { useStore } from "@/lib/store";

export function SystemDetailClient({ id }: { id: string }) {
  const { getSystem, ready } = useStore();
  const params = useSearchParams();
  const system = getSystem(id);

  if (!ready) {
    return (
      <div className="flex min-h-[50vh] flex-col items-center justify-center gap-3">
        <StrataMark className="h-8 w-8 animate-pulse" />
        <div className="text-sm font-semibold text-fg-muted">Loading system</div>
      </div>
    );
  }

  if (!system) {
    return (
      <div className="flex min-h-[50vh] flex-col items-center justify-center text-center">
        <div className="text-2xs font-bold uppercase tracking-wider text-fg-dim">Not found</div>
        <h1 className="mt-2 text-2xl font-bold tracking-tight text-fg">
          This AI system does not exist
        </h1>
        <p className="mt-2 max-w-md text-sm font-medium text-fg-muted">
          It may have been retired, or the link is out of date.
        </p>
        <div className="mt-6">
          <ButtonLink href="/registry" variant="primary">
            Back to AI Registry
          </ButtonLink>
        </div>
      </div>
    );
  }

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
      initialTab={params.get("tab") ?? undefined}
    />
  );
}
