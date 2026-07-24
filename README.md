# Ward

**The AI control plane for healthcare enterprises.**

Hospitals and health systems are deploying AI everywhere: sepsis predictors, radiology
models, ambient documentation copilots, prior-authorization agents, revenue-cycle coders,
and dozens of internally built systems. Once an organization runs tens or hundreds of AI
systems, no one has a single place to answer the questions that matter:

> What AI is running? What data does it use? Is it still accurate? Is it drifting? Is it
> failing for certain populations? Are clinicians ignoring it? Are autonomous agents taking
> actions they should not? Who approved it? Is it actually improving care or saving money?

Ward is the **visibility, monitoring, governance, validation, audit, and control layer**
for healthcare AI. Think Datadog for AI observability, ServiceNow for enterprise AI
governance, and Cloudflare for AI security, purpose-built for a health system, and rendered
as a mission-control interface an operator would trust during a high-stakes decision.

This repository is a production-quality **prototype** populated with a realistic synthetic
health system, **Northstar Health System** (8 hospitals, 33 registered AI systems).

## Real, multi-tenant, and account-based

Ward runs on a real database with real accounts. There is no fake auth.

- **Marketing website** (`/`) — public landing page, plus a `/download` page for the desktop
  app and a request-a-demo form.
- **The console** (`/overview` and the rest) — the gated control plane, behind hospital
  **email + password sign in** (`/login`). Passwords are bcrypt-hashed; sessions are signed,
  httpOnly cookies. Also packaged as a native **desktop app** (see [`desktop/`](desktop/)).
- **Owner console** (`/admin`) — a superadmin dashboard for the platform owner to **create
  the organizations you sign, provision their users with emails and passwords, reset
  passwords, and suspend access.** Data is isolated per organization.

Everything a user does is real and server-persisted: registering an AI system, attaching
documentation, and (for the demo org) the full monitored estate. New organizations start
clean and build up their own registry.

**Demo logins** (seeded, password `ward-demo`): `elena.marsh@northstarhealth.org`,
`alan.whitmore@northstarhealth.org`, `james.okonkwo@northstarhealth.org`. The platform owner
is seeded from the `OWNER_EMAIL` / `OWNER_PASSWORD` env vars.

## Local setup

```bash
npm install
cp .env.example .env          # then edit the values
npx prisma migrate dev        # create the SQLite database
npx prisma db seed            # create the owner + demo org
npm run dev                   # http://localhost:3000
```

Sign in at `/login`. The owner account (from `.env`) lands on `/admin`.

## Deploying to production

The app is a full-stack Next.js server (App Router route handlers + Prisma). The included
`Dockerfile` builds it, runs `prisma migrate deploy` and the seed on boot, then serves it.
`render.yaml` is a one-click Render blueprint.

Set these environment variables on your host:

| Variable | Purpose |
| --- | --- |
| `DATABASE_URL` | `file:/data/ward.db` on a persistent disk, or a `postgresql://` URL |
| `SESSION_SECRET` | long random string for signing session cookies |
| `OWNER_EMAIL` / `OWNER_PASSWORD` | the platform owner account created on first boot |

On **Render**: New + → Blueprint → this repo. It provisions a Docker web service with a 1 GB
disk mounted at `/data` (so the SQLite database persists across deploys), generates a
`SESSION_SECRET`, and prompts for the owner email + password. For higher scale, change the
Prisma datasource `provider` to `postgresql` and point `DATABASE_URL` at a managed Postgres.

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
| **Simulation** | Inject realistic failures (EHR schema change, subgroup regression, agent anomaly) and watch Ward detect and respond end to end. |

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

Open `/` for the marketing site, or `/login` to enter the console.

Other scripts:

```bash
npm run build      # production build (also emits the standalone server)
npm run start      # serve the production build
npm run typecheck  # tsc --noEmit
npm run lint       # next lint
```

## Desktop app

The full console ships as a native desktop app (Electron), isolated in
[`desktop/`](desktop/) so the web app stays lightweight.

```bash
# terminal 1
npm run dev
# terminal 2
cd desktop && npm install && npm run dev   # opens the Ward desktop window
```

See [`desktop/README.md`](desktop/README.md) for the production build and installer steps.

## Project structure

```
app/
  page.tsx               Marketing landing page (public)
  login/                 Sign in (public)
  overview/ registry/ …  The gated console routes
components/
  marketing/             Landing nav, hero preview, demo form
  shell/                 Chrome (marketing vs console + auth gate), sidebar, top bar, command palette
  ui/                    Panel, Badge, Metric, Button, Modal, Tabs, Feedback
  charts/                LineChart, Bars, Donut, Sparkline
  system/                Control Center tabs (health, performance, drift, fairness, documents, …)
  agents/ alerts/ incidents/ validation/ governance/ catalog/ roi/ settings/ overview/
lib/
  types.ts               The domain model (AISystem, ModelVersion, Incident, Alert, …)
  auth.tsx               Hospital sign-in (session in localStorage)
  store.tsx              Persistent data store (register systems + documentation)
  data/                  Realistic Northstar Health data + generators + scenarios
  simulation.tsx         The simulation engine (React context)
  validationEngine.ts    Validation-run result generation
desktop/                 Electron desktop app (main process, preload, build config)
```

## Data model

The domain is fully typed in [`lib/types.ts`](lib/types.ts). The atom is `AISystem`, which
embeds `PerformanceSummary`, `DriftSummary`, `FairnessSummary`, `HumanBehaviorSummary`,
`ROISummary`, `ValidationSummary`, and `ModelVersion[]`. Time series are generated
deterministically from a seeded PRNG anchored to a fixed demo clock, so the dataset is stable
across reloads.

## Note

Ward is a prototype. All patient data is synthetic, all organizations and vendors are
fictional, and nothing here is a medical device or clinical decision-support tool. It is a
demonstration of what an AI control plane for a healthcare enterprise looks like.
