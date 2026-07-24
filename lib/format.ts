import type { MetricStat, MetricStatus, Trend } from "./types";

/** The demo clock. All relative dates in the product derive from this instant,
 *  so the dataset is deterministic regardless of the real wall-clock time. */
export const NOW = new Date("2026-03-18T09:32:00Z");

export function daysFromNow(days: number): string {
  const d = new Date(NOW.getTime() + days * 86400000);
  return d.toISOString();
}
export function hoursFromNow(h: number): string {
  return new Date(NOW.getTime() + h * 3600000).toISOString();
}
export function minutesFromNow(m: number): string {
  return new Date(NOW.getTime() + m * 60000).toISOString();
}

export function fmtDate(iso: string): string {
  const d = new Date(iso);
  return d.toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

export function fmtDateShort(iso: string): string {
  const d = new Date(iso);
  return d.toLocaleDateString("en-US", { month: "short", day: "numeric" });
}

export function fmtDateTime(iso: string): string {
  const d = new Date(iso);
  return d.toLocaleString("en-US", {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  });
}

export function fmtTime(iso: string): string {
  const d = new Date(iso);
  return d.toLocaleTimeString("en-US", {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  });
}

export function relativeTime(iso: string, now: Date = NOW): string {
  const diff = now.getTime() - new Date(iso).getTime();
  const past = diff >= 0;
  const s = Math.abs(diff) / 1000;
  const fmt = (n: number, u: string) => {
    const r = Math.round(n);
    const label = `${r} ${u}${r === 1 ? "" : "s"}`;
    return past ? `${label} ago` : `in ${label}`;
  };
  if (s < 60) return past ? "just now" : "in moments";
  if (s < 3600) return fmt(s / 60, "min");
  if (s < 86400) return fmt(s / 3600, "hr");
  if (s < 86400 * 30) return fmt(s / 86400, "day");
  if (s < 86400 * 365) return fmt(s / (86400 * 30), "mo");
  return fmt(s / (86400 * 365), "yr");
}

export function fmtCurrency(n: number, compact = true): string {
  const abs = Math.abs(n);
  const sign = n < 0 ? "-" : "";
  if (compact) {
    if (abs >= 1_000_000)
      return `${sign}$${(abs / 1_000_000).toFixed(abs >= 10_000_000 ? 0 : 1)}M`;
    if (abs >= 1_000) return `${sign}$${(abs / 1_000).toFixed(0)}K`;
  }
  return `${sign}$${abs.toLocaleString("en-US")}`;
}

export function fmtNumber(n: number): string {
  return n.toLocaleString("en-US");
}

export function fmtCompact(n: number): string {
  const abs = Math.abs(n);
  if (abs >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (abs >= 1_000) return `${(n / 1_000).toFixed(1)}K`;
  return `${n}`;
}

export function fmtPct(n: number, digits = 1): string {
  return `${n.toFixed(digits)}%`;
}

export function fmtSignedPct(n: number, digits = 1): string {
  const sign = n > 0 ? "+" : "";
  return `${sign}${n.toFixed(digits)}%`;
}

export function fmtMetric(m: MetricStat): string {
  const v = m.value;
  switch (m.format) {
    case "pct":
      return `${v.toFixed(1)}%`;
    case "pct1":
      return `${v.toFixed(1)}%`;
    case "int":
      return fmtNumber(Math.round(v));
    case "ms":
      return `${Math.round(v)} ms`;
    case "float2":
      return v.toFixed(2);
    case "float3":
      return v.toFixed(3);
    case "currency":
      return fmtCurrency(v);
    case "x":
      return `${v.toFixed(2)}x`;
    default:
      return `${v}${m.unit ?? ""}`;
  }
}

export function trendOf(delta?: number): Trend {
  if (delta === undefined || Math.abs(delta) < 0.05) return "flat";
  return delta > 0 ? "up" : "down";
}

/** Whether a signed delta should read as good/bad given the metric's direction. */
export function deltaStatus(m: MetricStat): MetricStatus {
  if (m.delta === undefined) return "neutral";
  const better = m.betterWhen ?? "higher";
  const improving = better === "higher" ? m.delta > 0 : m.delta < 0;
  if (Math.abs(m.delta) < 0.05) return "neutral";
  return improving ? "good" : "warning";
}

export const statusColor: Record<MetricStatus, string> = {
  good: "text-positive",
  warning: "text-warning",
  critical: "text-critical",
  neutral: "text-fg-muted",
};

export function classNames(...xs: (string | false | null | undefined)[]): string {
  return xs.filter(Boolean).join(" ");
}
