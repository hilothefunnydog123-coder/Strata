import { cn } from "@/lib/cn";

export interface DonutSegment {
  label: string;
  value: number;
  color: string;
}

/** A donut/gauge for compositional data (risk mix, validation results). */
export function Donut({
  segments,
  size = 132,
  thickness = 14,
  centerLabel,
  centerValue,
  className,
}: {
  segments: DonutSegment[];
  size?: number;
  thickness?: number;
  centerLabel?: string;
  centerValue?: React.ReactNode;
  className?: string;
}) {
  const total = segments.reduce((s, x) => s + x.value, 0) || 1;
  const r = (size - thickness) / 2;
  const c = size / 2;
  const circ = 2 * Math.PI * r;
  let offset = 0;

  return (
    <div className={cn("relative inline-flex", className)} style={{ width: size, height: size }}>
      <svg width={size} height={size} className="-rotate-90">
        <circle
          cx={c}
          cy={c}
          r={r}
          fill="none"
          stroke="rgb(var(--raised))"
          strokeWidth={thickness}
        />
        {segments.map((seg, i) => {
          const frac = seg.value / total;
          const dash = frac * circ;
          const el = (
            <circle
              key={i}
              cx={c}
              cy={c}
              r={r}
              fill="none"
              stroke={seg.color}
              strokeWidth={thickness}
              strokeDasharray={`${dash} ${circ - dash}`}
              strokeDashoffset={-offset}
              strokeLinecap="butt"
            />
          );
          offset += dash;
          return el;
        })}
      </svg>
      {(centerValue || centerLabel) && (
        <div className="absolute inset-0 flex flex-col items-center justify-center">
          {centerValue && (
            <span className="text-xl font-semibold tracking-tight text-fg tnum">
              {centerValue}
            </span>
          )}
          {centerLabel && (
            <span className="mt-0.5 text-2xs uppercase tracking-wide text-fg-dim">
              {centerLabel}
            </span>
          )}
        </div>
      )}
    </div>
  );
}
