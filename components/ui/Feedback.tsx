import { cn } from "@/lib/cn";
import { toneToClasses } from "@/lib/constants";
import type { MetricStatus } from "@/lib/types";

export function ProgressBar({
  value,
  tone = "#4A8CF5",
  className,
  height = 6,
}: {
  value: number;
  tone?: string;
  className?: string;
  height?: number;
}) {
  return (
    <div
      className={cn("w-full overflow-hidden rounded-full bg-raised", className)}
      style={{ height }}
    >
      <div
        className="h-full rounded-full transition-all duration-500"
        style={{ width: `${Math.max(0, Math.min(100, value))}%`, background: tone }}
      />
    </div>
  );
}

export function EmptyState({
  icon,
  title,
  description,
  action,
  className,
}: {
  icon?: React.ReactNode;
  title: string;
  description?: string;
  action?: React.ReactNode;
  className?: string;
}) {
  return (
    <div
      className={cn(
        "flex flex-col items-center justify-center rounded-lg border border-dashed border-edge px-6 py-12 text-center",
        className,
      )}
    >
      {icon && <div className="mb-3 text-fg-dim">{icon}</div>}
      <div className="text-sm font-medium text-fg">{title}</div>
      {description && (
        <p className="mt-1 max-w-sm text-xs text-fg-muted">{description}</p>
      )}
      {action && <div className="mt-4">{action}</div>}
    </div>
  );
}

/** A left-accent callout for important context or warnings. */
export function Callout({
  tone = "neutral",
  title,
  children,
  icon,
  className,
}: {
  tone?: MetricStatus;
  title?: React.ReactNode;
  children: React.ReactNode;
  icon?: React.ReactNode;
  className?: string;
}) {
  const t = toneToClasses(tone);
  return (
    <div
      className={cn(
        "rounded-lg border border-l-2 p-3.5",
        t.bg,
        t.border,
        className,
      )}
      style={{ borderLeftColor: `rgb(var(--${cssVarForTone(tone)}))` }}
    >
      <div className="flex gap-2.5">
        {icon && <span className={cn("mt-0.5 shrink-0", t.text)}>{icon}</span>}
        <div className="min-w-0">
          {title && <div className={cn("text-sm font-semibold", t.text)}>{title}</div>}
          <div className={cn("text-xs leading-relaxed text-fg-muted", title && "mt-1")}>
            {children}
          </div>
        </div>
      </div>
    </div>
  );
}

function cssVarForTone(tone: MetricStatus): string {
  switch (tone) {
    case "good":
      return "positive";
    case "warning":
      return "warning";
    case "critical":
      return "critical";
    default:
      return "edge-strong";
  }
}
