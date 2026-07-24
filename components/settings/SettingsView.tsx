"use client";

import { useState } from "react";
import { CheckCircle2, Circle, Plug } from "lucide-react";
import { cn } from "@/lib/cn";
import { Panel, PanelBody, PanelHeader } from "@/components/ui/Panel";
import { Tabs } from "@/components/ui/Tabs";
import { Badge, RiskBadge } from "@/components/ui/Badge";
import {
  alertThresholds,
  integrations,
  orgUsers,
  riskPolicies,
  rolePermissions,
} from "@/lib/data";
import { relativeTime } from "@/lib/format";

const LEVEL_TONE: Record<string, string> = {
  Full: "text-positive",
  Approve: "text-accent",
  Edit: "text-info",
  View: "text-fg-muted",
  None: "text-fg-dim",
};

export function SettingsView() {
  const [tab, setTab] = useState("users");
  const tabs = [
    { key: "users", label: "Users" },
    { key: "roles", label: "Roles & Permissions" },
    { key: "policies", label: "Risk Policies" },
    { key: "thresholds", label: "Alert Thresholds" },
    { key: "integrations", label: "Integrations" },
  ];

  return (
    <div>
      <Tabs tabs={tabs} value={tab} onChange={setTab} className="mb-4" />

      {tab === "users" && (
        <Panel>
          <PanelHeader title="Users" description={`${orgUsers.length} members across governance, clinical, data science, and compliance.`} />
          <div className="overflow-x-auto">
            <div className="min-w-[680px]">
              <div className="grid grid-cols-[2fr_1.4fr_1.2fr_0.8fr_1fr] gap-3 border-b border-edge px-4 py-2 text-2xs font-semibold uppercase tracking-wider text-fg-dim">
                <span>Name</span>
                <span>Role</span>
                <span>Team</span>
                <span>Status</span>
                <span className="justify-self-end">Last active</span>
              </div>
              {orgUsers.map((u) => (
                <div key={u.id} className="grid grid-cols-[2fr_1.4fr_1.2fr_0.8fr_1fr] items-center gap-3 border-b border-edge/60 px-4 py-2.5 last:border-0">
                  <div className="flex items-center gap-2.5">
                    <span className="flex h-7 w-7 items-center justify-center rounded-full bg-accent/15 text-2xs font-bold text-accent">
                      {u.initials}
                    </span>
                    <div className="min-w-0">
                      <div className="truncate text-sm font-medium text-fg">{u.name}</div>
                      <div className="truncate text-2xs text-fg-dim">{u.email}</div>
                    </div>
                  </div>
                  <span className="text-xs text-fg-muted">{u.role}</span>
                  <span className="text-xs text-fg-muted">{u.team}</span>
                  <span>
                    <Badge tone={u.status === "Active" ? "good" : u.status === "Invited" ? "warning" : "neutral"}>
                      {u.status}
                    </Badge>
                  </span>
                  <span className="justify-self-end text-2xs text-fg-dim tnum">
                    {relativeTime(u.lastActive)}
                  </span>
                </div>
              ))}
            </div>
          </div>
        </Panel>
      )}

      {tab === "roles" && (
        <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
          {rolePermissions.map((r) => (
            <Panel key={r.role}>
              <PanelHeader
                title={r.role}
                description={r.description}
                actions={<span className="text-2xs text-fg-dim tnum">{r.memberCount} members</span>}
              />
              <PanelBody className="space-y-2">
                {r.scopes.map((sc) => (
                  <div key={sc.area} className="flex items-center justify-between text-sm">
                    <span className="text-fg-muted">{sc.area}</span>
                    <span className={cn("text-xs font-semibold", LEVEL_TONE[sc.level])}>{sc.level}</span>
                  </div>
                ))}
              </PanelBody>
            </Panel>
          ))}
        </div>
      )}

      {tab === "policies" && (
        <Panel>
          <PanelHeader title="Risk Policies" description="Validation cadence and approval requirements enforced by risk class." />
          <div className="overflow-x-auto">
            <div className="min-w-[760px]">
              <div className="grid grid-cols-[1fr_1.2fr_1fr_1fr_1fr_1.1fr] gap-3 border-b border-edge px-4 py-2 text-2xs font-semibold uppercase tracking-wider text-fg-dim">
                <span>Risk level</span>
                <span>Validation cadence</span>
                <span>Approvals</span>
                <span>Drift threshold</span>
                <span>Fairness gap</span>
                <span>Clinical review</span>
              </div>
              {riskPolicies.map((p) => (
                <div key={p.riskLevel} className="grid grid-cols-[1fr_1.2fr_1fr_1fr_1fr_1.1fr] items-center gap-3 border-b border-edge/60 px-4 py-3 last:border-0">
                  <RiskBadge risk={p.riskLevel} />
                  <span className="text-sm text-fg tnum">{p.validationCadenceDays} days</span>
                  <span className="text-sm text-fg tnum">{p.approvalsRequired}</span>
                  <span className="text-sm text-fg tnum">{p.driftThreshold.toFixed(2)}</span>
                  <span className="text-sm text-fg tnum">{p.fairnessThreshold.toFixed(1)} pts</span>
                  <span className="text-xs text-fg-muted">{p.requiresClinicalReview ? "Required" : "Optional"}</span>
                </div>
              ))}
            </div>
          </div>
        </Panel>
      )}

      {tab === "thresholds" && (
        <Panel>
          <PanelHeader title="Alert Thresholds" description="Conditions that raise alerts across the estate." />
          <div className="overflow-x-auto">
            <div className="min-w-[720px]">
              <div className="grid grid-cols-[1.1fr_1.6fr_1.4fr_0.9fr_0.7fr] gap-3 border-b border-edge px-4 py-2 text-2xs font-semibold uppercase tracking-wider text-fg-dim">
                <span>Category</span>
                <span>Metric</span>
                <span>Condition</span>
                <span>Severity</span>
                <span className="justify-self-end">Enabled</span>
              </div>
              {alertThresholds.map((t) => (
                <div key={t.id} className="grid grid-cols-[1.1fr_1.6fr_1.4fr_0.9fr_0.7fr] items-center gap-3 border-b border-edge/60 px-4 py-2.5 last:border-0">
                  <span className="text-xs font-medium text-fg-muted">{t.category}</span>
                  <span className="text-xs text-fg">{t.metric}</span>
                  <span className="text-xs text-fg-muted">{t.condition}</span>
                  <span>
                    <Badge tone={t.severity === "Critical" ? "critical" : t.severity === "High" ? "warning" : "neutral"}>
                      {t.severity}
                    </Badge>
                  </span>
                  <span className="justify-self-end">
                    {t.enabled ? (
                      <CheckCircle2 className="h-4 w-4 text-positive" />
                    ) : (
                      <Circle className="h-4 w-4 text-fg-dim" />
                    )}
                  </span>
                </div>
              ))}
            </div>
          </div>
        </Panel>
      )}

      {tab === "integrations" && (
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {integrations.map((i) => (
            <Panel key={i.id} className="p-4">
              <div className="flex items-start justify-between gap-2">
                <div className="flex items-center gap-2.5">
                  <span className="flex h-9 w-9 items-center justify-center rounded-md bg-raised text-fg-muted">
                    <Plug className="h-4 w-4" />
                  </span>
                  <div>
                    <div className="text-sm font-medium text-fg">{i.name}</div>
                    <div className="text-2xs text-fg-dim">{i.category}</div>
                  </div>
                </div>
                <span
                  className={cn(
                    "inline-flex items-center gap-1.5 text-2xs font-medium",
                    i.status === "Connected" ? "text-positive" : i.status === "Degraded" ? "text-warning" : "text-fg-dim",
                  )}
                >
                  <span
                    className={cn(
                      "h-1.5 w-1.5 rounded-full",
                      i.status === "Connected" ? "bg-positive" : i.status === "Degraded" ? "bg-warning" : "bg-fg-dim",
                    )}
                  />
                  {i.status}
                </span>
              </div>
              <p className="mt-2.5 text-xs text-fg-muted">{i.detail}</p>
              {i.lastSync && (
                <div className="mt-2 text-2xs text-fg-dim tnum">Last sync {relativeTime(i.lastSync)}</div>
              )}
            </Panel>
          ))}
        </div>
      )}
    </div>
  );
}
