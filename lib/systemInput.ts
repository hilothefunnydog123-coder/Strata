import { buildSystem } from "./data/build";
import type { SystemSeed, Vitals } from "./data/systems";
import type {
  AICategory,
  AISystem,
  DataClassification,
  Environment,
  LineageNode,
  ModelClass,
  RegulatoryClass,
  RiskLevel,
} from "./types";

// Pure (server- and client-safe) system-registration model + generator.

export interface CustomSystemInput {
  id: string;
  name: string;
  description: string;
  purpose: string;
  category: AICategory;
  modelClass: ModelClass;
  owner: string;
  ownerContact: string;
  department: string;
  vendor: string;
  isInternal: boolean;
  isAgent: boolean;
  environment: Environment;
  riskLevel: RiskLevel;
  regulatoryClass: RegulatoryClass;
  dataClassification: DataClassification;
  headlineLabel: string;
  headlineValue: number;
  inputs: string[];
  outputs: string[];
  tags: string[];
  registeredBy: string;
  createdAt: number;
}

export type DocType =
  | "Model Card"
  | "Validation Report"
  | "Data Flow Diagram"
  | "Approval Memo"
  | "Regulatory Filing"
  | "Intended-Use Statement"
  | "Other";

export interface SystemDoc {
  id: string;
  systemId: string;
  name: string;
  type: DocType;
  status: "Current" | "Draft" | "In review";
  addedBy: string;
  addedAt: number;
  note?: string;
  system?: boolean;
}

const CADENCE: Record<RiskLevel, number> = { Critical: 60, High: 90, Moderate: 120, Low: 180 };

function defaultVitals(): Vitals {
  return {
    availability: 99.9,
    latencyMs: 200,
    latencyDelta: 0,
    latencyThreshold: 1000,
    errorRatePct: 0.05,
    errorDelta: 0,
    volumePerDay: 120,
    volumeDelta: 0,
    confidencePct: 88,
    confidenceDelta: 0,
    overrideRatePct: 8,
    overrideDelta: 0,
    overrideThreshold: 15,
    timeToOverrideSec: 90,
    manualEditRatePct: 5,
    ignoredRatePct: 3,
  };
}

function defaultLineage(input: CustomSystemInput): LineageNode[] {
  const nodes: [LineageNode["kind"], string, string?][] = input.isAgent
    ? [
        ["source", input.inputs[0] ?? "Source systems", "Primary input"],
        ["model", `${input.name} 1.0.0`, input.modelClass],
        ["transform", "Reasoning & tools", "Planner + tool calls"],
        ["human", "Human approval", "Gate before action"],
        ["action", input.outputs[0] ?? "Action", "Downstream effect"],
      ]
    : [
        ["source", input.inputs[0] ?? "Source", "Primary input"],
        ["transform", "Feature pipeline", "Preprocessing"],
        ["model", `${input.name} 1.0.0`, input.modelClass],
        ["output", input.outputs[0] ?? "Output", "Model output"],
        ["human", "Clinician review", "Human in the loop"],
      ];
  return nodes.map(([kind, label, detail], i) => ({ id: `n${i}`, kind, label, detail }));
}

export function seedFromInput(input: CustomSystemInput): SystemSeed {
  const auroc = Math.round((input.headlineValue / 100 + 0.01) * 1000) / 1000;
  return {
    id: input.id,
    name: input.name,
    shortName: input.name.length > 22 ? input.name.slice(0, 22) : input.name,
    description: input.description || `${input.name} — registered AI system.`,
    purpose: input.purpose || input.description || "Registered for governance and monitoring.",
    category: input.category,
    modelClass: input.modelClass,
    owner: input.owner || "AI Platform",
    ownerContact: input.ownerContact || input.registeredBy,
    department: input.department || "Clinical AI",
    vendor: input.isInternal ? "Internal" : input.vendor || "Vendor",
    isAgent: input.isAgent,
    version: "1.0.0",
    environment: input.environment,
    riskLevel: input.riskLevel,
    regulatoryClass: input.regulatoryClass,
    dataClassification: input.dataClassification,
    status: "Operational",
    inputs: input.inputs.length ? input.inputs : ["Enterprise data platform"],
    outputs: input.outputs.length ? input.outputs : ["Model output"],
    downstreamActions: ["Clinician review queue"],
    lineage: defaultLineage(input),
    deployedDaysAgo: 2,
    lastValidatedDaysAgo: 2,
    validationCadenceDays: CADENCE[input.riskLevel],
    validationCoverage: 100,
    validationStatus: "Not started",
    headline: {
      label: input.headlineLabel || "Accuracy",
      value: input.headlineValue || 90,
      threshold: Math.max(50, (input.headlineValue || 90) - 4),
      delta30d: 0,
    },
    bases: defaultVitals(),
    drift: { overall: 0.03, status: "good", populationFactor: 0.4 },
    roi: {
      annualImpact: 0,
      implementationCost: 0,
      operatingCost: 0,
      headlineMetricLabel: "Impact",
      headlineMetricValue: "Not yet measured",
      breakdown: [],
    },
    versions: [
      {
        version: "1.0.0",
        status: "Candidate",
        releasedDaysAgo: 2,
        validationStatus: "Not started",
        changelog: ["Initial registration", "Pending first validation"],
        metrics: {
          auroc,
          sensitivity: Math.round(((input.headlineValue || 90) - 2) * 10) / 10,
          specificity: Math.round(((input.headlineValue || 90) - 1) * 10) / 10,
        },
        performanceDelta: 0,
      },
    ],
    flags: { needsAttention: false, overdueValidation: false, activeIncident: false, awaitingApproval: true },
    tags: input.tags.length ? input.tags : ["Newly registered"],
  };
}

export function buildFromInput(input: CustomSystemInput): AISystem {
  return buildSystem(seedFromInput(input));
}

export function baseDocsForSystem(s: AISystem): SystemDoc[] {
  const t = new Date(s.lastValidatedAt).getTime();
  return [
    { id: `${s.id}-doc-card`, systemId: s.id, name: `${s.shortName} Model Card`, type: "Model Card", status: "Current", addedBy: s.ownerContact, addedAt: t, system: true, note: "Intended use, training data, and limitations." },
    { id: `${s.id}-doc-val`, systemId: s.id, name: `Validation Report — ${s.currentVersion}`, type: "Validation Report", status: s.validation.status === "Passed" ? "Current" : "In review", addedBy: s.ownerContact, addedAt: t, system: true },
    { id: `${s.id}-doc-flow`, systemId: s.id, name: "Data Flow & PHI Handling", type: "Data Flow Diagram", status: "Current", addedBy: "Compliance & Privacy", addedAt: t, system: true },
  ];
}
