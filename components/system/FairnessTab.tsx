import { AlertTriangle, Scale, ShieldCheck } from "lucide-react";
import { cn } from "@/lib/cn";
import { Panel, PanelBody, PanelHeader } from "@/components/ui/Panel";
import { Callout, EmptyState } from "@/components/ui/Feedback";
import { Badge } from "@/components/ui/Badge";
import type { AISystem, FairnessGroupMetric } from "@/lib/types";

const DIMS: FairnessGroupMetric["dimension"][] = ["Age", "Sex", "Race & Ethnicity"];

const HEAD =
  "grid grid-cols-[1.6fr_0.8fr_1fr_1fr_1fr_1.2fr] gap-3 items-center px-3";

function Cell({ value, flagged }: { value: string; flagged?: boolean }) {
  return (
    <span className={cn("text-sm tnum", flagged ? "font-semibold text-critical" : "text-fg")}>
      {value}
    </span>
  );
}

export function FairnessTab({ system }: { system: AISystem }) {
  const f = system.fairness;

  if (f.groups.length === 0) {
    return (
      <EmptyState
        icon={<Scale className="h-6 w-6" />}
        title="Subgroup monitoring not configured"
        description="Fairness monitoring is enabled only where protected-attribute data is available and appropriate to the model's intended use. This system does not consume patient demographics."
      />
    );
  }

  const byDim = DIMS.map((dim) => ({
    dim,
    rows: f.groups.filter((g) => g.dimension === dim),
  })).filter((d) => d.rows.length > 0);

  return (
    <div className="space-y-4">
      {f.headline && (
        <Callout
          tone={f.status}
          icon={
            f.status === "good" ? (
              <ShieldCheck className="h-4 w-4" />
            ) : (
              <AlertTriangle className="h-4 w-4" />
            )
          }
          title={
            f.status === "good"
              ? "No material disparities detected"
              : "Subgroup disparity detected"
          }
        >
          {f.headline}
        </Callout>
      )}

      <Panel>
        <PanelHeader
          title="Performance Across Groups"
          description="Sensitivity, specificity, and error rates by subgroup. Flagged rows exceed the equity policy threshold."
          actions={
            <Badge tone={f.status}>
              Max FNR gap {f.parityGap.toFixed(1)} pts
            </Badge>
          }
        />
        <PanelBody className="space-y-5">
          {byDim.map(({ dim, rows }) => (
            <div key={dim}>
              <div className="mb-1.5 text-2xs font-semibold uppercase tracking-wider text-fg-dim">
                {dim}
              </div>
              <div className={cn(HEAD, "border-b border-edge py-1.5 text-2xs font-medium uppercase tracking-wide text-fg-dim")}>
                <span>Subgroup</span>
                <span className="tnum">n</span>
                <span>Sensitivity</span>
                <span>Specificity</span>
                <span>FPR</span>
                <span>FNR</span>
              </div>
              {rows.map((g) => (
                <div
                  key={g.subgroup}
                  className={cn(
                    HEAD,
                    "border-b border-edge/50 py-2.5 last:border-0",
                    g.flagged && "rounded-md bg-critical/[0.06]",
                  )}
                >
                  <span className="flex items-center gap-2 text-sm text-fg">
                    {g.subgroup}
                    {g.flagged && (
                      <AlertTriangle className="h-3.5 w-3.5 text-critical" />
                    )}
                  </span>
                  <span className="text-sm text-fg-muted tnum">
                    {g.n.toLocaleString()}
                  </span>
                  <Cell value={`${g.sensitivity.toFixed(1)}%`} />
                  <Cell value={`${g.specificity.toFixed(1)}%`} />
                  <Cell value={`${g.fpr.toFixed(1)}%`} />
                  <span className="flex items-center gap-2">
                    <Cell value={`${g.fnr.toFixed(1)}%`} flagged={g.flagged} />
                    {g.fnrPrevious !== undefined && (
                      <span
                        className={cn(
                          "text-2xs tnum",
                          g.fnr - g.fnrPrevious > 0.5 ? "text-critical" : "text-fg-dim",
                        )}
                      >
                        {g.fnr - g.fnrPrevious > 0 ? "▲" : "▼"}
                        {Math.abs(g.fnr - g.fnrPrevious).toFixed(1)}
                      </span>
                    )}
                  </span>
                </div>
              ))}
            </div>
          ))}
        </PanelBody>
      </Panel>
    </div>
  );
}
