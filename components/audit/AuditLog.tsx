import { cn } from "@/lib/cn";
import { fmtDateTime } from "@/lib/format";
import type { AuditCategory, AuditEvent } from "@/lib/types";

const CAT_TONE: Record<AuditCategory, string> = {
  Deployment: "text-accent",
  Version: "text-info",
  Configuration: "text-fg-muted",
  Approval: "text-positive",
  Validation: "text-info",
  Incident: "text-critical",
  Access: "text-fg-muted",
  Policy: "text-warning",
};

const GRID = "grid grid-cols-[130px_1.2fr_2fr_1fr] gap-3 items-start";

export function AuditLog({
  events,
  showReason = true,
  className,
}: {
  events: AuditEvent[];
  showReason?: boolean;
  className?: string;
}) {
  return (
    <div className={cn("overflow-x-auto", className)}>
      <div className="min-w-[720px]">
        <div className={cn(GRID, "border-b border-edge px-3 py-2 text-2xs font-semibold uppercase tracking-wider text-fg-dim")}>
          <span>Timestamp</span>
          <span>Actor</span>
          <span>Action</span>
          <span>Category</span>
        </div>
        {events.map((e) => (
          <div
            key={e.id}
            className={cn(GRID, "border-b border-edge/50 px-3 py-2.5 last:border-0 hover:bg-hover")}
          >
            <span className="font-mono text-2xs text-fg-dim tnum">{fmtDateTime(e.at)}</span>
            <span className="min-w-0">
              <span className="block truncate text-xs font-medium text-fg">{e.actor}</span>
              <span className="block truncate text-2xs text-fg-dim">{e.actorRole}</span>
            </span>
            <span className="min-w-0">
              <span className="block text-xs text-fg">
                {e.action} <span className="font-medium text-fg">{e.object}</span>
              </span>
              {showReason && e.reason && (
                <span className="mt-0.5 block text-2xs text-fg-dim">{e.reason}</span>
              )}
            </span>
            <span className={cn("text-2xs font-medium", CAT_TONE[e.category])}>{e.category}</span>
          </div>
        ))}
        {events.length === 0 && (
          <div className="px-3 py-10 text-center text-sm text-fg-dim">No audit events recorded.</div>
        )}
      </div>
    </div>
  );
}
