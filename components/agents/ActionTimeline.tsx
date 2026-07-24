import {
  AlertOctagon,
  Ban,
  BrainCircuit,
  CheckCircle2,
  FileText,
  MessageSquare,
  PlayCircle,
  Send,
  Wrench,
  BookOpen,
} from "lucide-react";
import { cn } from "@/lib/cn";
import { fmtTime } from "@/lib/format";
import type { AgentAction, AgentActionKind, AgentActionStatus } from "@/lib/types";

const KIND_ICON: Record<AgentActionKind, React.ReactNode> = {
  session: <PlayCircle className="h-3.5 w-3.5" />,
  read: <BookOpen className="h-3.5 w-3.5" />,
  tool: <Wrench className="h-3.5 w-3.5" />,
  decision: <BrainCircuit className="h-3.5 w-3.5" />,
  generate: <FileText className="h-3.5 w-3.5" />,
  message: <MessageSquare className="h-3.5 w-3.5" />,
  submit: <Send className="h-3.5 w-3.5" />,
  approval: <CheckCircle2 className="h-3.5 w-3.5" />,
  access: <FileText className="h-3.5 w-3.5" />,
  anomaly: <AlertOctagon className="h-3.5 w-3.5" />,
};

const STATUS_META: Record<
  AgentActionStatus,
  { label: string; text: string; bg: string; ring: string }
> = {
  normal: { label: "", text: "text-fg-dim", bg: "bg-raised", ring: "border-edge" },
  flagged: { label: "Flagged", text: "text-critical", bg: "bg-critical/10", ring: "border-critical/40" },
  blocked: { label: "Blocked", text: "text-critical", bg: "bg-critical/15", ring: "border-critical/50" },
  approved: { label: "Approved", text: "text-positive", bg: "bg-positive/10", ring: "border-positive/40" },
  pending: { label: "Awaiting human", text: "text-warning", bg: "bg-warning/10", ring: "border-warning/40" },
};

export function ActionTimeline({ actions }: { actions: AgentAction[] }) {
  return (
    <div className="relative pl-1">
      <div className="absolute bottom-3 left-[19px] top-3 w-px bg-edge" />
      <ul className="space-y-1">
        {actions.map((a) => {
          const meta = STATUS_META[a.status];
          const flagged = a.status === "flagged" || a.status === "blocked";
          return (
            <li key={a.id} className="relative flex gap-3">
              <span
                className={cn(
                  "relative z-10 mt-1 flex h-8 w-8 shrink-0 items-center justify-center rounded-full border",
                  meta.bg,
                  meta.ring,
                  meta.text,
                )}
              >
                {KIND_ICON[a.kind]}
              </span>
              <div
                className={cn(
                  "min-w-0 flex-1 rounded-lg border px-3 py-2",
                  flagged ? cn(meta.bg, meta.ring) : "border-transparent",
                )}
              >
                <div className="flex items-center justify-between gap-3">
                  <div className="flex items-center gap-2">
                    <span className="font-mono text-2xs text-fg-dim tnum">{fmtTime(a.at)}</span>
                    <span className="text-2xs text-fg-dim">Step {a.step}</span>
                  </div>
                  {meta.label && (
                    <span className={cn("text-2xs font-semibold uppercase tracking-wide", meta.text)}>
                      {a.status === "blocked" && <Ban className="mr-1 inline h-3 w-3" />}
                      {meta.label}
                    </span>
                  )}
                </div>
                <div className="mt-0.5 text-sm font-medium text-fg">{a.summary}</div>
                {a.detail && <div className="mt-0.5 text-xs text-fg-muted">{a.detail}</div>}
                <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
                  {a.tool && (
                    <span className="inline-flex items-center gap-1 rounded border border-edge bg-raised px-1.5 py-0.5 font-mono text-2xs text-fg-muted">
                      <Wrench className="h-2.5 w-2.5" />
                      {a.tool}
                    </span>
                  )}
                  {a.dataSource && (
                    <span className="rounded border border-edge bg-raised px-1.5 py-0.5 text-2xs text-fg-dim">
                      {a.dataSource}
                    </span>
                  )}
                  {a.durationMs && (
                    <span className="text-2xs text-fg-dim tnum">{a.durationMs} ms</span>
                  )}
                  {a.riskNote && (
                    <span className="text-2xs font-medium text-critical">{a.riskNote}</span>
                  )}
                </div>
              </div>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
