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
| `STRATA_CA_BUNDLE` | Custom CA bundle for TLS interception on managed networks. | OS trust store |

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
