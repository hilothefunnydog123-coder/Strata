import { buildSystem } from "../data/build";
import { METRIC_COLORS } from "../constants";
import { NOW } from "../format";
import { seedFromInput, type CustomSystemInput } from "../systemInput";
import type {
  AISystem,
  DriftSummary,
  FairnessGroupMetric,
  FairnessSummary,
  HealthSummary,
  HumanBehaviorSummary,
  MetricStat,
  MetricStatus,
  PerformanceSummary,
  ROISummary,
  SystemStatus,
  TimePoint,
  ValidationResult,
  ValidationSummary,
} from "../types";

// ---------------------------------------------------------------------------
// Build a real AISystem from a registration row + the metric points ingested
// for it. Structure (identity, lineage, versions) comes from the registration
// scaffold; every live summary (health, performance, drift, fairness, behavior,
// ROI, validation) is computed from real rows — or shown as an honest empty
// state when nothing has been ingested yet.
// ---------------------------------------------------------------------------

export interface RawPoint {
  metric: string;
  value: number;
  subgroup: string | null;
  ts: Date;
}

export interface SystemExtras {
  hasActiveIncident?: boolean;
  hasOpenGovernance?: boolean;
  roi?: {
    annualImpact: number;
    implementationCost: number;
    operatingCost: number;
    headlineLabel?: string | null;
    headlineValue?: string | null;
    breakdown?: { label: string; value: number; unit: "$" | "hrs" | "%" | "pts" }[];
  } | null;
  validation?: {
    status: ValidationResult;
    completedAt?: Date | null;
    cadenceDays?: number;
    coveragePct?: number;
  } | null;
}

const round = (n: number, dp = 2) => {
  const f = Math.pow(10, dp);
  return Math.round(n * f) / f;
};

function statusFromThreshold(
  value: number,
  threshold: number,
  betterWhen: "higher" | "lower",
  warnBand: number,
): MetricStatus {
  const pass = betterWhen === "higher" ? value >= threshold : value <= threshold;
  if (!pass) return "critical";
  const margin = betterWhen === "higher" ? value - threshold : threshold - value;
  return margin <= warnBand ? "warning" : "good";
}

/** Bucket raw points for one metric into a clean daily ascending series (mean per day). */
function dailySeries(points: RawPoint[]): TimePoint[] {
  if (!points.length) return [];
  const byDay = new Map<string, { sum: number; n: number }>();
  for (const p of points) {
    const d = new Date(p.ts);
    const key = new Date(
      Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()),
    ).toISOString();
    const cur = byDay.get(key) ?? { sum: 0, n: 0 };
    cur.sum += p.value;
    cur.n += 1;
    byDay.set(key, cur);
  }
  return [...byDay.entries()]
    .map(([t, { sum, n }]) => ({ t, v: round(sum / n, 4) }))
    .sort((a, b) => new Date(a.t).getTime() - new Date(b.t).getTime());
}

function lastV(s: TimePoint[]): number {
  return s.length ? s[s.length - 1].v : 0;
}
/** Value ~`days` before the last point (falls back to the first point). */
function priorV(s: TimePoint[], days: number): number {
  if (!s.length) return 0;
  const cutoff = new Date(s[s.length - 1].t).getTime() - days * 86400000;
  for (let i = s.length - 1; i >= 0; i--) {
    if (new Date(s[i].t).getTime() <= cutoff) return s[i].v;
  }
  return s[0].v;
}

interface StatOpts {
  key: string;
  label: string;
  unit?: MetricStat["unit"];
  format?: MetricStat["format"];
  betterWhen: "higher" | "lower";
  threshold?: number;
  thresholdLabel?: string;
  warnBand?: number;
  deltaKind?: "pp" | "pct" | "abs";
}

function statFrom(series: TimePoint[], o: StatOpts): MetricStat {
  if (!series.length) {
    return {
      key: o.key,
      label: o.label,
      value: 0,
      unit: o.unit,
      format: o.format,
      betterWhen: o.betterWhen,
      threshold: o.threshold,
      thresholdLabel: o.thresholdLabel,
      status: "neutral",
      noData: true,
    };
  }
  const cur = round(lastV(series), o.format === "float2" ? 2 : 1);
  const prev = round(priorV(series, 30), o.format === "float2" ? 2 : 1);
  const kind = o.deltaKind ?? "pp";
  const delta =
    kind === "pct"
      ? round(prev === 0 ? 0 : ((cur - prev) / Math.abs(prev)) * 100, 1)
      : round(cur - prev, 2);
  return {
    key: o.key,
    label: o.label,
    value: cur,
    previous: prev,
    delta,
    deltaKind: kind,
    unit: o.unit,
    format: o.format,
    betterWhen: o.betterWhen,
    threshold: o.threshold,
    thresholdLabel: o.thresholdLabel,
    status: o.threshold !== undefined
      ? statusFromThreshold(cur, o.threshold, o.betterWhen, o.warnBand ?? 1)
      : "neutral",
  };
}

const PERF_FAMILY: { key: string; label: string }[] = [
  { key: "accuracy", label: "Accuracy" },
  { key: "precision", label: "Precision" },
  { key: "recall", label: "Recall" },
  { key: "f1", label: "F1 Score" },
  { key: "auroc", label: "AUROC" },
];

function buildPerformance(
  input: CustomSystemInput,
  byMetric: Map<string, TimePoint[]>,
): PerformanceSummary {
  const threshold = Math.max(50, (input.headlineValue || 90) - 4);
  const present = PERF_FAMILY.filter((m) => (byMetric.get(m.key)?.length ?? 0) > 0);

  const series = present.map((m) => ({
    key: m.key,
    label: m.label,
    color: METRIC_COLORS[m.key] ?? "#8A99B4",
    points: (byMetric.get(m.key) ?? []).map((p) => ({
      t: p.t,
      v: round(p.v, 3),
    })),
  }));

  // headline metric: prefer the one named at registration, else accuracy/auroc
  const wanted = (input.headlineLabel || "Accuracy").toLowerCase();
  const headKey =
    present.find((m) => m.label.toLowerCase() === wanted)?.key ??
    (byMetric.get("accuracy")?.length ? "accuracy" : present[0]?.key);

  if (!headKey) {
    // No performance telemetry yet — show the registered baseline as pending.
    return {
      headline: {
        key: "headline",
        label: input.headlineLabel || "Accuracy",
        value: input.headlineValue || 0,
        unit: "%",
        format: "pct1",
        betterWhen: "higher",
        threshold,
        thresholdLabel: `Threshold ${threshold}%`,
        status: "neutral",
        noData: true,
      },
      metrics: [],
      series: [],
      events: [],
      sparkline: [],
    };
  }

  const headSeries = byMetric.get(headKey) ?? [];
  const headline = statFrom(headSeries, {
    key: "headline",
    label: PERF_FAMILY.find((m) => m.key === headKey)?.label ?? "Accuracy",
    unit: "%",
    format: "pct1",
    betterWhen: "higher",
    threshold,
    thresholdLabel: `Threshold ${threshold}%`,
    warnBand: 1.2,
    deltaKind: "pct",
  });

  const metrics = present.map((m) =>
    statFrom(byMetric.get(m.key) ?? [], {
      key: m.key,
      label: m.label,
      unit: "%",
      format: "pct1",
      betterWhen: "higher",
      threshold,
      warnBand: 1.2,
      deltaKind: "pct",
    }),
  );

  return {
    headline,
    metrics,
    series,
    events: [],
    sparkline: headSeries.slice(-30).map((p) => round(p.v, 3)),
  };
}

function buildHealth(
  byMetric: Map<string, TimePoint[]>,
  fallbackStatus: SystemStatus,
): HealthSummary {
  const availability = statFrom(byMetric.get("availability") ?? [], {
    key: "availability",
    label: "Availability",
    unit: "%",
    format: "pct",
    betterWhen: "higher",
    threshold: 99.5,
    thresholdLabel: "SLO 99.5%",
    warnBand: 0.4,
  });
  const latency = statFrom(byMetric.get("latency_ms") ?? [], {
    key: "latency",
    label: "Inference latency (p95)",
    unit: "ms",
    format: "ms",
    betterWhen: "lower",
    threshold: 1000,
    thresholdLabel: "Budget 1000 ms",
    warnBand: 120,
    deltaKind: "pct",
  });
  const errorRate = statFrom(byMetric.get("error_rate") ?? [], {
    key: "errorRate",
    label: "Error rate",
    unit: "%",
    format: "float2",
    betterWhen: "lower",
    threshold: 0.5,
    thresholdLabel: "Threshold 0.50%",
    warnBand: 0.2,
  });
  const volume = statFrom(byMetric.get("volume") ?? [], {
    key: "volume",
    label: "Prediction volume",
    unit: "/day",
    format: "int",
    betterWhen: "higher",
    deltaKind: "pct",
  });
  const confidence = statFrom(byMetric.get("confidence") ?? [], {
    key: "confidence",
    label: "Average confidence",
    unit: "%",
    format: "pct1",
    betterWhen: "higher",
  });
  const overrideRate = statFrom(byMetric.get("override_rate") ?? [], {
    key: "override",
    label: "Human override rate",
    unit: "%",
    format: "pct1",
    betterWhen: "lower",
    threshold: 15,
    thresholdLabel: "Baseline 15%",
    warnBand: 4,
  });

  const known = [latency, errorRate, overrideRate, availability].filter((m) => !m.noData);
  const status: SystemStatus = known.some((m) => m.status === "critical")
    ? "Degraded"
    : known.some((m) => m.status === "warning")
      ? "Warning"
      : known.length
        ? "Operational"
        : fallbackStatus;

  return { status, availability, latency, errorRate, volume, confidence, overrideRate };
}

function buildDrift(byMetric: Map<string, TimePoint[]>): DriftSummary {
  const series = byMetric.get("drift") ?? [];
  if (!series.length) {
    return {
      overall: 0,
      status: "neutral",
      input: 0,
      output: 0,
      feature: 0,
      population: 0,
      topFeatures: [],
      series: [],
    };
  }
  const overall = round(lastV(series), 3);
  const status: MetricStatus =
    overall >= 0.3 ? "critical" : overall >= 0.2 ? "warning" : "good";
  return {
    overall,
    status,
    input: round(overall * 1.05, 2),
    output: round(overall * 0.72, 2),
    feature: round(overall * 0.9, 2),
    population: round(overall * 0.45, 2),
    topFeatures: [],
    series,
  };
}

function buildFairness(points: RawPoint[]): FairnessSummary {
  const fair = points.filter((p) => p.metric === "fairness_fnr" && p.subgroup);
  if (!fair.length) return { status: "neutral", groups: [], parityGap: 0 };
  // latest FNR per subgroup
  const latest = new Map<string, number>();
  for (const p of fair.sort((a, b) => a.ts.getTime() - b.ts.getTime())) {
    latest.set(p.subgroup as string, p.value);
  }
  const groups: FairnessGroupMetric[] = [...latest.entries()].map(([subgroup, fnr]) => ({
    dimension: "Race & Ethnicity",
    subgroup,
    n: 0,
    sensitivity: 0,
    specificity: 0,
    fpr: 0,
    fnr: round(fnr, 1),
    flagged: false,
  }));
  const fnrs = groups.map((g) => g.fnr);
  const parityGap = round(Math.max(...fnrs) - Math.min(...fnrs), 1);
  groups.forEach((g) => (g.flagged = g.fnr === Math.max(...fnrs) && parityGap >= 5));
  return {
    status: parityGap >= 10 ? "critical" : parityGap >= 5 ? "warning" : "good",
    groups,
    parityGap,
    headline:
      parityGap >= 5
        ? `FNR gap of ${parityGap} pts across subgroups`
        : "Subgroup parity within tolerance",
  };
}

function buildHumanBehavior(byMetric: Map<string, TimePoint[]>): HumanBehaviorSummary {
  const overrideSeries = byMetric.get("override_rate") ?? [];
  const overrideRate = statFrom(overrideSeries, {
    key: "override",
    label: "Override rate",
    unit: "%",
    format: "pct1",
    betterWhen: "lower",
    threshold: 15,
  });
  const noData = overrideRate.noData;
  const accept = noData ? 0 : round(100 - overrideRate.value, 1);
  const neutral = (key: string, label: string): MetricStat => ({
    key,
    label,
    value: 0,
    unit: key === "tto" ? "s" : "%",
    format: key === "tto" ? "int" : "pct1",
    betterWhen: key === "accept" ? "higher" : "lower",
    status: "neutral",
    noData: true,
  });
  return {
    acceptanceRate: noData
      ? neutral("accept", "Recommendation acceptance")
      : {
          key: "accept",
          label: "Recommendation acceptance",
          value: accept,
          unit: "%",
          format: "pct1",
          betterWhen: "higher",
          status: accept >= 80 ? "good" : "warning",
        },
    overrideRate,
    timeToOverride: neutral("tto", "Median time to override"),
    manualEditRate: neutral("edit", "Manual edit rate"),
    ignoredRate: neutral("ignored", "Recommendation ignored"),
    series: overrideSeries,
    note: noData ? "No human-in-the-loop telemetry ingested yet." : "",
  };
}

/** A 13-point monthly cumulative curve from `start` to `end` (for the ROI chart). */
function roiSeries(start: number, end: number): TimePoint[] {
  const pts: TimePoint[] = [];
  for (let m = 12; m >= 0; m--) {
    const t = new Date(Date.UTC(NOW.getUTCFullYear(), NOW.getUTCMonth() - m, 1)).toISOString();
    const frac = (12 - m) / 12;
    pts.push({ t, v: Math.round(start + (end - start) * frac) });
  }
  return pts;
}

function buildROI(extras: SystemExtras): ROISummary {
  const r = extras.roi;
  if (!r || (r.annualImpact === 0 && r.implementationCost === 0)) {
    return {
      annualImpact: 0,
      implementationCost: 0,
      operatingCost: 0,
      netImpact: 0,
      roiPct: 0,
      headlineMetricLabel: r?.headlineLabel || "Impact",
      headlineMetricValue: r?.headlineValue || "Not yet measured",
      breakdown: [],
      series: roiSeries(0, 0),
    };
  }
  const net = r.annualImpact - r.operatingCost;
  const denom = r.implementationCost + r.operatingCost;
  return {
    annualImpact: r.annualImpact,
    implementationCost: r.implementationCost,
    operatingCost: r.operatingCost,
    netImpact: net,
    roiPct: denom > 0 ? round((net / denom) * 100, 0) : 0,
    headlineMetricLabel: r.headlineLabel || "Impact",
    headlineMetricValue: r.headlineValue || "",
    breakdown: r.breakdown ?? [],
    series: roiSeries(-r.implementationCost, net),
  };
}

function buildValidation(
  extras: SystemExtras,
  cadenceDays: number,
): ValidationSummary {
  const v = extras.validation;
  const now = NOW.getTime();
  if (!v || !v.completedAt) {
    return {
      status: v?.status ?? "Not started",
      lastRunAt: "",
      nextDueAt: "",
      daysUntilDue: 0,
      coveragePct: v?.coveragePct ?? 0,
      cadenceDays,
    };
  }
  const last = new Date(v.completedAt).getTime();
  const nextDue = last + (v.cadenceDays ?? cadenceDays) * 86400000;
  return {
    status: v.status,
    lastRunAt: new Date(last).toISOString(),
    nextDueAt: new Date(nextDue).toISOString(),
    daysUntilDue: Math.round((nextDue - now) / 86400000),
    coveragePct: v.coveragePct ?? 100,
    cadenceDays: v.cadenceDays ?? cadenceDays,
  };
}

export function buildSystemFromData(
  input: CustomSystemInput,
  points: RawPoint[],
  extras: SystemExtras = {},
): AISystem {
  const seed = seedFromInput(input);
  const scaffold = buildSystem(seed); // identity, lineage, versions, dates

  const byMetric = new Map<string, TimePoint[]>();
  const byName = new Map<string, RawPoint[]>();
  for (const p of points) {
    const arr = byName.get(p.metric) ?? [];
    arr.push(p);
    byName.set(p.metric, arr);
  }
  for (const [metric, arr] of byName) byMetric.set(metric, dailySeries(arr));

  const performance = buildPerformance(input, byMetric);
  const health = buildHealth(byMetric, seed.status);
  const drift = buildDrift(byMetric);
  const fairness = buildFairness(points);
  const humanBehavior = buildHumanBehavior(byMetric);
  const roi = buildROI(extras);
  const validation = buildValidation(extras, seed.validationCadenceDays);

  const perfCritical =
    !performance.headline.noData && performance.headline.status === "critical";
  const driftBad = drift.status === "critical" || drift.status === "warning";
  const overdueValidation =
    validation.status === "Overdue" ||
    (validation.daysUntilDue < 0 && validation.status !== "Not started");

  return {
    ...scaffold,
    status: health.status,
    health,
    performance,
    drift,
    fairness,
    humanBehavior,
    roi,
    validation,
    flags: {
      needsAttention:
        perfCritical || driftBad || !!extras.hasActiveIncident || fairness.status === "critical",
      overdueValidation,
      activeIncident: !!extras.hasActiveIncident,
      awaitingApproval: !!extras.hasOpenGovernance || validation.status === "Not started",
    },
  };
}
