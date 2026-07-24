"use client";

import Link from "next/link";
import { Bell } from "lucide-react";
import { Panel, PanelHeader } from "@/components/ui/Panel";
import { AlertCard } from "@/components/alerts/AlertCard";
import { SEVERITY_META } from "@/lib/constants";
import type { Alert } from "@/lib/types";
import { useSimulation } from "@/lib/simulation";

export function LiveAlerts({ base, limit = 5 }: { base: Alert[]; limit?: number }) {
  const { injectedAlerts } = useSimulation();

  const merged = [...injectedAlerts, ...base]
    .filter((a) => !["Resolved", "Muted"].includes(a.status))
    .sort((a, b) => {
      const s = SEVERITY_META[a.severity].rank - SEVERITY_META[b.severity].rank;
      if (s !== 0) return s;
      return new Date(b.at).getTime() - new Date(a.at).getTime();
    });

  const shown = merged.slice(0, limit);

  return (
    <Panel className="flex flex-col">
      <PanelHeader
        icon={<Bell className="h-4 w-4" />}
        title="Live Alerts"
        description="Signals that need an operator decision, most severe first."
        actions={
          <Link
            href="/alerts"
            className="text-xs font-medium text-accent hover:underline"
          >
            View all {merged.length}
          </Link>
        }
      />
      <div className="divide-y divide-edge">
        {shown.map((a) => (
          <AlertCard key={a.id} alert={a} />
        ))}
      </div>
    </Panel>
  );
}
