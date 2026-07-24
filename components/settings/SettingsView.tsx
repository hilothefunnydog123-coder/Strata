"use client";

import { useCallback, useEffect, useState } from "react";
import { useSearchParams } from "next/navigation";
import { Check, Copy, KeyRound, Plus, Trash2 } from "lucide-react";
import { cn } from "@/lib/cn";
import { Panel, PanelBody, PanelHeader } from "@/components/ui/Panel";
import { Tabs } from "@/components/ui/Tabs";
import { Badge, RiskBadge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { relativeTime } from "@/lib/format";
import type { RiskLevel } from "@/lib/types";

interface ApiKeyMeta {
  id: string;
  name: string;
  prefix: string;
  createdBy: string;
  lastUsedAt: string | null;
  revokedAt: string | null;
  createdAt: string;
}
interface AlertRule {
  id: string;
  category: string;
  metric: string;
  op: "gt" | "lt";
  threshold: number;
  severity: string;
  enabled: boolean;
}
interface Member {
  id: string;
  name: string;
  email: string;
  role: string;
  active: boolean;
  lastLoginAt: string | null;
}

const METRICS = [
  "accuracy",
  "auroc",
  "precision",
  "recall",
  "f1",
  "latency_ms",
  "error_rate",
  "volume",
  "confidence",
  "override_rate",
  "drift",
  "fairness_fnr",
];

function CopyButton({ text }: { text: string }) {
  const [done, setDone] = useState(false);
  return (
    <button
      onClick={() => {
        navigator.clipboard?.writeText(text);
        setDone(true);
        setTimeout(() => setDone(false), 1500);
      }}
      className="inline-flex items-center gap-1.5 rounded-md border border-edge bg-raised px-2.5 py-1.5 text-xs font-semibold text-fg-muted hover:bg-hover hover:text-fg"
    >
      {done ? <Check className="h-3.5 w-3.5 text-positive" /> : <Copy className="h-3.5 w-3.5" />}
      {done ? "Copied" : "Copy"}
    </button>
  );
}

export function SettingsView() {
  const params = useSearchParams();
  const initial = params.get("tab") ?? "api";
  const [tab, setTab] = useState(initial);
  const tabs = [
    { key: "api", label: "Ingestion & API Keys" },
    { key: "alerts", label: "Alert Rules" },
    { key: "team", label: "Team" },
    { key: "policies", label: "Risk Policies" },
  ];

  return (
    <div>
      <Tabs tabs={tabs} value={tab} onChange={setTab} className="mb-4" />
      {tab === "api" && <IngestionTab />}
      {tab === "alerts" && <AlertRulesTab />}
      {tab === "team" && <TeamTab />}
      {tab === "policies" && <PoliciesTab />}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Ingestion & API keys
// ---------------------------------------------------------------------------

function IngestionTab() {
  const [keys, setKeys] = useState<ApiKeyMeta[]>([]);
  const [freshKey, setFreshKey] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const [name, setName] = useState("");
  const origin = typeof window !== "undefined" ? window.location.origin : "https://app.ward.health";

  const load = useCallback(async () => {
    const res = await fetch("/api/apikeys", { cache: "no-store" });
    if (res.ok) setKeys((await res.json()).keys ?? []);
  }, []);
  useEffect(() => {
    load();
  }, [load]);

  const create = async () => {
    setCreating(true);
    const res = await fetch("/api/apikeys", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: name.trim() || "Ingestion key" }),
    });
    setCreating(false);
    if (res.ok) {
      const data = await res.json();
      setFreshKey(data.plaintext);
      setName("");
      load();
    }
  };

  const revoke = async (id: string) => {
    const res = await fetch(`/api/apikeys?id=${encodeURIComponent(id)}`, { method: "DELETE" });
    if (res.ok) load();
  };

  const sample = keys.find((k) => !k.revokedAt)?.prefix ?? "wk_live_xxxx";
  const snippet = `curl -X POST ${origin}/api/ingest/metrics \\
  -H "Authorization: Bearer ${freshKey ?? sample + "..."}" \\
  -H "Content-Type: application/json" \\
  -d '{"points":[
    {"systemId":"sys-your-system","metric":"accuracy","value":93.4},
    {"systemId":"sys-your-system","metric":"latency_ms","value":142},
    {"systemId":"sys-your-system","metric":"drift","value":0.06}
  ]}'`;

  return (
    <div className="space-y-4">
      {freshKey && (
        <div className="rounded-xl border border-positive/40 bg-positive/10 p-4">
          <div className="flex items-center gap-2 text-sm font-bold text-fg">
            <KeyRound className="h-4 w-4 text-positive" />
            New ingestion key created
          </div>
          <p className="mt-1 text-xs font-medium text-fg-muted">
            Copy it now. For your security, this is the only time the full key is shown.
          </p>
          <div className="mt-3 flex items-center gap-2">
            <code className="flex-1 truncate rounded-md border border-edge bg-canvas px-3 py-2 font-mono text-xs text-fg">
              {freshKey}
            </code>
            <CopyButton text={freshKey} />
          </div>
        </div>
      )}

      <Panel>
        <PanelHeader
          title="Ingestion API Keys"
          description="Authenticate your model infrastructure to stream real telemetry into Ward."
          actions={
            <div className="flex items-center gap-2">
              <input
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="Key name"
                className="h-9 w-40 rounded-md border border-edge bg-panel px-3 text-sm text-fg placeholder:text-fg-dim focus:border-accent focus:outline-none"
              />
              <Button variant="primary" size="sm" onClick={create} disabled={creating}>
                <Plus className="h-3.5 w-3.5" />
                Create key
              </Button>
            </div>
          }
        />
        <div className="overflow-x-auto">
          <div className="min-w-[640px]">
            <div className="grid grid-cols-[1.4fr_1fr_1fr_1fr_0.6fr] gap-3 border-b border-edge px-4 py-2 text-2xs font-semibold uppercase tracking-wider text-fg-dim">
              <span>Name</span>
              <span>Key</span>
              <span>Last used</span>
              <span>Created by</span>
              <span className="justify-self-end">Action</span>
            </div>
            {keys.length === 0 && (
              <div className="px-4 py-8 text-center text-sm font-medium text-fg-muted">
                No keys yet. Create one to start streaming telemetry.
              </div>
            )}
            {keys.map((k) => (
              <div
                key={k.id}
                className="grid grid-cols-[1.4fr_1fr_1fr_1fr_0.6fr] items-center gap-3 border-b border-edge/60 px-4 py-2.5 last:border-0"
              >
                <div className="min-w-0">
                  <div className="truncate text-sm font-semibold text-fg">{k.name}</div>
                  {k.revokedAt && <span className="text-2xs font-semibold text-critical">Revoked</span>}
                </div>
                <code className="truncate font-mono text-xs text-fg-muted">{k.prefix}…</code>
                <span className="text-xs text-fg-muted tnum">
                  {k.lastUsedAt ? relativeTime(k.lastUsedAt) : "Never"}
                </span>
                <span className="truncate text-xs text-fg-muted">{k.createdBy}</span>
                <span className="justify-self-end">
                  {!k.revokedAt && (
                    <button
                      onClick={() => revoke(k.id)}
                      className="inline-flex h-7 w-7 items-center justify-center rounded-md border border-edge text-fg-dim hover:border-critical/40 hover:text-critical"
                      aria-label="Revoke key"
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                    </button>
                  )}
                </span>
              </div>
            ))}
          </div>
        </div>
      </Panel>

      <Panel>
        <PanelHeader
          title="Stream telemetry"
          description="POST metric points from your serving stack. Points appear on the control center within seconds."
          actions={<CopyButton text={snippet} />}
        />
        <PanelBody>
          <pre className="overflow-x-auto rounded-lg border border-edge bg-canvas p-4 font-mono text-xs leading-relaxed text-fg-muted">
            {snippet}
          </pre>
          <div className="mt-4">
            <div className="text-2xs font-bold uppercase tracking-wider text-fg-dim">
              Supported metrics
            </div>
            <div className="mt-2 flex flex-wrap gap-1.5">
              {METRICS.map((m) => (
                <code
                  key={m}
                  className="rounded border border-edge bg-raised px-1.5 py-0.5 font-mono text-2xs text-fg-muted"
                >
                  {m}
                </code>
              ))}
            </div>
            <p className="mt-3 text-xs font-medium leading-relaxed text-fg-muted">
              Send <code className="font-mono text-fg">fairness_fnr</code> with a{" "}
              <code className="font-mono text-fg">subgroup</code> field to populate subgroup parity.
              Agent traces post to{" "}
              <code className="font-mono text-fg">/api/ingest/agent-events</code>.
            </p>
          </div>
        </PanelBody>
      </Panel>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Alert rules
// ---------------------------------------------------------------------------

const CATEGORIES = ["Performance", "Drift", "Fairness", "Agent Behavior", "Security", "Compliance", "Validation"];
const SEVERITIES = ["Critical", "High", "Medium", "Low"];

function AlertRulesTab() {
  const [rules, setRules] = useState<AlertRule[]>([]);
  const [form, setForm] = useState({ category: "Performance", metric: "accuracy", op: "lt", threshold: "90", severity: "High" });

  const load = useCallback(async () => {
    const res = await fetch("/api/alerts/rules", { cache: "no-store" });
    if (res.ok) setRules((await res.json()).rules ?? []);
  }, []);
  useEffect(() => {
    load();
  }, [load]);

  const create = async () => {
    const res = await fetch("/api/alerts/rules", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ...form, threshold: Number(form.threshold) }),
    });
    if (res.ok) load();
  };
  const toggle = async (r: AlertRule) => {
    await fetch("/api/alerts/rules", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id: r.id, enabled: !r.enabled }),
    });
    load();
  };
  const remove = async (id: string) => {
    await fetch(`/api/alerts/rules?id=${encodeURIComponent(id)}`, { method: "DELETE" });
    load();
  };

  return (
    <Panel>
      <PanelHeader
        title="Alert Rules"
        description="Thresholds that raise alerts as real telemetry crosses them."
      />
      <PanelBody>
        <div className="mb-4 flex flex-wrap items-end gap-2 rounded-lg border border-edge bg-raised p-3">
          <Field label="Category">
            <Select value={form.category} onChange={(v) => setForm({ ...form, category: v })} options={CATEGORIES} />
          </Field>
          <Field label="Metric">
            <Select value={form.metric} onChange={(v) => setForm({ ...form, metric: v })} options={METRICS} />
          </Field>
          <Field label="Condition">
            <Select value={form.op} onChange={(v) => setForm({ ...form, op: v })} options={["lt", "gt"]} labels={{ lt: "is below", gt: "is above" }} />
          </Field>
          <Field label="Threshold">
            <input
              value={form.threshold}
              onChange={(e) => setForm({ ...form, threshold: e.target.value })}
              className="h-9 w-24 rounded-md border border-edge bg-panel px-3 text-sm text-fg focus:border-accent focus:outline-none"
            />
          </Field>
          <Field label="Severity">
            <Select value={form.severity} onChange={(v) => setForm({ ...form, severity: v })} options={SEVERITIES} />
          </Field>
          <Button variant="primary" size="sm" onClick={create}>
            <Plus className="h-3.5 w-3.5" />
            Add rule
          </Button>
        </div>

        {rules.length === 0 ? (
          <p className="py-6 text-center text-sm font-medium text-fg-muted">
            No alert rules yet. Add one above to start watching your metrics.
          </p>
        ) : (
          <div className="divide-y divide-edge">
            {rules.map((r) => (
              <div key={r.id} className="flex items-center justify-between gap-3 py-2.5">
                <div className="flex items-center gap-3">
                  <Badge tone={r.severity === "Critical" ? "critical" : r.severity === "High" ? "warning" : "neutral"}>
                    {r.severity}
                  </Badge>
                  <span className="text-sm font-medium text-fg">
                    <span className="text-fg-muted">{r.category}:</span>{" "}
                    <code className="font-mono text-fg">{r.metric}</code>{" "}
                    {r.op === "gt" ? "above" : "below"}{" "}
                    <span className="font-semibold tnum">{r.threshold}</span>
                  </span>
                </div>
                <div className="flex items-center gap-2">
                  <button
                    onClick={() => toggle(r)}
                    className={cn(
                      "rounded-md border px-2 py-1 text-xs font-semibold",
                      r.enabled
                        ? "border-positive/40 bg-positive/10 text-positive"
                        : "border-edge bg-panel text-fg-dim",
                    )}
                  >
                    {r.enabled ? "Enabled" : "Disabled"}
                  </button>
                  <button
                    onClick={() => remove(r.id)}
                    className="inline-flex h-7 w-7 items-center justify-center rounded-md border border-edge text-fg-dim hover:border-critical/40 hover:text-critical"
                    aria-label="Delete rule"
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}
      </PanelBody>
    </Panel>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="flex flex-col gap-1">
      <span className="text-2xs font-bold uppercase tracking-wider text-fg-dim">{label}</span>
      {children}
    </label>
  );
}
function Select({
  value,
  onChange,
  options,
  labels,
}: {
  value: string;
  onChange: (v: string) => void;
  options: string[];
  labels?: Record<string, string>;
}) {
  return (
    <select
      value={value}
      onChange={(e) => onChange(e.target.value)}
      className="h-9 rounded-md border border-edge bg-panel px-2 text-sm font-medium text-fg focus:border-accent focus:outline-none"
    >
      {options.map((o) => (
        <option key={o} value={o}>
          {labels?.[o] ?? o}
        </option>
      ))}
    </select>
  );
}

// ---------------------------------------------------------------------------
// Team
// ---------------------------------------------------------------------------

function TeamTab() {
  const [members, setMembers] = useState<Member[]>([]);
  useEffect(() => {
    fetch("/api/org/members", { cache: "no-store" })
      .then((r) => (r.ok ? r.json() : { members: [] }))
      .then((d) => setMembers(d.members ?? []));
  }, []);

  return (
    <Panel>
      <PanelHeader
        title="Team"
        description={`${members.length} member${members.length === 1 ? "" : "s"} with access to this workspace.`}
      />
      <div className="overflow-x-auto">
        <div className="min-w-[620px]">
          <div className="grid grid-cols-[2fr_1.4fr_0.8fr_1fr] gap-3 border-b border-edge px-4 py-2 text-2xs font-semibold uppercase tracking-wider text-fg-dim">
            <span>Name</span>
            <span>Role</span>
            <span>Status</span>
            <span className="justify-self-end">Last sign-in</span>
          </div>
          {members.map((u) => (
            <div
              key={u.id}
              className="grid grid-cols-[2fr_1.4fr_0.8fr_1fr] items-center gap-3 border-b border-edge/60 px-4 py-2.5 last:border-0"
            >
              <div className="min-w-0">
                <div className="truncate text-sm font-medium text-fg">{u.name}</div>
                <div className="truncate text-2xs text-fg-dim">{u.email}</div>
              </div>
              <span className="text-xs text-fg-muted">{u.role}</span>
              <span>
                <Badge tone={u.active ? "good" : "neutral"}>{u.active ? "Active" : "Suspended"}</Badge>
              </span>
              <span className="justify-self-end text-2xs text-fg-dim tnum">
                {u.lastLoginAt ? relativeTime(u.lastLoginAt) : "Never"}
              </span>
            </div>
          ))}
        </div>
      </div>
      <PanelBody className="border-t border-edge">
        <p className="text-xs font-medium text-fg-muted">
          Members are provisioned by your platform owner in the owner console.
        </p>
      </PanelBody>
    </Panel>
  );
}

// ---------------------------------------------------------------------------
// Risk policies (product defaults, enforced by risk class)
// ---------------------------------------------------------------------------

const DEFAULT_POLICIES: {
  riskLevel: RiskLevel;
  cadence: number;
  approvals: number;
  drift: number;
  fairness: number;
  clinical: boolean;
}[] = [
  { riskLevel: "Critical", cadence: 60, approvals: 3, drift: 0.15, fairness: 5, clinical: true },
  { riskLevel: "High", cadence: 90, approvals: 2, drift: 0.2, fairness: 5, clinical: true },
  { riskLevel: "Moderate", cadence: 120, approvals: 1, drift: 0.25, fairness: 8, clinical: false },
  { riskLevel: "Low", cadence: 180, approvals: 1, drift: 0.3, fairness: 10, clinical: false },
];

function PoliciesTab() {
  return (
    <Panel>
      <PanelHeader
        title="Risk Policies"
        description="Validation cadence and approval requirements enforced by governance risk class."
      />
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
          {DEFAULT_POLICIES.map((p) => (
            <div
              key={p.riskLevel}
              className="grid grid-cols-[1fr_1.2fr_1fr_1fr_1fr_1.1fr] items-center gap-3 border-b border-edge/60 px-4 py-3 last:border-0"
            >
              <RiskBadge risk={p.riskLevel} />
              <span className="text-sm text-fg tnum">{p.cadence} days</span>
              <span className="text-sm text-fg tnum">{p.approvals}</span>
              <span className="text-sm text-fg tnum">{p.drift.toFixed(2)}</span>
              <span className="text-sm text-fg tnum">{p.fairness.toFixed(1)} pts</span>
              <span className="text-xs text-fg-muted">{p.clinical ? "Required" : "Optional"}</span>
            </div>
          ))}
        </div>
      </div>
    </Panel>
  );
}
