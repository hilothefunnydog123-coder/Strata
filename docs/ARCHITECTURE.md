# Strata — Architecture

Strata is the foundation of an **evidence-verification and evidence-change
monitoring layer** for medicine. This document describes how the system is built
and why the boundaries are where they are.

Design principles:

1. **The claim is the core object**, not the paper. Everything is organized so a
   claim can be verified, versioned, and monitored over time.
2. **Honesty is enforced in code.** Provenance tags, abstract-level labelling,
   graceful degradation, and "absence is stated" are structural, not stylistic.
3. **Standard library only.** Zero runtime dependencies keeps the engine
   auditable, portable, and trivially deployable. `sqlite3` gives real relational
   persistence and a genuine audit trail; `http.server` serves the app and API.
   The access layer is deliberately thin so Postgres is a driver swap, not a
   rewrite.
4. **Transport-agnostic core.** The pipeline and API handlers are pure functions;
   HTTP is a thin adapter. This makes everything testable without a network.

## The pipeline (Strata Verify)

```
question / claim
  │
  ├─ pico.py            structure → PICO (population/intervention/comparator/outcome)
  │                     + recall-first query expansion (light synonyms)
  ├─ sources/           parallel multi-source retrieval → dedupe (DOI→PMID→title)
  │     pubmed          → RetrievalResult with PRISMA counts + per-source errors
  │     europepmc
  │     openalex
  ├─ extract.py         per study: design, n, effect+CI, p, follow-up, population,
  │                     funding, COI — every field provenance-tagged
  ├─ evidence.py        study-design grading on the evidence pyramid
  ├─ contradiction.py   stance vs the claim (support / contradict / neutral)
  │                     + attributed reason for disagreement
  ├─ assess.py          transparent GRADE-style strength across domains,
  │                     with + reasons and - limitations
  └─ verify.py          orchestration → Verdict (+ full audit trail + fingerprint)
```

The `Verdict` is the unit of output: PICO, expanded query, per-study evidence
lines (each with stance, grade, effect, population match), the transparent
assessment, the retrieval PRISMA, and an ordered audit trail. `Verdict.to_dict()`
is the API/JSON contract; `verify.fingerprint` is a stable hash of the evidence
set and each study's directional read — the signal the monitor diffs on.

## The claim-centered data model (the moat)

```
Organization → Workspace → TherapeuticArea → Claim
                                               │
                                    ┌──────────┼───────────┐
                              ClaimVersion  EvidenceItem → Study
                              (timeline)    (stance, effect, grade, pop-match)
                                               │
                                        ChangeEvent → Alert
                              Monitor ──────────┘
```

- **Claim** is first-class: text + PICO + current status/strength/trend/version.
- **ClaimVersion** is written every time the evidence changes materially. This
  append-only timeline — *what the evidence said and when it changed* — is the
  asset a competitor can't clone by also calling PubMed.
- **Study** is a de-duplicated bibliographic record shared across claims;
  **EvidenceItem** links a claim (at a version) to a study with the per-claim
  analysis.
- **Monitor / ChangeEvent / Alert** implement continuous monitoring.
- **ApiKey / ApiUsage / DemoRequest** back the platform.

`db.py` is the single data-access layer (thread-safe over one SQLite connection,
WAL for file DBs). Every query is parameterized.

## The change engine (the enterprise product)

```
run_monitor(claim)
  → verify(claim.text, claim_population=claim.PICO)
  → claims.ingest(verdict):
       first run   → baseline (version 1)
       later runs  → diff vs previous version:
                       added studies (new_rct / new_meta_analysis / new_study)
                       new contradictions
                       strength change (up/down)   status change
                     material?  → new version + change events + alerts + trend
                     no change? → touch last_verified, no new version
  → reschedule (daily/weekly/monthly)
```

Alerts are raised for high-impact events, filtered by the monitor's configured
conditions. This is "CI for medical knowledge": the claim is the build, new
literature is the commit, a weakening result is a failing check.

## Surfaces

- **`web.py`** — accessible (WCAG 2.2 AA target) marketing page, Strata Verify,
  and the Console dashboard. Static shells; all data via `/app/*` JSON endpoints,
  so every chart is bound to real pipeline output. Light/dark, reduced-motion,
  keyboard-operable, text-not-color-alone, visually-hidden data tables behind
  charts.
- **`api.py` + `server.py`** — the `/v1/*` API behind hashed keys with scopes,
  per-key rate limiting, and usage logging. Security headers, body-size limits,
  no secrets client-side, org-scoped authorization on claim access.
- **`cli.py`** — verify, serve, seed, claim, monitor, apikey.

## The model layer

`models.py` is a per-task router (`expand`, `classify`, `extract`, `contradict`,
`synthesize`). Models are injected `str -> str` callables — no vendor SDKs, no
hardcoded providers. Every task degrades to a deterministic path when no model is
registered or a model errors. **A model never originates a medical fact**; it only
restructures retrieved text, and the output says whether it's a grounded digest or
a model narrative.

## What is intentionally *not* here yet

Honestly scoped for a foundation, not claimed as done: hosted multi-tenant auth
(SSO/RBAC beyond org-scoping), webhooks for change events, full-text extraction,
risk-of-bias instruments (RoB 2 / ROBINS-I), meta-analytic pooling, and the
remaining data-source adapters (ClinicalTrials.gov, Crossref, guideline
libraries, Retraction Watch). The architecture is built so each is an additive
module. See [`ROADMAP.md`](ROADMAP.md).

## Testing

`tests/` is stdlib-only and never touches the network — retrieval is injected and
source adapters are tested against fixture payloads. `python tests/run.py` runs
the pipeline, monitoring, API, and source suites plus the original grader tests.
