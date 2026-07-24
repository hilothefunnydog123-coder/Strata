import { cn } from "@/lib/cn";

export function Panel({
  children,
  className,
  as: Tag = "section",
}: {
  children: React.ReactNode;
  className?: string;
  as?: React.ElementType;
}) {
  return (
    <Tag
      className={cn(
        "rounded-lg border border-edge bg-panel shadow-panel",
        className,
      )}
    >
      {children}
    </Tag>
  );
}

export function PanelHeader({
  title,
  description,
  actions,
  icon,
  className,
}: {
  title: React.ReactNode;
  description?: React.ReactNode;
  actions?: React.ReactNode;
  icon?: React.ReactNode;
  className?: string;
}) {
  return (
    <div
      className={cn(
        "flex items-start justify-between gap-4 border-b border-edge px-4 py-3",
        className,
      )}
    >
      <div className="flex min-w-0 items-start gap-2.5">
        {icon && <span className="mt-0.5 text-fg-dim">{icon}</span>}
        <div className="min-w-0">
          <h3 className="text-sm font-semibold tracking-tight text-fg">{title}</h3>
          {description && (
            <p className="mt-0.5 text-xs leading-relaxed text-fg-muted">{description}</p>
          )}
        </div>
      </div>
      {actions && <div className="flex shrink-0 items-center gap-2">{actions}</div>}
    </div>
  );
}

export function PanelBody({
  children,
  className,
}: {
  children: React.ReactNode;
  className?: string;
}) {
  return <div className={cn("p-4", className)}>{children}</div>;
}

/** A titled section label used above groups of content. */
export function SectionLabel({
  children,
  className,
}: {
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <div
      className={cn(
        "text-2xs font-semibold uppercase tracking-[0.12em] text-fg-dim",
        className,
      )}
    >
      {children}
    </div>
  );
}
