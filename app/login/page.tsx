"use client";

import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { Suspense, useEffect, useState } from "react";
import { ArrowRight, Lock, ShieldCheck } from "lucide-react";
import { Brand } from "@/components/shell/Brand";
import { Button } from "@/components/ui/Button";
import { DEMO_ACCOUNTS, useAuth } from "@/lib/auth";

function LoginForm() {
  const { login, session, ready } = useAuth();
  const router = useRouter();
  const params = useSearchParams();
  const next = params.get("next") || "/overview";

  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (ready && session) router.replace(session.isOwner ? "/admin" : next);
  }, [ready, session, next, router]);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setBusy(true);
    const res = await login(email, password);
    setBusy(false);
    if (res.ok) router.replace(res.isOwner ? "/admin" : next);
    else setError(res.error ?? "Sign in failed.");
  };

  return (
    <div className="grid min-h-screen grid-cols-1 lg:grid-cols-2">
      {/* Brand panel */}
      <div className="relative hidden flex-col justify-between overflow-hidden border-r border-edge bg-panel p-10 lg:flex">
        <div className="grid-backdrop pointer-events-none absolute inset-0 opacity-40" />
        <div className="relative">
          <Link href="/">
            <Brand />
          </Link>
        </div>
        <div className="relative max-w-md">
          <div className="text-2xs font-bold uppercase tracking-[0.16em] text-accent">
            Healthcare AI Control Plane
          </div>
          <h1 className="mt-3 text-3xl font-bold leading-tight tracking-tight text-fg">
            Stay in control of every AI system in your health system.
          </h1>
          <p className="mt-4 text-sm font-medium leading-relaxed text-fg-muted">
            Monitor accuracy and drift, catch fairness failures, govern deployments, oversee
            autonomous agents, and prove ROI, all from one secure console.
          </p>
        </div>
        <div className="relative flex items-center gap-2 text-2xs font-semibold text-fg-dim">
          <ShieldCheck className="h-4 w-4 text-positive" />
          SOC 2 Type II · HIPAA · SSO / SCIM · Immutable audit
        </div>
      </div>

      {/* Login card */}
      <div className="flex items-center justify-center px-6 py-12">
        <div className="w-full max-w-sm">
          <div className="mb-8 lg:hidden">
            <Brand />
          </div>
          <h2 className="text-2xl font-bold tracking-tight text-fg">Sign in</h2>
          <p className="mt-1 text-sm font-medium text-fg-muted">
            Access the Strata console for your organization.
          </p>

          <form onSubmit={submit} className="mt-6 space-y-3.5">
            <label className="block">
              <span className="mb-1 block text-xs font-semibold text-fg-muted">Work email</span>
              <input
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="you@hospital.org"
                className="h-10 w-full rounded-md border border-edge bg-panel px-3 text-sm font-medium text-fg placeholder:text-fg-dim focus:border-accent focus:outline-none"
                autoComplete="username"
              />
            </label>
            <label className="block">
              <span className="mb-1 block text-xs font-semibold text-fg-muted">Password</span>
              <div className="relative">
                <Lock className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-fg-dim" />
                <input
                  type="password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder="••••••••"
                  className="h-10 w-full rounded-md border border-edge bg-panel pl-9 pr-3 text-sm font-medium text-fg placeholder:text-fg-dim focus:border-accent focus:outline-none"
                  autoComplete="current-password"
                />
              </div>
            </label>

            {error && (
              <div className="rounded-md border border-critical/30 bg-critical/10 px-3 py-2 text-xs font-semibold text-critical">
                {error}
              </div>
            )}

            <Button type="submit" variant="primary" className="h-10 w-full" disabled={busy}>
              {busy ? "Signing in…" : "Sign in"}
              {!busy && <ArrowRight className="h-4 w-4" />}
            </Button>
          </form>

          <div className="mt-6 rounded-lg border border-edge bg-raised p-3.5">
            <div className="text-2xs font-bold uppercase tracking-wider text-fg-dim">
              Demo accounts · password “strata”
            </div>
            <div className="mt-2 space-y-1.5">
              {DEMO_ACCOUNTS.map((a) => (
                <button
                  key={a.email}
                  onClick={() => {
                    setEmail(a.email);
                    setPassword("strata");
                    setError(null);
                  }}
                  className="flex w-full items-center justify-between gap-2 rounded-md px-2 py-1.5 text-left transition-colors hover:bg-hover"
                >
                  <span className="min-w-0">
                    <span className="block truncate text-xs font-semibold text-fg">{a.name}</span>
                    <span className="block truncate text-2xs font-medium text-fg-dim">{a.email}</span>
                  </span>
                  <span className="shrink-0 text-2xs font-semibold text-accent">{a.role}</span>
                </button>
              ))}
            </div>
          </div>

          <p className="mt-6 text-center text-xs font-medium text-fg-dim">
            <Link href="/" className="text-accent hover:underline">
              Back to strata.health
            </Link>
          </p>
        </div>
      </div>
    </div>
  );
}

export default function LoginPage() {
  return (
    <Suspense fallback={<div className="min-h-screen bg-canvas" />}>
      <LoginForm />
    </Suspense>
  );
}
