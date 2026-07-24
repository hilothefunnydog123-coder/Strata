"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useMemo, useState } from "react";
import {
  Building2,
  KeyRound,
  LogOut,
  Plus,
  Power,
  ShieldCheck,
  Trash2,
  UserPlus,
  Users,
} from "lucide-react";
import { cn } from "@/lib/cn";
import { Brand } from "@/components/shell/Brand";
import { Button } from "@/components/ui/Button";
import { Badge } from "@/components/ui/Badge";
import { Modal, Field, Select, TextInput } from "@/components/ui/Modal";
import { fmtDate, relativeTime } from "@/lib/format";
import { useAuth } from "@/lib/auth";

interface Org {
  id: string;
  name: string;
  slug: string;
  plan: string;
  active: boolean;
  seededDemo: boolean;
  createdAt: string;
  userCount: number;
  systemCount: number;
}
interface OrgUser {
  id: string;
  name: string;
  email: string;
  role: string;
  active: boolean;
  isOwner: boolean;
  lastLoginAt: string | null;
  createdAt: string;
}

const ROLES = [
  "Administrator",
  "AI Governance Lead",
  "Clinical Reviewer",
  "Data Scientist",
  "Compliance Officer",
  "Executive",
];

function genPassword() {
  const chars = "ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnpqrstuvwxyz23456789";
  let out = "";
  for (let i = 0; i < 12; i++) out += chars[Math.floor(Math.random() * chars.length)];
  return out;
}

async function api(path: string, opts?: RequestInit) {
  const res = await fetch(path, {
    headers: { "Content-Type": "application/json" },
    cache: "no-store",
    ...opts,
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || "Request failed");
  return data;
}

export function AdminDashboard() {
  const { session, logout } = useAuth();
  const router = useRouter();

  const [orgs, setOrgs] = useState<Org[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [users, setUsers] = useState<OrgUser[]>([]);
  const [showNewOrg, setShowNewOrg] = useState(false);
  const [showNewUser, setShowNewUser] = useState(false);
  const [resetUser, setResetUser] = useState<OrgUser | null>(null);
  const [banner, setBanner] = useState<{ kind: "ok" | "err"; text: string } | null>(null);

  const selected = orgs.find((o) => o.id === selectedId) ?? null;

  const loadOrgs = useCallback(async () => {
    const data = await api("/api/admin/orgs");
    setOrgs(data.orgs);
    setSelectedId((cur) => cur ?? data.orgs[0]?.id ?? null);
  }, []);

  const loadUsers = useCallback(async (orgId: string) => {
    const data = await api(`/api/admin/users?orgId=${orgId}`);
    setUsers(data.users);
  }, []);

  useEffect(() => {
    loadOrgs().catch((e) => setBanner({ kind: "err", text: e.message }));
  }, [loadOrgs]);
  useEffect(() => {
    if (selectedId) loadUsers(selectedId).catch(() => setUsers([]));
  }, [selectedId, loadUsers]);

  const flash = (kind: "ok" | "err", text: string) => {
    setBanner({ kind, text });
    setTimeout(() => setBanner(null), 4000);
  };

  const totalUsers = useMemo(() => orgs.reduce((s, o) => s + o.userCount, 0), [orgs]);

  const toggleUser = async (u: OrgUser) => {
    try {
      await api(`/api/admin/users/${u.id}`, { method: "PATCH", body: JSON.stringify({ active: !u.active }) });
      if (selectedId) await loadUsers(selectedId);
    } catch (e) {
      flash("err", (e as Error).message);
    }
  };
  const deleteUser = async (u: OrgUser) => {
    try {
      await api(`/api/admin/users/${u.id}`, { method: "DELETE" });
      if (selectedId) await loadUsers(selectedId);
      await loadOrgs();
    } catch (e) {
      flash("err", (e as Error).message);
    }
  };
  const toggleOrg = async (o: Org) => {
    try {
      await api(`/api/admin/orgs/${o.id}`, { method: "PATCH", body: JSON.stringify({ active: !o.active }) });
      await loadOrgs();
    } catch (e) {
      flash("err", (e as Error).message);
    }
  };
  const deleteOrg = async (o: Org) => {
    try {
      await api(`/api/admin/orgs/${o.id}`, { method: "DELETE" });
      setSelectedId(null);
      await loadOrgs();
    } catch (e) {
      flash("err", (e as Error).message);
    }
  };

  return (
    <div className="min-h-screen bg-canvas">
      {/* Header */}
      <header className="sticky top-0 z-30 flex h-14 items-center justify-between border-b border-edge bg-canvas/90 px-5 backdrop-blur">
        <div className="flex items-center gap-3">
          <Brand subtitle={false} />
          <span className="rounded-md border border-accent/30 bg-accent-soft px-2 py-0.5 text-2xs font-bold uppercase tracking-wider text-accent">
            Owner Console
          </span>
        </div>
        <div className="flex items-center gap-2">
          <Link href="/overview" className="text-xs font-semibold text-fg-muted hover:text-fg">
            App console
          </Link>
          <span className="text-xs font-semibold text-fg-dim">{session?.email}</span>
          <button
            onClick={async () => {
              await logout();
              router.push("/login");
            }}
            className="inline-flex h-8 items-center gap-1.5 rounded-md border border-edge px-2.5 text-xs font-semibold text-fg-muted hover:bg-hover hover:text-fg"
          >
            <LogOut className="h-3.5 w-3.5" /> Sign out
          </button>
        </div>
      </header>

      <main className="mx-auto max-w-7xl px-5 py-6">
        <div className="mb-5">
          <h1 className="text-2xl font-bold tracking-tight text-fg">Organizations</h1>
          <p className="mt-1 text-sm font-medium text-fg-muted">
            Provision the health systems you sign, create their users and passwords, and control access.
          </p>
        </div>

        {banner && (
          <div
            className={cn(
              "mb-4 rounded-md border px-3 py-2 text-sm font-semibold",
              banner.kind === "ok"
                ? "border-positive/30 bg-positive/10 text-positive"
                : "border-critical/30 bg-critical/10 text-critical",
            )}
          >
            {banner.text}
          </div>
        )}

        <div className="mb-5 grid grid-cols-3 gap-3">
          {[
            { label: "Organizations", value: orgs.length, icon: <Building2 className="h-4 w-4" /> },
            { label: "Total users", value: totalUsers, icon: <Users className="h-4 w-4" /> },
            { label: "Active orgs", value: orgs.filter((o) => o.active).length, icon: <ShieldCheck className="h-4 w-4" /> },
          ].map((s) => (
            <div key={s.label} className="rounded-lg border border-edge bg-panel p-4">
              <div className="flex items-center justify-between text-fg-dim">
                <span className="text-2xs font-bold uppercase tracking-wider">{s.label}</span>
                {s.icon}
              </div>
              <div className="mt-1.5 text-2xl font-bold tnum text-fg">{s.value}</div>
            </div>
          ))}
        </div>

        <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
          {/* Org list */}
          <div className="lg:col-span-1">
            <div className="mb-2 flex items-center justify-between">
              <span className="text-2xs font-bold uppercase tracking-wider text-fg-dim">Customers</span>
              <Button size="sm" variant="primary" onClick={() => setShowNewOrg(true)}>
                <Plus className="h-3.5 w-3.5" /> New
              </Button>
            </div>
            <div className="space-y-1.5">
              {orgs.map((o) => (
                <button
                  key={o.id}
                  onClick={() => setSelectedId(o.id)}
                  className={cn(
                    "flex w-full items-center justify-between gap-2 rounded-lg border px-3 py-2.5 text-left transition-colors",
                    o.id === selectedId
                      ? "border-accent/40 bg-accent-soft"
                      : "border-edge bg-panel hover:bg-hover",
                  )}
                >
                  <div className="min-w-0">
                    <div className="flex items-center gap-2">
                      <span className="truncate text-sm font-bold text-fg">{o.name}</span>
                      {o.seededDemo && (
                        <span className="rounded bg-info/10 px-1 text-[0.6rem] font-bold uppercase text-info">Demo</span>
                      )}
                    </div>
                    <div className="text-2xs font-medium text-fg-dim tnum">
                      {o.userCount} users · {o.systemCount} systems
                    </div>
                  </div>
                  <span
                    className={cn(
                      "h-2 w-2 shrink-0 rounded-full",
                      o.active ? "bg-positive" : "bg-fg-dim",
                    )}
                  />
                </button>
              ))}
            </div>
          </div>

          {/* Org detail */}
          <div className="lg:col-span-2">
            {selected ? (
              <div className="rounded-lg border border-edge bg-panel">
                <div className="flex flex-wrap items-center justify-between gap-3 border-b border-edge px-4 py-3">
                  <div>
                    <div className="flex items-center gap-2">
                      <h2 className="text-base font-bold text-fg">{selected.name}</h2>
                      <Badge tone={selected.active ? "good" : "neutral"}>
                        {selected.active ? "Active" : "Suspended"}
                      </Badge>
                    </div>
                    <div className="text-2xs font-medium text-fg-dim">
                      {selected.plan} · {selected.slug} · created {fmtDate(selected.createdAt)}
                    </div>
                  </div>
                  <div className="flex items-center gap-2">
                    <Button size="sm" variant="secondary" onClick={() => toggleOrg(selected)}>
                      <Power className="h-3.5 w-3.5" />
                      {selected.active ? "Suspend" : "Activate"}
                    </Button>
                    {!selected.seededDemo && (
                      <Button
                        size="sm"
                        variant="ghost"
                        onClick={() => {
                          if (confirm(`Delete ${selected.name} and all its users? This cannot be undone.`))
                            deleteOrg(selected);
                        }}
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                      </Button>
                    )}
                    <Button size="sm" variant="primary" onClick={() => setShowNewUser(true)}>
                      <UserPlus className="h-3.5 w-3.5" /> Add user
                    </Button>
                  </div>
                </div>

                <div className="divide-y divide-edge">
                  {users.map((u) => (
                    <div key={u.id} className="flex flex-wrap items-center justify-between gap-3 px-4 py-3">
                      <div className="flex items-center gap-3">
                        <span className="flex h-8 w-8 items-center justify-center rounded-full bg-accent/15 text-2xs font-bold text-accent">
                          {u.name.split(" ").map((p) => p[0]).slice(0, 2).join("").toUpperCase()}
                        </span>
                        <div className="min-w-0">
                          <div className="flex items-center gap-2">
                            <span className="text-sm font-bold text-fg">{u.name}</span>
                            {u.isOwner && (
                              <span className="rounded bg-accent/15 px-1 text-[0.6rem] font-bold uppercase text-accent">Owner</span>
                            )}
                          </div>
                          <div className="text-2xs font-medium text-fg-dim">{u.email}</div>
                        </div>
                      </div>
                      <div className="flex items-center gap-3">
                        <span className="hidden text-xs font-semibold text-fg-muted sm:block">{u.role}</span>
                        <span className="hidden text-2xs font-medium text-fg-dim sm:block">
                          {u.lastLoginAt ? `Active ${relativeTime(u.lastLoginAt)}` : "Never signed in"}
                        </span>
                        <Badge tone={u.active ? "good" : "neutral"}>{u.active ? "Active" : "Disabled"}</Badge>
                        <button onClick={() => setResetUser(u)} title="Reset password" className="text-fg-dim hover:text-fg">
                          <KeyRound className="h-4 w-4" />
                        </button>
                        <button onClick={() => toggleUser(u)} title={u.active ? "Disable" : "Enable"} className="text-fg-dim hover:text-warning">
                          <Power className="h-4 w-4" />
                        </button>
                        {!u.isOwner && (
                          <button onClick={() => deleteUser(u)} title="Delete" className="text-fg-dim hover:text-critical">
                            <Trash2 className="h-4 w-4" />
                          </button>
                        )}
                      </div>
                    </div>
                  ))}
                  {users.length === 0 && (
                    <div className="px-4 py-12 text-center text-sm font-medium text-fg-dim">
                      No users yet. Add the first user for this organization.
                    </div>
                  )}
                </div>
              </div>
            ) : (
              <div className="flex h-64 items-center justify-center rounded-lg border border-dashed border-edge text-sm font-medium text-fg-dim">
                Select or create an organization.
              </div>
            )}
          </div>
        </div>
      </main>

      <NewOrgModal
        open={showNewOrg}
        onClose={() => setShowNewOrg(false)}
        onCreated={async () => {
          setShowNewOrg(false);
          await loadOrgs();
          flash("ok", "Organization created.");
        }}
      />
      {selected && (
        <NewUserModal
          open={showNewUser}
          orgName={selected.name}
          orgId={selected.id}
          onClose={() => setShowNewUser(false)}
          onCreated={async () => {
            setShowNewUser(false);
            await loadUsers(selected.id);
            await loadOrgs();
            flash("ok", "User created. Share their email and password securely.");
          }}
        />
      )}
      <ResetPasswordModal
        user={resetUser}
        onClose={() => setResetUser(null)}
        onDone={() => {
          setResetUser(null);
          flash("ok", "Password reset.");
        }}
      />
    </div>
  );
}

function NewOrgModal({ open, onClose, onCreated }: { open: boolean; onClose: () => void; onCreated: () => void }) {
  const [name, setName] = useState("");
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const submit = async () => {
    setBusy(true);
    setErr(null);
    try {
      await api("/api/admin/orgs", { method: "POST", body: JSON.stringify({ name }) });
      setName("");
      onCreated();
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setBusy(false);
    }
  };
  return (
    <Modal
      open={open}
      onClose={onClose}
      title="New organization"
      description="Add a health system you have signed. You will add its users next."
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>Cancel</Button>
          <Button variant="primary" onClick={submit} disabled={!name.trim() || busy}>
            <Building2 className="h-4 w-4" /> {busy ? "Creating…" : "Create organization"}
          </Button>
        </>
      }
    >
      {err && <div className="mb-3 rounded-md border border-critical/30 bg-critical/10 px-3 py-2 text-xs font-semibold text-critical">{err}</div>}
      <Field label="Organization name">
        <TextInput value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Cedar Valley Medical Center" autoFocus />
      </Field>
    </Modal>
  );
}

function NewUserModal({
  open,
  orgId,
  orgName,
  onClose,
  onCreated,
}: {
  open: boolean;
  orgId: string;
  orgName: string;
  onClose: () => void;
  onCreated: () => void;
}) {
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState(genPassword());
  const [role, setRole] = useState(ROLES[0]);
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const submit = async () => {
    setBusy(true);
    setErr(null);
    try {
      await api("/api/admin/users", {
        method: "POST",
        body: JSON.stringify({ orgId, name, email, password, role }),
      });
      setName("");
      setEmail("");
      setPassword(genPassword());
      onCreated();
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setBusy(false);
    }
  };
  return (
    <Modal
      open={open}
      onClose={onClose}
      size="lg"
      title={`Add user to ${orgName}`}
      description="Create a login. They will sign in with this email and password."
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>Cancel</Button>
          <Button variant="primary" onClick={submit} disabled={!name.trim() || !email.trim() || busy}>
            <UserPlus className="h-4 w-4" /> {busy ? "Creating…" : "Create user"}
          </Button>
        </>
      }
    >
      {err && <div className="mb-3 rounded-md border border-critical/30 bg-critical/10 px-3 py-2 text-xs font-semibold text-critical">{err}</div>}
      <div className="grid grid-cols-1 gap-3.5 sm:grid-cols-2">
        <Field label="Full name">
          <TextInput value={name} onChange={(e) => setName(e.target.value)} placeholder="Dr. Sam Rivera" autoFocus />
        </Field>
        <Field label="Work email">
          <TextInput value={email} onChange={(e) => setEmail(e.target.value)} placeholder="sam@cedarvalley.org" />
        </Field>
        <Field label="Role">
          <Select value={role} onChange={(e) => setRole(e.target.value)}>
            {ROLES.map((r) => (
              <option key={r}>{r}</option>
            ))}
          </Select>
        </Field>
        <Field label="Temporary password">
          <div className="flex gap-2">
            <TextInput value={password} onChange={(e) => setPassword(e.target.value)} className="font-mono" />
            <Button variant="secondary" size="md" onClick={() => setPassword(genPassword())} className="shrink-0">
              Generate
            </Button>
          </div>
        </Field>
      </div>
    </Modal>
  );
}

function ResetPasswordModal({ user, onClose, onDone }: { user: OrgUser | null; onClose: () => void; onDone: () => void }) {
  const [password, setPassword] = useState("");
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    if (user) setPassword(genPassword());
  }, [user]);
  const submit = async () => {
    if (!user) return;
    setBusy(true);
    setErr(null);
    try {
      await api(`/api/admin/users/${user.id}`, { method: "PATCH", body: JSON.stringify({ password }) });
      onDone();
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setBusy(false);
    }
  };
  return (
    <Modal
      open={!!user}
      onClose={onClose}
      title={`Reset password`}
      description={user ? `Set a new password for ${user.name} (${user.email}).` : ""}
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>Cancel</Button>
          <Button variant="primary" onClick={submit} disabled={password.length < 8 || busy}>
            <KeyRound className="h-4 w-4" /> {busy ? "Saving…" : "Set password"}
          </Button>
        </>
      }
    >
      {err && <div className="mb-3 rounded-md border border-critical/30 bg-critical/10 px-3 py-2 text-xs font-semibold text-critical">{err}</div>}
      <Field label="New password" hint="At least 8 characters. Share it securely.">
        <div className="flex gap-2">
          <TextInput value={password} onChange={(e) => setPassword(e.target.value)} className="font-mono" />
          <Button variant="secondary" size="md" onClick={() => setPassword(genPassword())} className="shrink-0">
            Generate
          </Button>
        </div>
      </Field>
    </Modal>
  );
}
