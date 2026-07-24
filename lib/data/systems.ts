import type {
  AICategory,
  AISystem,
  DataClassification,
  Environment,
  FairnessGroupMetric,
  LineageNode,
  MetricStatus,
  ModelClass,
  RegulatoryClass,
  RiskLevel,
  SeriesEvent,
  SystemStatus,
  ValidationResult,
} from "../types";
import { buildSystem } from "./build";

// ---------------------------------------------------------------------------
// SystemSeed — the compact, authored input the builder expands into a full
// AISystem (metrics, time series, drift distributions, versions, lineage).
// ---------------------------------------------------------------------------

export interface Vitals {
  availability: number;
  latencyMs: number;
  latencyDelta: number;
  latencyThreshold: number;
  errorRatePct: number;
  errorDelta: number;
  volumePerDay: number;
  volumeDelta: number;
  confidencePct: number;
  confidenceDelta: number;
  overrideRatePct: number;
  overrideDelta: number;
  overrideThreshold: number;
  timeToOverrideSec: number;
  manualEditRatePct: number;
  ignoredRatePct: number;
}

export interface DriftDriver {
  feature: string;
  prev: number;
  cur: number;
  unit: string;
  sd: number;
  lo: number;
  hi: number;
  contribution: number;
  spread?: number;
}

export interface VersionSeed {
  version: string;
  status:
    | "Current production"
    | "Staging"
    | "Candidate"
    | "Retired"
    | "Blocked"
    | "Rolled back";
  releasedDaysAgo: number;
  approvedBy?: string;
  validationStatus: ValidationResult;
  changelog: string[];
  metrics: { auroc: number; sensitivity: number; specificity: number };
  performanceDelta: number;
  notes?: string;
}

export interface SystemSeed {
  id: string;
  name: string;
  shortName: string;
  description: string;
  purpose: string;
  category: AICategory;
  modelClass: ModelClass;
  owner: string;
  ownerContact: string;
  department: string;
  vendor: string;
  isAgent?: boolean;
  version: string;
  environment: Environment;
  riskLevel: RiskLevel;
  regulatoryClass: RegulatoryClass;
  dataClassification: DataClassification;
  status: SystemStatus;
  inputs: string[];
  outputs: string[];
  downstreamActions: string[];
  lineage: LineageNode[];
  deployedDaysAgo: number;
  lastValidatedDaysAgo: number;
  validationCadenceDays: number;
  validationCoverage?: number;
  validationStatus: ValidationResult;
  headline: { label: string; value: number; threshold: number; delta30d: number };
  bases: Vitals;
  drift: {
    overall: number;
    status: MetricStatus;
    populationFactor?: number;
    drivers?: DriftDriver[];
  };
  fairness?: {
    status: MetricStatus;
    headline?: string;
    groups: FairnessGroupMetric[];
  };
  humanNote?: string;
  roi: {
    annualImpact: number;
    implementationCost: number;
    operatingCost: number;
    headlineMetricLabel: string;
    headlineMetricValue: string;
    breakdown: { label: string; value: number; unit: "$" | "hrs" | "%" | "pts" }[];
  };
  perfEvent?: SeriesEvent["kind"] extends never
    ? never
    : { atDay: number; label: string; kind: SeriesEvent["kind"]; detail?: string };
  versions: VersionSeed[];
  flags: {
    needsAttention: boolean;
    overdueValidation: boolean;
    activeIncident: boolean;
    awaitingApproval: boolean;
  };
  tags: string[];
}

// ---------------------------------------------------------------------------
// Authoring helpers to keep each system compact.
// ---------------------------------------------------------------------------

function vitals(o: Partial<Vitals>): Vitals {
  return {
    availability: 99.9,
    latencyMs: 180,
    latencyDelta: 0,
    latencyThreshold: 400,
    errorRatePct: 0.08,
    errorDelta: 0,
    volumePerDay: 1200,
    volumeDelta: 1.5,
    confidencePct: 88,
    confidenceDelta: 0,
    overrideRatePct: 9,
    overrideDelta: 0.4,
    overrideThreshold: 12,
    timeToOverrideSec: 95,
    manualEditRatePct: 6,
    ignoredRatePct: 4,
    ...o,
  };
}

function lineage(nodes: [LineageNode["kind"], string, string?][]): LineageNode[] {
  return nodes.map(([kind, label, detail], i) => ({
    id: `n${i}`,
    kind,
    label,
    detail,
  }));
}

/** Standard, mostly-balanced fairness table for clinical models. */
function balancedFairness(base: number, jitter = 0.4): FairnessGroupMetric[] {
  const mk = (
    dimension: FairnessGroupMetric["dimension"],
    subgroup: string,
    n: number,
    d: number,
  ): FairnessGroupMetric => ({
    dimension,
    subgroup,
    n,
    sensitivity: round(base + d, 1),
    specificity: round(base - 1 + d * 0.5, 1),
    fpr: round(6 - d * 0.3, 1),
    fnr: round(8 - d, 1),
    flagged: false,
  });
  return [
    mk("Age", "Under 40", 4210, jitter),
    mk("Age", "40 to 65", 9840, jitter * 0.4),
    mk("Age", "Over 65", 7930, -jitter * 0.6),
    mk("Sex", "Female", 11020, jitter * 0.2),
    mk("Sex", "Male", 10960, -jitter * 0.2),
  ];
}

function round(n: number, dp = 2): number {
  const f = Math.pow(10, dp);
  return Math.round(n * f) / f;
}

const NO_FLAGS = {
  needsAttention: false,
  overdueValidation: false,
  activeIncident: false,
  awaitingApproval: false,
};

// ===========================================================================
// HERO SYSTEM 1 — Sepsis Risk Predictor (the demo narrative anchor)
// ===========================================================================

const sepsis: SystemSeed = {
  id: "sepsis-risk-predictor",
  name: "Sepsis Risk Predictor",
  shortName: "Sepsis Predictor",
  description:
    "Continuously scores inpatients for early sepsis onset from vitals, labs, and nursing assessments, surfacing a risk score to the clinical deterioration dashboard.",
  purpose:
    "Detect sepsis six hours earlier than standard screening to enable earlier antibiotics and fluid resuscitation.",
  category: "Clinical Prediction",
  modelClass: "Gradient-Boosted Trees",
  owner: "Clinical AI Team",
  ownerContact: "Dr. Elena Marsh",
  department: "Critical Care",
  vendor: "Internal",
  version: "4.2.1",
  environment: "Production",
  riskLevel: "High",
  regulatoryClass: "Clinical Decision Support (Non-Device)",
  dataClassification: "PHI",
  status: "Warning",
  inputs: [
    "Epic EHR — vitals stream",
    "Laboratory results (CBC, lactate, creatinine)",
    "Nursing flowsheet assessments",
    "ADT admission feed",
  ],
  outputs: ["Sepsis risk score (0-100)", "Contributing factors", "Recommended screening action"],
  downstreamActions: [
    "Clinical deterioration dashboard alert",
    "Rapid response team notification (score > 80)",
    "Nursing reassessment task",
  ],
  lineage: lineage([
    ["source", "Epic EHR", "Vitals, labs, ADT via FHIR R4"],
    ["transform", "Feature pipeline", "34 features, 15-min windows"],
    ["model", "Sepsis Risk Predictor 4.2.1", "Gradient-boosted trees"],
    ["output", "Risk score 0-100", "Calibrated probability"],
    ["action", "Deterioration dashboard", "Surfaced to bedside RN"],
    ["human", "Clinician review", "Screen / treat / dismiss"],
  ]),
  deployedDaysAgo: 372,
  lastValidatedDaysAgo: 78,
  validationCadenceDays: 90,
  validationCoverage: 94,
  validationStatus: "Passed with warnings",
  headline: { label: "Accuracy", value: 91.4, threshold: 90, delta30d: -3.2 },
  bases: vitals({
    availability: 99.1,
    latencyMs: 240,
    latencyDelta: 6,
    latencyThreshold: 400,
    errorRatePct: 0.31,
    errorDelta: 0.19,
    volumePerDay: 3820,
    volumeDelta: -1.2,
    confidencePct: 82.6,
    confidenceDelta: -4.1,
    overrideRatePct: 17,
    overrideDelta: 8,
    overrideThreshold: 12,
    timeToOverrideSec: 72,
    manualEditRatePct: 0,
    ignoredRatePct: 9,
  }),
  drift: {
    overall: 0.18,
    status: "warning",
    populationFactor: 0.6,
    drivers: [
      { feature: "Respiratory rate", prev: 18.4, cur: 15.1, unit: "breaths/min", sd: 4, lo: 6, hi: 34, contribution: 0.41, spread: 1.3 },
      { feature: "Creatinine", prev: 1.12, cur: 1.02, unit: "mg/dL", sd: 0.4, lo: 0.3, hi: 3, contribution: 0.27, spread: 1.1 },
      { feature: "Age", prev: 61.2, cur: 64.8, unit: "years", sd: 16, lo: 18, hi: 95, contribution: 0.18 },
      { feature: "Lactate", prev: 1.9, cur: 2.0, unit: "mmol/L", sd: 0.9, lo: 0.4, hi: 6, contribution: 0.14 },
    ],
  },
  fairness: {
    status: "critical",
    headline:
      "False negative rate for patients over 65 rose from 7.2% to 11.4% following the March 14 schema change, a 4.2 point disparity above the 3.0 point policy threshold.",
    groups: [
      { dimension: "Age", subgroup: "Under 40", n: 2140, sensitivity: 92.8, specificity: 90.1, fpr: 9.9, fnr: 7.2, fnrPrevious: 7.0, flagged: false },
      { dimension: "Age", subgroup: "40 to 65", n: 6820, sensitivity: 91.9, specificity: 89.4, fpr: 10.6, fnr: 8.1, fnrPrevious: 7.6, flagged: false },
      { dimension: "Age", subgroup: "Over 65", n: 7460, sensitivity: 88.6, specificity: 88.0, fpr: 12.0, fnr: 11.4, fnrPrevious: 7.2, flagged: true },
      { dimension: "Sex", subgroup: "Female", n: 8410, sensitivity: 90.8, specificity: 89.0, fpr: 11.0, fnr: 9.2, fnrPrevious: 8.6, flagged: false },
      { dimension: "Sex", subgroup: "Male", n: 8010, sensitivity: 91.2, specificity: 89.2, fpr: 10.8, fnr: 8.8, fnrPrevious: 8.4, flagged: false },
    ],
  },
  humanNote:
    "Clinicians are overriding 17% of high-risk recommendations, up 8 points over 30 days. The override spike began the week of the March 14 schema change and concentrates in the medical ICU, consistent with degraded recall rather than a workflow change.",
  roi: {
    annualImpact: 1_200_000,
    implementationCost: 610_000,
    operatingCost: 240_000,
    headlineMetricLabel: "Sepsis mortality reduction",
    headlineMetricValue: "18% relative",
    breakdown: [
      { label: "Earlier antibiotic administration", value: 640_000, unit: "$" },
      { label: "Reduced ICU length of stay", value: 420_000, unit: "$" },
      { label: "Avoided sepsis readmissions", value: 140_000, unit: "$" },
      { label: "Bedside minutes saved per screen", value: 4.2, unit: "hrs" },
    ],
  },
  perfEvent: {
    atDay: 4,
    label: "EHR schema update",
    kind: "schema",
    detail:
      "Epic v2026.02 remapped the respiratory-rate flowsheet row; the feature pipeline began ingesting nulls for 22% of encounters.",
  },
  versions: [
    {
      version: "4.2.1",
      status: "Current production",
      releasedDaysAgo: 6,
      approvedBy: "Dr. Elena Marsh",
      validationStatus: "Passed with warnings",
      changelog: [
        "Hotfix: null-imputation for respiratory-rate feature",
        "Recalibrated risk thresholds for medical ICU cohort",
      ],
      metrics: { auroc: 0.923, sensitivity: 89.1, specificity: 88.4 },
      performanceDelta: -1.8,
      notes: "Deployed as a hotfix after the schema-change degradation was detected.",
    },
    {
      version: "4.2.0",
      status: "Rolled back",
      releasedDaysAgo: 26,
      approvedBy: "Dr. Elena Marsh",
      validationStatus: "Passed",
      changelog: ["Added lactate trend feature", "Expanded training window to 24 months"],
      metrics: { auroc: 0.941, sensitivity: 92.4, specificity: 89.0 },
      performanceDelta: 1.1,
      notes: "Strong at release; degraded after upstream schema change, not a model regression.",
    },
    {
      version: "4.1.7",
      status: "Retired",
      releasedDaysAgo: 96,
      approvedBy: "Dr. Elena Marsh",
      validationStatus: "Passed",
      changelog: ["Quarterly retrain", "Dropped deprecated SpO2 device feature"],
      metrics: { auroc: 0.936, sensitivity: 91.8, specificity: 88.6 },
      performanceDelta: 0.3,
    },
  ],
  flags: { needsAttention: true, overdueValidation: false, activeIncident: true, awaitingApproval: false },
  tags: ["Deterioration", "ICU", "Real-time", "FHIR"],
};

// ===========================================================================
// HERO SYSTEM 2 — Radiology Chest X-Ray Model (stable, vendor, cleared)
// ===========================================================================

const chestXray: SystemSeed = {
  id: "chest-xray-triage",
  name: "Radiology Chest X-Ray Model",
  shortName: "Chest X-Ray AI",
  description:
    "Prioritizes chest radiographs by detecting critical findings including pneumothorax, pleural effusion, and consolidation, reordering the radiologist worklist.",
  purpose: "Reduce time-to-read for critical chest findings and flag likely-normal studies for later review.",
  category: "Medical Imaging",
  modelClass: "Deep CNN",
  owner: "Radiology Informatics",
  ownerContact: "Dr. Priya Nair",
  department: "Radiology",
  vendor: "Lumen Radiology AI",
  version: "7.8.0",
  environment: "Production",
  riskLevel: "High",
  regulatoryClass: "FDA Cleared (510k)",
  dataClassification: "PHI",
  status: "Operational",
  inputs: ["PACS — DICOM chest radiographs", "Modality worklist (HL7)"],
  outputs: ["Finding probabilities", "Worklist priority score", "Bounding-box overlays"],
  downstreamActions: ["Radiologist worklist reprioritization", "Critical-finding notification"],
  lineage: lineage([
    ["source", "PACS", "DICOM CR/DX studies"],
    ["transform", "Image normalization", "Windowing, resample to 1024²"],
    ["model", "Chest X-Ray Model 7.8", "Deep CNN ensemble"],
    ["output", "Finding probabilities", "14 pathologies"],
    ["action", "Worklist reprioritization", "PACS priority"],
    ["human", "Radiologist read", "Diagnostic sign-off"],
  ]),
  deployedDaysAgo: 540,
  lastValidatedDaysAgo: 34,
  validationCadenceDays: 180,
  validationCoverage: 98,
  validationStatus: "Passed",
  headline: { label: "AUROC", value: 96.2, threshold: 93, delta30d: 0.1 },
  bases: vitals({
    availability: 99.98,
    latencyMs: 640,
    latencyDelta: -2,
    latencyThreshold: 1500,
    errorRatePct: 0.04,
    errorDelta: -0.01,
    volumePerDay: 2160,
    volumeDelta: 2.1,
    confidencePct: 93.4,
    confidenceDelta: 0.2,
    overrideRatePct: 4.1,
    overrideDelta: -0.3,
    overrideThreshold: 8,
    timeToOverrideSec: 210,
    manualEditRatePct: 2,
    ignoredRatePct: 3,
  }),
  drift: { overall: 0.05, status: "good", populationFactor: 0.3 },
  fairness: { status: "good", headline: "Performance is consistent across age, sex, and device manufacturer subgroups.", groups: balancedFairness(95) },
  humanNote: "Radiologists accept 96% of worklist prioritizations. Overrides are rare and concentrate in portable ICU films, an expected hard subset.",
  roi: {
    annualImpact: 980_000,
    implementationCost: 720_000,
    operatingCost: 310_000,
    headlineMetricLabel: "Critical finding turnaround",
    headlineMetricValue: "-41 minutes",
    breakdown: [
      { label: "Faster critical-finding escalation", value: 520_000, unit: "$" },
      { label: "Radiologist reading efficiency", value: 460_000, unit: "$" },
      { label: "Reading time saved", value: 3100, unit: "hrs" },
    ],
  },
  versions: [
    { version: "7.8.0", status: "Current production", releasedDaysAgo: 62, approvedBy: "Dr. Priya Nair", validationStatus: "Passed", changelog: ["Vendor model refresh 7.8", "Added subsegmental pneumothorax head"], metrics: { auroc: 0.962, sensitivity: 94.1, specificity: 95.8 }, performanceDelta: 0.6 },
    { version: "7.6.2", status: "Retired", releasedDaysAgo: 210, approvedBy: "Dr. Priya Nair", validationStatus: "Passed", changelog: ["Vendor patch 7.6.2"], metrics: { auroc: 0.956, sensitivity: 93.4, specificity: 95.2 }, performanceDelta: 0.2 },
  ],
  flags: NO_FLAGS,
  tags: ["Radiology", "FDA 510k", "Worklist", "Vendor"],
};

// ===========================================================================
// HERO SYSTEM 3 — Clinical Documentation Copilot (LLM, rising overrides)
// ===========================================================================

const docCopilot: SystemSeed = {
  id: "clinical-doc-copilot",
  name: "Clinical Documentation Copilot",
  shortName: "Doc Copilot",
  description:
    "Ambient LLM assistant that drafts clinical notes from the patient encounter conversation, proposing history, assessment, and plan text for clinician review.",
  purpose: "Reduce documentation burden and after-hours charting by drafting encounter notes for physician edit and sign-off.",
  category: "Clinical Documentation",
  modelClass: "Fine-tuned LLM",
  owner: "Digital Health",
  ownerContact: "Dr. Marcus Bell",
  department: "Ambulatory Operations",
  vendor: "Veta Health AI",
  version: "2.4.0",
  environment: "Production",
  riskLevel: "Moderate",
  regulatoryClass: "Clinical Decision Support (Non-Device)",
  dataClassification: "PHI",
  status: "Warning",
  inputs: ["Ambient encounter audio (transcribed)", "Epic problem list & meds", "Prior encounter notes"],
  outputs: ["Draft note (HPI, A&P)", "Suggested diagnosis codes", "Follow-up orders draft"],
  downstreamActions: ["Note inserted into Epic for edit", "Suggested orders queued", "Coding suggestions to CDI"],
  lineage: lineage([
    ["source", "Ambient audio", "Encrypted, transcribed on-prem"],
    ["source", "Epic EHR", "Problem list, meds, history"],
    ["transform", "Context assembly", "Redaction + retrieval"],
    ["model", "Doc Copilot 2.4 (LLM)", "Fine-tuned + guardrails"],
    ["output", "Draft note & codes", "Structured note"],
    ["human", "Physician edit & sign", "Attestation required"],
  ]),
  deployedDaysAgo: 205,
  lastValidatedDaysAgo: 51,
  validationCadenceDays: 90,
  validationCoverage: 88,
  validationStatus: "Passed with warnings",
  headline: { label: "Accuracy", value: 87.9, threshold: 85, delta30d: -1.4 },
  bases: vitals({
    availability: 99.7,
    latencyMs: 2400,
    latencyDelta: 4,
    latencyThreshold: 4000,
    errorRatePct: 0.12,
    errorDelta: 0.02,
    volumePerDay: 5400,
    volumeDelta: 6.4,
    confidencePct: 79,
    confidenceDelta: -1.1,
    overrideRatePct: 22,
    overrideDelta: 8,
    overrideThreshold: 18,
    timeToOverrideSec: 40,
    manualEditRatePct: 34,
    ignoredRatePct: 5,
  }),
  drift: {
    overall: 0.12,
    status: "warning",
    populationFactor: 0.7,
    drivers: [
      { feature: "Encounter length", prev: 12.4, cur: 15.8, unit: "min", sd: 6, lo: 2, hi: 40, contribution: 0.38, spread: 1.2 },
      { feature: "Specialty mix (cardiology)", prev: 12, cur: 21, unit: "% of notes", sd: 8, lo: 0, hi: 40, contribution: 0.34, spread: 1.3 },
      { feature: "Ambient audio quality", prev: 0.86, cur: 0.79, unit: "SNR index", sd: 0.15, lo: 0.3, hi: 1, contribution: 0.21 },
    ],
  },
  fairness: { status: "warning", headline: "Draft acceptance is 9 points lower for encounters with interpreter-assisted audio; flagged for language-equity review.", groups: balancedFairness(84, 0.8) },
  humanNote:
    "22% of generated suggestions are overridden, up 8 points this month. The rise tracks a shift in specialty mix toward cardiology and longer encounters, which the current model handles less well. This could indicate model degradation or a change in workflow and warrants a targeted evaluation.",
  roi: {
    annualImpact: 1_800_000,
    implementationCost: 380_000,
    operatingCost: 420_000,
    headlineMetricLabel: "Documentation time saved",
    headlineMetricValue: "1.6 hrs / clinician / day",
    breakdown: [
      { label: "After-hours charting reduced", value: 1_100_000, unit: "$" },
      { label: "Increased visit throughput", value: 520_000, unit: "$" },
      { label: "Coding accuracy uplift", value: 180_000, unit: "$" },
      { label: "Clinician documentation hours saved", value: 41_000, unit: "hrs" },
    ],
  },
  perfEvent: { atDay: 22, label: "Cardiology rollout", kind: "config", detail: "Expanded to the cardiology service line, shifting the encounter distribution." },
  versions: [
    { version: "2.4.0", status: "Current production", releasedDaysAgo: 30, approvedBy: "Dr. Marcus Bell", validationStatus: "Passed with warnings", changelog: ["Cardiology & specialty templates", "Order-suggestion guardrails"], metrics: { auroc: 0.9, sensitivity: 88, specificity: 86 }, performanceDelta: 0.4 },
    { version: "2.3.1", status: "Staging", releasedDaysAgo: 12, approvedBy: undefined, validationStatus: "In progress", changelog: ["Improved interpreter-audio handling", "Longer-context summarization"], metrics: { auroc: 0.915, sensitivity: 90, specificity: 87 }, performanceDelta: 1.5, notes: "Candidate to address the override rise; validation in progress." },
    { version: "2.2.0", status: "Retired", releasedDaysAgo: 96, approvedBy: "Dr. Marcus Bell", validationStatus: "Passed", changelog: ["General availability"], metrics: { auroc: 0.896, sensitivity: 87, specificity: 86 }, performanceDelta: 0 },
  ],
  flags: { needsAttention: true, overdueValidation: false, activeIncident: false, awaitingApproval: true },
  tags: ["LLM", "Ambient", "Documentation", "Vendor"],
};

// ===========================================================================
// HERO SYSTEM 4 — Prior Authorization Agent (autonomous, agent monitoring)
// ===========================================================================

const priorAuthAgent: SystemSeed = {
  id: "prior-auth-agent",
  name: "Prior Authorization Agent",
  shortName: "Prior Auth Agent",
  description:
    "Autonomous agent that assembles prior-authorization requests: reads the chart, identifies missing documentation, drafts the request, and submits it to the payer after clinician approval.",
  purpose: "Cut prior-authorization turnaround time and administrative burden while keeping a human approval gate before submission.",
  category: "Autonomous Agent",
  modelClass: "Agentic LLM System",
  owner: "Revenue Cycle AI",
  ownerContact: "Dana Whitfield",
  department: "Revenue Cycle",
  vendor: "Internal",
  isAgent: true,
  version: "1.6.2",
  environment: "Production",
  riskLevel: "High",
  regulatoryClass: "Enterprise-Validated",
  dataClassification: "PHI",
  status: "Warning",
  inputs: ["Epic chart (notes, orders, results)", "Payer policy database", "Coverage & benefits API"],
  outputs: ["Missing-documentation findings", "Drafted authorization request", "Payer submission"],
  downstreamActions: ["Physician approval request", "Payer portal submission", "Auth status write-back to Epic"],
  lineage: lineage([
    ["source", "Epic EHR", "Chart, orders, results"],
    ["source", "Payer policy DB", "Medical necessity criteria"],
    ["model", "Prior Auth Agent 1.6.2", "Planner + tools"],
    ["transform", "Documentation assembly", "Evidence extraction"],
    ["human", "Physician approval", "Required before submission"],
    ["action", "Payer submission", "Portal API + write-back"],
  ]),
  deployedDaysAgo: 128,
  lastValidatedDaysAgo: 40,
  validationCadenceDays: 60,
  validationCoverage: 91,
  validationStatus: "Passed",
  headline: { label: "Accuracy", value: 94.1, threshold: 90, delta30d: -0.6 },
  bases: vitals({
    availability: 99.6,
    latencyMs: 8200,
    latencyDelta: 12,
    latencyThreshold: 15000,
    errorRatePct: 0.44,
    errorDelta: 0.12,
    volumePerDay: 640,
    volumeDelta: 38,
    confidencePct: 90.2,
    confidenceDelta: -0.8,
    overrideRatePct: 11,
    overrideDelta: 1.5,
    overrideThreshold: 15,
    timeToOverrideSec: 130,
    manualEditRatePct: 14,
    ignoredRatePct: 3,
  }),
  drift: { overall: 0.09, status: "good", populationFactor: 0.5 },
  humanNote:
    "Physicians approve 89% of drafted authorizations without edits. A rise in agent action volume this week triggered a behavior-anomaly review; see Agent Monitoring for the session-level timeline.",
  roi: {
    annualImpact: 2_400_000,
    implementationCost: 540_000,
    operatingCost: 300_000,
    headlineMetricLabel: "Authorization turnaround",
    headlineMetricValue: "3.1 days to 6 hours",
    breakdown: [
      { label: "Administrative FTE hours avoided", value: 1_500_000, unit: "$" },
      { label: "Reduced peer-to-peer denials", value: 620_000, unit: "$" },
      { label: "Faster time-to-treatment", value: 280_000, unit: "$" },
      { label: "Coordinator hours saved", value: 22_000, unit: "hrs" },
    ],
  },
  versions: [
    { version: "1.6.2", status: "Current production", releasedDaysAgo: 20, approvedBy: "Dana Whitfield", validationStatus: "Passed", changelog: ["Expanded payer policy coverage", "Tighter submission guardrails"], metrics: { auroc: 0.951, sensitivity: 94, specificity: 93 }, performanceDelta: 0.5 },
    { version: "1.5.0", status: "Retired", releasedDaysAgo: 70, approvedBy: "Dana Whitfield", validationStatus: "Passed", changelog: ["Added benefits API tool"], metrics: { auroc: 0.946, sensitivity: 93, specificity: 92 }, performanceDelta: 0.7 },
  ],
  flags: { needsAttention: true, overdueValidation: false, activeIncident: false, awaitingApproval: false },
  tags: ["Agent", "Autonomous", "Revenue Cycle", "Tool-use"],
};

// ===========================================================================
// BROADER ESTATE — generated from compact configs
// ===========================================================================

interface QuickCfg {
  id: string;
  name: string;
  shortName: string;
  description: string;
  purpose: string;
  category: AICategory;
  modelClass: ModelClass;
  owner: string;
  ownerContact: string;
  department: string;
  vendor: string;
  version: string;
  environment: Environment;
  riskLevel: RiskLevel;
  regulatoryClass: RegulatoryClass;
  dataClassification: DataClassification;
  status: SystemStatus;
  headlineLabel: string;
  headlineValue: number;
  headlineThreshold: number;
  delta30d: number;
  vit: Partial<Vitals>;
  driftOverall: number;
  driftStatus: MetricStatus;
  roi: SystemSeed["roi"];
  lastValidatedDaysAgo: number;
  cadence: number;
  validationStatus: ValidationResult;
  isAgent?: boolean;
  flags?: Partial<SystemSeed["flags"]>;
  tags: string[];
  inputs: string[];
  outputs: string[];
  downstream: string[];
  fairnessBase?: number;
}

function quick(c: QuickCfg): SystemSeed {
  const cat = c.category;
  const lin: [LineageNode["kind"], string, string?][] = c.isAgent
    ? [
        ["source", "Source systems", c.inputs[0]],
        ["model", `${c.shortName} ${c.version}`, c.modelClass],
        ["transform", "Reasoning & tools", "Planner + tool calls"],
        ["human", "Human approval", "Gate before action"],
        ["action", c.downstream[0], "Downstream effect"],
      ]
    : [
        ["source", c.inputs[0] ?? "Source", "Primary input"],
        ["transform", "Feature pipeline", "Preprocessing"],
        ["model", `${c.shortName} ${c.version}`, c.modelClass],
        ["output", c.outputs[0] ?? "Output", "Model output"],
        ["human", "Clinician review", "Human in the loop"],
      ];
  return {
    id: c.id,
    name: c.name,
    shortName: c.shortName,
    description: c.description,
    purpose: c.purpose,
    category: cat,
    modelClass: c.modelClass,
    owner: c.owner,
    ownerContact: c.ownerContact,
    department: c.department,
    vendor: c.vendor,
    isAgent: c.isAgent,
    version: c.version,
    environment: c.environment,
    riskLevel: c.riskLevel,
    regulatoryClass: c.regulatoryClass,
    dataClassification: c.dataClassification,
    status: c.status,
    inputs: c.inputs,
    outputs: c.outputs,
    downstreamActions: c.downstream,
    lineage: lineage(lin),
    deployedDaysAgo: 180 + (hash(c.id) % 400),
    lastValidatedDaysAgo: c.lastValidatedDaysAgo,
    validationCadenceDays: c.cadence,
    validationCoverage: 90 + (hash(c.id) % 9),
    validationStatus: c.validationStatus,
    headline: {
      label: c.headlineLabel,
      value: c.headlineValue,
      threshold: c.headlineThreshold,
      delta30d: c.delta30d,
    },
    bases: vitals(c.vit),
    drift: { overall: c.driftOverall, status: c.driftStatus, populationFactor: 0.5 },
    fairness: c.fairnessBase
      ? {
          status: "good",
          headline: "No material performance disparities detected across monitored subgroups.",
          groups: balancedFairness(c.fairnessBase),
        }
      : undefined,
    roi: c.roi,
    versions: [
      {
        version: c.version,
        status: "Current production",
        releasedDaysAgo: 40 + (hash(c.id) % 120),
        approvedBy: c.ownerContact,
        validationStatus: c.validationStatus,
        changelog: ["Scheduled retrain", "Threshold recalibration"],
        metrics: {
          auroc: round(c.headlineValue / 100 + 0.01, 3),
          sensitivity: round(c.headlineValue - 2, 1),
          specificity: round(c.headlineValue - 1, 1),
        },
        performanceDelta: round(c.delta30d / 2, 1),
      },
      {
        version: bumpDown(c.version),
        status: "Retired",
        releasedDaysAgo: 200 + (hash(c.id) % 160),
        approvedBy: c.ownerContact,
        validationStatus: "Passed",
        changelog: ["Prior production release"],
        metrics: {
          auroc: round(c.headlineValue / 100 - 0.01, 3),
          sensitivity: round(c.headlineValue - 3, 1),
          specificity: round(c.headlineValue - 2, 1),
        },
        performanceDelta: 0.2,
      },
    ],
    flags: { ...NO_FLAGS, ...(c.flags ?? {}) },
    tags: c.tags,
  };
}

function hash(s: string): number {
  let h = 5381;
  for (let i = 0; i < s.length; i++) h = (h * 33) ^ s.charCodeAt(i);
  return h >>> 0;
}
function bumpDown(v: string): string {
  const parts = v.split(".").map(Number);
  if (parts[1] > 0) parts[1] -= 1;
  else parts[0] = Math.max(0, parts[0] - 1);
  return parts.join(".");
}

const roiQ = (
  annualImpact: number,
  implementationCost: number,
  operatingCost: number,
  headlineMetricLabel: string,
  headlineMetricValue: string,
  breakdown: SystemSeed["roi"]["breakdown"],
): SystemSeed["roi"] => ({
  annualImpact,
  implementationCost,
  operatingCost,
  headlineMetricLabel,
  headlineMetricValue,
  breakdown,
});

const rest: SystemSeed[] = [
  quick({
    id: "readmission-risk",
    name: "30-Day Readmission Risk Model",
    shortName: "Readmission Risk",
    description: "Predicts 30-day all-cause readmission at discharge to target care-management resources.",
    purpose: "Reduce avoidable readmissions by prioritizing transitional-care outreach.",
    category: "Clinical Prediction", modelClass: "Gradient-Boosted Trees",
    owner: "Population Health", ownerContact: "Sofia Ramirez", department: "Care Management",
    vendor: "Internal", version: "3.1.0", environment: "Production", riskLevel: "High",
    regulatoryClass: "Clinical Decision Support (Non-Device)", dataClassification: "PHI", status: "Operational",
    headlineLabel: "AUROC", headlineValue: 82.4, headlineThreshold: 78, delta30d: 0.3,
    vit: { availability: 99.95, latencyMs: 90, volumePerDay: 890, overrideRatePct: 14, overrideDelta: 0.6, overrideThreshold: 20, confidencePct: 80 },
    driftOverall: 0.07, driftStatus: "good",
    roi: roiQ(1_600_000, 300_000, 180_000, "Readmission rate reduction", "-2.4 points", [
      { label: "Avoided readmission penalties", value: 900_000, unit: "$" },
      { label: "Care-management efficiency", value: 700_000, unit: "$" },
    ]),
    lastValidatedDaysAgo: 40, cadence: 90, validationStatus: "Passed", fairnessBase: 81,
    tags: ["Population Health", "Discharge"], inputs: ["Epic EHR — encounters, labs", "Claims history", "SDOH indices"],
    outputs: ["Readmission probability", "Top risk drivers"], downstream: ["Care-management worklist", "Transitional-care referral"],
  }),
  quick({
    id: "deterioration-index",
    name: "Inpatient Deterioration Index",
    shortName: "Deterioration Index",
    description: "Early-warning score for general-ward clinical deterioration, updated every 15 minutes.",
    purpose: "Trigger rapid-response evaluation before clinical deterioration becomes critical.",
    category: "Clinical Prediction", modelClass: "Recurrent Neural Net",
    owner: "Clinical AI Team", ownerContact: "Dr. Elena Marsh", department: "Hospital Medicine",
    vendor: "Internal", version: "5.0.3", environment: "Production", riskLevel: "High",
    regulatoryClass: "Clinical Decision Support (Non-Device)", dataClassification: "PHI", status: "Operational",
    headlineLabel: "AUROC", headlineValue: 88.1, headlineThreshold: 85, delta30d: -0.4,
    vit: { availability: 99.9, latencyMs: 160, volumePerDay: 6100, overrideRatePct: 12, overrideThreshold: 16, confidencePct: 85 },
    driftOverall: 0.08, driftStatus: "good",
    roi: roiQ(1_350_000, 420_000, 210_000, "Rapid-response lead time", "+2.7 hours", [
      { label: "Reduced ICU transfers", value: 820_000, unit: "$" },
      { label: "Avoided code events", value: 530_000, unit: "$" },
    ]),
    lastValidatedDaysAgo: 60, cadence: 90, validationStatus: "Passed", fairnessBase: 87,
    tags: ["Early Warning", "Real-time"], inputs: ["Vitals stream", "Labs", "Nursing assessments"],
    outputs: ["Deterioration score", "Trend"], downstream: ["Rapid response notification", "Charge-nurse dashboard"],
  }),
  quick({
    id: "aki-predictor",
    name: "Acute Kidney Injury Predictor",
    shortName: "AKI Predictor",
    description: "Flags patients at risk of AKI within 48 hours from labs, medications, and hemodynamics.",
    purpose: "Enable nephroprotective intervention and medication review before kidney injury.",
    category: "Clinical Prediction", modelClass: "Gradient-Boosted Trees",
    owner: "Clinical AI Team", ownerContact: "Dr. Owen Fletcher", department: "Nephrology",
    vendor: "Internal", version: "2.2.1", environment: "Production", riskLevel: "Moderate",
    regulatoryClass: "Clinical Decision Support (Non-Device)", dataClassification: "PHI", status: "Operational",
    headlineLabel: "AUROC", headlineValue: 84.7, headlineThreshold: 80, delta30d: 0.2,
    vit: { availability: 99.9, latencyMs: 120, volumePerDay: 2400, overrideRatePct: 10, overrideThreshold: 15, confidencePct: 83 },
    driftOverall: 0.06, driftStatus: "good",
    roi: roiQ(720_000, 240_000, 140_000, "AKI incidence reduction", "-1.1 points", [
      { label: "Avoided dialysis events", value: 460_000, unit: "$" },
      { label: "Shorter length of stay", value: 260_000, unit: "$" },
    ]),
    lastValidatedDaysAgo: 30, cadence: 90, validationStatus: "Passed", fairnessBase: 83,
    tags: ["Nephrology", "Labs"], inputs: ["Labs (creatinine, BUN)", "Medication list", "Hemodynamics"],
    outputs: ["AKI risk (48h)", "Nephrotoxic med flags"], downstream: ["Pharmacy alert", "Nephrology consult suggestion"],
  }),
  quick({
    id: "fall-risk",
    name: "Fall Risk Assessment Model",
    shortName: "Fall Risk",
    description: "Scores inpatient fall risk from mobility, medications, and history to guide precautions.",
    purpose: "Target fall-prevention resources to the highest-risk patients.",
    category: "Clinical Prediction", modelClass: "Logistic Regression",
    owner: "Nursing Informatics", ownerContact: "Karen Liu", department: "Nursing",
    vendor: "Internal", version: "1.4.0", environment: "Production", riskLevel: "Low",
    regulatoryClass: "Clinical Decision Support (Non-Device)", dataClassification: "PHI", status: "Operational",
    headlineLabel: "AUROC", headlineValue: 79.2, headlineThreshold: 74, delta30d: 0.1,
    vit: { availability: 99.99, latencyMs: 40, volumePerDay: 3900, overrideRatePct: 8, overrideThreshold: 14, confidencePct: 82 },
    driftOverall: 0.04, driftStatus: "good",
    roi: roiQ(340_000, 90_000, 60_000, "Fall rate reduction", "-0.8 per 1k days", [
      { label: "Avoided fall-related injury cost", value: 340_000, unit: "$" },
    ]),
    lastValidatedDaysAgo: 55, cadence: 180, validationStatus: "Passed", fairnessBase: 78,
    tags: ["Nursing", "Safety"], inputs: ["Mobility assessment", "Medication list", "Fall history"],
    outputs: ["Fall risk tier"], downstream: ["Fall precaution order set", "Care-plan update"],
  }),
  quick({
    id: "icu-mortality",
    name: "ICU Mortality Predictor",
    shortName: "ICU Mortality",
    description: "Estimates ICU mortality risk to support goals-of-care conversations and resource planning.",
    purpose: "Inform prognostication and family conversations with a calibrated risk estimate.",
    category: "Clinical Prediction", modelClass: "Ensemble",
    owner: "Clinical AI Team", ownerContact: "Dr. Owen Fletcher", department: "Critical Care",
    vendor: "Internal", version: "0.9.4", environment: "Staging", riskLevel: "High",
    regulatoryClass: "Clinical Decision Support (Non-Device)", dataClassification: "PHI", status: "Operational",
    headlineLabel: "AUROC", headlineValue: 90.3, headlineThreshold: 87, delta30d: 0.5,
    vit: { availability: 99.8, latencyMs: 210, volumePerDay: 410, overrideRatePct: 9, overrideThreshold: 15, confidencePct: 88 },
    driftOverall: 0.05, driftStatus: "good",
    roi: roiQ(0, 260_000, 90_000, "Prognostic calibration", "In validation", [
      { label: "Projected LOS optimization", value: 0, unit: "$" },
    ]),
    lastValidatedDaysAgo: 8, cadence: 60, validationStatus: "In progress", fairnessBase: 89,
    flags: { awaitingApproval: true },
    tags: ["Critical Care", "Staging"], inputs: ["APACHE features", "Labs", "Vitals"],
    outputs: ["Mortality risk", "Confidence interval"], downstream: ["Goals-of-care flag (staging only)"],
  }),
  quick({
    id: "pediatric-ews",
    name: "Pediatric Early Warning Score",
    shortName: "Pediatric EWS",
    description: "Deterioration early warning tailored to pediatric physiology and age-banded vitals.",
    purpose: "Detect pediatric deterioration accounting for age-specific vital ranges.",
    category: "Clinical Prediction", modelClass: "Gradient-Boosted Trees",
    owner: "Clinical AI Team", ownerContact: "Dr. Naomi Chen", department: "Pediatrics",
    vendor: "Internal", version: "2.0.1", environment: "Production", riskLevel: "Moderate",
    regulatoryClass: "Clinical Decision Support (Non-Device)", dataClassification: "PHI", status: "Operational",
    headlineLabel: "AUROC", headlineValue: 86.5, headlineThreshold: 83, delta30d: -0.2,
    vit: { availability: 99.9, latencyMs: 140, volumePerDay: 1200, overrideRatePct: 11, overrideThreshold: 16, confidencePct: 84 },
    driftOverall: 0.06, driftStatus: "good",
    roi: roiQ(560_000, 210_000, 120_000, "Pediatric rapid-response lead time", "+2.1 hours", [
      { label: "Reduced PICU transfers", value: 560_000, unit: "$" },
    ]),
    lastValidatedDaysAgo: 44, cadence: 90, validationStatus: "Passed", fairnessBase: 85,
    tags: ["Pediatrics", "Early Warning"], inputs: ["Age-banded vitals", "Nursing assessments"],
    outputs: ["Pediatric EWS", "Trend"], downstream: ["Pediatric rapid response", "Charge-nurse view"],
  }),
  quick({
    id: "ich-detector",
    name: "Intracranial Hemorrhage Detector",
    shortName: "ICH Detector",
    description: "Detects acute intracranial hemorrhage on non-contrast head CT and escalates positive studies.",
    purpose: "Accelerate stroke-pathway activation by flagging hemorrhage within seconds of scan completion.",
    category: "Medical Imaging", modelClass: "Vision Transformer",
    owner: "Radiology Informatics", ownerContact: "Dr. Priya Nair", department: "Radiology",
    vendor: "Lumen Radiology AI", version: "4.3.0", environment: "Production", riskLevel: "Critical",
    regulatoryClass: "FDA Cleared (510k)", dataClassification: "PHI", status: "Degraded",
    headlineLabel: "AUROC", headlineValue: 95.8, headlineThreshold: 94, delta30d: -0.9,
    vit: { availability: 98.4, latencyMs: 1350, latencyDelta: 34, latencyThreshold: 1200, errorRatePct: 0.9, errorDelta: 0.5, volumePerDay: 720, overrideRatePct: 5, overrideThreshold: 8, confidencePct: 92, confidenceDelta: -0.6 },
    driftOverall: 0.07, driftStatus: "good",
    roi: roiQ(1_100_000, 680_000, 290_000, "Hemorrhage notification time", "-6.2 minutes", [
      { label: "Faster stroke-pathway activation", value: 700_000, unit: "$" },
      { label: "Reduced door-to-needle time", value: 400_000, unit: "$" },
    ]),
    lastValidatedDaysAgo: 20, cadence: 180, validationStatus: "Passed", fairnessBase: 94,
    flags: { needsAttention: true, activeIncident: true },
    tags: ["Stroke", "FDA 510k", "Critical"], inputs: ["PACS — head CT (DICOM)"],
    outputs: ["Hemorrhage probability", "Slice localization"], downstream: ["Stroke team escalation", "Worklist priority"],
  }),
  quick({
    id: "mammography-ai",
    name: "Mammography Density & Lesion Model",
    shortName: "Mammography AI",
    description: "Assesses breast density and flags suspicious lesions on screening mammography.",
    purpose: "Support radiologists with density scoring and lesion detection on screening mammograms.",
    category: "Medical Imaging", modelClass: "Deep CNN",
    owner: "Radiology Informatics", ownerContact: "Dr. Priya Nair", department: "Breast Imaging",
    vendor: "Lumen Radiology AI", version: "6.1.0", environment: "Production", riskLevel: "High",
    regulatoryClass: "FDA Cleared (510k)", dataClassification: "PHI", status: "Operational",
    headlineLabel: "AUROC", headlineValue: 93.6, headlineThreshold: 90, delta30d: 0.2,
    vit: { availability: 99.95, latencyMs: 820, latencyThreshold: 1500, volumePerDay: 540, overrideRatePct: 6, overrideThreshold: 10, confidencePct: 91 },
    driftOverall: 0.05, driftStatus: "good",
    roi: roiQ(690_000, 520_000, 240_000, "Cancer detection uplift", "+11%", [
      { label: "Earlier-stage detection value", value: 690_000, unit: "$" },
    ]),
    lastValidatedDaysAgo: 70, cadence: 180, validationStatus: "Passed", fairnessBase: 92,
    tags: ["Breast Imaging", "Screening", "FDA 510k"], inputs: ["PACS — mammography (DICOM)"],
    outputs: ["Density category", "Lesion probability"], downstream: ["Radiologist worklist", "Density reporting"],
  }),
  quick({
    id: "pe-ct-detector",
    name: "Pulmonary Embolism CT Detector",
    shortName: "PE Detector",
    description: "Detects pulmonary embolism on CT pulmonary angiography and prioritizes positive studies.",
    purpose: "Reduce time to PE diagnosis and anticoagulation initiation.",
    category: "Medical Imaging", modelClass: "Deep CNN",
    owner: "Radiology Informatics", ownerContact: "Dr. Priya Nair", department: "Radiology",
    vendor: "Lumen Radiology AI", version: "5.2.1", environment: "Production", riskLevel: "High",
    regulatoryClass: "FDA Cleared (510k)", dataClassification: "PHI", status: "Operational",
    headlineLabel: "AUROC", headlineValue: 94.4, headlineThreshold: 91, delta30d: 0.0,
    vit: { availability: 99.9, latencyMs: 1100, latencyThreshold: 1800, volumePerDay: 320, overrideRatePct: 5, overrideThreshold: 9, confidencePct: 92 },
    driftOverall: 0.04, driftStatus: "good",
    roi: roiQ(610_000, 480_000, 210_000, "Time to anticoagulation", "-33 minutes", [
      { label: "Faster PE treatment", value: 610_000, unit: "$" },
    ]),
    lastValidatedDaysAgo: 88, cadence: 180, validationStatus: "Passed", fairnessBase: 93,
    tags: ["Radiology", "FDA 510k"], inputs: ["PACS — CTPA (DICOM)"],
    outputs: ["PE probability", "Clot localization"], downstream: ["Radiologist worklist", "Critical result notification"],
  }),
  quick({
    id: "diabetic-retinopathy",
    name: "Diabetic Retinopathy Screener",
    shortName: "DR Screener",
    description: "Autonomous screening for diabetic retinopathy from fundus photographs in primary care.",
    purpose: "Expand retinopathy screening access with point-of-care fundus grading.",
    category: "Medical Imaging", modelClass: "Deep CNN",
    owner: "Digital Health", ownerContact: "Dr. Marcus Bell", department: "Ophthalmology",
    vendor: "Retina Health Systems", version: "3.0.0", environment: "Production", riskLevel: "Moderate",
    regulatoryClass: "FDA Cleared (De Novo)", dataClassification: "PHI", status: "Operational",
    headlineLabel: "Sensitivity", headlineValue: 91.8, headlineThreshold: 87, delta30d: 0.1,
    vit: { availability: 99.9, latencyMs: 480, latencyThreshold: 1200, volumePerDay: 210, overrideRatePct: 7, overrideThreshold: 12, confidencePct: 90 },
    driftOverall: 0.05, driftStatus: "good",
    roi: roiQ(430_000, 260_000, 150_000, "Screening completion rate", "+28%", [
      { label: "Expanded screening access", value: 430_000, unit: "$" },
    ]),
    lastValidatedDaysAgo: 62, cadence: 180, validationStatus: "Passed", fairnessBase: 90,
    tags: ["Ophthalmology", "Autonomous", "FDA De Novo"], inputs: ["Fundus camera images"],
    outputs: ["Retinopathy grade", "Referral recommendation"], downstream: ["Ophthalmology referral", "Result to patient chart"],
  }),
  quick({
    id: "stroke-lvo",
    name: "Stroke Large-Vessel-Occlusion Detector",
    shortName: "LVO Detector",
    description: "Detects large-vessel occlusion on CT angiography to activate thrombectomy pathways.",
    purpose: "Speed LVO identification and transfer for endovascular treatment.",
    category: "Medical Imaging", modelClass: "Vision Transformer",
    owner: "Radiology Informatics", ownerContact: "Dr. Priya Nair", department: "Neuroradiology",
    vendor: "Lumen Radiology AI", version: "2.4.0", environment: "Staging", riskLevel: "High",
    regulatoryClass: "FDA Cleared (510k)", dataClassification: "PHI", status: "Operational",
    headlineLabel: "AUROC", headlineValue: 94.9, headlineThreshold: 92, delta30d: 0.3,
    vit: { availability: 99.7, latencyMs: 900, latencyThreshold: 1500, volumePerDay: 140, overrideRatePct: 6, overrideThreshold: 10, confidencePct: 93 },
    driftOverall: 0.05, driftStatus: "good",
    roi: roiQ(0, 410_000, 160_000, "Door-to-groin time", "In validation", [
      { label: "Projected transfer acceleration", value: 0, unit: "$" },
    ]),
    lastValidatedDaysAgo: 120, cadence: 90, validationStatus: "Overdue", fairnessBase: 93,
    flags: { overdueValidation: true, needsAttention: true },
    tags: ["Stroke", "Staging", "FDA 510k"], inputs: ["PACS — CTA (DICOM)"],
    outputs: ["LVO probability", "Vessel localization"], downstream: ["Thrombectomy team alert (staging)"],
  }),
  quick({
    id: "bone-age",
    name: "Pediatric Bone Age Estimator",
    shortName: "Bone Age AI",
    description: "Estimates skeletal maturity from hand radiographs to support growth assessment.",
    purpose: "Standardize and speed bone-age reads for endocrinology.",
    category: "Medical Imaging", modelClass: "Deep CNN",
    owner: "Radiology Informatics", ownerContact: "Dr. Priya Nair", department: "Pediatric Radiology",
    vendor: "Lumen Radiology AI", version: "3.5.0", environment: "Production", riskLevel: "Low",
    regulatoryClass: "FDA Cleared (510k)", dataClassification: "PHI", status: "Operational",
    headlineLabel: "Accuracy", headlineValue: 96.1, headlineThreshold: 92, delta30d: 0.0,
    vit: { availability: 99.98, latencyMs: 300, latencyThreshold: 1000, volumePerDay: 60, overrideRatePct: 4, overrideThreshold: 10, confidencePct: 94 },
    driftOverall: 0.03, driftStatus: "good",
    roi: roiQ(120_000, 140_000, 60_000, "Read turnaround", "-18 minutes", [
      { label: "Radiologist time saved", value: 120_000, unit: "$" },
    ]),
    lastValidatedDaysAgo: 100, cadence: 365, validationStatus: "Passed", fairnessBase: 95,
    tags: ["Pediatrics", "FDA 510k"], inputs: ["PACS — hand radiograph"],
    outputs: ["Estimated bone age"], downstream: ["Radiology report insert"],
  }),
  quick({
    id: "discharge-summary",
    name: "Discharge Summary Generator",
    shortName: "Discharge Summary",
    description: "Drafts discharge summaries from the hospital course for physician review and sign-off.",
    purpose: "Reduce discharge documentation time and speed bed turnover.",
    category: "Clinical Documentation", modelClass: "Fine-tuned LLM",
    owner: "Digital Health", ownerContact: "Dr. Marcus Bell", department: "Hospital Medicine",
    vendor: "Veta Health AI", version: "1.2.0", environment: "Staging", riskLevel: "Moderate",
    regulatoryClass: "Clinical Decision Support (Non-Device)", dataClassification: "PHI", status: "Operational",
    headlineLabel: "Accuracy", headlineValue: 85.2, headlineThreshold: 82, delta30d: 0.6,
    vit: { availability: 99.6, latencyMs: 3200, latencyThreshold: 5000, volumePerDay: 380, overrideRatePct: 24, overrideThreshold: 25, confidencePct: 78 },
    driftOverall: 0.08, driftStatus: "good",
    roi: roiQ(0, 210_000, 180_000, "Discharge documentation time", "In validation", [
      { label: "Projected charting reduction", value: 0, unit: "$" },
    ]),
    lastValidatedDaysAgo: 14, cadence: 90, validationStatus: "In progress",
    flags: { awaitingApproval: true },
    tags: ["LLM", "Documentation", "Staging"], inputs: ["Hospital course notes", "Meds & problems"],
    outputs: ["Draft discharge summary"], downstream: ["Physician edit & sign (staging)"],
  }),
  quick({
    id: "rad-report-summarizer",
    name: "Radiology Report Summarizer",
    shortName: "Rad Summarizer",
    description: "Summarizes prior radiology reports into a longitudinal impression for the reading radiologist.",
    purpose: "Give radiologists a fast longitudinal view of prior imaging findings.",
    category: "Clinical Documentation", modelClass: "Transformer (NLP)",
    owner: "Radiology Informatics", ownerContact: "Dr. Priya Nair", department: "Radiology",
    vendor: "Internal", version: "1.1.3", environment: "Production", riskLevel: "Moderate",
    regulatoryClass: "Clinical Decision Support (Non-Device)", dataClassification: "PHI", status: "Operational",
    headlineLabel: "Accuracy", headlineValue: 89.4, headlineThreshold: 85, delta30d: 0.2,
    vit: { availability: 99.9, latencyMs: 900, latencyThreshold: 2000, volumePerDay: 1600, overrideRatePct: 12, overrideThreshold: 18, confidencePct: 86 },
    driftOverall: 0.05, driftStatus: "good",
    roi: roiQ(340_000, 160_000, 110_000, "Prior-review time saved", "-6 minutes / read", [
      { label: "Radiologist efficiency", value: 340_000, unit: "$" },
    ]),
    lastValidatedDaysAgo: 48, cadence: 120, validationStatus: "Passed",
    tags: ["NLP", "Radiology"], inputs: ["Prior radiology reports"],
    outputs: ["Longitudinal impression"], downstream: ["Reading worklist context panel"],
  }),
  quick({
    id: "nursing-handoff",
    name: "Nursing Handoff Summarizer",
    shortName: "Handoff Summarizer",
    description: "Generates structured shift-handoff summaries from the nursing record.",
    purpose: "Standardize nurse-to-nurse handoff and reduce omissions.",
    category: "Clinical Documentation", modelClass: "Fine-tuned LLM",
    owner: "Nursing Informatics", ownerContact: "Karen Liu", department: "Nursing",
    vendor: "Internal", version: "0.6.0", environment: "Development", riskLevel: "Low",
    regulatoryClass: "Research Use Only", dataClassification: "PHI", status: "Operational",
    headlineLabel: "Accuracy", headlineValue: 82.0, headlineThreshold: 80, delta30d: 1.0,
    vit: { availability: 99.4, latencyMs: 2600, latencyThreshold: 6000, volumePerDay: 90, overrideRatePct: 28, overrideThreshold: 35, confidencePct: 74 },
    driftOverall: 0.09, driftStatus: "good",
    roi: roiQ(0, 80_000, 60_000, "Handoff completeness", "Pilot", [
      { label: "Projected omission reduction", value: 0, unit: "$" },
    ]),
    lastValidatedDaysAgo: 6, cadence: 90, validationStatus: "In progress",
    tags: ["LLM", "Nursing", "Development"], inputs: ["Nursing flowsheet", "Care plan"],
    outputs: ["Handoff summary (SBAR)"], downstream: ["Shift-change handoff view (pilot)"],
  }),
  quick({
    id: "antibiotic-stewardship",
    name: "Antimicrobial Stewardship Advisor",
    shortName: "Stewardship Advisor",
    description: "Recommends antibiotic optimization based on cultures, renal function, and local resistance.",
    purpose: "Improve antibiotic appropriateness and reduce resistance pressure.",
    category: "Decision Support", modelClass: "Gradient-Boosted Trees",
    owner: "Pharmacy Informatics", ownerContact: "Dr. Aisha Karim", department: "Pharmacy",
    vendor: "Internal", version: "2.3.0", environment: "Production", riskLevel: "Moderate",
    regulatoryClass: "Clinical Decision Support (Non-Device)", dataClassification: "PHI", status: "Operational",
    headlineLabel: "Accuracy", headlineValue: 88.7, headlineThreshold: 84, delta30d: 0.3,
    vit: { availability: 99.9, latencyMs: 150, volumePerDay: 720, overrideRatePct: 19, overrideThreshold: 24, confidencePct: 84 },
    driftOverall: 0.06, driftStatus: "good",
    roi: roiQ(820_000, 220_000, 140_000, "Antibiotic days optimized", "-14%", [
      { label: "Reduced broad-spectrum use", value: 520_000, unit: "$" },
      { label: "Shorter length of stay", value: 300_000, unit: "$" },
    ]),
    lastValidatedDaysAgo: 36, cadence: 120, validationStatus: "Passed", fairnessBase: 87,
    tags: ["Pharmacy", "Stewardship"], inputs: ["Culture results", "Renal function", "Antibiogram"],
    outputs: ["Optimization recommendation"], downstream: ["Pharmacist review queue", "Provider suggestion"],
  }),
  quick({
    id: "med-interaction",
    name: "Medication Interaction Detector",
    shortName: "Med Interaction",
    description: "Detects high-risk drug-drug and drug-condition interactions beyond static rule sets.",
    purpose: "Reduce adverse drug events from complex interaction patterns.",
    category: "Medication Safety", modelClass: "Ensemble",
    owner: "Pharmacy Informatics", ownerContact: "Dr. Aisha Karim", department: "Pharmacy",
    vendor: "Internal", version: "3.4.2", environment: "Production", riskLevel: "High",
    regulatoryClass: "Clinical Decision Support (Non-Device)", dataClassification: "PHI", status: "Warning",
    headlineLabel: "Sensitivity", headlineValue: 92.6, headlineThreshold: 90, delta30d: -1.1,
    vit: { availability: 99.9, latencyMs: 70, volumePerDay: 14200, overrideRatePct: 31, overrideDelta: 3.2, overrideThreshold: 30, confidencePct: 85, confidenceDelta: -0.4 },
    driftOverall: 0.11, driftStatus: "warning",
    roi: roiQ(1_050_000, 300_000, 180_000, "Adverse drug events avoided", "-19%", [
      { label: "Avoided ADE cost", value: 780_000, unit: "$" },
      { label: "Reduced alert fatigue rework", value: 270_000, unit: "$" },
    ]),
    lastValidatedDaysAgo: 58, cadence: 90, validationStatus: "Passed with warnings", fairnessBase: 91,
    flags: { needsAttention: true },
    tags: ["Pharmacy", "Safety", "High-volume"], inputs: ["Active medication list", "Problem list", "Labs"],
    outputs: ["Interaction severity", "Rationale"], downstream: ["Order-entry alert", "Pharmacist review"],
  }),
  quick({
    id: "opioid-risk",
    name: "Opioid Risk Screener",
    shortName: "Opioid Risk",
    description: "Estimates opioid misuse and overdose risk from prescription history and clinical factors.",
    purpose: "Support safe opioid prescribing and targeted harm-reduction outreach.",
    category: "Medication Safety", modelClass: "Gradient-Boosted Trees",
    owner: "Pharmacy Informatics", ownerContact: "Dr. Aisha Karim", department: "Pain Management",
    vendor: "Internal", version: "1.9.0", environment: "Production", riskLevel: "Moderate",
    regulatoryClass: "Clinical Decision Support (Non-Device)", dataClassification: "PHI", status: "Operational",
    headlineLabel: "AUROC", headlineValue: 83.9, headlineThreshold: 80, delta30d: -0.3,
    vit: { availability: 99.9, latencyMs: 110, volumePerDay: 480, overrideRatePct: 16, overrideThreshold: 22, confidencePct: 81 },
    driftOverall: 0.07, driftStatus: "good",
    roi: roiQ(390_000, 180_000, 110_000, "High-risk prescriptions flagged", "+22%", [
      { label: "Avoided overdose events", value: 390_000, unit: "$" },
    ]),
    lastValidatedDaysAgo: 132, cadence: 120, validationStatus: "Overdue", fairnessBase: 82,
    flags: { overdueValidation: true, needsAttention: true },
    tags: ["Pharmacy", "Safety"], inputs: ["PDMP history", "Diagnoses", "Prescription patterns"],
    outputs: ["Opioid risk tier"], downstream: ["Prescriber advisory", "Care-management referral"],
  }),
  quick({
    id: "rev-cycle-coding",
    name: "Revenue Cycle Coding Model",
    shortName: "Coding Model",
    description: "Suggests and autonomously assigns inpatient and professional codes from the clinical record.",
    purpose: "Improve coding accuracy and throughput while reducing denials.",
    category: "Revenue Cycle", modelClass: "Transformer (NLP)",
    owner: "Revenue Cycle AI", ownerContact: "Dana Whitfield", department: "Health Information Management",
    vendor: "Internal", version: "4.0.1", environment: "Production", riskLevel: "High",
    regulatoryClass: "Enterprise-Validated", dataClassification: "PHI", status: "Operational",
    headlineLabel: "Accuracy", headlineValue: 93.2, headlineThreshold: 90, delta30d: 0.4,
    vit: { availability: 99.95, latencyMs: 260, volumePerDay: 8600, overrideRatePct: 13, overrideThreshold: 18, confidencePct: 89 },
    driftOverall: 0.06, driftStatus: "good",
    roi: roiQ(3_100_000, 720_000, 380_000, "Coding throughput & accuracy", "+27%", [
      { label: "Reduced denials & rework", value: 1_800_000, unit: "$" },
      { label: "Coder productivity", value: 1_300_000, unit: "$" },
    ]),
    lastValidatedDaysAgo: 40, cadence: 90, validationStatus: "Passed", fairnessBase: 92,
    tags: ["Revenue Cycle", "Autonomous", "High-value"], inputs: ["Clinical documentation", "Charge data"],
    outputs: ["Suggested codes", "Confidence"], downstream: ["Coding worklist", "Auto-code (high confidence)"],
  }),
  quick({
    id: "claim-denial",
    name: "Claim Denial Predictor",
    shortName: "Denial Predictor",
    description: "Predicts likely claim denials pre-submission and recommends corrective actions.",
    purpose: "Prevent denials by flagging at-risk claims before they are submitted.",
    category: "Revenue Cycle", modelClass: "Gradient-Boosted Trees",
    owner: "Revenue Cycle AI", ownerContact: "Dana Whitfield", department: "Patient Financial Services",
    vendor: "Internal", version: "2.7.0", environment: "Production", riskLevel: "Moderate",
    regulatoryClass: "Enterprise-Validated", dataClassification: "Operational", status: "Operational",
    headlineLabel: "AUROC", headlineValue: 87.5, headlineThreshold: 83, delta30d: 0.5,
    vit: { availability: 99.95, latencyMs: 130, volumePerDay: 5200, overrideRatePct: 10, overrideThreshold: 16, confidencePct: 87 },
    driftOverall: 0.05, driftStatus: "good",
    roi: roiQ(1_400_000, 260_000, 160_000, "Denial rate reduction", "-3.1 points", [
      { label: "Prevented denials", value: 1_400_000, unit: "$" },
    ]),
    lastValidatedDaysAgo: 52, cadence: 120, validationStatus: "Passed",
    tags: ["Revenue Cycle", "Denials"], inputs: ["Claim data", "Payer rules", "Historical denials"],
    outputs: ["Denial probability", "Correction suggestions"], downstream: ["Pre-bill edit queue"],
  }),
  quick({
    id: "charge-capture",
    name: "Charge Capture Auditor",
    shortName: "Charge Auditor",
    description: "Identifies missing or inconsistent charges by comparing documentation to captured charges.",
    purpose: "Recover missed revenue and reduce compliance risk from charge gaps.",
    category: "Revenue Cycle", modelClass: "Gradient-Boosted Trees",
    owner: "Revenue Cycle AI", ownerContact: "Dana Whitfield", department: "Patient Financial Services",
    vendor: "Internal", version: "1.3.0", environment: "Production", riskLevel: "Low",
    regulatoryClass: "Enterprise-Validated", dataClassification: "Operational", status: "Operational",
    headlineLabel: "Precision", headlineValue: 90.8, headlineThreshold: 86, delta30d: 0.2,
    vit: { availability: 99.95, latencyMs: 180, volumePerDay: 3400, overrideRatePct: 9, overrideThreshold: 16, confidencePct: 88 },
    driftOverall: 0.04, driftStatus: "good",
    roi: roiQ(880_000, 180_000, 120_000, "Recovered charges", "+$0.9M / yr", [
      { label: "Missed-charge recovery", value: 880_000, unit: "$" },
    ]),
    lastValidatedDaysAgo: 74, cadence: 180, validationStatus: "Passed",
    tags: ["Revenue Cycle", "Audit"], inputs: ["Documentation", "Charge master"],
    outputs: ["Charge gap findings"], downstream: ["Charge review worklist"],
  }),
  quick({
    id: "patient-scheduling-agent",
    name: "Patient Scheduling Agent",
    shortName: "Scheduling Agent",
    description: "Autonomous agent that manages appointment scheduling, rescheduling, and waitlist backfill.",
    purpose: "Fill schedule gaps and reduce no-shows through proactive outreach.",
    category: "Autonomous Agent", modelClass: "Agentic LLM System",
    owner: "Access Center AI", ownerContact: "Miguel Santos", department: "Patient Access",
    vendor: "Internal", isAgent: true, version: "2.1.0", environment: "Production", riskLevel: "Moderate",
    regulatoryClass: "Enterprise-Validated", dataClassification: "PHI", status: "Operational",
    headlineLabel: "Accuracy", headlineValue: 95.5, headlineThreshold: 92, delta30d: 0.2,
    vit: { availability: 99.8, latencyMs: 5200, latencyThreshold: 12000, volumePerDay: 2200, overrideRatePct: 8, overrideThreshold: 14, confidencePct: 92 },
    driftOverall: 0.05, driftStatus: "good",
    roi: roiQ(1_300_000, 320_000, 220_000, "Schedule utilization", "+9%", [
      { label: "Filled appointment slots", value: 900_000, unit: "$" },
      { label: "Reduced no-shows", value: 400_000, unit: "$" },
    ]),
    lastValidatedDaysAgo: 46, cadence: 90, validationStatus: "Passed",
    tags: ["Agent", "Scheduling", "Access"], inputs: ["Scheduling system", "Patient contact prefs", "Provider templates"],
    outputs: ["Scheduling actions", "Outreach messages"], downstream: ["Appointment booking", "Patient notification"],
  }),
  quick({
    id: "referral-agent",
    name: "Referral Coordination Agent",
    shortName: "Referral Agent",
    description: "Coordinates specialist referrals: matches specialists, assembles records, and tracks status.",
    purpose: "Reduce referral leakage and time-to-appointment for specialty care.",
    category: "Autonomous Agent", modelClass: "Agentic LLM System",
    owner: "Access Center AI", ownerContact: "Miguel Santos", department: "Patient Access",
    vendor: "Internal", isAgent: true, version: "1.0.4", environment: "Staging", riskLevel: "Moderate",
    regulatoryClass: "Enterprise-Validated", dataClassification: "PHI", status: "Operational",
    headlineLabel: "Accuracy", headlineValue: 92.8, headlineThreshold: 88, delta30d: 0.4,
    vit: { availability: 99.5, latencyMs: 6100, latencyThreshold: 14000, volumePerDay: 340, overrideRatePct: 12, overrideThreshold: 18, confidencePct: 89 },
    driftOverall: 0.06, driftStatus: "good",
    roi: roiQ(0, 240_000, 150_000, "Referral leakage reduction", "In validation", [
      { label: "Projected retained referrals", value: 0, unit: "$" },
    ]),
    lastValidatedDaysAgo: 16, cadence: 90, validationStatus: "In progress",
    flags: { awaitingApproval: true },
    tags: ["Agent", "Referrals", "Staging"], inputs: ["Referral orders", "Specialist directory", "Records"],
    outputs: ["Referral routing", "Record packages"], downstream: ["Referral submission (staging)"],
  }),
  quick({
    id: "inbox-triage-agent",
    name: "Patient Inbox Triage Agent",
    shortName: "Inbox Triage",
    description: "Triages patient portal messages, drafts responses, and routes clinical items to the care team.",
    purpose: "Reduce in-basket burden and speed patient message turnaround.",
    category: "Autonomous Agent", modelClass: "Agentic LLM System",
    owner: "Digital Health", ownerContact: "Dr. Marcus Bell", department: "Ambulatory Operations",
    vendor: "Veta Health AI", isAgent: true, version: "1.4.1", environment: "Production", riskLevel: "Moderate",
    regulatoryClass: "Clinical Decision Support (Non-Device)", dataClassification: "PHI", status: "Operational",
    headlineLabel: "Accuracy", headlineValue: 90.6, headlineThreshold: 86, delta30d: -0.5,
    vit: { availability: 99.7, latencyMs: 3800, latencyThreshold: 9000, volumePerDay: 4100, overrideRatePct: 18, overrideDelta: 2.1, overrideThreshold: 22, confidencePct: 84 },
    driftOverall: 0.08, driftStatus: "good",
    roi: roiQ(760_000, 260_000, 190_000, "In-basket time saved", "-31%", [
      { label: "Clinician in-basket hours saved", value: 760_000, unit: "$" },
    ]),
    lastValidatedDaysAgo: 50, cadence: 90, validationStatus: "Passed",
    tags: ["Agent", "In-basket", "LLM"], inputs: ["Portal messages", "Chart context"],
    outputs: ["Triage category", "Draft response"], downstream: ["Care-team routing", "Draft reply for review"],
  }),
  quick({
    id: "bed-capacity",
    name: "Bed Capacity Forecaster",
    shortName: "Bed Forecaster",
    description: "Forecasts inpatient census and discharges to support bed management and staffing.",
    purpose: "Anticipate capacity constraints and smooth patient flow.",
    category: "Scheduling & Operations", modelClass: "Recurrent Neural Net",
    owner: "Capacity Command Center", ownerContact: "Rachel Kim", department: "Operations",
    vendor: "Internal", version: "2.5.0", environment: "Production", riskLevel: "Low",
    regulatoryClass: "Enterprise-Validated", dataClassification: "Operational", status: "Operational",
    headlineLabel: "Accuracy", headlineValue: 91.0, headlineThreshold: 86, delta30d: 0.3,
    vit: { availability: 99.9, latencyMs: 220, volumePerDay: 1900, overrideRatePct: 11, overrideThreshold: 18, confidencePct: 86 },
    driftOverall: 0.05, driftStatus: "good",
    roi: roiQ(920_000, 240_000, 150_000, "Capacity utilization", "+6%", [
      { label: "Reduced diversion & boarding", value: 920_000, unit: "$" },
    ]),
    lastValidatedDaysAgo: 66, cadence: 180, validationStatus: "Passed",
    tags: ["Operations", "Forecasting"], inputs: ["ADT feed", "Historical census", "Scheduled admissions"],
    outputs: ["Census forecast", "Discharge forecast"], downstream: ["Capacity command dashboard"],
  }),
  quick({
    id: "or-scheduling",
    name: "OR Scheduling Optimizer",
    shortName: "OR Optimizer",
    description: "Optimizes operating-room block allocation and case sequencing to improve utilization.",
    purpose: "Increase OR utilization and reduce turnover delays.",
    category: "Scheduling & Operations", modelClass: "Ensemble",
    owner: "Perioperative Services", ownerContact: "Rachel Kim", department: "Surgery",
    vendor: "Internal", version: "1.1.0", environment: "Staging", riskLevel: "Moderate",
    regulatoryClass: "Enterprise-Validated", dataClassification: "Operational", status: "Operational",
    headlineLabel: "Accuracy", headlineValue: 88.3, headlineThreshold: 84, delta30d: 0.7,
    vit: { availability: 99.6, latencyMs: 340, volumePerDay: 210, overrideRatePct: 15, overrideThreshold: 22, confidencePct: 84 },
    driftOverall: 0.06, driftStatus: "good",
    roi: roiQ(0, 210_000, 140_000, "OR utilization", "In validation", [
      { label: "Projected utilization gain", value: 0, unit: "$" },
    ]),
    lastValidatedDaysAgo: 12, cadence: 120, validationStatus: "In progress",
    tags: ["Operations", "Perioperative", "Staging"], inputs: ["OR schedule", "Case durations", "Block allocations"],
    outputs: ["Optimized schedule"], downstream: ["OR scheduling suggestions (staging)"],
  }),
  quick({
    id: "no-show",
    name: "Appointment No-Show Predictor",
    shortName: "No-Show Predictor",
    description: "Predicts appointment no-show probability to drive reminders and overbooking policy.",
    purpose: "Reduce no-shows and unused clinic capacity.",
    category: "Scheduling & Operations", modelClass: "Logistic Regression",
    owner: "Access Center AI", ownerContact: "Miguel Santos", department: "Patient Access",
    vendor: "Internal", version: "3.2.0", environment: "Production", riskLevel: "Low",
    regulatoryClass: "Enterprise-Validated", dataClassification: "Operational", status: "Operational",
    headlineLabel: "AUROC", headlineValue: 80.5, headlineThreshold: 76, delta30d: 0.1,
    vit: { availability: 99.95, latencyMs: 60, volumePerDay: 7400, overrideRatePct: 7, overrideThreshold: 14, confidencePct: 83 },
    driftOverall: 0.04, driftStatus: "good",
    roi: roiQ(680_000, 120_000, 90_000, "No-show rate reduction", "-2.9 points", [
      { label: "Recovered visit revenue", value: 680_000, unit: "$" },
    ]),
    lastValidatedDaysAgo: 80, cadence: 180, validationStatus: "Passed",
    tags: ["Operations", "Access"], inputs: ["Appointment history", "Distance & SDOH", "Reminders sent"],
    outputs: ["No-show probability"], downstream: ["Reminder cadence", "Overbooking policy"],
  }),
  quick({
    id: "oncology-treatment",
    name: "Oncology Treatment Recommendation Model",
    shortName: "Oncology Rec",
    description: "Recommends guideline-concordant oncology treatment options from tumor and genomic data.",
    purpose: "Support tumor boards with guideline-concordant, evidence-linked treatment options.",
    category: "Oncology & Genomics", modelClass: "Ensemble",
    owner: "Precision Medicine", ownerContact: "Dr. Naomi Chen", department: "Oncology",
    vendor: "Internal", version: "0.8.0", environment: "Staging", riskLevel: "Critical",
    regulatoryClass: "Research Use Only", dataClassification: "PHI", status: "Operational",
    headlineLabel: "Accuracy", headlineValue: 89.9, headlineThreshold: 90, delta30d: 0.8,
    vit: { availability: 99.5, latencyMs: 1800, latencyThreshold: 5000, volumePerDay: 40, overrideRatePct: 20, overrideThreshold: 25, confidencePct: 82 },
    driftOverall: 0.06, driftStatus: "good",
    roi: roiQ(0, 640_000, 280_000, "Guideline concordance", "In validation", [
      { label: "Projected concordance uplift", value: 0, unit: "$" },
    ]),
    lastValidatedDaysAgo: 10, cadence: 60, validationStatus: "In progress", fairnessBase: 88,
    flags: { awaitingApproval: true, needsAttention: true },
    tags: ["Oncology", "Genomics", "Critical", "Staging"], inputs: ["Tumor registry", "Genomic panel", "Guidelines"],
    outputs: ["Ranked treatment options", "Evidence links"], downstream: ["Tumor board worklist (staging)"],
  }),
  quick({
    id: "tumor-board-prep",
    name: "Tumor Board Prep Assistant",
    shortName: "Tumor Board Prep",
    description: "Assembles tumor-board case packets: imaging, pathology, staging, and prior treatment.",
    purpose: "Save oncology coordinators time preparing tumor-board cases.",
    category: "Oncology & Genomics", modelClass: "Transformer (NLP)",
    owner: "Precision Medicine", ownerContact: "Dr. Naomi Chen", department: "Oncology",
    vendor: "Internal", version: "1.0.0", environment: "Staging", riskLevel: "Low",
    regulatoryClass: "Research Use Only", dataClassification: "PHI", status: "Operational",
    headlineLabel: "Accuracy", headlineValue: 90.2, headlineThreshold: 85, delta30d: 0.3,
    vit: { availability: 99.6, latencyMs: 2200, latencyThreshold: 6000, volumePerDay: 30, overrideRatePct: 14, overrideThreshold: 22, confidencePct: 85 },
    driftOverall: 0.05, driftStatus: "good",
    roi: roiQ(0, 90_000, 70_000, "Case-prep time saved", "Pilot", [
      { label: "Projected coordinator hours saved", value: 0, unit: "$" },
    ]),
    lastValidatedDaysAgo: 18, cadence: 120, validationStatus: "Passed",
    tags: ["Oncology", "Staging"], inputs: ["Imaging", "Pathology", "Staging data"],
    outputs: ["Case packet"], downstream: ["Tumor board packet view"],
  }),
];

// ---------------------------------------------------------------------------

export const SYSTEM_SEEDS: SystemSeed[] = [
  sepsis,
  chestXray,
  docCopilot,
  priorAuthAgent,
  ...rest,
];

export const systems: AISystem[] = SYSTEM_SEEDS.map(buildSystem);

export const systemById: Record<string, AISystem> = Object.fromEntries(
  systems.map((s) => [s.id, s]),
);

export function getSystem(id: string): AISystem | undefined {
  return systemById[id];
}
