# Strata Console — living evidence intelligence

*The B2B product: a mission-control dashboard that turns a standing clinical question into
a continuously-graded, continuously-watched systematic review.*

This is the wedge from [`vision.md`](vision.md), built. Where **Strata Lite** answers one
question for one person (the B2C surface), **Strata Console** is the operator's console for
a team whose job is defensible evidence — medical affairs, guideline groups, value &
access, and hospital evidence offices.

---

## What a "living review" is

A one-off literature answer is stale the moment it prints. A living review is a **protocol**
— a question, the evidence levels to admit, an optional recency floor — that Strata keeps
fresh. Each **sync** re-runs the protocol against current literature, re-grades everything,
and **diffs against the last sync** so the team sees exactly what moved:

- a new trial or meta-analysis entered the evidence base;
- the overall certainty shifted (e.g. *weak → moderate*);
- studies dropped out of the included set.

That "what changed since last time" is the thing worth paying for. It converts a periodic,
6–12-month manual systematic review into a standing, always-current instrument.

```bash
strata review create --title "SGLT2 inhibitors & heart failure" \
    --question "Do SGLT2 inhibitors reduce heart-failure hospitalization?" --levels 1,2,3
strata review sync <id>     # → "certainty moved moderate → high · NEW: pooled RCT (n=21,947)"
```

## The surfaces

`strata serve` opens both:

| Surface | Route | Audience | Job |
|---|---|---|---|
| **Console** | `/` | clinical evidence teams (B2B) | operate a portfolio of living reviews |
| **Lite** | `/lite` | anyone (B2C) | ask one question, get the honest answer |

Both are standard-library only — no CDN, no fonts to fetch, no libraries — so they run on a
locked-down hospital network, and fully offline in demo mode.

## What the Console shows

Every panel is hand-drawn on Canvas/SVG; nothing is fetched from outside.

- **Evidence-focus anatomy** — a live 3-D model of the body; glowing pins mark the organ
  systems this body of *evidence* concerns, sized by share of signal and coloured by
  certainty. It is a map of the literature, **not a patient**.
- **Certainty gauge** — a GRADE-style dial (very low → high) for the body of evidence.
- **Living-evidence curve** — studies accrued over time, with the certainty reached at each
  step: you can watch the evidence base mature.
- **Forest plot** — extracted effect sizes with 95% CIs against the no-effect line; effects
  whose interval crosses 1 render as null. *(Effect extraction is heuristic — verify against
  the sources; the UI says so.)*
- **PRISMA flow** — identified → screened → included, with what each filter excluded.
- **Evidence pyramid** — how many included studies landed at each level.
- **Surveillance timeline** — the sync history and the "what changed" feed.
- **Graded sources** — every included study, strongest first, with its grade, effect chip,
  and a PubMed link.
- **Plain-language toggle** — swaps every readout to lay terms (patient-facing / exec use).

## How it's built

```
strata/
  review.py     # Protocol, run_protocol (search→grade→include→PRISMA→effects→cumulative→
                #   hotspots), diff_snapshots (surveillance), store-backed create/sync/view
  anatomy.py    # clinical language → body regions with 3-D coordinates + intensity
  store.py      # bounded JSON history per review under $STRATA_HOME (~/.strata)
  demo.py       # three reproducible reviews, each with a real "what changed" story
  pages.py      # CONSOLE_HTML (dashboard) + LITE_HTML, zero external deps
  server.py     # /api/reviews, /api/review, /api/review/run, /api/review/new, /api/ask
```

The pipeline reuses the honest core (`evidence.py` grading, `query.py` ranking). Every
network touch takes an injectable `_search`, so the whole thing runs — and is tested —
offline (`tests/test_review.py`).

### API (powers the Console, and anything else)

```
GET /api/reviews            all living reviews + status
GET /api/review?id=         one review's full render payload
GET /api/review/run?id=     re-sync, return the fresh payload + surveillance
GET /api/review/new?q=...   create a review + first sync
GET /api/ask?q=             one-shot graded answer (Lite)
```

## Why this is the fundable wedge

- **Whitespace.** The incumbents split the job in two and leave the middle open: reference
  tools (UpToDate, DynaMed) are human-curated and *not living*; systematic-review tooling
  (DistillerSR and friends) automates screening but stops at a static document; the LLM
  wave answers fluently but **can't be audited**. Nobody owns *continuously-graded, always-
  current, fully-traceable* evidence as a product. Strata does.
- **Value & buyer.** Hospitals, health systems, and life-sciences teams already staff and
  budget literature surveillance and evidence synthesis. A standing instrument that collapses
  months to minutes, with a citation audit trail, is a line item they understand.
- **Unicorn shape.** The living-review store is a compounding, graded **evidence graph**; the
  same engine becomes an **API** other health-AI products embed to stay grounded and honest.
  A data asset and infrastructure, not a single app.
- **Non-legal by construction.** Strata grades **published literature** for decision support.
  It is not a medical device, handles **no patient data**, and does not diagnose, treat, or
  advise — the anatomy view maps evidence, not a person. That keeps it clear of device
  regulation and clinical liability, and aligns with the FDA's non-device
  clinical-decision-support criteria (transparent basis, independently reviewable, not
  time-critical). *(Framing, not legal advice — counsel gates each market.)*

## Try it

```bash
strata demo        # seed three reproducible reviews (offline)
strata serve       # open http://127.0.0.1:8600/  → the Console
```
