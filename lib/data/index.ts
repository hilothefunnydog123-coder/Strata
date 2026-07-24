import { ORG } from "../constants";
import { NOW } from "../format";
import type {
  AICategory,
  EstateStats,
  RiskLevel,
  SystemStatus,
  TimePoint,
} from "../types";
import { systems } from "./systems";

export * from "./systems";
export * from "./alerts";
export * from "./incidents";
export * from "./audit";
export * from "./agents";
export * from "./validation";
export * from "./governance";
export * from "./org";

function countBy<T extends string>(items: T[]): Record<T, number> {
  return items.reduce(
    (acc, k) => {
      acc[k] = (acc[k] ?? 0) + 1;
      return acc;
    },
    {} as Record<T, number>,
  );
}

const riskCounts: Record<RiskLevel, number> = {
  Low: 0,
  Moderate: 0,
  High: 0,
  Critical: 0,
};
systems.forEach((s) => (riskCounts[s.riskLevel] += 1));

const statusCounts: Record<SystemStatus, number> = {
  Operational: 0,
  Warning: 0,
  Degraded: 0,
  Critical: 0,
  Offline: 0,
};
systems.forEach((s) => (statusCounts[s.status] += 1));

const categoryCounts = Object.entries(
  countBy(systems.map((s) => s.category)),
)
  .map(([category, count]) => ({ category: category as AICategory, count }))
  .sort((a, b) => b.count - a.count);

// Portfolio adoption over the trailing 12 months, derived from deploy dates.
const growth: TimePoint[] = (() => {
  const points: TimePoint[] = [];
  for (let m = 11; m >= 0; m--) {
    const cutoff = new Date(NOW.getFullYear(), NOW.getMonth() - m + 1, 1).getTime();
    const count = systems.filter(
      (s) => new Date(s.deployedAt).getTime() < cutoff,
    ).length;
    const label = new Date(NOW.getFullYear(), NOW.getMonth() - m, 1).toISOString();
    points.push({ t: label, v: count });
  }
  return points;
})();

const incidentFrequency = [
  { month: "Oct", count: 2 },
  { month: "Nov", count: 3 },
  { month: "Dec", count: 1 },
  { month: "Jan", count: 4 },
  { month: "Feb", count: 3 },
  { month: "Mar", count: 5 },
];

const annualImpact = systems.reduce((sum, s) => sum + s.roi.annualImpact, 0);
const netImpact = systems.reduce((sum, s) => sum + s.roi.netImpact, 0);
const avgPerformanceDelta30d =
  systems.reduce((sum, s) => sum + (s.performance.headline.delta ?? 0), 0) /
  systems.length;

export const estate: EstateStats = {
  total: systems.length,
  production: systems.filter((s) => s.environment === "Production").length,
  needsAttention: systems.filter((s) => s.flags.needsAttention).length,
  activeIncidents: systems.filter((s) => s.flags.activeIncident).length,
  overdueValidation: systems.filter((s) => s.flags.overdueValidation).length,
  awaitingApproval: systems.filter((s) => s.flags.awaitingApproval).length,
  avgPerformanceDelta30d: Math.round(avgPerformanceDelta30d * 10) / 10,
  agents: systems.filter((s) => s.isAgent).length,
  hospitals: ORG.hospitals,
  annualImpact,
  netImpact,
  riskCounts,
  statusCounts,
  categoryCounts,
  growth,
  incidentFrequency,
};

/** Systems that need operator attention, most urgent first. */
export function systemsNeedingAttention() {
  const rank: Record<SystemStatus, number> = {
    Critical: 0,
    Degraded: 1,
    Warning: 2,
    Operational: 3,
    Offline: 4,
  };
  return systems
    .filter(
      (s) =>
        s.flags.needsAttention ||
        s.flags.activeIncident ||
        s.flags.overdueValidation,
    )
    .sort((a, b) => rank[a.status] - rank[b.status]);
}
