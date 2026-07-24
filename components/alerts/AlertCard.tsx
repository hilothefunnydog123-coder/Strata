import Link from "next/link";
import { ArrowRight } from "lucide-react";
import { cn } from "@/lib/cn";
import { SEVERITY_META, toneToClasses } from "@/lib/constants";
import { relativeTime } from "@/lib/format";
import type { Alert } from "@/lib/types";
import { SeverityBadge } from "@/components/ui/Badge";

const SEVERITY_ACCENT: Record<string, string> = {
  Critical: "var(--critical)",
  High: "var(--elevated)",
  Medium: "var(--warning)",
  Low: "var(--fg-dim)",
  Info: "var(--info)",
};

export function AlertCard({
  alert,
  compact = false,
  className,
}: {
  alert: Alert;
  compact?: boolean;
  className?: string;
}) {
  const href = `/registry/${alert.systemId}${alert.linkTab ? `?tab=${alert.linkTab}` : ""}`;
  return (
    <Link
      href={href}
      className={cn(
        "group block border-l-2 bg-panel px-4 py-3 transition-colors hover:bg-hover",
        className,
      )}
      style={{ borderLeftColor: `rgb(${SEVERITY_ACCENT[alert.severity]})` }}
    >
      <div className="flex items-start justify-between gap-3">
        <div className="flex min-w-0 items-center gap-2">
          <SeverityBadge severity={alert.severity} />
          <span className="truncate text-2xs font-medium uppercase tracking-wide text-fg-dim">
            {alert.category}
          </span>
        </div>
        <span className="shrink-0 text-2xs text-fg-dim tnum">
          {relativeTime(alert.at)}
        </span>
      </div>

      <div className="mt-1.5 flex items-start justify-between gap-3">
        <div className="min-w-0">
          <h4 className="truncate text-sm font-semibold text-fg">{alert.title}</h4>
          <p className="mt-0.5 truncate text-xs text-fg-muted">{alert.systemName}</p>
        </div>
        <ArrowRight className="mt-0.5 h-4 w-4 shrink-0 text-fg-dim transition-transform group-hover:translate-x-0.5 group-hover:text-fg-muted" />
      </div>

      {!compact && (
        <>
          <p className="mt-2 text-xs leading-relaxed text-fg-muted line-clamp-2">
            {alert.detail}
          </p>
          {alert.evidence.length > 0 && (
            <div className="mt-2.5 flex flex-wrap gap-1.5">
              {alert.evidence.map((e, i) => {
                const t = toneToClasses(e.status ?? "neutral");
                return (
                  <span
                    key={i}
                    className={cn(
                      "inline-flex items-center gap-1 rounded border border-edge bg-raised px-1.5 py-0.5 text-2xs",
                    )}
                  >
                    <span className="text-fg-dim">{e.label}</span>
                    <span className={cn("font-semibold tnum", t.text)}>{e.value}</span>
                  </span>
                );
              })}
            </div>
          )}
          <div className="mt-2.5 flex items-center gap-1.5 text-2xs text-fg-dim">
            <span className="font-medium text-fg-muted">Recommended</span>
            <span className="truncate">{alert.recommendedAction}</span>
          </div>
        </>
      )}
    </Link>
  );
}
