# Strata

**The verification layer for medical AI.**

Strata checks whether an AI's medical claims are actually supported by science. Send it a
claim, and it traces the claim to the underlying research, grades how strong the evidence
is, surfaces contradicting studies, and continuously alerts you when the evidence changes —
with a citation trail for every word.

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

## Three products, one evidence engine

| | | |
|---|---|---|
| **Strata Verify** · API | Send a claim → get a receipt. | The high-margin core: a software API, usage-priced. |
| **Strata Monitor** · dashboard | Watch thousands of claims; get *what changed* alerts. | For pharma, hospitals, payers, AI companies. |
| **Strata Seal** · trust mark | An embeddable "Evidence Verified" badge. | Like SSL — for medical claims. |

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

Endpoints: `POST /v1/verify` · `POST /v1/compare` · `POST /v1/keys` · `POST /v1/cohort` ·
`GET /v1/monitor(/register|/check|/get)` · `GET /v1/receipt/<id>` · `GET /v1/seal/<id>.svg`
(public badge). Full reference: **[`docs/api.md`](docs/api.md)** · step-by-step:
**[`docs/integration.md`](docs/integration.md)**.

Optional AI (`strata.llm`) sharpens borderline stance calls using any OpenAI-compatible
free tier (Groq, Gemini); it only ever sees public abstracts and is never the source of a
fact. Without it, the transparent heuristic still runs.

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

Surfaces served: **`/`** landing · **`/app`** the Verify + Monitor demo (paste a claim) ·
**`/console`** the Monitor console (therapeutic-area view, with a live evidence map) ·
**`/lite`** the simple ask-one-question page.

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
status (*Supported / Mixed / Contradicted / Insufficient / Unsupported*) and a certainty. It
is a transparent heuristic — decision support, not a substitute for reading the papers, and
not medical advice.

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
