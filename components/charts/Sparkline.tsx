import { cn } from "@/lib/cn";

/** Compact inline trend line (SVG, no dependencies). */
export function Sparkline({
  data,
  width = 96,
  height = 28,
  stroke = "currentColor",
  fill = true,
  strokeWidth = 1.5,
  className,
}: {
  data: number[];
  width?: number;
  height?: number;
  stroke?: string;
  fill?: boolean;
  strokeWidth?: number;
  className?: string;
}) {
  if (!data || data.length < 2) {
    return <div style={{ width, height }} className={className} />;
  }
  const min = Math.min(...data);
  const max = Math.max(...data);
  const range = max - min || 1;
  const pad = 2;
  const w = width - pad * 2;
  const h = height - pad * 2;
  const pts = data.map((v, i) => {
    const x = pad + (i / (data.length - 1)) * w;
    const y = pad + h - ((v - min) / range) * h;
    return [x, y] as const;
  });
  const line = pts.map(([x, y], i) => `${i === 0 ? "M" : "L"}${x.toFixed(1)},${y.toFixed(1)}`).join(" ");
  const area = `${line} L${pts[pts.length - 1][0].toFixed(1)},${height} L${pts[0][0].toFixed(1)},${height} Z`;
  return (
    <svg
      width={width}
      height={height}
      viewBox={`0 0 ${width} ${height}`}
      className={cn("overflow-visible", className)}
      style={{ color: stroke }}
      aria-hidden
    >
      {fill && <path d={area} fill="currentColor" fillOpacity={0.1} stroke="none" />}
      <path
        d={line}
        fill="none"
        stroke="currentColor"
        strokeWidth={strokeWidth + 0.5}
        strokeLinejoin="round"
        strokeLinecap="round"
      />
      <circle
        cx={pts[pts.length - 1][0]}
        cy={pts[pts.length - 1][1]}
        r={2}
        fill="currentColor"
      />
    </svg>
  );
}
