import { cn } from "@/lib/cn";
import {
  INCIDENT_SEVERITY_META,
  RISK_TEXT,
  SEVERITY_META,
  STATUS_META,
  toneToClasses,
} from "@/lib/constants";
import type {
  AlertSeverity,
  IncidentSeverity,
  MetricStatus,
  RiskLevel,
  SystemStatus,
} from "@/lib/types";

export function Badge({
  children,
  tone = "neutral",
  className,
  variant = "soft",
}: {
  children: React.ReactNode;
  tone?: MetricStatus;
  variant?: "soft" | "outline";
  className?: string;
}) {
  const t = toneToClasses(tone);
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1.5 rounded-md border px-1.5 py-0.5 text-2xs font-medium",
        variant === "soft" ? cn(t.bg, t.text, "border-transparent") : cn(t.text, t.border),
        className,
      )}
    >
      {children}
    </span>
  );
}

export function StatusDot({
  tone,
  pulse,
  className,
}: {
  tone: MetricStatus;
  pulse?: boolean;
  className?: string;
}) {
  const t = toneToClasses(tone);
  return (
    <span className={cn("relative inline-flex h-2 w-2", className)}>
      {pulse && (
        <span
          className={cn(
            "absolute inline-flex h-full w-full animate-ping rounded-full opacity-60",
            t.dot,
          )}
        />
      )}
      <span className={cn("relative inline-flex h-2 w-2 rounded-full", t.dot)} />
    </span>
  );
}

export function StatusBadge({
  status,
  className,
}: {
  status: SystemStatus;
  className?: string;
}) {
  const meta = STATUS_META[status];
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1.5 text-xs font-medium",
        toneToClasses(meta.tone).text,
        className,
      )}
    >
      <StatusDot tone={meta.tone} pulse={meta.tone === "critical"} />
      {meta.label}
    </span>
  );
}

export function RiskBadge({
  risk,
  className,
  showDot = true,
}: {
  risk: RiskLevel;
  className?: string;
  showDot?: boolean;
}) {
  const tone: MetricStatus =
    risk === "Critical"
      ? "critical"
      : risk === "High"
        ? "warning"
        : risk === "Moderate"
          ? "warning"
          : "good";
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1.5 text-xs font-medium",
        RISK_TEXT[risk],
        className,
      )}
    >
      {showDot && (
        <span
          className="inline-block h-2 w-2 rounded-[3px]"
          style={{ background: `rgb(var(--${cssVar(risk)}))` }}
        />
      )}
      {risk}
    </span>
  );
}

function cssVar(risk: RiskLevel): string {
  switch (risk) {
    case "Low":
      return "positive";
    case "Moderate":
      return "warning";
    case "High":
      return "elevated";
    case "Critical":
      return "critical";
  }
}

export function SeverityBadge({
  severity,
  className,
}: {
  severity: AlertSeverity;
  className?: string;
}) {
  const tone = SEVERITY_META[severity].tone;
  return (
    <Badge tone={tone} variant="outline" className={cn("uppercase", className)}>
      {severity}
    </Badge>
  );
}

export function IncidentSeverityBadge({
  severity,
  className,
}: {
  severity: IncidentSeverity;
  className?: string;
}) {
  const meta = INCIDENT_SEVERITY_META[severity];
  return (
    <Badge tone={meta.tone} variant="outline" className={className}>
      {meta.label}
    </Badge>
  );
}

/** A neutral meta chip for tags, categories, environments. */
export function Chip({
  children,
  className,
}: {
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1 rounded-md border border-edge bg-raised px-1.5 py-0.5 text-2xs font-medium text-fg-muted",
        className,
      )}
    >
      {children}
    </span>
  );
}
