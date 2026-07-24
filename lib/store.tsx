"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
} from "react";
import { useAuth } from "./auth";
import {
  baseDocsForSystem,
  type CustomSystemInput,
  type DocType,
  type SystemDoc,
} from "./systemInput";
import type {
  AgentAction,
  AgentSession,
  AISystem,
  Alert,
  AuditEvent,
  EstateStats,
  GovernanceWorkflow,
  Incident,
  ValidationRun,
} from "./types";

export type { CustomSystemInput, DocType, SystemDoc } from "./systemInput";

export type RegisterInput = Omit<CustomSystemInput, "id" | "createdAt" | "registeredBy">;

interface AgentData {
  sessions: AgentSession[];
  actions: Record<string, AgentAction[]>;
}

interface StoreValue {
  systems: AISystem[];
  getSystem: (id: string) => AISystem | undefined;
  addSystem: (input: RegisterInput) => Promise<string | null>;
  customCount: number;
  documentsFor: (systemId: string) => SystemDoc[];
  addDocument: (
    systemId: string,
    doc: { name: string; type: DocType; note?: string },
  ) => Promise<void>;
  removeDocument: (id: string) => Promise<void>;
  // Real org-wide operational data (from /api/estate)
  estate: EstateStats | null;
  alerts: Alert[];
  incidents: Incident[];
  getIncident: (id: string) => Incident | undefined;
  audit: AuditEvent[];
  agents: AgentData;
  validations: ValidationRun[];
  governance: GovernanceWorkflow[];
  isDemo: boolean;
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
  refresh: () => Promise<void>;
}

const EMPTY_AGENTS: AgentData = { sessions: [], actions: {} };
const StoreContext = createContext<StoreValue | null>(null);

export function StoreProvider({ children }: { children: React.ReactNode }) {
  const { session } = useAuth();
  const [systems, setSystems] = useState<AISystem[]>([]);
  const [estate, setEstate] = useState<EstateStats | null>(null);
  const [alerts, setAlerts] = useState<Alert[]>([]);
  const [incidents, setIncidents] = useState<Incident[]>([]);
  const [audit, setAudit] = useState<AuditEvent[]>([]);
  const [agents, setAgents] = useState<AgentData>(EMPTY_AGENTS);
  const [validations, setValidations] = useState<ValidationRun[]>([]);
  const [governance, setGovernance] = useState<GovernanceWorkflow[]>([]);
  const [isDemo, setIsDemo] = useState(false);
  const [docs, setDocs] = useState<SystemDoc[]>([]);
  const [ready, setReady] = useState(false);

  const clear = useCallback(() => {
    setSystems([]);
    setEstate(null);
    setAlerts([]);
    setIncidents([]);
    setAudit([]);
    setAgents(EMPTY_AGENTS);
    setValidations([]);
    setGovernance([]);
    setIsDemo(false);
    setDocs([]);
  }, []);

  const refresh = useCallback(async () => {
    if (!session) {
      clear();
      setReady(true);
      return;
    }
    try {
      const [estateRes, docRes] = await Promise.all([
        fetch("/api/estate", { cache: "no-store" }),
        fetch("/api/systems/documents", { cache: "no-store" }),
      ]);
      const data = estateRes.ok ? await estateRes.json() : {};
      const docData = docRes.ok ? await docRes.json() : { docs: [] };
      setSystems(data.systems ?? []);
      setEstate(data.stats ?? null);
      setAlerts(data.alerts ?? []);
      setIncidents(data.incidents ?? []);
      setAudit(data.audit ?? []);
      setAgents(data.agents ?? EMPTY_AGENTS);
      setValidations(data.validations ?? []);
      setGovernance(data.governance ?? []);
      setIsDemo(!!data.isDemo);
      setDocs(docData.docs ?? []);
    } catch {
      clear();
    } finally {
      setReady(true);
    }
  }, [session, clear]);

  useEffect(() => {
    setReady(false);
    refresh();
  }, [refresh]);

  const byId = useMemo(() => {
    const m: Record<string, AISystem> = {};
    systems.forEach((s) => (m[s.id] = s));
    return m;
  }, [systems]);

  const incidentById = useMemo(() => {
    const m: Record<string, Incident> = {};
    incidents.forEach((i) => (m[i.id] = i));
    return m;
  }, [incidents]);

  const addSystem = useCallback(
    async (input: RegisterInput): Promise<string | null> => {
      const res = await fetch("/api/systems", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(input),
      });
      if (!res.ok) return null;
      const data = await res.json();
      await refresh();
      return data.id ?? null;
    },
    [refresh],
  );

  const documentsFor = useCallback(
    (systemId: string): SystemDoc[] => {
      const sys = byId[systemId];
      const base = sys ? baseDocsForSystem(sys) : [];
      const mine = docs.filter((d) => d.systemId === systemId);
      return [...mine, ...base].sort((a, b) => b.addedAt - a.addedAt);
    },
    [byId, docs],
  );

  const addDocument: StoreValue["addDocument"] = useCallback(async (systemId, doc) => {
    const res = await fetch("/api/systems/documents", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ systemId, name: doc.name, type: doc.type, note: doc.note }),
    });
    if (res.ok) {
      const data = await res.json();
      setDocs((prev) => [data.doc, ...prev]);
    }
  }, []);

  const removeDocument = useCallback(async (id: string) => {
    const res = await fetch(`/api/systems/documents?id=${encodeURIComponent(id)}`, {
      method: "DELETE",
    });
    if (res.ok) setDocs((prev) => prev.filter((d) => d.id !== id));
  }, []);

  const stats = useMemo(
    () => ({
      total: systems.length,
      production: systems.filter((s) => s.environment === "Production").length,
      needsAttention: systems.filter((s) => s.flags.needsAttention).length,
      activeIncidents: incidents.filter((i) =>
        ["Investigating", "Contained", "Monitoring"].includes(i.status),
      ).length,
      overdueValidation: systems.filter((s) => s.flags.overdueValidation).length,
      awaitingApproval: systems.filter((s) => s.flags.awaitingApproval).length,
      agents: systems.filter((s) => s.isAgent).length,
    }),
    [systems, incidents],
  );

  const value: StoreValue = useMemo(
    () => ({
      systems,
      getSystem: (id) => byId[id],
      addSystem,
      customCount: systems.length,
      documentsFor,
      addDocument,
      removeDocument,
      estate,
      alerts,
      incidents,
      getIncident: (id) => incidentById[id],
      audit,
      agents,
      validations,
      governance,
      isDemo,
      stats,
      ready,
      refresh,
    }),
    [
      systems,
      byId,
      addSystem,
      documentsFor,
      addDocument,
      removeDocument,
      estate,
      alerts,
      incidents,
      incidentById,
      audit,
      agents,
      validations,
      governance,
      isDemo,
      stats,
      ready,
      refresh,
    ],
  );

  return <StoreContext.Provider value={value}>{children}</StoreContext.Provider>;
}

export function useStore(): StoreValue {
  const ctx = useContext(StoreContext);
  if (!ctx) {
    return {
      systems: [],
      getSystem: () => undefined,
      addSystem: async () => null,
      customCount: 0,
      documentsFor: () => [],
      addDocument: async () => {},
      removeDocument: async () => {},
      estate: null,
      alerts: [],
      incidents: [],
      getIncident: () => undefined,
      audit: [],
      agents: EMPTY_AGENTS,
      validations: [],
      governance: [],
      isDemo: false,
      stats: { total: 0, production: 0, needsAttention: 0, activeIncidents: 0, overdueValidation: 0, awaitingApproval: 0, agents: 0 },
      ready: false,
      refresh: async () => {},
    };
  }
  return ctx;
}
