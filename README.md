# Strata

**The AI control plane for healthcare enterprises.**

Hospitals and health systems are deploying AI everywhere: sepsis predictors, radiology
models, ambient documentation copilots, prior-authorization agents, revenue-cycle coders,
and dozens of internally built systems. Once an organization runs tens or hundreds of AI
systems, no one has a single place to answer the questions that matter:

> What AI is running? What data does it use? Is it still accurate? Is it drifting? Is it
> failing for certain populations? Are clinicians ignoring it? Are autonomous agents taking
> actions they should not? Who approved it? Is it actually improving care or saving money?

Strata is the **visibility, monitoring, governance, validation, audit, and control layer**
for healthcare AI. Think Datadog for AI observability, ServiceNow for enterprise AI
governance, and Cloudflare for AI security, purpose-built for a health system, and rendered
as a mission-control interface an operator would trust during a high-stakes decision.

This repository is a production-quality **prototype** populated with a realistic synthetic
health system, **Northstar Health System** (8 hospitals, 33 registered AI systems).

---

## The core concept: the AI Registry

Every AI system in the organization is registered and continuously monitored. Each system
carries its identity, owner, vendor, model version, environments, input and output data,
risk classification, approval status, validation history, performance, drift, fairness,
incidents, human-override behavior, ROI, audit trail, and current health, all in one place.

## What's inside

| Area | What it answers |
| --- | --- |
| **Overview** | Command center: estate health, risk distribution, live alerts, activity, system map. |
| **AI Registry** | Dense, filterable table of the entire AI estate with live status and financials. |
| **Control Center** | Per-system deep dive: health, performance-over-time with event causes, drift, fairness, human behavior, versions, data lineage, incidents, audit log. |
| **Validation Center** | Select system → version → dataset → tests, run validation, then approve or **block** a deployment with an audit record. |
| **Agent Monitoring** | Cybersecurity-grade oversight of autonomous agents: every action, tool call, data access, and human approval, with anomaly detection. |
| **Incidents** | Investigate failures: timeline, what changed before onset, affected population, related alerts, remediation. |
| **Governance** | Staged approval workflows (Security → Clinical → Validation → Approval → Production) showing exactly what is blocking each release. |
| **Alerts** | Triage across performance, drift, fairness, agent behavior, security, compliance: acknowledge, assign, escalate, mute, resolve. |
| **AI Catalog** | Searchable source-of-truth profiles for every system. |
| **ROI & Impact** | Executive view of annual impact, net value, and portfolio ROI. |
| **Settings** | Users, roles and permissions, risk policies, alert thresholds, integrations. |
| **Simulation** | Inject realistic failures (EHR schema change, subgroup regression, agent anomaly) and watch Strata detect and respond end to end. |

## The demo story

The product is built to support one continuous narrative:

1. Open the **Overview**; systems require attention and incidents are active.
2. Open the **Sepsis Risk Predictor**; accuracy has dropped 3.2% over 30 days.
3. The alert explains an **EHR schema change on March 14**.
4. Inspect **input feature drift** (respiratory rate) and the **performance decline** on the
   same timeline.
5. See that the **false negative rate for patients over 65 rose from 7.2% to 11.4%**.
6. Open the **incident** for the full timeline and what changed before onset.
7. **Compare** the current model with the previous version.
8. Start a **validation run**; it **fails for one subgroup**, and you **block** the model
   from approval, recorded to the audit log.

Run **Simulation Mode** to reproduce these dynamics live.

## Tech stack

- **Next.js 14** (App Router) + **React 18** + **TypeScript** (strict)
- **Tailwind CSS** with a semantic, theme-aware token system (dark and light)
- Custom, dependency-free **SVG charts** (line, area, distribution, donut, sparkline)
- `lucide-react` icons
- Strongly typed **mock data** structured like a real backend, so it can be swapped for a
  live API with no shape changes

## Getting started

```bash
npm install
npm run dev        # http://localhost:3000
```

Other scripts:

```bash
npm run build      # production build
npm run start      # serve the production build
npm run typecheck  # tsc --noEmit
npm run lint       # next lint
```

## Project structure

```
app/                     Routes (Overview, Registry, Control Center, Validation, …)
components/
  shell/                 Sidebar, top bar, command palette, theme
  ui/                    Panel, Badge, Metric, Button, Modal, Tabs, Feedback
  charts/                LineChart, Bars, Donut, Sparkline
  system/                Control Center tabs (health, performance, drift, fairness, …)
  agents/ alerts/ incidents/ validation/ governance/ catalog/ roi/ settings/ overview/
lib/
  types.ts               The domain model (AISystem, ModelVersion, Incident, Alert, …)
  data/                  Realistic Northstar Health data + generators + scenarios
  simulation.tsx         The simulation engine (React context)
  validationEngine.ts    Validation-run result generation
```

## Data model

The domain is fully typed in [`lib/types.ts`](lib/types.ts). The atom is `AISystem`, which
embeds `PerformanceSummary`, `DriftSummary`, `FairnessSummary`, `HumanBehaviorSummary`,
`ROISummary`, `ValidationSummary`, and `ModelVersion[]`. Time series are generated
deterministically from a seeded PRNG anchored to a fixed demo clock, so the dataset is stable
across reloads.

## Note

Strata is a prototype. All patient data is synthetic, all organizations and vendors are
fictional, and nothing here is a medical device or clinical decision-support tool. It is a
demonstration of what an AI control plane for a healthcare enterprise looks like.
