"use client";

import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useRef,
  useState,
} from "react";
import type { Alert, MetricStatus } from "./types";
import { scenarioById, scenarios, type Scenario } from "./data/scenarios";

export interface SignalEntry {
  id: string;
  at: number;
  scenarioId: string;
  scenarioTitle: string;
  systemId: string;
  label: string;
  detail: string;
  tone: MetricStatus;
}

interface RunState {
  scenarioId: string | null;
  stepIndex: number;
  running: boolean;
}

interface SimulationContextValue {
  scenarios: Scenario[];
  run: RunState;
  signals: SignalEntry[];
  injectedAlerts: Alert[];
  completed: Record<string, boolean>;
  runScenario: (id: string) => void;
  reset: () => void;
}

const SimulationContext = createContext<SimulationContextValue | null>(null);

let counter = 0;
const uid = (p: string) => `${p}-${Date.now().toString(36)}-${(counter++).toString(36)}`;

export function SimulationProvider({ children }: { children: React.ReactNode }) {
  const [run, setRun] = useState<RunState>({ scenarioId: null, stepIndex: -1, running: false });
  const [signals, setSignals] = useState<SignalEntry[]>([]);
  const [injectedAlerts, setInjectedAlerts] = useState<Alert[]>([]);
  const [completed, setCompleted] = useState<Record<string, boolean>>({});
  const timers = useRef<ReturnType<typeof setTimeout>[]>([]);

  const clearTimers = () => {
    timers.current.forEach(clearTimeout);
    timers.current = [];
  };

  const runScenario = useCallback((id: string) => {
    const scenario = scenarioById[id];
    if (!scenario) return;
    clearTimers();
    setRun({ scenarioId: id, stepIndex: -1, running: true });

    let elapsed = 0;
    scenario.steps.forEach((step, i) => {
      elapsed += step.delayMs;
      const timer = setTimeout(() => {
        setRun({ scenarioId: id, stepIndex: i, running: i < scenario.steps.length - 1 });
        setSignals((prev) =>
          [
            {
              id: uid("sig"),
              at: Date.now(),
              scenarioId: id,
              scenarioTitle: scenario.title,
              systemId: scenario.targetSystemId,
              label: step.label,
              detail: step.detail,
              tone: step.tone,
            },
            ...prev,
          ].slice(0, 40),
        );
        if (step.alert) {
          const alert: Alert = {
            ...step.alert,
            id: uid("SIM"),
            at: new Date().toISOString(),
            status: "Active",
          };
          setInjectedAlerts((prev) => [alert, ...prev]);
        }
        if (i === scenario.steps.length - 1) {
          setCompleted((prev) => ({ ...prev, [id]: true }));
        }
      }, elapsed);
      timers.current.push(timer);
    });
  }, []);

  const reset = useCallback(() => {
    clearTimers();
    setRun({ scenarioId: null, stepIndex: -1, running: false });
    setSignals([]);
    setInjectedAlerts([]);
    setCompleted({});
  }, []);

  const value = useMemo(
    () => ({ scenarios, run, signals, injectedAlerts, completed, runScenario, reset }),
    [run, signals, injectedAlerts, completed, runScenario, reset],
  );

  return <SimulationContext.Provider value={value}>{children}</SimulationContext.Provider>;
}

export function useSimulation(): SimulationContextValue {
  const ctx = useContext(SimulationContext);
  if (!ctx) {
    return {
      scenarios,
      run: { scenarioId: null, stepIndex: -1, running: false },
      signals: [],
      injectedAlerts: [],
      completed: {},
      runScenario: () => {},
      reset: () => {},
    };
  }
  return ctx;
}
