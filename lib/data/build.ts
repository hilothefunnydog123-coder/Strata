import { METRIC_COLORS } from "../constants";
import { NOW, daysFromNow } from "../format";
import { histogram, makeSeries, round, seeded, hashString } from "../rng";
import type {
  AISystem,
  DriftFeatureDetail,
  DriftSummary,
  FairnessGroupMetric,
  FairnessSummary,
  HealthSummary,
  HumanBehaviorSummary,
  LineageNode,
  MetricStat,
  MetricStatus,
  ModelVersion,
  PerformanceSummary,
  ROISummary,
  SeriesEvent,
  TimePoint,
  ValidationSummary,
} from "../types";
import type { SystemSeed } from "./systems";

function statusFromThreshold(
  value: number,
  threshold: number,
  betterWhen: "higher" | "lower",
  warnBand: number,
): MetricStatus {
  const pass = betterWhen === "higher" ? value >= threshold : value <= threshold;
  if (!pass) return "critical";
  const margin =
    betterWhen === "higher" ? value - threshold : threshold - value;
  return margin <= warnBand ? "warning" : "good";
}

function stat(partial: Omit<MetricStat, "status"> & { status?: MetricStatus }): MetricStat {
  return { status: "neutral", ...partial };
}

/** Derive the five performance metrics + series around a headline metric. */
function buildPerformance(seed: SystemSeed, rng: () => number): PerformanceSummary {
  const h = seed.headline;
  const days = 90;
  const eventDayIdx = seed.perfEvent ? days - seed.perfEvent.atDay : undefined;
  const delta = h.delta30d ?? 0; // signed % change over 30d (relative)
  // Convert 30d relative delta into an absolute step for the series.
  const absDrop = (h.value * delta) / 100;

  const events: SeriesEvent[] = [];
  if (seed.perfEvent) {
    events.push({
      t: daysFromNow(-seed.perfEvent.atDay),
      label: seed.perfEvent.label,
      kind: seed.perfEvent.kind,
      detail: seed.perfEvent.detail,
    });
  }

  // Family of correlated metrics; recall usually suffers most on drift.
  const family: { key: string; label: string; base: number; sens: number }[] = [
    { key: "auroc", label: "AUROC", base: clamp(h.value / 100 + 0.02, 0.6, 0.99) * 100, sens: 0.8 },
    { key: "accuracy", label: "Accuracy", base: h.value, sens: 1 },
    { key: "precision", label: "Precision", base: clamp(h.value - 2.5, 55, 99), sens: 0.7 },
    { key: "recall", label: "Recall", base: clamp(h.value - 4.5, 50, 99), sens: 1.35 },
    { key: "f1", label: "F1 Score", base: clamp(h.value - 3.2, 52, 99), sens: 1.05 },
  ];

  const series = family.map((m) => {
    // change30 is the signed 30-day change for this metric, scaled by how
    // sensitive it is to the event. The series is anchored so its endpoint
    // lands on m.base (the intended current value).
    const change30 = absDrop * m.sens; // absDrop is signed (h.value * delta / 100)
    const cur = m.base;
    const points = makeSeries({
      days,
      base: seed.perfEvent ? cur - change30 : cur - 3 * change30,
      noise: m.base * 0.005,
      drift: seed.perfEvent ? 0 : change30 / 30,
      step: seed.perfEvent
        ? { atDay: eventDayIdx!, delta: change30, ramp: 3 }
        : undefined,
      min: 40,
      max: 99.9,
      seed: hashString(seed.id + m.key),
    });
    return {
      key: m.key,
      label: m.label,
      color: METRIC_COLORS[m.key] ?? "#8A99B4",
      points,
    };
  });

  // headline stat from the accuracy/auroc family matching h.label
  const headlineSeries =
    series.find((s) => s.label.toLowerCase() === h.label.toLowerCase()) ??
    series[1];
  const cur = headlineSeries.points[headlineSeries.points.length - 1].v;
  const prev30 =
    headlineSeries.points[headlineSeries.points.length - 31]?.v ?? cur;
  const realDelta = ((cur - prev30) / prev30) * 100;

  const mkStat = (key: string, label: string): MetricStat => {
    const s = series.find((x) => x.key === key)!;
    const c = round(s.points[s.points.length - 1].v, 1);
    const p = round(s.points[s.points.length - 31]?.v ?? c, 1);
    const d = round(((c - p) / p) * 100, 1);
    return stat({
      key,
      label,
      value: c,
      previous: p,
      delta: d,
      deltaKind: "pct",
      betterWhen: "higher",
      threshold: h.threshold,
      unit: "%",
      format: "pct1",
      status: statusFromThreshold(c, h.threshold ?? 0, "higher", 1.2),
    });
  };

  return {
    headline: stat({
      key: "headline",
      label: h.label,
      value: round(cur, 1),
      previous: round(prev30, 1),
      delta: round(realDelta, 1),
      deltaKind: "pct",
      betterWhen: "higher",
      threshold: h.threshold,
      thresholdLabel: h.threshold ? `Threshold ${h.threshold}%` : undefined,
      unit: "%",
      format: "pct1",
      status: statusFromThreshold(cur, h.threshold ?? 0, "higher", 1.2),
    }),
    metrics: [
      mkStat("accuracy", "Accuracy"),
      mkStat("precision", "Precision"),
      mkStat("recall", "Recall"),
      mkStat("f1", "F1 Score"),
      mkStat("auroc", "AUROC"),
    ],
    series,
    events,
    sparkline: headlineSeries.points.slice(-30).map((p) => round(p.v, 3)),
  };
}

function clamp(v: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, v));
}

function buildHealth(seed: SystemSeed): HealthSummary {
  const b = seed.bases;
  return {
    status: seed.status,
    availability: stat({
      key: "availability",
      label: "Availability",
      value: b.availability,
      previous: round(b.availability - 0.1, 2),
      delta: 0.1,
      deltaKind: "pp",
      betterWhen: "higher",
      threshold: 99.5,
      thresholdLabel: "SLO 99.5%",
      unit: "%",
      format: "pct",
      status: statusFromThreshold(b.availability, 99.5, "higher", 0.4),
    }),
    latency: stat({
      key: "latency",
      label: "Inference latency (p95)",
      value: b.latencyMs,
      previous: Math.round(b.latencyMs * (1 - b.latencyDelta / 100)),
      delta: b.latencyDelta,
      deltaKind: "pct",
      betterWhen: "lower",
      threshold: b.latencyThreshold,
      thresholdLabel: `Budget ${b.latencyThreshold} ms`,
      unit: "ms",
      format: "ms",
      status: statusFromThreshold(b.latencyMs, b.latencyThreshold, "lower", 80),
    }),
    errorRate: stat({
      key: "errorRate",
      label: "Error rate",
      value: b.errorRatePct,
      previous: round(b.errorRatePct - b.errorDelta, 2),
      delta: b.errorDelta,
      deltaKind: "pp",
      betterWhen: "lower",
      threshold: 0.5,
      thresholdLabel: "Threshold 0.50%",
      unit: "%",
      format: "float2",
      status: statusFromThreshold(b.errorRatePct, 0.5, "lower", 0.2),
    }),
    volume: stat({
      key: "volume",
      label: "Prediction volume",
      value: b.volumePerDay,
      previous: Math.round(b.volumePerDay * (1 - b.volumeDelta / 100)),
      delta: b.volumeDelta,
      deltaKind: "pct",
      betterWhen: "higher",
      unit: "/day",
      format: "int",
      status: "neutral",
    }),
    confidence: stat({
      key: "confidence",
      label: "Average confidence",
      value: b.confidencePct,
      previous: round(b.confidencePct - b.confidenceDelta, 1),
      delta: b.confidenceDelta,
      deltaKind: "pp",
      betterWhen: "higher",
      unit: "%",
      format: "pct1",
      status: b.confidenceDelta < -1.5 ? "warning" : "neutral",
    }),
    overrideRate: stat({
      key: "override",
      label: "Human override rate",
      value: b.overrideRatePct,
      previous: round(b.overrideRatePct - b.overrideDelta, 1),
      delta: b.overrideDelta,
      deltaKind: "pp",
      betterWhen: "lower",
      threshold: b.overrideThreshold,
      thresholdLabel: `Baseline ${b.overrideThreshold}%`,
      unit: "%",
      format: "pct1",
      status: statusFromThreshold(
        b.overrideRatePct,
        b.overrideThreshold,
        "lower",
        4,
      ),
    }),
  };
}

function buildDrift(seed: SystemSeed): DriftSummary {
  const d = seed.drift;
  const eventDayIdx = seed.perfEvent ? 90 - seed.perfEvent.atDay : undefined;
  const series = makeSeries({
    days: 90,
    base: d.overall * 0.35,
    noise: 0.012,
    drift: seed.perfEvent ? 0 : (d.overall - d.overall * 0.35) / 90,
    step: seed.perfEvent
      ? { atDay: eventDayIdx!, delta: d.overall - d.overall * 0.35, ramp: 5 }
      : undefined,
    min: 0,
    max: 1,
    seed: hashString(seed.id + "drift"),
  });

  const drivers: DriftFeatureDetail[] = (d.drivers ?? []).map((dr) => {
    const changePct = round(((dr.cur - dr.prev) / Math.abs(dr.prev || 1)) * 100, 1);
    return {
      feature: dr.feature,
      previousMean: dr.prev,
      currentMean: dr.cur,
      unit: dr.unit,
      changePct,
      contribution: dr.contribution,
      previousDist: histogram(dr.prev, dr.sd, 12, dr.lo, dr.hi),
      currentDist: histogram(dr.cur, dr.sd * (dr.spread ?? 1), 12, dr.lo, dr.hi),
    };
  });

  return {
    overall: d.overall,
    status: d.status,
    input: round(d.overall * 1.05, 2),
    output: round(d.overall * 0.72, 2),
    feature: round(d.overall * 0.9, 2),
    population: round(d.overall * (d.populationFactor ?? 0.5), 2),
    topFeatures: drivers,
    series,
  };
}

function buildFairness(seed: SystemSeed): FairnessSummary {
  const f = seed.fairness;
  if (!f) {
    return { status: "neutral", groups: [], parityGap: 0 };
  }
  let parityGap = 0;
  f.groups.forEach((g) => {
    if (g.fnrPrevious) parityGap = Math.max(parityGap, Math.abs(g.fnr - g.fnrPrevious));
  });
  return {
    status: f.status,
    groups: f.groups,
    headline: f.headline,
    parityGap: round(parityGap, 1),
  };
}

function buildHumanBehavior(seed: SystemSeed): HumanBehaviorSummary {
  const b = seed.bases;
  const eventDayIdx = seed.perfEvent ? 90 - seed.perfEvent.atDay : undefined;
  const series = makeSeries({
    days: 90,
    base: b.overrideRatePct - b.overrideDelta,
    noise: 0.5,
    drift: seed.perfEvent ? 0 : b.overrideDelta / 30,
    step: seed.perfEvent
      ? { atDay: eventDayIdx!, delta: b.overrideDelta, ramp: 8 }
      : undefined,
    min: 0,
    max: 60,
    seed: hashString(seed.id + "override"),
  });
  const accept = round(100 - b.overrideRatePct - b.ignoredRatePct, 1);
  return {
    acceptanceRate: stat({
      key: "accept",
      label: "Recommendation acceptance",
      value: accept,
      previous: round(accept - -b.overrideDelta, 1),
      delta: round(-b.overrideDelta, 1),
      deltaKind: "pp",
      betterWhen: "higher",
      unit: "%",
      format: "pct1",
      status: b.overrideDelta > 3 ? "warning" : "good",
    }),
    overrideRate: stat({
      key: "override",
      label: "Override rate",
      value: b.overrideRatePct,
      previous: round(b.overrideRatePct - b.overrideDelta, 1),
      delta: b.overrideDelta,
      deltaKind: "pp",
      betterWhen: "lower",
      threshold: b.overrideThreshold,
      unit: "%",
      format: "pct1",
      status: b.overrideDelta > 3 ? "warning" : "neutral",
    }),
    timeToOverride: stat({
      key: "tto",
      label: "Median time to override",
      value: b.timeToOverrideSec,
      unit: "s",
      betterWhen: "higher",
      format: "int",
      status: "neutral",
    }),
    manualEditRate: stat({
      key: "edit",
      label: "Manual edit rate",
      value: b.manualEditRatePct,
      unit: "%",
      format: "pct1",
      betterWhen: "lower",
      status: "neutral",
    }),
    ignoredRate: stat({
      key: "ignored",
      label: "Recommendation ignored",
      value: b.ignoredRatePct,
      unit: "%",
      format: "pct1",
      betterWhen: "lower",
      status: "neutral",
    }),
    series,
    note: seed.humanNote ?? "",
  };
}

function buildROI(seed: SystemSeed): ROISummary {
  const r = seed.roi;
  const net = r.annualImpact - r.operatingCost;
  const roiPct = round((net / (r.implementationCost + r.operatingCost)) * 100, 0);
  const series = makeSeries({
    days: 365,
    base: -r.implementationCost,
    noise: r.annualImpact * 0.004,
    drift: (net + r.implementationCost) / 365,
    seed: hashString(seed.id + "roi"),
    interval: 7,
  });
  return {
    annualImpact: r.annualImpact,
    implementationCost: r.implementationCost,
    operatingCost: r.operatingCost,
    netImpact: net,
    roiPct,
    headlineMetricLabel: r.headlineMetricLabel,
    headlineMetricValue: r.headlineMetricValue,
    breakdown: r.breakdown,
    series,
  };
}

function buildVersions(seed: SystemSeed): ModelVersion[] {
  return seed.versions.map((v, i) => ({
    id: `${seed.id}-v${i}`,
    systemId: seed.id,
    version: v.version,
    status: v.status,
    releaseDate: daysFromNow(-v.releasedDaysAgo),
    approvedBy: v.approvedBy,
    approvedAt: v.approvedBy ? daysFromNow(-v.releasedDaysAgo - 2) : undefined,
    validationStatus: v.validationStatus,
    rollbackAvailable: v.status !== "Current production" && v.status !== "Retired",
    changelog: v.changelog,
    metrics: v.metrics,
    performanceDelta: v.performanceDelta,
    notes: v.notes,
  }));
}

function buildValidation(seed: SystemSeed): ValidationSummary {
  const cadence = seed.validationCadenceDays;
  const nextDue = seed.lastValidatedDaysAgo * -1 + cadence; // days from now
  return {
    status: seed.validationStatus,
    lastRunAt: daysFromNow(-seed.lastValidatedDaysAgo),
    nextDueAt: daysFromNow(nextDue),
    daysUntilDue: nextDue,
    coveragePct: seed.validationCoverage ?? 96,
    cadenceDays: cadence,
  };
}

function buildLineage(seed: SystemSeed): LineageNode[] {
  return seed.lineage;
}

export function buildSystem(seed: SystemSeed): AISystem {
  const rng = seeded(hashString(seed.id));
  const performance = buildPerformance(seed, rng);
  const health = buildHealth(seed);
  return {
    id: seed.id,
    name: seed.name,
    shortName: seed.shortName,
    description: seed.description,
    purpose: seed.purpose,
    category: seed.category,
    modelClass: seed.modelClass,
    owner: seed.owner,
    ownerContact: seed.ownerContact,
    department: seed.department,
    vendor: seed.vendor,
    isInternal: seed.vendor === "Internal",
    isAgent: !!seed.isAgent,
    currentVersion: seed.version,
    environment: seed.environment,
    riskLevel: seed.riskLevel,
    regulatoryClass: seed.regulatoryClass,
    dataClassification: seed.dataClassification,
    status: seed.status,
    inputs: seed.inputs,
    outputs: seed.outputs,
    downstreamActions: seed.downstreamActions,
    lineage: buildLineage(seed),
    deployedAt: daysFromNow(-seed.deployedDaysAgo),
    lastValidatedAt: daysFromNow(-seed.lastValidatedDaysAgo),
    nextValidationAt: daysFromNow(-seed.lastValidatedDaysAgo + seed.validationCadenceDays),
    lastReviewAt: daysFromNow(-seed.lastValidatedDaysAgo),
    health,
    performance,
    drift: buildDrift(seed),
    fairness: buildFairness(seed),
    humanBehavior: buildHumanBehavior(seed),
    roi: buildROI(seed),
    validation: buildValidation(seed),
    versions: buildVersions(seed),
    flags: seed.flags,
    tags: seed.tags,
  };
}
