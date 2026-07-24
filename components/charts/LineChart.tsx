"use client";

import { useRef, useState } from "react";
import { cn } from "@/lib/cn";
import { fmtDateShort } from "@/lib/format";
import type { MultiSeries, SeriesEvent } from "@/lib/types";

const EVENT_COLOR = "#8A99B4";

export interface ThresholdLine {
  value: number;
  label: string;
  color?: string;
}

export function LineChart({
  series,
  events = [],
  thresholds = [],
  height = 260,
  ySuffix = "",
  yFormat = (v: number) => v.toFixed(0),
  yDomain,
  className,
  showLegend = true,
  area = false,
}: {
  series: MultiSeries[];
  events?: SeriesEvent[];
  thresholds?: ThresholdLine[];
  height?: number;
  ySuffix?: string;
  yFormat?: (v: number) => string;
  yDomain?: [number, number];
  className?: string;
  showLegend?: boolean;
  area?: boolean;
}) {
  const W = 820;
  const H = height;
  const m = { top: 16, right: 16, bottom: 26, left: 44 };
  const plotW = W - m.left - m.right;
  const plotH = H - m.top - m.bottom;
  const [hover, setHover] = useState<number | null>(null);
  const wrapRef = useRef<HTMLDivElement>(null);

  const n = series[0]?.points.length ?? 0;
  if (n < 2) return <div style={{ height }} className={className} />;

  const allVals = series.flatMap((s) => s.points.map((p) => p.v));
  const tvals = thresholds.map((t) => t.value);
  let lo = yDomain ? yDomain[0] : Math.min(...allVals, ...tvals);
  let hi = yDomain ? yDomain[1] : Math.max(...allVals, ...tvals);
  const pad = (hi - lo) * 0.12 || 1;
  if (!yDomain) {
    lo = lo - pad;
    hi = hi + pad;
  }
  const range = hi - lo || 1;

  const x = (i: number) => m.left + (i / (n - 1)) * plotW;
  const y = (v: number) => m.top + plotH - ((v - lo) / range) * plotH;

  const path = (s: MultiSeries) =>
    s.points
      .map((p, i) => `${i === 0 ? "M" : "L"}${x(i).toFixed(1)},${y(p.v).toFixed(1)}`)
      .join(" ");

  const gridVals = ticks(lo, hi, 4);
  const xTickIdx = xTicks(n, 6);
  const dates = series[0].points.map((p) => p.t);

  const eventIdx = events
    .map((e) => ({ e, i: nearestIndex(dates, e.t) }))
    .filter((x) => x.i >= 0);

  const onMove = (clientX: number) => {
    const rect = wrapRef.current?.getBoundingClientRect();
    if (!rect) return;
    const rel = ((clientX - rect.left) / rect.width) * W;
    const frac = (rel - m.left) / plotW;
    const idx = Math.round(frac * (n - 1));
    setHover(Math.max(0, Math.min(n - 1, idx)));
  };

  return (
    <div className={cn("w-full", className)}>
      <div ref={wrapRef} className="relative w-full">
        <svg
          viewBox={`0 0 ${W} ${H}`}
          width="100%"
          height={H}
          preserveAspectRatio="none"
          className="touch-none select-none"
          onMouseMove={(e) => onMove(e.clientX)}
          onMouseLeave={() => setHover(null)}
        >
          {/* gridlines */}
          {gridVals.map((gv, i) => (
            <g key={i}>
              <line
                x1={m.left}
                x2={W - m.right}
                y1={y(gv)}
                y2={y(gv)}
                stroke="rgb(var(--edge))"
                strokeWidth={1}
                strokeDasharray={i === 0 ? undefined : "2 4"}
              />
              <text
                x={m.left - 8}
                y={y(gv)}
                textAnchor="end"
                dominantBaseline="middle"
                className="fill-fg-dim tnum"
                fontSize={10.5}
              >
                {yFormat(gv)}
                {ySuffix}
              </text>
            </g>
          ))}

          {/* x labels */}
          {xTickIdx.map((i) => (
            <text
              key={i}
              x={x(i)}
              y={H - 8}
              textAnchor="middle"
              className="fill-fg-dim tnum"
              fontSize={10.5}
            >
              {fmtDateShort(dates[i])}
            </text>
          ))}

          {/* thresholds */}
          {thresholds.map((t, i) => (
            <g key={i}>
              <line
                x1={m.left}
                x2={W - m.right}
                y1={y(t.value)}
                y2={y(t.value)}
                stroke={t.color ?? "#F26064"}
                strokeWidth={1.25}
                strokeDasharray="5 3"
                opacity={0.85}
              />
              <text
                x={W - m.right}
                y={y(t.value) - 4}
                textAnchor="end"
                fontSize={10}
                className="tnum"
                fill={t.color ?? "#F26064"}
              >
                {t.label}
              </text>
            </g>
          ))}

          {/* event annotations */}
          {eventIdx.map(({ e, i }, k) => (
            <g key={k}>
              <line
                x1={x(i)}
                x2={x(i)}
                y1={m.top}
                y2={m.top + plotH}
                stroke={EVENT_COLOR}
                strokeWidth={1}
                strokeDasharray="3 3"
                opacity={0.7}
              />
              <circle cx={x(i)} cy={m.top} r={3} fill={EVENT_COLOR} />
            </g>
          ))}

          {/* area fills */}
          {area &&
            series.map((s) => (
              <path
                key={`a-${s.key}`}
                d={`${path(s)} L${x(n - 1)},${m.top + plotH} L${x(0)},${m.top + plotH} Z`}
                fill={s.color}
                opacity={0.08}
              />
            ))}

          {/* series lines */}
          {series.map((s) => (
            <path
              key={s.key}
              d={path(s)}
              fill="none"
              stroke={s.color}
              strokeWidth={1.75}
              strokeLinejoin="round"
              strokeLinecap="round"
            />
          ))}

          {/* hover cursor */}
          {hover !== null && (
            <g>
              <line
                x1={x(hover)}
                x2={x(hover)}
                y1={m.top}
                y2={m.top + plotH}
                stroke="rgb(var(--fg-dim))"
                strokeWidth={1}
              />
              {series.map((s) => (
                <circle
                  key={s.key}
                  cx={x(hover)}
                  cy={y(s.points[hover].v)}
                  r={3}
                  fill="rgb(var(--panel))"
                  stroke={s.color}
                  strokeWidth={2}
                />
              ))}
            </g>
          )}
        </svg>

        {/* tooltip */}
        {hover !== null && (
          <Tooltip
            xFrac={hover / (n - 1)}
            date={dates[hover]}
            series={series}
            index={hover}
            yFormat={yFormat}
            ySuffix={ySuffix}
            event={eventIdx.find((e) => e.i === hover)?.e}
          />
        )}
      </div>

      {showLegend && (
        <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-1.5">
          {series.map((s) => (
            <span key={s.key} className="inline-flex items-center gap-1.5 text-xs text-fg-muted">
              <span className="h-0.5 w-3.5 rounded-full" style={{ background: s.color }} />
              {s.label}
            </span>
          ))}
          {events.length > 0 && (
            <span className="inline-flex items-center gap-1.5 text-xs text-fg-muted">
              <span className="h-2 w-2 rounded-full" style={{ background: EVENT_COLOR }} />
              Event
            </span>
          )}
        </div>
      )}
    </div>
  );
}

function Tooltip({
  xFrac,
  date,
  series,
  index,
  yFormat,
  ySuffix,
  event,
}: {
  xFrac: number;
  date: string;
  series: MultiSeries[];
  index: number;
  yFormat: (v: number) => string;
  ySuffix: string;
  event?: SeriesEvent;
}) {
  const leftPct = 6 + xFrac * 88;
  const flip = xFrac > 0.62;
  return (
    <div
      className="pointer-events-none absolute top-2 z-10 w-max max-w-[220px] rounded-md border border-edge-strong bg-raised/95 p-2.5 shadow-pop backdrop-blur"
      style={{
        left: `${leftPct}%`,
        transform: flip ? "translateX(-100%)" : "translateX(0)",
      }}
    >
      <div className="mb-1.5 text-2xs font-semibold uppercase tracking-wide text-fg-dim">
        {fmtDateShort(date)}
      </div>
      <div className="space-y-1">
        {series.map((s) => (
          <div key={s.key} className="flex items-center justify-between gap-4 text-xs">
            <span className="inline-flex items-center gap-1.5 text-fg-muted">
              <span className="h-0.5 w-3 rounded-full" style={{ background: s.color }} />
              {s.label}
            </span>
            <span className="font-semibold tnum text-fg">
              {yFormat(s.points[index].v)}
              {ySuffix}
            </span>
          </div>
        ))}
      </div>
      {event && (
        <div className="mt-2 border-t border-edge pt-1.5 text-2xs leading-snug text-warning">
          {event.label}
        </div>
      )}
    </div>
  );
}

function ticks(lo: number, hi: number, count: number): number[] {
  const step = (hi - lo) / count;
  return Array.from({ length: count + 1 }, (_, i) => lo + step * i);
}
function xTicks(n: number, count: number): number[] {
  const step = Math.max(1, Math.floor((n - 1) / count));
  const out: number[] = [];
  for (let i = 0; i < n; i += step) out.push(i);
  if (out[out.length - 1] !== n - 1) out.push(n - 1);
  return out;
}
function nearestIndex(dates: string[], t: string): number {
  const target = new Date(t).getTime();
  let best = -1;
  let bestDiff = Infinity;
  dates.forEach((d, i) => {
    const diff = Math.abs(new Date(d).getTime() - target);
    if (diff < bestDiff) {
      bestDiff = diff;
      best = i;
    }
  });
  return best;
}
