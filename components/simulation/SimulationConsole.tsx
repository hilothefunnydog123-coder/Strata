"use client";

import Link from "next/link";
import {
  ArrowRight,
  CheckCircle2,
  FlaskConical,
  Play,
  RotateCcw,
  Terminal,
} from "lucide-react";
import { cn } from "@/lib/cn";
import { Panel, PanelBody, PanelHeader } from "@/components/ui/Panel";
import { Button } from "@/components/ui/Button";
import { AlertCard } from "@/components/alerts/AlertCard";
import { toneToClasses } from "@/lib/constants";
import { useSimulation } from "@/lib/simulation";
import type { Scenario } from "@/lib/data/scenarios";

function ScenarioCard({
  scenario,
  activeStep,
  running,
  completed,
  disabled,
  onRun,
}: {
  scenario: Scenario;
  activeStep: number;
  running: boolean;
  completed: boolean;
  disabled: boolean;
  onRun: () => void;
}) {
  return (
    <Panel className={cn(running && "border-warning/40")}>
      <PanelBody>
        <div className="flex items-start justify-between gap-3">
          <div>
            <div className="text-2xs font-semibold uppercase tracking-wider text-fg-dim">
              Scenario {scenario.index}
            </div>
            <h3 className="mt-0.5 text-base font-semibold text-fg">{scenario.title}</h3>
          </div>
          {completed && !running && (
            <span className="inline-flex items-center gap-1 text-2xs font-medium text-positive">
              <CheckCircle2 className="h-3.5 w-3.5" /> Complete
            </span>
          )}
        </div>
        <p className="mt-2 text-xs leading-relaxed text-fg-muted">{scenario.summary}</p>

        <Link
          href={`/registry/${scenario.targetSystemId}`}
          className="mt-2 inline-flex items-center gap-1 text-2xs font-medium text-accent hover:underline"
        >
          Target: {scenario.targetSystemName} <ArrowRight className="h-3 w-3" />
        </Link>

        <div className="mt-3 space-y-1.5 border-t border-edge pt-3">
          {scenario.steps.map((step, i) => {
            const done = running ? i < activeStep : completed;
            const active = running && i === activeStep;
            return (
              <div key={i} className="flex items-center gap-2">
                {done ? (
                  <CheckCircle2 className="h-3.5 w-3.5 shrink-0 text-positive" />
                ) : active ? (
                  <span className="h-3 w-3 shrink-0 animate-spin rounded-full border-2 border-accent border-t-transparent" />
                ) : (
                  <span className="h-3 w-3 shrink-0 rounded-full border border-edge-strong" />
                )}
                <span className={cn("text-xs", active || done ? "text-fg" : "text-fg-dim")}>
                  {step.label}
                </span>
              </div>
            );
          })}
        </div>

        <Button
          variant={running ? "secondary" : "primary"}
          className="mt-3.5 w-full"
          onClick={onRun}
          disabled={disabled}
        >
          <Play className="h-4 w-4" />
          {running ? "Running…" : scenario.trigger}
        </Button>
      </PanelBody>
    </Panel>
  );
}

export function SimulationConsole() {
  const { scenarios, run, signals, injectedAlerts, completed, runScenario, reset } =
    useSimulation();

  return (
    <div className="grid grid-cols-1 gap-4 lg:grid-cols-5">
      <div className="space-y-4 lg:col-span-3">
        <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
          {scenarios.map((s) => (
            <ScenarioCard
              key={s.id}
              scenario={s}
              running={run.running && run.scenarioId === s.id}
              activeStep={run.scenarioId === s.id ? run.stepIndex + 1 : 0}
              completed={!!completed[s.id]}
              disabled={run.running}
              onRun={() => runScenario(s.id)}
            />
          ))}
        </div>

        <Panel>
          <PanelHeader
            icon={<Terminal className="h-4 w-4" />}
            title="Signal Console"
            description="Live detection signals as the simulation propagates through the estate."
            actions={
              <Button variant="ghost" size="sm" onClick={reset}>
                <RotateCcw className="h-3.5 w-3.5" /> Reset
              </Button>
            }
          />
          <PanelBody className="p-0">
            <div className="max-h-[340px] overflow-y-auto p-3 font-mono text-xs">
              {signals.length === 0 ? (
                <div className="px-2 py-10 text-center font-sans text-sm text-fg-dim">
                  Run a scenario to stream detection signals here.
                </div>
              ) : (
                <ul className="space-y-1.5">
                  {signals.map((sig) => {
                    const t = toneToClasses(sig.tone);
                    return (
                      <li key={sig.id} className="flex gap-2.5 animate-fade-in">
                        <span className="shrink-0 text-fg-dim">
                          {new Date(sig.at).toLocaleTimeString("en-US", { hour12: false })}
                        </span>
                        <span className={cn("shrink-0 font-semibold uppercase", t.text)}>
                          [{sig.scenarioTitle}]
                        </span>
                        <span className="min-w-0">
                          <span className="text-fg">{sig.label}.</span>{" "}
                          <span className="font-sans text-fg-muted">{sig.detail}</span>
                        </span>
                      </li>
                    );
                  })}
                </ul>
              )}
            </div>
          </PanelBody>
        </Panel>
      </div>

      <div className="space-y-4 lg:col-span-2">
        <Panel>
          <PanelHeader
            icon={<FlaskConical className="h-4 w-4" />}
            title="How simulation works"
          />
          <PanelBody className="space-y-2 text-xs leading-relaxed text-fg-muted">
            <p>
              Simulation injects realistic conditions into a live-looking estate so you can watch
              Ward detect and respond end to end. Each scenario streams signals, then raises real
              alerts that appear in the Alert Center and on the Overview.
            </p>
            <p className="text-fg-dim">
              Simulated alerts are tagged and can be cleared with Reset. No production data is
              affected.
            </p>
          </PanelBody>
        </Panel>

        <Panel>
          <PanelHeader
            title="Injected Alerts"
            description={`${injectedAlerts.length} raised by simulation.`}
            actions={
              injectedAlerts.length > 0 ? (
                <Link href="/alerts" className="text-xs font-medium text-accent hover:underline">
                  Open Alert Center
                </Link>
              ) : undefined
            }
          />
          {injectedAlerts.length === 0 ? (
            <PanelBody className="py-10 text-center text-sm text-fg-dim">
              No simulated alerts yet.
            </PanelBody>
          ) : (
            <div className="divide-y divide-edge">
              {injectedAlerts.map((a) => (
                <AlertCard key={a.id} alert={a} compact />
              ))}
            </div>
          )}
        </Panel>
      </div>
    </div>
  );
}
