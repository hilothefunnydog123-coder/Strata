import { ORG } from "../constants";
import { NOW } from "../format";
import type {
  AICategory,
  AISystem,
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

const INCIDENT_FREQUENCY = [
  { month: "Oct", count: 2 },
  { month: "Nov", count: 3 },
  { month: "Dec", count: 1 },
  { month: "Jan", count: 4 },
  { month: "Feb", count: 3 },
  { month: "Mar", count: 5 },
];

/** Compute estate-wide aggregates from any set of systems (base or live). */
export function deriveEstate(list: AISystem[]): EstateStats {
  const riskCounts: Record<RiskLevel, number> = { Low: 0, Moderate: 0, High: 0, Critical: 0 };
  list.forEach((s) => (riskCounts[s.riskLevel] += 1));

  const statusCounts: Record<SystemStatus, number> = {
    Operational: 0,
    Warning: 0,
    Degraded: 0,
    Critical: 0,
    Offline: 0,
  };
  list.forEach((s) => (statusCounts[s.status] += 1));

  const categoryCounts = Object.entries(countBy(list.map((s) => s.category)))
    .map(([category, count]) => ({ category: category as AICategory, count }))
    .sort((a, b) => b.count - a.count);

  const growth: TimePoint[] = [];
  for (let m = 11; m >= 0; m--) {
    const cutoff = new Date(NOW.getFullYear(), NOW.getMonth() - m + 1, 1).getTime();
    const count = list.filter((s) => new Date(s.deployedAt).getTime() < cutoff).length;
    const label = new Date(NOW.getFullYear(), NOW.getMonth() - m, 1).toISOString();
    growth.push({ t: label, v: count });
  }

  const annualImpact = list.reduce((sum, s) => sum + s.roi.annualImpact, 0);
  const netImpact = list.reduce((sum, s) => sum + s.roi.netImpact, 0);
  const avgPerformanceDelta30d = list.length
    ? list.reduce((sum, s) => sum + (s.performance.headline.delta ?? 0), 0) / list.length
    : 0;

  return {
    total: list.length,
    production: list.filter((s) => s.environment === "Production").length,
    needsAttention: list.filter((s) => s.flags.needsAttention).length,
    activeIncidents: list.filter((s) => s.flags.activeIncident).length,
    overdueValidation: list.filter((s) => s.flags.overdueValidation).length,
    awaitingApproval: list.filter((s) => s.flags.awaitingApproval).length,
    avgPerformanceDelta30d: Math.round(avgPerformanceDelta30d * 10) / 10,
    agents: list.filter((s) => s.isAgent).length,
    hospitals: ORG.hospitals,
    annualImpact,
    netImpact,
    riskCounts,
    statusCounts,
    categoryCounts,
    growth,
    incidentFrequency: INCIDENT_FREQUENCY,
  };
}

export const estate: EstateStats = deriveEstate(systems);

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
