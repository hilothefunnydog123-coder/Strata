# Strata — Roadmap to a category-defining company

This is the founder's-eye view: what we're building, where the foundation stands
today, and the sequence that turns it into infrastructure the industry depends on.

## The category

Not "AI search for papers." Not "a medical chatbot with citations." Not "an AI
systematic-review tool." Those are crowded.

Strata is **Continuous Evidence Intelligence**: the independent layer that tells
an organization whether the medical claims it relies on are still supported by the
evidence — and alerts it when that changes.

The core object is the **claim**, not the paper. The product answers a question no
incumbent does: *"We have 10,000 claims that matter to us. What supports them, what
contradicts them, how strong is the evidence, and what changed this week?"*

## Why this wins where a better chatbot loses

A doctor-facing evidence chatbot is a category with a well-funded incumbent and
pharma-subsidized free distribution you cannot out-spend. Answering a question once
is a feature, not a moat.

Strata's defensible surface is different:

- **The buyer has budget and a compliance need.** Pharma medical affairs / HEOR,
  guideline and HTA bodies, payers, hospitals, and medical-AI companies all need
  *defensible, auditable, monitored* evidence — not a vibe. That is a B2B product
  with real ACV, not an ad-subsidized consumer app.
- **The asset compounds.** Every monitored claim adds to a versioned graph of
  *what the evidence said and when it changed*. Nobody else keeps that history.
- **The wedge is monitoring, not answering.** "Answer this" is a commodity.
  "Tell me the instant this claim weakens" is a subscription.

## Where the foundation stands today

Built and tested (stdlib-only, honest, real):

| Capability | Status |
|---|---|
| Claim-centered data model with **versioned history** | ✅ `db.py` |
| Strata Verify pipeline (PICO → multi-source retrieval → extract → grade → **contradiction** → transparent GRADE-style assessment → auditable verdict) | ✅ `verify.py` and friends |
| **Contradiction engine** with attributed reasons for disagreement | ✅ `contradiction.py` |
| **Evidence-change engine**: monitor, diff, change events, alerts, trend | ✅ `monitor.py`, `claims.py` |
| Multi-source retrieval (PubMed, Europe PMC, OpenAlex), parallel + deduped, PRISMA counts, graceful degradation | ✅ `sources/` |
| Provenance-tagged extraction (reported/heuristic/inferred) | ✅ `extract.py` |
| Enterprise **Console** (evidence health, what-changed, alerts, filters, claim timeline) | ✅ `web.py` |
| **API** with hashed keys, scopes, rate limiting, usage logging | ✅ `api.py`, `server.py` |
| Pluggable model layer with deterministic fallback | ✅ `models.py` |
| Accessibility (WCAG 2.2 AA target), light/dark, keyboard, data-bound charts | ✅ `web.py` |

This is a genuine end-to-end vertical slice of the company — not mockups. What's
deliberately *not* done yet is called out honestly below.

## Development priorities (and what "done" means for each)

**P1 — Make Strata Verify genuinely real.** ✅ done as a foundation.
Next: full-text extraction where OA PDFs exist; risk-of-bias instruments (RoB 2,
ROBINS-I); effect-size normalization and light meta-analytic pooling; retraction
and predatory-journal signals (Retraction Watch, Crossref).

**P2 — Claim-centered evidence model.** ✅ done.
Next: claim collections/portfolios; bulk import (CSV / label claims / guideline
statements); internal-corpus ingestion behind a hard tenancy boundary.

**P3 — Evidence-change monitoring.** ✅ done.
Next: a real scheduler/worker (currently `run_due` on demand); **webhooks** for
change events; per-population and safety-signal alert conditions; digest emails.

**P4 — Enterprise Console.** ✅ done as a single-workspace demo.
Next: multi-tenant auth (SSO/SAML), RBAC, saved views, therapeutic-area rollups,
export (PDF/CSV evidence dossiers), audit-log UI.

**P5 — The API.** ✅ done.
Next: OpenAPI spec + client SDKs (Python/TS), webhooks, batch verify, sandbox keys.

**P6 — Enterprise integrations & advanced security.** Next up.
SOC 2 program, HIPAA-oriented controls once internal data is in scope, encryption
at rest, tenant isolation, DPA/BAA readiness. No compliance is *claimed* until it
exists.

## The moat

Not "we can search PubMed" — that is not defensible. The moat is a **continuously
evolving, historically versioned map of medical claims and the evidence behind
them**, plus the feedback loop on top of it:

- The `claim_versions` + `change_events` timeline is proprietary from day one and
  grows with every monitored claim and every week that passes.
- Expert-in-the-loop corrections to stances and grades create the only large,
  structured, GRADE-labelled corpus of claim↔evidence relationships — training data
  no competitor can buy.
- Over time the graph learns which evidence is reliable, which studies are
  repeatedly contradicted, which claims are unstable, and which populations lack
  evidence entirely.

## Regulatory posture

Deliberately on the **reference / evidence-synthesis** side of the line, like the
established point-of-care references — not patient-specific clinical decision
support. Strata verifies *claims against literature*; it does not diagnose or
recommend treatment for an individual. This keeps us out of SaMD/510(k) territory
while we build, and it matches the product: every output already says "decision
support, not medical advice." If we ever cross into patient-specific guidance, that
is a separate, deliberate product with its own QMS and clinical validation.

Trust is also GTM in medicine: publish a peer-reviewed validation of the grader and
contradiction engine against human GRADE assessments, and a citation-faithfulness
benchmark. Credibility is a moat here.

## Business model

Land on a wedge, expand across the organization.

| Tier | Price | Shape |
|---|---|---|
| Starter evidence monitoring | $25k–$75k / yr | one therapeutic area, N claims |
| Department | $100k–$300k / yr | multiple areas/teams, Console, alerts |
| Enterprise | $500k+ / yr | org-wide, SSO/RBAC, integrations, SLAs |
| API | usage-based | for medical-AI companies verifying generated claims |

The architecture already supports the expansion motion: multiple workspaces and
therapeutic areas, per-key rate limits and usage logging for billing, and
org-level analytics.

## The path to $1B

A ~$1B outcome needs a credible path to ~$100M ARR. Two non-exclusive routes:

1. **Enterprise evidence monitoring** — ~300 department/enterprise accounts at a
   ~$300k blended ACV ≈ $90M ARR. The buyers (pharma med-affairs/HEOR, guideline
   bodies, payers, large health systems) exist, have budget, and feel the pain of
   evidence surveillance done by hand.
2. **The verification API** — priced per call to the fast-growing set of medical-AI
   builders who must ground and *verify* generated claims. This rides someone
   else's growth and compounds with the moat.

Both routes strengthen the same graph, which is the point.

## Team to build

The engine is real; the gap is credibility and distribution. Highest-leverage
early hires/founders: a respected **clinical evidence methodologist** (a
guideline-panel or Cochrane/GRADE veteran) to co-sign the science and open doors, a
**medical-affairs/HEOR go-to-market** leader who has bought tools like this, and
platform engineers for tenancy, scheduling, and integrations. A solo engineer
without clinical authority does not get bought in this market.

## Near-term execution order

1. Land 2–3 **design partners** (a specialty-society guideline group, a pharma
   med-affairs team, a medical-AI company) — one claim portfolio each.
2. Ship the **scheduler + webhooks** so monitoring is truly continuous, not on-demand.
3. Add **full-text + risk-of-bias + retraction signals** to deepen the assessment.
4. Multi-tenant auth + RBAC + export → sellable Console.
5. Publish the **validation study**; stand up the **SOC 2** program.
6. OpenAPI + SDKs; turn the API into a self-serve funnel for medical-AI builders.

The north star: the independent evidence-verification and evidence-change layer
used by medical-AI systems, hospitals, pharma, and healthcare organizations
worldwide. Strata doesn't just tell you what the evidence says — it tells you
whether the evidence still supports what you believe.
