import type { Metadata } from "next";
import Link from "next/link";
import {
  Activity,
  ArrowRight,
  Bot,
  FileCheck,
  GitBranch,
  Lock,
  Radar,
  Scale,
  ServerCog,
  ShieldCheck,
  TrendingUp,
} from "lucide-react";
import { Brand } from "@/components/shell/Brand";
import { ButtonLink } from "@/components/ui/Button";
import { LandingNav } from "@/components/marketing/LandingNav";
import { HeroPreview } from "@/components/marketing/HeroPreview";
import { DemoForm } from "@/components/marketing/DemoForm";

export const metadata: Metadata = {
  title: "Strata · The AI Control Plane for Healthcare",
  description:
    "Monitor, govern, validate, and control every AI system in your health system from one secure console.",
};

const CAPABILITIES = [
  { icon: Activity, title: "AI Observability", body: "Track accuracy, drift, latency, confidence, and volume for every model in production, with thresholds and alerts that lead to action." },
  { icon: Scale, title: "Fairness & Safety", body: "Monitor performance across age, sex, and race. Catch subgroup failures like a rising false-negative rate before they reach patients." },
  { icon: GitBranch, title: "Governance Workflow", body: "Every system moves through security, clinical, and validation review before production, with a complete, immutable audit trail." },
  { icon: Bot, title: "Agent Oversight", body: "Watch every action, tool call, and data access an autonomous agent takes. Detect anomalies and enforce human approval gates." },
  { icon: FileCheck, title: "Model Validation", body: "Validate models against governed datasets and subgroup floors. Approve or block deployments with an accountable, recorded decision." },
  { icon: TrendingUp, title: "ROI & Impact", body: "Quantify hours saved, cost reduced, and outcomes improved against implementation and operating cost for the whole portfolio." },
];

const QUESTIONS = [
  "What AI systems are actually running?",
  "Which version is deployed, and who approved it?",
  "Are they still accurate, or are they drifting?",
  "Are they failing for certain populations?",
  "Are clinicians ignoring their recommendations?",
  "Are autonomous agents taking actions they should not?",
  "What happened during the last incident?",
  "Is it improving care and saving money?",
];

const SECURITY = [
  { icon: ShieldCheck, label: "SOC 2 Type II" },
  { icon: Lock, label: "HIPAA compliant" },
  { icon: ServerCog, label: "VPC & on-prem deployment" },
  { icon: FileCheck, label: "Immutable audit log" },
  { icon: Radar, label: "SSO / SCIM provisioning" },
  { icon: Scale, label: "PHI-minimized by design" },
];

const OUTCOMES = [
  { v: "6 hrs", l: "earlier sepsis detection" },
  { v: "41 min", l: "faster critical imaging turnaround" },
  { v: "1.6 hrs", l: "documentation saved per clinician per day" },
  { v: "329%", l: "ROI on the documentation copilot" },
];

function SectionKicker({ children }: { children: React.ReactNode }) {
  return (
    <div className="text-2xs font-bold uppercase tracking-[0.16em] text-accent">{children}</div>
  );
}

export default function LandingPage() {
  return (
    <div className="min-h-screen bg-canvas">
      <LandingNav />

      {/* Hero */}
      <section className="relative overflow-hidden border-b border-edge">
        <div className="grid-backdrop pointer-events-none absolute inset-0 opacity-30" />
        <div className="relative mx-auto grid max-w-6xl grid-cols-1 items-center gap-12 px-5 py-16 lg:grid-cols-2 lg:py-24">
          <div>
            <div className="inline-flex items-center gap-2 rounded-full border border-edge bg-panel px-3 py-1 text-2xs font-bold uppercase tracking-wider text-fg-muted">
              <span className="h-1.5 w-1.5 rounded-full bg-positive" />
              Healthcare AI Control Plane
            </div>
            <h1 className="mt-5 text-4xl font-bold leading-[1.05] tracking-tight text-fg sm:text-5xl lg:text-[3.4rem]">
              Every AI system in your health system, under control.
            </h1>
            <p className="mt-5 max-w-xl text-base font-medium leading-relaxed text-fg-muted sm:text-lg">
              Hospitals are deploying hundreds of AI models and agents. Strata is the single
              place to monitor accuracy and drift, catch fairness failures, govern deployments,
              oversee autonomous agents, and prove ROI.
            </p>
            <div className="mt-7 flex flex-wrap items-center gap-3">
              <ButtonLink href="#demo" variant="primary" size="md" className="h-11 px-5 text-sm">
                Request a demo
                <ArrowRight className="h-4 w-4" />
              </ButtonLink>
              <ButtonLink href="/login" variant="outline" size="md" className="h-11 px-5 text-sm">
                See it live
              </ButtonLink>
            </div>
            <div className="mt-8 flex items-center gap-6 text-2xs font-semibold text-fg-dim">
              <span>Trusted by governance teams at</span>
              <span className="text-sm font-bold text-fg-muted">Northstar Health</span>
              <span className="text-sm font-bold text-fg-muted">8 hospitals</span>
            </div>
          </div>
          <HeroPreview />
        </div>
      </section>

      {/* Stat band */}
      <section className="border-b border-edge bg-panel">
        <div className="mx-auto grid max-w-6xl grid-cols-2 gap-px px-5 py-10 sm:grid-cols-4">
          {[
            { v: "42", l: "AI systems monitored" },
            { v: "$26M", l: "annual impact tracked" },
            { v: "9", l: "high-risk systems governed" },
            { v: "100%", l: "decisions on the audit trail" },
          ].map((s) => (
            <div key={s.l} className="px-2 text-center">
              <div className="text-3xl font-bold tracking-tight text-fg tnum sm:text-4xl">{s.v}</div>
              <div className="mt-1 text-xs font-semibold text-fg-muted">{s.l}</div>
            </div>
          ))}
        </div>
      </section>

      {/* Problem */}
      <section className="mx-auto max-w-6xl px-5 py-16 lg:py-24">
        <div className="grid grid-cols-1 gap-10 lg:grid-cols-2">
          <div>
            <SectionKicker>The problem</SectionKicker>
            <h2 className="mt-3 text-3xl font-bold tracking-tight text-fg">
              Nobody has one place to answer the questions that matter.
            </h2>
            <p className="mt-4 text-base font-medium leading-relaxed text-fg-muted">
              Clinical prediction, imaging, ambient documentation, prior-authorization agents,
              revenue-cycle coders, and internal models all get deployed by different teams. Once
              you have dozens, the estate becomes invisible and the risk becomes real.
            </p>
          </div>
          <div className="rounded-xl border border-edge bg-panel p-2">
            {QUESTIONS.map((q, i) => (
              <div
                key={i}
                className="flex items-center gap-3 border-b border-edge/60 px-4 py-3 last:border-0"
              >
                <span className="text-2xs font-bold tnum text-fg-dim">{String(i + 1).padStart(2, "0")}</span>
                <span className="text-sm font-semibold text-fg">{q}</span>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* Platform */}
      <section id="platform" className="border-y border-edge bg-panel py-16 lg:py-24">
        <div className="mx-auto max-w-6xl px-5">
          <div className="max-w-2xl">
            <SectionKicker>The platform</SectionKicker>
            <h2 className="mt-3 text-3xl font-bold tracking-tight text-fg">
              Datadog for AI observability. ServiceNow for AI governance. Cloudflare for AI control.
            </h2>
            <p className="mt-4 text-base font-medium leading-relaxed text-fg-muted">
              One control plane for the entire lifecycle: register, monitor, validate, govern, and
              prove value for every AI system you run.
            </p>
          </div>
          <div className="mt-10 grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {CAPABILITIES.map((c) => (
              <div key={c.title} className="rounded-xl border border-edge bg-canvas p-5">
                <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-accent/15 text-accent">
                  <c.icon className="h-5 w-5" strokeWidth={2} />
                </div>
                <h3 className="mt-3.5 text-base font-bold text-fg">{c.title}</h3>
                <p className="mt-1.5 text-sm font-medium leading-relaxed text-fg-muted">{c.body}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* Registry concept */}
      <section id="registry" className="mx-auto max-w-6xl px-5 py-16 lg:py-24">
        <div className="grid grid-cols-1 items-center gap-12 lg:grid-cols-2">
          <div>
            <SectionKicker>The AI Registry</SectionKicker>
            <h2 className="mt-3 text-3xl font-bold tracking-tight text-fg">
              One source of truth for your entire AI estate.
            </h2>
            <p className="mt-4 text-base font-medium leading-relaxed text-fg-muted">
              Every AI system is registered with its owner, vendor, version, risk class,
              regulatory status, input and output data, validation history, and live health. Click
              any system to open a complete control center: performance over time, drift, fairness,
              human override behavior, versions, data lineage, incidents, and audit log.
            </p>
            <ul className="mt-5 space-y-2.5">
              {[
                "Trace any AI from input data to clinical action.",
                "See exactly what changed before an incident started.",
                "Prove a system is safe, accurate, compliant, and valuable.",
              ].map((t) => (
                <li key={t} className="flex items-start gap-2.5 text-sm font-semibold text-fg">
                  <ShieldCheck className="mt-0.5 h-4 w-4 shrink-0 text-positive" />
                  {t}
                </li>
              ))}
            </ul>
          </div>
          <div className="rounded-xl border border-edge bg-panel p-2">
            {[
              { n: "Sepsis Risk Predictor", c: "Clinical Prediction", r: "High", t: "text-elevated" },
              { n: "Radiology Chest X-Ray Model", c: "Medical Imaging", r: "High", t: "text-elevated" },
              { n: "Clinical Documentation Copilot", c: "Documentation", r: "Moderate", t: "text-warning" },
              { n: "Prior Authorization Agent", c: "Autonomous Agent", r: "High", t: "text-elevated" },
              { n: "Revenue Cycle Coding Model", c: "Revenue Cycle", r: "High", t: "text-elevated" },
            ].map((s) => (
              <div key={s.n} className="flex items-center justify-between gap-3 border-b border-edge/60 px-4 py-3 last:border-0">
                <div className="min-w-0">
                  <div className="truncate text-sm font-bold text-fg">{s.n}</div>
                  <div className="text-2xs font-semibold text-fg-dim">{s.c}</div>
                </div>
                <span className={`shrink-0 text-xs font-bold ${s.t}`}>{s.r} risk</span>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* Outcomes */}
      <section className="border-y border-edge bg-panel py-14">
        <div className="mx-auto grid max-w-6xl grid-cols-2 gap-8 px-5 lg:grid-cols-4">
          {OUTCOMES.map((o) => (
            <div key={o.l}>
              <div className="text-3xl font-bold tracking-tight text-positive tnum sm:text-4xl">{o.v}</div>
              <div className="mt-1.5 text-sm font-semibold text-fg-muted">{o.l}</div>
            </div>
          ))}
        </div>
      </section>

      {/* Security */}
      <section id="security" className="mx-auto max-w-6xl px-5 py-16 lg:py-24">
        <div className="max-w-2xl">
          <SectionKicker>Security & compliance</SectionKicker>
          <h2 className="mt-3 text-3xl font-bold tracking-tight text-fg">
            Built for the enterprise, and for PHI.
          </h2>
          <p className="mt-4 text-base font-medium leading-relaxed text-fg-muted">
            Strata deploys in your VPC or on-premise, integrates with your identity provider, and
            records every action to an immutable audit store. Fairness monitoring runs only where
            protected-attribute data is available and appropriate to a model's intended use.
          </p>
        </div>
        <div className="mt-8 grid grid-cols-2 gap-3 sm:grid-cols-3">
          {SECURITY.map((s) => (
            <div key={s.label} className="flex items-center gap-3 rounded-lg border border-edge bg-panel px-4 py-3.5">
              <s.icon className="h-5 w-5 shrink-0 text-accent" />
              <span className="text-sm font-bold text-fg">{s.label}</span>
            </div>
          ))}
        </div>
      </section>

      {/* Demo + Company */}
      <section id="demo" className="border-t border-edge bg-panel py-16 lg:py-24">
        <div className="mx-auto grid max-w-6xl grid-cols-1 gap-12 px-5 lg:grid-cols-2">
          <div id="company">
            <SectionKicker>Request a demo</SectionKicker>
            <h2 className="mt-3 text-3xl font-bold tracking-tight text-fg">
              See Strata on your AI estate.
            </h2>
            <p className="mt-4 text-base font-medium leading-relaxed text-fg-muted">
              We will walk your team through the live console with a realistic health system,
              then map it to your models, your agents, and your governance process.
            </p>
            <div className="mt-6 space-y-3">
              {[
                "A 30-minute working session, not a slide deck.",
                "See detection, validation, and an agent anomaly end to end.",
                "Talk through deployment in your VPC or on-premise.",
              ].map((t) => (
                <div key={t} className="flex items-start gap-2.5 text-sm font-semibold text-fg">
                  <ArrowRight className="mt-0.5 h-4 w-4 shrink-0 text-accent" />
                  {t}
                </div>
              ))}
            </div>
            <div className="mt-8 border-t border-edge pt-6">
              <div className="text-2xs font-bold uppercase tracking-wider text-fg-dim">Strata, Inc.</div>
              <p className="mt-2 max-w-md text-sm font-medium text-fg-muted">
                Strata is the AI control plane for healthcare enterprises. We help health systems
                stay in control as they deploy AI across clinical and administrative operations.
              </p>
              <a href="mailto:hello@strata.health" className="mt-2 inline-block text-sm font-bold text-accent hover:underline">
                hello@strata.health
              </a>
            </div>
          </div>
          <DemoForm />
        </div>
      </section>

      {/* Footer */}
      <footer className="border-t border-edge">
        <div className="mx-auto flex max-w-6xl flex-col items-center justify-between gap-4 px-5 py-8 sm:flex-row">
          <Brand subtitle={false} />
          <div className="flex items-center gap-6 text-xs font-semibold text-fg-muted">
            <a href="#platform" className="hover:text-fg">Platform</a>
            <a href="#security" className="hover:text-fg">Security</a>
            <Link href="/login" className="hover:text-fg">Sign in</Link>
          </div>
          <div className="text-2xs font-medium text-fg-dim">
            © 2026 Strata, Inc. Prototype with synthetic data.
          </div>
        </div>
      </footer>
    </div>
  );
}
