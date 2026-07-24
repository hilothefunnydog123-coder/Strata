import {
  ArrowRight,
  Boxes,
  ChevronDown,
  Cpu,
  Database,
  FileOutput,
  UserCheck,
  Workflow,
  Zap,
} from "lucide-react";
import { cn } from "@/lib/cn";
import { Panel, PanelBody, PanelHeader } from "@/components/ui/Panel";
import type { AISystem, LineageNode } from "@/lib/types";

const KIND_META: Record<
  LineageNode["kind"],
  { icon: React.ReactNode; color: string; label: string }
> = {
  source: { icon: <Database className="h-4 w-4" />, color: "var(--info)", label: "Data source" },
  transform: { icon: <Workflow className="h-4 w-4" />, color: "var(--fg-muted)", label: "Transform" },
  model: { icon: <Cpu className="h-4 w-4" />, color: "var(--accent)", label: "Model" },
  output: { icon: <FileOutput className="h-4 w-4" />, color: "var(--positive)", label: "Output" },
  action: { icon: <Zap className="h-4 w-4" />, color: "var(--elevated)", label: "Action" },
  human: { icon: <UserCheck className="h-4 w-4" />, color: "var(--warning)", label: "Human" },
};

function ListPanel({ title, items }: { title: string; items: string[] }) {
  return (
    <Panel>
      <PanelHeader title={title} />
      <PanelBody className="space-y-1.5">
        {items.map((i, idx) => (
          <div key={idx} className="flex items-start gap-2 text-sm text-fg-muted">
            <span className="mt-1.5 h-1 w-1 shrink-0 rounded-full bg-fg-dim" />
            {i}
          </div>
        ))}
      </PanelBody>
    </Panel>
  );
}

export function LineageTab({ system }: { system: AISystem }) {
  return (
    <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
      <div className="lg:col-span-2">
        <Panel>
          <PanelHeader
            icon={<Boxes className="h-4 w-4" />}
            title="Data Lineage"
            description="End-to-end flow from source data to clinical action, with the human decision point."
          />
          <PanelBody>
            <div className="mx-auto max-w-md">
              {system.lineage.map((node, i) => {
                const meta = KIND_META[node.kind];
                const last = i === system.lineage.length - 1;
                return (
                  <div key={node.id}>
                    <div className="flex items-center gap-3 rounded-lg border border-edge bg-raised p-3">
                      <span
                        className="flex h-9 w-9 shrink-0 items-center justify-center rounded-md"
                        style={{ background: `rgb(${meta.color} / 0.14)`, color: `rgb(${meta.color})` }}
                      >
                        {meta.icon}
                      </span>
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-2">
                          <span className="text-sm font-medium text-fg">{node.label}</span>
                          <span
                            className="rounded px-1 py-px text-[0.6rem] font-semibold uppercase tracking-wide"
                            style={{ background: `rgb(${meta.color} / 0.12)`, color: `rgb(${meta.color})` }}
                          >
                            {meta.label}
                          </span>
                        </div>
                        {node.detail && (
                          <div className="mt-0.5 truncate text-2xs text-fg-dim">{node.detail}</div>
                        )}
                      </div>
                    </div>
                    {!last && (
                      <div className="flex justify-center py-1">
                        <ChevronDown className="h-4 w-4 text-fg-dim" />
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          </PanelBody>
        </Panel>
      </div>

      <div className="space-y-4">
        <ListPanel title="Input Data" items={system.inputs} />
        <ListPanel title="Model Output" items={system.outputs} />
        <ListPanel title="Downstream Actions" items={system.downstreamActions} />
      </div>
    </div>
  );
}
