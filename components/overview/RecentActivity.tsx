import Link from "next/link";
import {
  CheckCircle2,
  FileCheck,
  GitCommitHorizontal,
  Rocket,
  ShieldAlert,
  SlidersHorizontal,
  UserCheck,
} from "lucide-react";
import { cn } from "@/lib/cn";
import { auditEvents } from "@/lib/data";
import { relativeTime } from "@/lib/format";
import type { AuditCategory } from "@/lib/types";

const ICON: Record<AuditCategory, React.ReactNode> = {
  Deployment: <Rocket className="h-3.5 w-3.5" />,
  Version: <GitCommitHorizontal className="h-3.5 w-3.5" />,
  Configuration: <SlidersHorizontal className="h-3.5 w-3.5" />,
  Approval: <UserCheck className="h-3.5 w-3.5" />,
  Validation: <FileCheck className="h-3.5 w-3.5" />,
  Incident: <ShieldAlert className="h-3.5 w-3.5" />,
  Access: <CheckCircle2 className="h-3.5 w-3.5" />,
  Policy: <CheckCircle2 className="h-3.5 w-3.5" />,
};

export function RecentActivity({ limit = 8 }: { limit?: number }) {
  const events = auditEvents.slice(0, limit);
  return (
    <div className="relative">
      <div className="absolute bottom-2 left-[15px] top-2 w-px bg-edge" />
      <ul className="space-y-0.5">
        {events.map((e) => {
          const inner = (
            <>
              <span className="relative z-10 mt-0.5 flex h-[30px] w-[30px] shrink-0 items-center justify-center rounded-full border border-edge bg-raised text-fg-dim">
                {ICON[e.category]}
              </span>
              <div className="min-w-0 flex-1">
                <p className="text-xs leading-snug text-fg">
                  <span className="font-medium">{e.actor}</span>{" "}
                  <span className="text-fg-muted">{e.action.toLowerCase()}</span>{" "}
                  <span className="font-medium">{e.object}</span>
                </p>
                <div className="mt-0.5 flex items-center gap-2 text-2xs text-fg-dim">
                  <span>{e.actorRole}</span>
                  <span>·</span>
                  <span className="tnum">{relativeTime(e.at)}</span>
                </div>
              </div>
            </>
          );
          return (
            <li key={e.id}>
              {e.systemId ? (
                <Link
                  href={`/registry/${e.systemId}?tab=audit`}
                  className="flex items-start gap-2.5 rounded-md px-1 py-1.5 transition-colors hover:bg-hover"
                >
                  {inner}
                </Link>
              ) : (
                <div className="flex items-start gap-2.5 px-1 py-1.5">{inner}</div>
              )}
            </li>
          );
        })}
      </ul>
    </div>
  );
}
