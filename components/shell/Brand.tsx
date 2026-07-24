import { cn } from "@/lib/cn";

/** Ward mark — stacked layers. */
export function WardMark({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 28 28" className={className} fill="none" aria-hidden>
      <rect width="28" height="28" rx="6" fill="rgb(var(--accent))" />
      <g stroke="rgb(var(--accent-fg))" strokeWidth="2" strokeLinecap="round">
        <path d="M7 10.5 L14 7 L21 10.5 L14 14 Z" fill="rgb(var(--accent-fg))" opacity="0.95" />
        <path d="M7 14.5 L14 18 L21 14.5" opacity="0.7" />
        <path d="M7 18.5 L14 22 L21 18.5" opacity="0.45" />
      </g>
    </svg>
  );
}

export function Brand({
  className,
  subtitle = true,
}: {
  className?: string;
  subtitle?: boolean;
}) {
  return (
    <div className={cn("flex items-center gap-2.5", className)}>
      <WardMark className="h-7 w-7 shrink-0" />
      <div className="min-w-0 leading-none">
        <div className="text-sm font-semibold tracking-tight text-fg">Ward</div>
        {subtitle && (
          <div className="mt-1 text-2xs font-medium uppercase tracking-[0.14em] text-fg-dim">
            AI Control Plane
          </div>
        )}
      </div>
    </div>
  );
}
