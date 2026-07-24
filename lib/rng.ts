import { NOW } from "./format";
import type { TimePoint } from "./types";

/** Deterministic PRNG (mulberry32). Seeded so mock data never changes between
 *  renders or reloads. */
export function seeded(seed: number): () => number {
  let a = seed >>> 0;
  return function () {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function hashString(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

export interface SeriesOptions {
  days: number;
  base: number;
  /** Random jitter amplitude (absolute units). */
  noise?: number;
  /** Gentle slope per day (absolute units). */
  drift?: number;
  /** Optional step change applied on/after a given day index. */
  step?: { atDay: number; delta: number; ramp?: number };
  min?: number;
  max?: number;
  seed: number;
  /** Sample interval in days (1 = daily). */
  interval?: number;
}

/** Build a realistic daily time series ending at NOW. */
export function makeSeries(opts: SeriesOptions): TimePoint[] {
  const { days, base, noise = 0, drift = 0, step, seed, interval = 1 } = opts;
  const rnd = seeded(seed);
  const points: TimePoint[] = [];
  let smoothed = base;
  for (let day = days; day >= 0; day -= interval) {
    const idx = days - day;
    let v = base + drift * idx;
    if (step && idx >= step.atDay) {
      const since = idx - step.atDay;
      const ramp = step.ramp ?? 1;
      const factor = ramp <= 1 ? 1 : Math.min(1, since / ramp);
      v += step.delta * factor;
    }
    // correlated noise for organic feel (light smoothing so designed steps land)
    smoothed = smoothed * 0.4 + (v + (rnd() - 0.5) * 2 * noise) * 0.6;
    let out = smoothed;
    if (opts.min !== undefined) out = Math.max(opts.min, out);
    if (opts.max !== undefined) out = Math.min(opts.max, out);
    const t = new Date(NOW.getTime() - day * 86400000).toISOString();
    points.push({ t, v: out });
  }
  return points;
}

/** Compact sparkline array from a series' values (normalized left as raw). */
export function sparkFromSeries(series: TimePoint[], count = 30): number[] {
  const tail = series.slice(-count);
  return tail.map((p) => round(p.v, 4));
}

export function round(n: number, dp = 2): number {
  const f = Math.pow(10, dp);
  return Math.round(n * f) / f;
}

export function lastOf(series: TimePoint[]): number {
  return series[series.length - 1]?.v ?? 0;
}

export function valueAtDaysAgo(series: TimePoint[], daysAgo: number): number {
  const idx = series.length - 1 - daysAgo;
  return series[Math.max(0, idx)]?.v ?? series[0]?.v ?? 0;
}

/** Build a histogram (as bucket heights summing to ~1) for a normal-ish dist. */
export function histogram(
  mean: number,
  sd: number,
  buckets: number,
  lo: number,
  hi: number,
): number[] {
  const out: number[] = [];
  const width = (hi - lo) / buckets;
  let sum = 0;
  for (let i = 0; i < buckets; i++) {
    const x = lo + width * (i + 0.5);
    const z = (x - mean) / sd;
    const y = Math.exp(-0.5 * z * z);
    out.push(y);
    sum += y;
  }
  return out.map((y) => round(y / sum, 4));
}
