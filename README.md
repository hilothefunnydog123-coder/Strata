# Strata

**Continuous evidence intelligence — the verification layer for medical AI.**

Medical evidence changes every day; the systems that rely on it update periodically. Strata
closes that gap. Send it a claim, and it traces the claim to the underlying research, grades
how strong the evidence is *with an inspectable GRADE*, explains why supporting and
contradicting studies disagree, and then **watches** the claim — versioning it and alerting
you the moment the evidence materially changes, with a citation trail for every word.

> Stripe processes payments. **Strata processes medical evidence.**

The future of medicine will run thousands of AI systems — AI doctors, radiologists,
drug-discovery agents, scribes, patient bots — all generating claims like *"this treatment
is effective for this population."* Today companies ship **AI → answer**. Medicine needs
**AI → answer → independent evidence verification.** That layer is the whitespace. Strata
is built to be it.

```bash
pip install strata-evidence

strata verify "Metformin reduces cardiovascular mortality in type 2 diabetes"
strata serve       # web app + Verify API on http://127.0.0.1:8600
```

## The Evidence Receipt

Every claim Strata checks produces a standardized, portable **receipt** — simple enough for
a person, structured enough for a machine to embed:

```
┌──────────────────────────────────────────────────────────────┐
│ STRATA EVIDENCE RECEIPT                                       │
│ STR-8F42A1C9                                                  │
├──────────────────────────────────────────────────────────────┤
│ Claim: Metformin reduces cardiovascular mortality in type 2… │
│                                                              │
│ Evidence: SUPPORTED  ·  MODERATE                             │
│ 4 supporting   0 contradicting   1 neutral                  │
│ Strongest: Systematic review / meta-analysis (2020)         │
│ Limitation: Rests largely on observational and older trials │
│ Last checked: 2026-07-23   Evidence changed: no             │
└──────────────────────────────────────────────────────────────┘
```

It is a transparent appraisal of **published evidence**, never a claim of absolute truth —
and the receipt says so.

## The core object: a versioned Claim

Strata treats every medical claim as a **first-class, versioned object** — not a search query.
Each claim lives in an object graph and carries its own history:

```
Organization → Workspace → Therapeutic Area → Claim → Claim Version
                                                 ↓         ↓
                                          Alert Rules   Evidence (graded studies)
                                                 ↓         ↓
                                     Evidence Change Event → Alert
```

Every *material* change in a claim's evidence creates a new **version**; version diffs are
mined into structured **change events**; events that cross a claim's **alert rules** (new
meta-analysis, new RCT, new contradiction, strength/status change, safety signal, effect
drift) become **alerts** with signed-webhook delivery. It is *version control for medical
knowledge* — and the accumulating evidence-change history is the long-term data asset.

## Three products, one evidence engine

| | | |
|---|---|---|
| **Strata Verify** · API + demo | Send a claim → get a graded Evidence Receipt. | The high-margin core: a software API, usage-priced. |
| **Strata Console** · Evidence Health | *What changed in our evidence base?* — versioned claims, alerts, timelines, per-area rollups. | For pharma, hospitals, payers, AI companies. |
| **Strata API** · infrastructure | Verify + monitor from code; signed change webhooks; an embeddable **Seal** trust badge. | The independent evidence layer for medical AI. |

## The API

Generate a working key, then verify anything:

```bash
curl -X POST http://127.0.0.1:8600/v1/keys -d '{"label":"my app"}'      # -> sk_live_...

curl -X POST http://127.0.0.1:8600/v1/verify \
  -H "Authorization: Bearer $STRATA_KEY" \
  -d '{"claim":"SGLT2 inhibitors reduce heart-failure hospitalization"}'
```

Every verification fans out across **PubMed, Europe PMC, ClinicalTrials.gov, OpenAlex, and
Crossref** (all free, keyless), deduplicated and graded in one pass, with citation counts and
source provenance on every receipt. `POST /v1/compare` weighs two claims against each other.

```python
from strata_client import Strata            # clients/python/strata_client.py — zero deps
strata = Strata(api_key="sk_live_...")

r = strata.verify("SGLT2 inhibitors reduce heart-failure hospitalization")
if r["status"] in ("Mixed", "Contradicted"):
    flag_answer(r)                            # gate your AI's response

claim_id = strata.monitor(r["claim"])["id"]   # watch it forever
for event in strata.check(claim_id)["change"]["events"]:
    print(event["text"])                      # "Certainty upgraded: moderate → high"
```

Claim-centered endpoints: `POST/GET /v1/claims` · `GET /v1/claims/<id>(/recheck|/history)` ·
`GET /v1/changes` (the evidence-change feed) · `GET /v1/evidence/<id>` · `GET /v1/console/summary`
(Evidence Health) · `GET /v1/alerts(/<id>/ack)` · `GET/POST /v1/webhooks` (signed). Plus
`POST /v1/verify(/stream|/batch)` · `POST /v1/compare` · `POST /v1/keys` · `POST /v1/cohort` ·
`GET /v1/seal/<id>.svg` (public badge). Full reference lives at **`/docs`** (a real developer
platform, served by the app) · schema in **[`docs/api.md`](docs/api.md)** · step-by-step:
**[`docs/integration.md`](docs/integration.md)**.

Optional AI (`strata.llm`) sharpens borderline stance calls using any OpenAI-compatible
free tier (Groq, Gemini); it only ever sees public abstracts and is never the source of a
fact. Without it, the transparent heuristic still runs.

Every verification runs an explicit, auditable **pipeline** — understand → expand → retrieve
→ dedup → rank → classify → extract → contradiction → grade → synthesize → audit — routed
through a per-task **model-abstraction layer** (strong tier for reasoning, cheap tier for
mechanical steps, free/local fallback). Each receipt carries a **PICO** breakdown, a
calibrated **confidence** (0–1), **effect estimates**, and a full **audit trail**. Stream it
stage-by-stage with `POST /v1/verify/stream` (newline-delimited JSON) for a progressive UI.

## The killer feature: *what changed*

Medical evidence is never final. A monitored claim is re-checked on a schedule and every
change is pushed:

- 🟢 **Upgraded** — a new Phase III trial moves certainty *moderate → high*.
- 🟠 **Conflict** — a new cohort contradicts consensus; status *Supported → Mixed*.
- 🔴 **Weakening** — new safety data introduces a serious limitation.

This is the difference between a static report and living infrastructure.

## Run it

```bash
strata demo        # seed reproducible reviews + monitored claims (offline)
strata serve       # http://127.0.0.1:8600
```

Surfaces served: **`/`** landing · **`/app`** the Verify demo (paste a claim, watch the
pipeline stream) · **`/console`** the **Evidence-Health dashboard** (what changed, per-area
rollups, filterable claims, per-claim dossiers with the GRADE rationale + contradiction
analysis) · **`/search`** the live streaming evidence search · **`/why` `/pricing` `/trust`
`/security`** the company site · **`/docs`** the developer platform · **`/lite`** the simple
ask-one-question page.

```bash
strata console     # the Evidence-Health rollup in your terminal
strata changes     # the recent evidence-change alert feed
```

## Self-host / download (for businesses)

Strata reads only **public literature**, so no patient data (PHI) ever leaves your network —
it self-hosts cleanly on-prem.

```bash
STRATA_API_KEYS=sk_live_your_key docker compose up --build   # → http://localhost:8600
```

Or install the wheel (`pip install strata-evidence`) and run `strata serve --host 0.0.0.0`.
Set `STRATA_API_KEYS` (comma-separated) to require an API key; leave it unset for an open
private-network deployment. The self-hosted **platform** (`/platform`) ships with the API
integrated and lets you **import your population** (ages, medications, conditions) so verdicts
flag generalizability to *your* patients. Cohort data is aggregated locally and **never
leaves the box**. Details: **[`docs/self-hosting.md`](docs/self-hosting.md)**.
SDKs: [`clients/python`](clients/python/strata_client.py) · [`clients/js`](clients/js/strata.js).

## How the grading works

Each retrieved study is placed on the evidence hierarchy (Oxford CEBM / GRADE, simplified) —
meta-analysis → RCT → cohort → case report — then adjusted for sample size and recency. For
a claim, each study's extracted effect is classified **supporting / contradicting / neutral**
relative to what the claim asserts, weighted by evidence strength, and aggregated into a
status (*Supported / Mixed / Contradicted / Insufficient / Unsupported*) and a certainty.

The certainty is **inspectable**: it breaks into GRADE-style domains (design, consistency,
directness, precision, recency, replication) rated from the actual studies, with plain-language
`+` upgrades and `−` limitations. When studies disagree, a **contradiction engine** names the
likely reason — different populations, doses, follow-up, designs, or plain statistical
uncertainty — citing the studies that show each difference, and labels a genuinely unexplained
conflict as unresolved rather than averaging it away. It is a transparent heuristic — decision
support, not a substitute for reading the papers, and not medical advice.

## Not a medical device

Strata is **medical evidence infrastructure**. It appraises published literature for
decision support: it is **not a medical device**, handles **no patient data**, and does not
diagnose, treat, advise, or determine truth. Every claim links to its primary sources for
independent review. *(Framing, not legal advice.)*

## Docs

- [`docs/api.md`](docs/api.md) — full API reference + Evidence Receipt schema.
- [`docs/integration.md`](docs/integration.md) — step-by-step: key, verify, gate, monitor, cohort.
- [`docs/self-hosting.md`](docs/self-hosting.md) — Docker / on-prem / keys / AI / cohort / SMTP.
- [`docs/strategy.md`](docs/strategy.md) — the verification-layer thesis and the unicorn case.
- [`docs/console.md`](docs/console.md) — the Monitor console & living-review engine.
- [`docs/vision.md`](docs/vision.md) · [`docs/pitch.md`](docs/pitch.md) — company strategy & positioning.

## License

MIT © 2026 Neil Gilani
