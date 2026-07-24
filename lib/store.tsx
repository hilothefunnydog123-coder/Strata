"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
} from "react";
import { buildSystem } from "./data/build";
import { systems as baseSystems } from "./data/systems";
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

// ---------------------------------------------------------------------------
// Custom (user-registered) systems + documentation, persisted to localStorage.
// A registered system is stored as a minimal input and rebuilt through the same
// deterministic generator as the seeded estate, so it gets a full control center.
// ---------------------------------------------------------------------------

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
  system?: boolean; // true for seeded/default docs (not user-removable)
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

function baseDocsFor(s: AISystem): SystemDoc[] {
  const t = new Date(s.lastValidatedAt).getTime();
  return [
    { id: `${s.id}-doc-card`, systemId: s.id, name: `${s.shortName} Model Card`, type: "Model Card", status: "Current", addedBy: s.ownerContact, addedAt: t, system: true, note: "Intended use, training data, and limitations." },
    { id: `${s.id}-doc-val`, systemId: s.id, name: `Validation Report — ${s.currentVersion}`, type: "Validation Report", status: s.validation.status === "Passed" ? "Current" : "In review", addedBy: s.ownerContact, addedAt: t, system: true },
    { id: `${s.id}-doc-flow`, systemId: s.id, name: "Data Flow & PHI Handling", type: "Data Flow Diagram", status: "Current", addedBy: "Compliance & Privacy", addedAt: t, system: true },
  ];
}

interface StoreValue {
  systems: AISystem[];
  getSystem: (id: string) => AISystem | undefined;
  addSystem: (input: Omit<CustomSystemInput, "id" | "createdAt">) => string;
  customCount: number;
  documentsFor: (systemId: string) => SystemDoc[];
  addDocument: (systemId: string, doc: { name: string; type: DocType; note?: string; addedBy: string }) => void;
  removeDocument: (id: string) => void;
  stats: {
    total: number;
    production: number;
    needsAttention: number;
    activeIncidents: number;
    overdueValidation: number;
    awaitingApproval: number;
    agents: number;
  };
  ready: boolean;
}

const StoreContext = createContext<StoreValue | null>(null);

const SYS_KEY = "strata-custom-systems";
const DOC_KEY = "strata-custom-docs";

export function StoreProvider({ children }: { children: React.ReactNode }) {
  const [custom, setCustom] = useState<CustomSystemInput[]>([]);
  const [userDocs, setUserDocs] = useState<SystemDoc[]>([]);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    try {
      const s = localStorage.getItem(SYS_KEY);
      if (s) setCustom(JSON.parse(s));
      const d = localStorage.getItem(DOC_KEY);
      if (d) setUserDocs(JSON.parse(d));
    } catch {}
    setReady(true);
  }, []);

  const persistCustom = (next: CustomSystemInput[]) => {
    setCustom(next);
    try {
      localStorage.setItem(SYS_KEY, JSON.stringify(next));
    } catch {}
  };
  const persistDocs = (next: SystemDoc[]) => {
    setUserDocs(next);
    try {
      localStorage.setItem(DOC_KEY, JSON.stringify(next));
    } catch {}
  };

  const customSystems = useMemo(
    () => custom.map((c) => buildSystem(seedFromInput(c))),
    [custom],
  );

  const systems = useMemo(
    () => [...customSystems, ...baseSystems],
    [customSystems],
  );

  const byId = useMemo(() => {
    const m: Record<string, AISystem> = {};
    systems.forEach((s) => (m[s.id] = s));
    return m;
  }, [systems]);

  const addSystem = useCallback(
    (input: Omit<CustomSystemInput, "id" | "createdAt">) => {
      const slug =
        input.name
          .toLowerCase()
          .replace(/[^a-z0-9]+/g, "-")
          .replace(/(^-|-$)/g, "")
          .slice(0, 32) || "system";
      const id = `custom-${slug}-${Date.now().toString(36)}`;
      const full: CustomSystemInput = { ...input, id, createdAt: Date.now() };
      setCustom((prev) => {
        const next = [full, ...prev];
        try {
          localStorage.setItem(SYS_KEY, JSON.stringify(next));
        } catch {}
        return next;
      });
      return id;
    },
    [],
  );

  const documentsFor = useCallback(
    (systemId: string): SystemDoc[] => {
      const sys = byId[systemId];
      const base = sys && !systemId.startsWith("custom-") ? baseDocsFor(sys) : [];
      const mine = userDocs.filter((d) => d.systemId === systemId);
      return [...mine, ...base].sort((a, b) => b.addedAt - a.addedAt);
    },
    [byId, userDocs],
  );

  const addDocument: StoreValue["addDocument"] = useCallback((systemId, doc) => {
    const d: SystemDoc = {
      id: `udoc-${Date.now().toString(36)}`,
      systemId,
      name: doc.name,
      type: doc.type,
      status: "Draft",
      addedBy: doc.addedBy,
      addedAt: Date.now(),
      note: doc.note,
    };
    setUserDocs((prev) => {
      const next = [d, ...prev];
      try {
        localStorage.setItem(DOC_KEY, JSON.stringify(next));
      } catch {}
      return next;
    });
  }, []);

  const removeDocument = useCallback((id: string) => {
    setUserDocs((prev) => {
      const next = prev.filter((d) => d.id !== id);
      try {
        localStorage.setItem(DOC_KEY, JSON.stringify(next));
      } catch {}
      return next;
    });
  }, []);

  const stats = useMemo(
    () => ({
      total: systems.length,
      production: systems.filter((s) => s.environment === "Production").length,
      needsAttention: systems.filter((s) => s.flags.needsAttention).length,
      activeIncidents: systems.filter((s) => s.flags.activeIncident).length,
      overdueValidation: systems.filter((s) => s.flags.overdueValidation).length,
      awaitingApproval: systems.filter((s) => s.flags.awaitingApproval).length,
      agents: systems.filter((s) => s.isAgent).length,
    }),
    [systems],
  );

  const value: StoreValue = useMemo(
    () => ({
      systems,
      getSystem: (id) => byId[id],
      addSystem,
      customCount: custom.length,
      documentsFor,
      addDocument,
      removeDocument,
      stats,
      ready,
    }),
    [systems, byId, addSystem, custom.length, documentsFor, addDocument, removeDocument, stats, ready],
  );

  return <StoreContext.Provider value={value}>{children}</StoreContext.Provider>;
}

export function useStore(): StoreValue {
  const ctx = useContext(StoreContext);
  if (!ctx) {
    // Fallback for any non-provider render path: seeded systems only.
    return {
      systems: baseSystems,
      getSystem: (id) => baseSystems.find((s) => s.id === id),
      addSystem: () => "",
      customCount: 0,
      documentsFor: (systemId) => {
        const s = baseSystems.find((x) => x.id === systemId);
        return s ? baseDocsFor(s) : [];
      },
      addDocument: () => {},
      removeDocument: () => {},
      stats: {
        total: baseSystems.length,
        production: baseSystems.filter((s) => s.environment === "Production").length,
        needsAttention: baseSystems.filter((s) => s.flags.needsAttention).length,
        activeIncidents: baseSystems.filter((s) => s.flags.activeIncident).length,
        overdueValidation: baseSystems.filter((s) => s.flags.overdueValidation).length,
        awaitingApproval: baseSystems.filter((s) => s.flags.awaitingApproval).length,
        agents: baseSystems.filter((s) => s.isAgent).length,
      },
      ready: true,
    };
  }
  return ctx;
}
