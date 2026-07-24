import { prisma } from "./db";
import { buildSystemFromData, type RawPoint, type SystemExtras } from "./systemBuild";
import { NOW } from "../format";
import type { CustomSystemInput } from "../systemInput";
import type {
  AISystem,
  AICategory,
  AgentAction,
  AgentSession,
  Alert,
  AuditEvent,
  EstateStats,
  GovernanceWorkflow,
  Incident,
  IncidentEvent,
  RiskLevel,
  SystemStatus,
  ValidationRun,
} from "../types";

function safeParse<T>(s: string | null | undefined, fallback: T): T {
  if (!s) return fallback;
  try {
    return JSON.parse(s) as T;
  } catch {
    return fallback;
  }
}

const OPEN_INCIDENT = ["Investigating", "Contained", "Monitoring"];
const OPEN_GOV = ["Draft", "In review", "Blocked"];

// ---------------------------------------------------------------------------
// Systems — registration rows + real telemetry folded into full AISystem objects
// ---------------------------------------------------------------------------

export async function getOrgSystems(orgId: string): Promise<AISystem[]> {
  const [rows, points, incidents, governance, roi, validations] = await Promise.all([
    prisma.registeredSystem.findMany({ where: { orgId }, orderBy: { createdAt: "asc" } }),
    prisma.metricPoint.findMany({
      where: { orgId },
      select: { systemId: true, metric: true, value: true, subgroup: true, ts: true },
    }),
    prisma.incident.findMany({ where: { orgId, status: { in: OPEN_INCIDENT } }, select: { systemId: true } }),
    prisma.governanceItem.findMany({ where: { orgId, status: { in: OPEN_GOV } }, select: { systemId: true } }),
    prisma.roiRecord.findMany({ where: { orgId } }),
    prisma.validationRun.findMany({
      where: { orgId },
      orderBy: { createdAt: "desc" },
    }),
  ]);

  const pointsBySystem = new Map<string, RawPoint[]>();
  for (const p of points) {
    const arr = pointsBySystem.get(p.systemId) ?? [];
    arr.push({ metric: p.metric, value: p.value, subgroup: p.subgroup, ts: p.ts });
    pointsBySystem.set(p.systemId, arr);
  }
  const activeIncidentSystems = new Set(incidents.map((i) => i.systemId).filter(Boolean) as string[]);
  const openGovSystems = new Set(governance.map((g) => g.systemId).filter(Boolean) as string[]);
  const roiBySystem = new Map(roi.map((r) => [r.systemId, r]));
  const latestValidation = new Map<string, (typeof validations)[number]>();
  for (const v of validations) {
    if (!latestValidation.has(v.systemId)) latestValidation.set(v.systemId, v);
  }

  return rows.map((row) => {
    const input = safeParse<CustomSystemInput>(row.data, {} as CustomSystemInput);
    const v = latestValidation.get(row.id);
    const r = roiBySystem.get(row.id);
    const extras: SystemExtras = {
      hasActiveIncident: activeIncidentSystems.has(row.id),
      hasOpenGovernance: openGovSystems.has(row.id),
      roi: r
        ? {
            annualImpact: r.annualImpact,
            implementationCost: r.implementationCost,
            operatingCost: r.operatingCost,
            headlineLabel: r.headlineLabel,
            headlineValue: r.headlineValue,
            breakdown: safeParse(r.breakdown, []),
          }
        : null,
      validation: v
        ? { status: v.result as ValidationRun["overallResult"], completedAt: v.completedAt }
        : null,
    };
    return buildSystemFromData(input, pointsBySystem.get(row.id) ?? [], extras);
  });
}

// ---------------------------------------------------------------------------
// Estate stats — computed from the real built systems + real incident rows
// ---------------------------------------------------------------------------

const RISK_LEVELS: RiskLevel[] = ["Low", "Moderate", "High", "Critical"];
const STATUSES: SystemStatus[] = ["Operational", "Warning", "Degraded", "Critical", "Offline"];

export async function getEstateStats(orgId: string, systems?: AISystem[]): Promise<EstateStats> {
  const list = systems ?? (await getOrgSystems(orgId));
  const incidents = await prisma.incident.findMany({
    where: { orgId },
    select: { openedAt: true, status: true },
  });

  const riskCounts = Object.fromEntries(RISK_LEVELS.map((r) => [r, 0])) as Record<RiskLevel, number>;
  const statusCounts = Object.fromEntries(STATUSES.map((s) => [s, 0])) as Record<SystemStatus, number>;
  const categoryMap = new Map<AICategory, number>();
  const departments = new Set<string>();
  let annualImpact = 0;
  let netImpact = 0;
  let deltaSum = 0;
  let deltaN = 0;

  for (const s of list) {
    riskCounts[s.riskLevel]++;
    statusCounts[s.status]++;
    categoryMap.set(s.category, (categoryMap.get(s.category) ?? 0) + 1);
    if (s.department) departments.add(s.department);
    annualImpact += s.roi.annualImpact;
    netImpact += s.roi.netImpact;
    if (!s.performance.headline.noData && typeof s.performance.headline.delta === "number") {
      deltaSum += s.performance.headline.delta;
      deltaN++;
    }
  }

  // System growth over the last 12 months (cumulative, by deploy date)
  const growth: { t: string; v: number }[] = [];
  for (let m = 11; m >= 0; m--) {
    const edge = new Date(Date.UTC(NOW.getUTCFullYear(), NOW.getUTCMonth() - m + 1, 1));
    const count = list.filter((s) => new Date(s.deployedAt).getTime() < edge.getTime()).length;
    growth.push({ t: edge.toISOString(), v: count });
  }

  // Incident frequency over the last 6 months
  const incidentFrequency: { month: string; count: number }[] = [];
  for (let m = 5; m >= 0; m--) {
    const start = new Date(Date.UTC(NOW.getUTCFullYear(), NOW.getUTCMonth() - m, 1));
    const end = new Date(Date.UTC(NOW.getUTCFullYear(), NOW.getUTCMonth() - m + 1, 1));
    const count = incidents.filter((i) => {
      const t = new Date(i.openedAt).getTime();
      return t >= start.getTime() && t < end.getTime();
    }).length;
    incidentFrequency.push({
      month: start.toLocaleDateString("en-US", { month: "short" }),
      count,
    });
  }

  return {
    total: list.length,
    production: list.filter((s) => s.environment === "Production").length,
    needsAttention: list.filter((s) => s.flags.needsAttention).length,
    activeIncidents: incidents.filter((i) => OPEN_INCIDENT.includes(i.status)).length,
    overdueValidation: list.filter((s) => s.flags.overdueValidation).length,
    awaitingApproval: list.filter((s) => s.flags.awaitingApproval).length,
    avgPerformanceDelta30d: deltaN ? Math.round((deltaSum / deltaN) * 10) / 10 : 0,
    agents: list.filter((s) => s.isAgent).length,
    hospitals: departments.size,
    annualImpact,
    netImpact,
    riskCounts,
    statusCounts,
    categoryCounts: [...categoryMap.entries()].map(([category, count]) => ({ category, count })),
    growth,
    incidentFrequency,
  };
}

// ---------------------------------------------------------------------------
// Incidents
// ---------------------------------------------------------------------------

type IncidentRow = NonNullable<Awaited<ReturnType<typeof prisma.incident.findFirst>>> & {
  events?: { at: Date; actor: string; kind: string; text: string }[];
};

function mapIncident(row: IncidentRow): Incident {
  return {
    id: row.id,
    systemId: row.systemId ?? "",
    systemName: row.systemName,
    title: row.title,
    severity: row.severity as Incident["severity"],
    status: row.status as Incident["status"],
    openedAt: row.openedAt.toISOString(),
    resolvedAt: row.resolvedAt?.toISOString(),
    detectedBy: row.detectedBy,
    owner: row.owner,
    description: row.description,
    affectedPeriod: row.affectedPeriod ?? "",
    affectedPopulation: row.affectedPopulation ?? "",
    suspectedCause: row.suspectedCause ?? "",
    rootCause: row.rootCause ?? undefined,
    resolution: row.resolution ?? undefined,
    impact: row.impact ?? "",
    timeline: (row.events ?? []).map(
      (e): IncidentEvent => ({
        at: e.at.toISOString(),
        actor: e.actor,
        kind: e.kind as IncidentEvent["kind"],
        text: e.text,
      }),
    ),
    relatedAlertIds: [],
    relatedVersion: row.relatedVersion ?? undefined,
  };
}

export async function getIncidents(orgId: string): Promise<Incident[]> {
  const rows = await prisma.incident.findMany({
    where: { orgId },
    orderBy: { openedAt: "desc" },
    include: { events: { orderBy: { at: "asc" } } },
  });
  return rows.map(mapIncident);
}

export async function getIncidentById(orgId: string, id: string): Promise<Incident | null> {
  const row = await prisma.incident.findFirst({
    where: { id, orgId },
    include: { events: { orderBy: { at: "asc" } } },
  });
  return row ? mapIncident(row) : null;
}

// ---------------------------------------------------------------------------
// Validation runs
// ---------------------------------------------------------------------------

export async function getValidationRuns(orgId: string): Promise<ValidationRun[]> {
  const rows = await prisma.validationRun.findMany({
    where: { orgId },
    orderBy: { startedAt: "desc" },
  });
  return rows.map((r) => ({
    id: r.id,
    systemId: r.systemId,
    systemName: r.systemName,
    version: r.version,
    dataset: r.dataset,
    datasetSize: r.datasetSize,
    requestedBy: r.requestedBy,
    startedAt: r.startedAt.toISOString(),
    completedAt: r.completedAt?.toISOString(),
    status: r.status as ValidationRun["status"],
    overallResult: r.result as ValidationRun["overallResult"],
    progress: r.progress,
    tests: safeParse(r.tests, []),
    metrics: safeParse(r.metrics, []),
    subgroups: safeParse(r.subgroups, []),
    decision: r.decision ? safeParse(r.decision, undefined) : undefined,
  }));
}

// ---------------------------------------------------------------------------
// Governance
// ---------------------------------------------------------------------------

export async function getGovernance(orgId: string): Promise<GovernanceWorkflow[]> {
  const rows = await prisma.governanceItem.findMany({
    where: { orgId },
    orderBy: { submittedAt: "desc" },
  });
  return rows.map((g) => ({
    id: g.id,
    systemName: g.systemName,
    systemId: g.systemId ?? undefined,
    category: g.category as AICategory,
    vendor: g.vendor,
    riskLevel: g.riskLevel as RiskLevel,
    submittedBy: g.submittedBy,
    submittedAt: g.submittedAt.toISOString(),
    currentStage: g.currentStage,
    status: g.status as GovernanceWorkflow["status"],
    steps: safeParse(g.steps, []),
    blockingReason: g.blockingReason ?? undefined,
    targetGoLive: g.targetGoLive?.toISOString(),
  }));
}

// ---------------------------------------------------------------------------
// Alerts
// ---------------------------------------------------------------------------

export async function getAlerts(orgId: string): Promise<Alert[]> {
  const rows = await prisma.alert.findMany({
    where: { orgId },
    orderBy: { at: "desc" },
  });
  return rows.map((a) => ({
    id: a.id,
    systemId: a.systemId ?? "",
    systemName: a.systemName,
    category: a.category as Alert["category"],
    severity: a.severity as Alert["severity"],
    title: a.title,
    detail: a.detail ?? "",
    changeSummary: a.changeSummary ?? "",
    recommendedAction: a.recommendedAction ?? "",
    at: a.at.toISOString(),
    status: a.status as Alert["status"],
    owner: a.owner ?? undefined,
    evidence: [],
    linkTab: a.linkTab ?? undefined,
  }));
}

// ---------------------------------------------------------------------------
// Audit
// ---------------------------------------------------------------------------

export async function getAuditEvents(orgId: string, limit = 200): Promise<AuditEvent[]> {
  const rows = await prisma.auditEvent.findMany({
    where: { orgId },
    orderBy: { at: "desc" },
    take: limit,
  });
  return rows.map((e) => ({
    id: e.id,
    at: e.at.toISOString(),
    actor: e.actor,
    actorRole: e.actorRole,
    action: e.action,
    object: e.object,
    systemId: e.systemId ?? undefined,
    category: e.category as AuditEvent["category"],
    reason: e.reason ?? undefined,
  }));
}

export function auditForSystem(events: AuditEvent[], systemId: string): AuditEvent[] {
  return events.filter((e) => e.systemId === systemId);
}

// ---------------------------------------------------------------------------
// Agent monitoring
// ---------------------------------------------------------------------------

export async function getAgentSessions(orgId: string): Promise<AgentSession[]> {
  const rows = await prisma.agentSession.findMany({
    where: { orgId },
    orderBy: { startedAt: "desc" },
    include: { _count: { select: { events: true } }, events: { select: { tool: true } } },
  });
  return rows.map((s) => ({
    id: s.id,
    systemId: s.systemId,
    label: s.label,
    subject: s.subject,
    startedAt: s.startedAt.toISOString(),
    endedAt: s.endedAt?.toISOString(),
    actionCount: s._count.events,
    toolCalls: s.events.filter((e) => e.tool).length,
    status: s.status as AgentSession["status"],
    outcome: s.outcome ?? "",
    riskFlags: safeParse(s.riskFlags, []),
    anomalyScore: s.anomalyScore,
  }));
}

export async function getAgentActions(orgId: string): Promise<Record<string, AgentAction[]>> {
  const sessions = await prisma.agentSession.findMany({
    where: { orgId },
    select: { id: true, events: { orderBy: { step: "asc" } } },
  });
  const out: Record<string, AgentAction[]> = {};
  for (const s of sessions) {
    out[s.id] = s.events.map((e) => ({
      id: e.id,
      sessionId: s.id,
      at: e.at.toISOString(),
      step: e.step,
      kind: e.kind as AgentAction["kind"],
      summary: e.summary,
      detail: e.detail ?? undefined,
      tool: e.tool ?? undefined,
      dataSource: e.dataSource ?? undefined,
      status: e.status as AgentAction["status"],
      durationMs: e.durationMs ?? undefined,
      riskNote: e.riskNote ?? undefined,
    }));
  }
  return out;
}
