# Self-hosting Strata

Strata is designed to run inside your own environment. It reads only **public literature**
(PubMed via NCBI E-utilities), so **no patient data (PHI) ever passes through it** — which is
exactly what makes it easy for a hospital or pharma security team to approve.

Standard library only: no database to operate, no model weights to download, no GPU.

## Option A — Docker (recommended)

```bash
STRATA_API_KEYS=sk_live_change_me docker compose up --build
```

Open `http://localhost:8600/`. The API is at `POST /v1/verify`. Persistent state (monitored
claims + living reviews) lives in the `strata-data` volume.

Single container without compose:

```bash
docker build -t strata .
docker run -p 8600:8600 -v strata-data:/data \
  -e STRATA_API_KEYS=sk_live_change_me -e STRATA_TENANT="Your Health System" strata
```

## Option B — pip / wheel

```bash
pip install strata-evidence          # from PyPI
# or from a built wheel:  pip install dist/strata_evidence-0.3.0-py3-none-any.whl

STRATA_API_KEYS=sk_live_change_me strata serve --host 0.0.0.0 --port 8600
```

`make build` produces the wheel + sdist in `dist/`; `make wheel` builds just the wheel.

## Configuration (environment variables)

| Variable | Purpose | Default |
|---|---|---|
| `STRATA_API_KEYS` | Comma-separated API keys. **Unset ⇒ open** (private network only). | *(unset)* |
| `STRATA_HOME` | Where monitored claims + reviews persist. | `~/.strata` (`/data` in Docker) |
| `STRATA_TENANT` | Display name in the console / monitor board. | `Meridian Health (demo)` |
| `NCBI_API_KEY` | Raise the PubMed rate limit (3 → 10 req/s). | *(unset)* |
| `STRATA_ADMIN_KEY` | If set, required (via `X-Admin-Key`) to create API keys. | *(unset, open)* |
| `STRATA_SOURCES` | Comma list of enabled sources (`pubmed,europepmc,clinicaltrials,openalex,crossref`). | first four |
| `STRATA_CONTACT_EMAIL` | Contact for the OpenAlex/Crossref polite pool. | placeholder |
| `STRATA_LLM_BASE_URL` / `STRATA_LLM_KEY` / `STRATA_LLM_MODEL` | Optional AI (any OpenAI-compatible endpoint). | Groq defaults |
| `STRATA_SMTP_HOST` / `_PORT` / `_USER` / `_PASS` / `_FROM` | Email demo requests to the founder. | *(unset, stored locally)* |
| `STRATA_CA_BUNDLE` | Custom CA bundle for TLS interception on managed networks. | OS trust store |

## Data sources

One query fans out across **PubMed, Europe PMC, ClinicalTrials.gov, OpenAlex, Crossref** (all
free, no key), de-duplicated by DOI/PMID/title with citation counts merged. All are keyless;
set `NCBI_API_KEY` and `STRATA_CONTACT_EMAIL` to be a good citizen and lift rate limits. Choose
a subset with `STRATA_SOURCES`. Each source fails soft, so one being down never breaks a search.

## Optional AI (free tiers)

Set an OpenAI-compatible endpoint to sharpen borderline stance calls and (optionally) write a
plain-language synthesis. Free tiers that fit a pre-VC runway:

```bash
# Groq
export STRATA_LLM_BASE_URL=https://api.groq.com/openai/v1
export STRATA_LLM_KEY=gsk_...   STRATA_LLM_MODEL=llama-3.3-70b-versatile
# Google Gemini (OpenAI-compatible endpoint)
export STRATA_LLM_BASE_URL=https://generativelanguage.googleapis.com/v1beta/openai
export STRATA_LLM_KEY=...        STRATA_LLM_MODEL=gemini-2.0-flash
```

The model only ever sees the claim and public abstracts. It never sees cohort/patient data,
and Strata records its verdict beside the transparent grade.

## Cohort import (population profiles)

`POST /v1/cohort` accepts patient rows (`age`, `medications`, `conditions`) and stores only the
**aggregate** profile under `STRATA_HOME`. Pass the cohort id to `/v1/verify` to get a
population-specific generalizability note. Cohort data is never transmitted to any external
source or model. This is decision support for a population, not a decision about an individual.

## Demo requests

`POST /v1/demo-request` records requests to `STRATA_HOME/demo_requests.jsonl` and, when SMTP is
configured, emails them. Set `STRATA_SMTP_HOST` (and friends) to enable delivery.

## Hardening for production

Strata's server is a lightweight app server, not a hardened edge. For a real deployment:

- **Terminate TLS and rate-limit at your gateway** (nginx / a load balancer / an API gateway).
  Strata has no built-in rate limiting or billing — meter usage at the edge.
- **Rotate `STRATA_API_KEYS`**; issue one key per client/tenant so you can revoke individually.
- **Run multiple replicas** behind the gateway; the store is a shared volume of JSON files, so
  for high write concurrency point `STRATA_HOME` at shared storage or run a single writer.
- **Back up `STRATA_HOME`** — it holds your monitored claims and their history.
- **Scheduled re-checks**: call `GET /v1/monitor/check?id=…` for each monitored claim from a
  cron / job runner to keep the "what changed" feed fresh (a built-in scheduler is on the
  roadmap).

## Verifying the install

```bash
strata demo                 # seed reproducible reviews + monitored claims
curl localhost:8600/v1/health
strata verify "Metformin reduces cardiovascular mortality in type 2 diabetes"
```
