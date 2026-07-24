"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
} from "react";
import { systems as baseSystems } from "./data/systems";
import { useAuth } from "./auth";
import {
  baseDocsForSystem,
  buildFromInput,
  type CustomSystemInput,
  type DocType,
  type SystemDoc,
} from "./systemInput";
import type { AISystem } from "./types";

export type { CustomSystemInput, DocType, SystemDoc } from "./systemInput";

export type RegisterInput = Omit<CustomSystemInput, "id" | "createdAt" | "registeredBy">;

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

const StoreContext = createContext<StoreValue | null>(null);
const baseIds = new Set(baseSystems.map((s) => s.id));

export function StoreProvider({ children }: { children: React.ReactNode }) {
  const { session } = useAuth();
  const [registered, setRegistered] = useState<CustomSystemInput[]>([]);
  const [isDemo, setIsDemo] = useState(false);
  const [docs, setDocs] = useState<SystemDoc[]>([]);
  const [ready, setReady] = useState(false);

  const refresh = useCallback(async () => {
    if (!session) {
      setRegistered([]);
      setIsDemo(false);
      setDocs([]);
      setReady(true);
      return;
    }
    try {
      const [sysRes, docRes] = await Promise.all([
        fetch("/api/systems", { cache: "no-store" }),
        fetch("/api/systems/documents", { cache: "no-store" }),
      ]);
      const sysData = sysRes.ok ? await sysRes.json() : { registered: [], isDemo: false };
      const docData = docRes.ok ? await docRes.json() : { docs: [] };
      setRegistered(sysData.registered ?? []);
      setIsDemo(!!sysData.isDemo);
      setDocs(docData.docs ?? []);
    } catch {
      setRegistered([]);
      setIsDemo(false);
      setDocs([]);
    } finally {
      setReady(true);
    }
  }, [session]);

  useEffect(() => {
    setReady(false);
    refresh();
  }, [refresh]);

  const systems = useMemo(() => {
    const built = registered.map(buildFromInput);
    return isDemo ? [...built, ...baseSystems] : built;
  }, [registered, isDemo]);

  const byId = useMemo(() => {
    const m: Record<string, AISystem> = {};
    systems.forEach((s) => (m[s.id] = s));
    return m;
  }, [systems]);

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
      const base = sys && baseIds.has(systemId) ? baseDocsForSystem(sys) : [];
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
      customCount: registered.length,
      documentsFor,
      addDocument,
      removeDocument,
      stats,
      ready,
      refresh,
    }),
    [systems, byId, addSystem, registered.length, documentsFor, addDocument, removeDocument, stats, ready, refresh],
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
      stats: { total: 0, production: 0, needsAttention: 0, activeIncidents: 0, overdueValidation: 0, awaitingApproval: 0, agents: 0 },
      ready: false,
      refresh: async () => {},
    };
  }
  return ctx;
}
