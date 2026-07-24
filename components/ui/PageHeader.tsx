import Link from "next/link";
import { ChevronRight } from "lucide-react";
import { cn } from "@/lib/cn";

export function PageHeader({
  title,
  description,
  actions,
  breadcrumb,
  className,
  meta,
}: {
  title: React.ReactNode;
  description?: React.ReactNode;
  actions?: React.ReactNode;
  breadcrumb?: { label: string; href?: string }[];
  meta?: React.ReactNode;
  className?: string;
}) {
  return (
    <div className={cn("mb-5", className)}>
      {breadcrumb && breadcrumb.length > 0 && (
        <nav className="mb-2 flex items-center gap-1 text-xs text-fg-dim">
          {breadcrumb.map((c, i) => (
            <span key={i} className="flex items-center gap-1">
              {i > 0 && <ChevronRight className="h-3 w-3" />}
              {c.href ? (
                <Link href={c.href} className="hover:text-fg-muted">
                  {c.label}
                </Link>
              ) : (
                <span className="text-fg-muted">{c.label}</span>
              )}
            </span>
          ))}
        </nav>
      )}
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div className="min-w-0">
          <h1 className="text-xl font-bold tracking-tight text-fg sm:text-[1.4rem]">
            {title}
          </h1>
          {description && (
            <p className="mt-1 max-w-2xl text-sm font-medium leading-relaxed text-fg-muted">
              {description}
            </p>
          )}
        </div>
        {actions && (
          <div className="flex shrink-0 flex-wrap items-center gap-2">{actions}</div>
        )}
      </div>
      {meta && <div className="mt-3">{meta}</div>}
    </div>
  );
}

/** A small labeled KPI used in header strips. */
export function SummaryStat({
  label,
  value,
  tone,
  hint,
  className,
}: {
  label: React.ReactNode;
  value: React.ReactNode;
  tone?: string;
  hint?: React.ReactNode;
  className?: string;
}) {
  return (
    <div className={cn("min-w-0", className)}>
      <div className="text-2xs font-bold uppercase tracking-wider text-fg-dim">
        {label}
      </div>
      <div className={cn("mt-1 text-lg font-bold tracking-tight tnum", tone ?? "text-fg")}>
        {value}
      </div>
      {hint && <div className="mt-0.5 text-2xs text-fg-dim">{hint}</div>}
    </div>
  );
}
