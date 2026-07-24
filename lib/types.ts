// ============================================================================
// Ward — core domain model for the Healthcare AI Control Plane.
// Every entity is strongly typed and structured like a real backend response
// so mock data can be swapped for a live API with no shape changes.
// ============================================================================

export type AICategory =
  | "Clinical Prediction"
  | "Medical Imaging"
  | "Clinical Documentation"
  | "Autonomous Agent"
  | "Revenue Cycle"
  | "Scheduling & Operations"
  | "Decision Support"
  | "Medication Safety"
  | "Oncology & Genomics";

export type Environment = "Production" | "Staging" | "Development";

export type RiskLevel = "Low" | "Moderate" | "High" | "Critical";

export type SystemStatus =
  | "Operational"
  | "Warning"
  | "Degraded"
  | "Critical"
  | "Offline";

export type ModelClass =
  | "Gradient-Boosted Trees"
  | "Deep CNN"
  | "Vision Transformer"
  | "Fine-tuned LLM"
  | "Transformer (NLP)"
  | "Recurrent Neural Net"
  | "Ensemble"
  | "Logistic Regression"
  | "Agentic LLM System";

export type RegulatoryClass =
  | "FDA Cleared (510k)"
  | "FDA Cleared (De Novo)"
  | "Enterprise-Validated"
  | "Clinical Decision Support (Non-Device)"
  | "Laboratory-Developed Test"
  | "Research Use Only";

export type DataClassification =
  | "PHI"
  | "Limited Data Set"
  | "De-identified"
  | "Operational";

export type MetricStatus = "good" | "warning" | "critical" | "neutral";
export type Trend = "up" | "down" | "flat";

/** A single monitored metric with its threshold and period-over-period change. */
export interface MetricStat {
  key: string;
  label: string;
  value: number;
  unit?: "%" | "ms" | "/day" | "x" | "$" | "s" | "";
  previous?: number;
  /** Signed percentage-point or relative change vs. previous period. */
  delta?: number;
  deltaKind?: "pp" | "pct" | "abs";
  betterWhen?: "higher" | "lower";
  threshold?: number;
  thresholdLabel?: string;
  status: MetricStatus;
  format?: "pct" | "pct1" | "int" | "ms" | "float2" | "float3" | "currency" | "x";
}

export interface TimePoint {
  t: string; // ISO date
  v: number;
}

export interface SeriesEvent {
  t: string;
  label: string;
  kind: "deploy" | "schema" | "incident" | "validation" | "threshold" | "config";
  detail?: string;
}

export interface MultiSeries {
  key: string;
  label: string;
  color: string;
  points: TimePoint[];
}

// ---------------------------------------------------------------------------
// Summaries embedded on each AI system
// ---------------------------------------------------------------------------

export interface HealthSummary {
  status: SystemStatus;
  availability: MetricStat;
  latency: MetricStat;
  errorRate: MetricStat;
  volume: MetricStat;
  confidence: MetricStat;
  overrideRate: MetricStat;
}

export interface PerformanceSummary {
  headline: MetricStat; // the metric that defines this model (AUROC / Accuracy / F1)
  metrics: MetricStat[]; // accuracy, precision, recall, f1, auroc
  series: MultiSeries[]; // time series for the performance chart
  events: SeriesEvent[]; // annotations (schema changes, deploys)
  sparkline: number[]; // compact 30d trend for tables
}

export interface DriftFeatureDetail {
  feature: string;
  previousMean: number;
  currentMean: number;
  unit: string;
  changePct: number;
  contribution: number; // share of total drift (0-1)
  previousDist: number[]; // histogram buckets
  currentDist: number[];
}

export interface DriftSummary {
  overall: number; // 0-1 PSI-style score
  status: MetricStatus;
  input: number;
  output: number;
  feature: number;
  population: number;
  topFeatures: DriftFeatureDetail[];
  series: TimePoint[];
}

export interface FairnessGroupMetric {
  dimension: "Age" | "Sex" | "Race & Ethnicity";
  subgroup: string;
  n: number;
  sensitivity: number;
  specificity: number;
  fpr: number;
  fnr: number;
  fnrPrevious?: number;
  flagged: boolean;
}

export interface FairnessSummary {
  status: MetricStatus;
  groups: FairnessGroupMetric[];
  headline?: string; // human-readable summary of the worst disparity
  parityGap: number; // max FNR gap across subgroups
}

export interface HumanBehaviorSummary {
  acceptanceRate: MetricStat;
  overrideRate: MetricStat;
  timeToOverride: MetricStat;
  manualEditRate: MetricStat;
  ignoredRate: MetricStat;
  series: TimePoint[]; // override rate over time
  note: string;
}

export interface ROISummary {
  annualImpact: number;
  implementationCost: number;
  operatingCost: number;
  netImpact: number;
  roiPct: number;
  headlineMetricLabel: string;
  headlineMetricValue: string;
  breakdown: { label: string; value: number; unit: "$" | "hrs" | "%" | "pts" }[];
  series: TimePoint[]; // cumulative net value
}

export type ValidationResult =
  | "Passed"
  | "Passed with warnings"
  | "Failed"
  | "In progress"
  | "Overdue"
  | "Not started";

export interface ValidationSummary {
  status: ValidationResult;
  lastRunAt: string;
  nextDueAt: string;
  daysUntilDue: number;
  coveragePct: number;
  cadenceDays: number;
}

// ---------------------------------------------------------------------------
// The AI system — the atom of the registry
// ---------------------------------------------------------------------------

export interface AISystem {
  id: string;
  name: string;
  shortName: string;
  description: string;
  purpose: string;
  category: AICategory;
  modelClass: ModelClass;
  owner: string; // team
  ownerContact: string; // person
  department: string;
  vendor: string; // "Internal" for in-house
  isInternal: boolean;
  isAgent: boolean;
  currentVersion: string;
  environment: Environment;
  riskLevel: RiskLevel;
  regulatoryClass: RegulatoryClass;
  dataClassification: DataClassification;
  status: SystemStatus;

  inputs: string[];
  outputs: string[];
  downstreamActions: string[];
  lineage: LineageNode[];

  deployedAt: string;
  lastValidatedAt: string;
  nextValidationAt: string;
  lastReviewAt: string;

  health: HealthSummary;
  performance: PerformanceSummary;
  drift: DriftSummary;
  fairness: FairnessSummary;
  humanBehavior: HumanBehaviorSummary;
  roi: ROISummary;
  validation: ValidationSummary;

  versions: ModelVersion[];

  flags: {
    needsAttention: boolean;
    overdueValidation: boolean;
    activeIncident: boolean;
    awaitingApproval: boolean;
  };

  tags: string[];
}

export interface LineageNode {
  id: string;
  label: string;
  kind: "source" | "transform" | "model" | "output" | "action" | "human";
  detail?: string;
}

export interface ModelVersion {
  id: string;
  systemId: string;
  version: string;
  status:
    | "Current production"
    | "Staging"
    | "Candidate"
    | "Retired"
    | "Blocked"
    | "Rolled back";
  releaseDate: string;
  approvedBy?: string;
  approvedAt?: string;
  validationStatus: ValidationResult;
  rollbackAvailable: boolean;
  changelog: string[];
  metrics: { auroc: number; sensitivity: number; specificity: number };
  performanceDelta: number; // vs previous version, in AUROC points
  notes?: string;
}

// ---------------------------------------------------------------------------
// Alerts, incidents, audit, agents, validation, governance
// ---------------------------------------------------------------------------

export type AlertCategory =
  | "Performance"
  | "Drift"
  | "Fairness"
  | "Security"
  | "Compliance"
  | "Model Version"
  | "Agent Behavior"
  | "Validation";

export type AlertSeverity = "Critical" | "High" | "Medium" | "Low" | "Info";

export type AlertStatus =
  | "Active"
  | "Acknowledged"
  | "Assigned"
  | "Muted"
  | "Escalated"
  | "Resolved";

export interface Alert {
  id: string;
  systemId: string;
  systemName: string;
  category: AlertCategory;
  severity: AlertSeverity;
  title: string;
  detail: string;
  changeSummary: string;
  recommendedAction: string;
  at: string;
  status: AlertStatus;
  owner?: string;
  evidence: { label: string; value: string; status?: MetricStatus }[];
  linkTab?: string; // which control-center tab holds the evidence
}

export type IncidentSeverity = "SEV-1" | "SEV-2" | "SEV-3" | "SEV-4";
export type IncidentStatus =
  | "Investigating"
  | "Contained"
  | "Monitoring"
  | "Resolved"
  | "Closed";

export interface IncidentEvent {
  at: string;
  actor: string;
  kind: "detect" | "action" | "comment" | "status" | "deploy" | "resolve";
  text: string;
}

export interface Incident {
  id: string;
  systemId: string;
  systemName: string;
  title: string;
  severity: IncidentSeverity;
  status: IncidentStatus;
  openedAt: string;
  resolvedAt?: string;
  detectedBy: string;
  owner: string;
  description: string;
  affectedPeriod: string;
  affectedPopulation: string;
  suspectedCause: string;
  rootCause?: string;
  resolution?: string;
  impact: string;
  timeline: IncidentEvent[];
  relatedAlertIds: string[];
  relatedVersion?: string;
}

export type AuditCategory =
  | "Deployment"
  | "Version"
  | "Configuration"
  | "Approval"
  | "Validation"
  | "Incident"
  | "Access"
  | "Policy";

export interface AuditEvent {
  id: string;
  at: string;
  actor: string;
  actorRole: string;
  action: string;
  object: string;
  systemId?: string;
  category: AuditCategory;
  reason?: string;
}

// ------- Agent monitoring -------

export type AgentActionKind =
  | "session"
  | "read"
  | "tool"
  | "decision"
  | "generate"
  | "message"
  | "submit"
  | "approval"
  | "access"
  | "anomaly";

export type AgentActionStatus =
  | "normal"
  | "flagged"
  | "blocked"
  | "approved"
  | "pending";

export interface AgentAction {
  id: string;
  sessionId: string;
  at: string;
  step: number;
  kind: AgentActionKind;
  summary: string;
  detail?: string;
  tool?: string;
  dataSource?: string;
  status: AgentActionStatus;
  durationMs?: number;
  riskNote?: string;
}

export interface AgentSession {
  id: string;
  systemId: string;
  label: string; // masked case reference
  subject: string; // masked patient
  startedAt: string;
  endedAt?: string;
  actionCount: number;
  toolCalls: number;
  status: "Completed" | "Awaiting approval" | "Blocked" | "In progress";
  outcome: string;
  riskFlags: string[];
  anomalyScore: number;
}

export interface AgentPolicy {
  tool: string;
  scope: string;
  requiresApproval: boolean;
  used24h: number;
  status: "Within policy" | "Elevated" | "Violation";
}

// ------- Validation -------

export interface ValidationTest {
  key: string;
  label: string;
  description: string;
  status: "Passed" | "Warning" | "Failed" | "Running" | "Queued" | "Skipped";
  detail?: string;
}

export interface ValidationMetricResult {
  metric: string;
  value: number;
  threshold: number;
  betterWhen: "higher" | "lower";
  status: MetricStatus;
  unit?: string;
}

export interface ValidationRun {
  id: string;
  systemId: string;
  systemName: string;
  version: string;
  dataset: string;
  datasetSize: number;
  requestedBy: string;
  startedAt: string;
  completedAt?: string;
  status: "Queued" | "Running" | "Passed" | "Passed with warnings" | "Failed";
  overallResult: ValidationResult;
  progress: number; // 0-100
  tests: ValidationTest[];
  metrics: ValidationMetricResult[];
  subgroups: FairnessGroupMetric[];
  decision?: {
    by: string;
    at: string;
    decision: "Approved" | "Rejected" | "Blocked";
    comment: string;
  };
}

export interface ValidationDataset {
  id: string;
  name: string;
  description: string;
  size: number;
  window: string;
  phiHandling: string;
}

// ------- Governance -------

export type GovStepStatus =
  | "Complete"
  | "In progress"
  | "Blocked"
  | "Pending"
  | "Rejected";

export interface GovStep {
  key: string;
  name: string;
  owner: string;
  ownerRole: string;
  status: GovStepStatus;
  completedAt?: string;
  dueDate?: string;
  comment?: string;
  requiredDocs: { name: string; status: "Provided" | "Missing" | "In review" }[];
}

export interface GovernanceWorkflow {
  id: string;
  systemName: string;
  systemId?: string;
  category: AICategory;
  vendor: string;
  riskLevel: RiskLevel;
  submittedBy: string;
  submittedAt: string;
  currentStage: string;
  status: "Draft" | "In review" | "Blocked" | "Approved" | "Rejected";
  steps: GovStep[];
  blockingReason?: string;
  targetGoLive?: string;
}

// ------- Organization -------

export type UserRole =
  | "Administrator"
  | "AI Governance Lead"
  | "Clinical Reviewer"
  | "Data Scientist"
  | "Compliance Officer"
  | "Executive";

export interface OrgUser {
  id: string;
  name: string;
  role: UserRole;
  email: string;
  team: string;
  status: "Active" | "Invited" | "Suspended";
  lastActive: string;
  initials: string;
}

export interface RolePermission {
  role: UserRole;
  description: string;
  scopes: { area: string; level: "Full" | "Edit" | "Approve" | "View" | "None" }[];
  memberCount: number;
}

export interface RiskPolicy {
  riskLevel: RiskLevel;
  validationCadenceDays: number;
  approvalsRequired: number;
  driftThreshold: number;
  fairnessThreshold: number;
  requiresClinicalReview: boolean;
}

export interface AlertThreshold {
  id: string;
  category: AlertCategory;
  metric: string;
  condition: string;
  severity: AlertSeverity;
  enabled: boolean;
}

export interface Integration {
  id: string;
  name: string;
  category: string;
  status: "Connected" | "Degraded" | "Not connected";
  detail: string;
  lastSync?: string;
}

// ------- Org-level aggregates -------

export interface EstateStats {
  total: number;
  production: number;
  needsAttention: number;
  activeIncidents: number;
  overdueValidation: number;
  awaitingApproval: number;
  avgPerformanceDelta30d: number;
  agents: number;
  hospitals: number;
  annualImpact: number;
  netImpact: number;
  riskCounts: Record<RiskLevel, number>;
  statusCounts: Record<SystemStatus, number>;
  categoryCounts: { category: AICategory; count: number }[];
  growth: TimePoint[];
  incidentFrequency: { month: string; count: number }[];
}
