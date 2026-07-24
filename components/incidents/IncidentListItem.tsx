import Link from "next/link";
import { ArrowRight } from "lucide-react";
import { cn } from "@/lib/cn";
import { IncidentSeverityBadge, Badge } from "@/components/ui/Badge";
import { INCIDENT_SEVERITY_META } from "@/lib/constants";
import { fmtDate, relativeTime } from "@/lib/format";
import type { Incident, MetricStatus } from "@/lib/types";

const STATUS_TONE: Record<Incident["status"], MetricStatus> = {
  Investigating: "critical",
  Contained: "warning",
  Monitoring: "warning",
  Resolved: "good",
  Closed: "neutral",
};

export function IncidentListItem({
  incident,
  showSystem = true,
}: {
  incident: Incident;
  showSystem?: boolean;
}) {
  const open = ["Investigating", "Contained", "Monitoring"].includes(incident.status);
  return (
    <Link
      href={`/incidents/${incident.id}`}
      className="group block px-4 py-3.5 transition-colors hover:bg-hover"
    >
      <div className="flex items-start justify-between gap-3">
        <div className="flex min-w-0 items-center gap-2">
          <IncidentSeverityBadge severity={incident.severity} />
          <Badge tone={STATUS_TONE[incident.status]} variant="outline">
            {incident.status}
          </Badge>
          <span className="font-mono text-2xs text-fg-dim">{incident.id}</span>
        </div>
        <span className="shrink-0 text-2xs text-fg-dim tnum">
          {open ? relativeTime(incident.openedAt) : fmtDate(incident.openedAt)}
        </span>
      </div>
      <div className="mt-1.5 flex items-start justify-between gap-3">
        <div className="min-w-0">
          <h4 className="truncate text-sm font-semibold text-fg">{incident.title}</h4>
          {showSystem && (
            <p className="mt-0.5 truncate text-xs text-fg-muted">{incident.systemName}</p>
          )}
        </div>
        <ArrowRight className="mt-0.5 h-4 w-4 shrink-0 text-fg-dim transition-transform group-hover:translate-x-0.5" />
      </div>
      <p className="mt-1.5 text-xs leading-relaxed text-fg-muted line-clamp-2">
        {incident.rootCause ?? incident.suspectedCause}
      </p>
    </Link>
  );
}
