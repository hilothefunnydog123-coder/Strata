# Strata

**Continuous Evidence Intelligence for medicine.**

Strata doesn't just tell you what the evidence says. It tells you whether the
medical claims you rely on are *still supported* by the evidence — and alerts you
the moment that changes.

The core object in Strata is not the paper. It is the **claim**.

```
CLAIM
  → relevant evidence → supporting studies → contradicting studies
  → study quality → population / context → evidence strength
  → change over time → auditable conclusion
```

```bash
pip install strata-evidence

strata verify "Does Treatment X reduce hospitalization in elderly heart failure?"
strata serve      # web app + API + Console at http://127.0.0.1:8600
```

## What it does

Ask whether a claim holds, and Strata runs a transparent pipeline:

1. **Structures** the question into PICO (population, intervention, comparator, outcome).
2. **Searches** biomedical literature across sources (PubMed, Europe PMC, OpenAlex) in parallel.
3. **De-duplicates** by DOI / PMID / title and records PRISMA counts.
4. **Extracts** structured evidence from each study — design, sample size, effect
   estimate + CI, p-value, follow-up, population, funding, conflicts — with a
   `provenance` tag on every field (`reported` / `heuristic` / `inferred`).
5. **Grades** each study on the evidence pyramid.
6. **Separates** the studies that *support* the claim from the ones that
   *contradict* it — and attributes *why* they disagree (population, dose,
   outcome, design, statistical uncertainty, or genuine scientific conflict).
7. **Assesses** overall strength transparently, GRADE-style, with inspectable
   `+ reasons` and `- limitations`.
8. Returns an **auditable verdict** — every step is in the trail.

```
CLAIM  Does Treatment X reduce hospitalization in elderly heart failure?
[PARTIALLY SUPPORTED]  MODERATE CERTAINTY

The claim is partially supported — moderate certainty. 2 supporting vs 1
contradicting study(ies); strongest design is a systematic review / meta-analysis.

Why this grade:
  + Strongest supporting evidence is a systematic review / meta-analysis
  + Direct evidence in the claim's population
  - 1 comparable-quality study(ies) contradict the claim

▲ supports     Meta-analysis · 2021   Treatment X reduces hospitalization…
▼ contradicts  RCT · 2025             Large trial finds no reduction…  (genuine disagreement)
```

## Version control for medical knowledge

Register a claim for monitoring and Strata watches the literature. When a new
study lands, it re-verifies, diffs against the stored evidence base, and — if the
evidence changed materially — writes a new claim version, records a change event,
and raises an alert with a recommended action.

```
CLAIM      Treatment X reduces hospitalization in elderly heart failure
STATUS     PARTIALLY SUPPORTED        (was: SUPPORTED)
STRENGTH   MODERATE                   (was: HIGH)
TREND      ↓ WEAKENING
WHAT CHANGED   A new randomized controlled trial found no reduction.
SUPPORTING 2 studies   CONTRADICTING 1 study
ACTION     Review the claim and affected materials.
```

Every conclusion stays auditable, and the versioned history — *what the evidence
said, and when it changed* — accrues as a durable data asset.

## The Console

`strata serve` opens a dashboard built for teams: what changed this week, which
claims strengthened, which weakened, which are newly contradicted, filtered by
therapeutic area, status, strength, and change type. The demo workspace is
clearly-labelled synthetic data run through the real engine.

## The API

The same engine behind real, hashed API keys — for medical-AI companies verifying
generated claims, and for teams wiring monitoring into their systems.

```bash
curl https://your-host/v1/verify -H "Authorization: Bearer sk_live_..." \
  -H "Content-Type: application/json" \
  -d '{"claim": "Treatment X reduces hospitalization", "population": "Adults over 65"}'
```

```
POST /v1/verify   POST /v1/search   POST /v1/compare   POST /v1/monitor
GET  /v1/claims/:id   GET /v1/changes
```

See `/docs` when the server is running, or [`docs/API.md`](docs/API.md).

## Honest by design

The thing that makes AI dangerous in medicine is confident fabrication. Strata is
built to be the opposite, and the honesty is enforced in code, not promised in prose:

- **Real sources only.** Every claim is anchored to specific retrieved papers.
- **Provenance on every extracted field.** Reported vs. heuristically-inferred vs.
  model-inferred are never silently mixed; a field the text doesn't contain is
  "not reported", never guessed.
- **Abstract-level is labelled as such.** Strata never claims to have read full
  text it didn't retrieve.
- **Absence is stated, not filled.** No retrieved studies → it says so.
- **The grade is inspectable.** Strength comes from transparent domains you can open.
- **Graceful degradation.** If a source is unreachable it's reported, not hidden.

Strata is decision support from public literature — **not medical advice**, and
not a substitute for reading the primary sources.

## Bring your own model (optional)

Strata is stdlib-only and runs with no model at all — the default output is a
grounded, deterministic digest. Register any `str -> str` callable per task
(`expand`, `classify`, `extract`, `contradict`, `synthesize`) to add a narrative
layer; the model only ever restructures retrieved text, and the system falls back
to deterministic heuristics if it's absent or errors.

```python
from strata import ROUTER, verify
ROUTER.register("synthesize", my_llm)     # any text-in/text-out function
v = verify("Does metformin reduce cardiovascular mortality in type 2 diabetes?")
print(v.status, v.evidence_strength)
```

## CLI

```bash
strata verify "<claim>"              # full evidence trail (--json for structured)
strata serve                         # web app + API + Console
strata seed                          # populate a synthetic demo evidence base
strata claim add "<claim>" --monitor # track a claim
strata monitor run --claim <id>      # re-verify; detect and alert on change
strata apikey create --org "Acme"    # mint an API key (shown once)
```

## Data, privacy, scope

Strata reads open bibliographic data (NCBI E-utilities, Europe PMC, OpenAlex). It
handles **no patient data**, needs no key to run (set `NCBI_API_KEY` /
`STRATA_CONTACT_EMAIL` to raise rate limits). Persistence is a single SQLite file.
Behind a school or corporate network that intercepts HTTPS, Strata already trusts
the OS certificate store; set `STRATA_CA_BUNDLE` to a PEM if needed.

See [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md) for the system design and
[`docs/ROADMAP.md`](docs/ROADMAP.md) for where this is going.

## License

MIT © 2026 Neil Gilani
