# Strata API reference (v1)

The verification layer over HTTP. Standard-library server; run it with `strata serve`
(see [self-hosting](self-hosting.md)). Base URL below is the local default.

```
http://127.0.0.1:8600
```

New here? Start with the [integration guide](integration.md).

## Authentication

Generate a working key (returned once):

```bash
curl -X POST http://127.0.0.1:8600/v1/keys -d '{"label":"my app"}'
# { "key": "sk_live_...", "id": "key_...", "prefix": "sk_live_...abcd", "requests": 0 }
```

Send it on every `/v1/*` call (except the public Seal badge and `/v1/health`) as any of:

```
Authorization: Bearer sk_live_...
X-API-Key: sk_live_...
?key=sk_live_...
```

A generated key always authorizes and its usage is tracked. If `STRATA_API_KEYS` is set,
those keys work too and everything else is rejected; if it is unset, the API is open (fine
for a trusted private network). Key **creation** can be gated with `STRATA_ADMIN_KEY`.

## Data sources

Every verification fans out, in one pass, across **PubMed**, **Europe PMC**,
**ClinicalTrials.gov**, **OpenAlex**, and **Crossref**, then de-duplicates by DOI / PMID /
title and carries citation counts + source provenance. `GET /v1/sources` lists what is
enabled; set `STRATA_SOURCES` to choose.

## Endpoints

### `POST /v1/verify` — verify a claim
Body: `{"claim": "...", "cohort": "<optional cohort id>"}` (or `GET /v1/verify?claim=...`).
Returns an **Evidence Receipt**.

```bash
curl -X POST http://127.0.0.1:8600/v1/verify \
  -H "Authorization: Bearer $STRATA_KEY" \
  -d '{"claim":"Metformin reduces cardiovascular mortality in type 2 diabetes"}'
```

### `POST /v1/compare` — compare two claims
Body: `{"claim_a": "...", "claim_b": "..."}`. Returns two receipts plus which has the stronger
evidence base.

```jsonc
{ "winner": "a", "rationale": "...stronger evidence base (Supported, high, 5 supporting)...",
  "a": { /* receipt */ }, "b": { /* receipt */ } }
```

### `POST /v1/keys` · `GET /v1/keys` · `GET /v1/keys/revoke?id=`
Create (returns the raw key once), list (redacted, with usage), and revoke keys.

### `POST /v1/cohort` · `GET /v1/cohort`
Import a **local** population profile; list imported cohorts. Rows are reduced to aggregates
immediately and never transmitted anywhere.

```bash
curl -X POST http://127.0.0.1:8600/v1/cohort -H "Authorization: Bearer $STRATA_KEY" \
  -d '{"name":"clinic A","rows":[{"age":82,"medications":"metformin","conditions":"diabetes"}]}'
# -> { "id": "cohort-clinic-a", "profile": { "age_median": 82, "age_bands": {...}, ... } }
```

Pass the returned id as `cohort` to `/v1/verify` to get a population-specific
`population_note`.

### `GET /v1/monitor` · `/register?claim=` · `/check?id=` · `/get?id=`
Continuous claim watching. `register` and `check` return `{id, receipt, change}`, where
`change` is the "what changed" feed.

### `GET /v1/receipt/<id>` — a monitored claim's latest receipt

### `GET /v1/seal/<id>.svg` — public "Evidence Verified" badge
```html
<img src="http://127.0.0.1:8600/v1/seal/clm-sglt2-hf.svg" alt="Evidence Verified by Strata"/>
```

### `POST /v1/demo-request` — request a demo
Body: `{"email":"...","org":"...","message":"..."}`. Stored locally and emailed to the
founder when SMTP is configured. Public.

### `GET /v1/health` · `GET /v1/sources`
Version, enabled sources, whether AI + auth are configured.

## The Evidence Receipt

```jsonc
{
  "receipt_id": "STR-8F42A1C9",
  "claim": "Metformin reduces cardiovascular mortality in type 2 diabetes",
  "status": "Supported",            // Supported | Mixed | Contradicted | Insufficient | Unsupported
  "strength": "moderate",           // high | moderate | low | very low | none
  "supporting": 5, "contradicting": 0, "neutral": 1, "total": 6,
  "claim_status": "SUPPORTED",      // SUPPORTED | PARTIALLY_SUPPORTED | CONTRADICTED | INSUFFICIENT | UNSUPPORTED
  "confidence": 0.82,               // 0..1, calibrated from quantity + quality + agreement + recency
  "pico": {"population":"adults over 65","intervention":"Drug X","comparator":"standard care",
           "outcome":"hospitalization","direction":"reduces"},
  "effect_estimates": [ {"measure":"HR","value":0.70,"ci_low":0.62,"ci_high":0.79,"significant":true,"year":2023} ],
  "population_limitations": ["45% of your population is 80+, where evidence is thinnest."],
  "audit_trail": [ {"stage":"retrieve","detail":"Retrieved 40 records across 4 sources.","ms":180} ],
  "models_used": [], "elapsed_ms": 420,
  "checked": "2026-07-23T09:00:00+00:00",
  "highest_evidence": { "label": "Systematic review / meta-analysis", "level": 1,
                        "year": 2020, "url": "...", "source": "europepmc" },
  "key_limitation": "Rests largely on observational and older trials.",
  "citations": [
    { "n": 1, "title": "...", "year": 2020, "url": "...", "level": 1,
      "label": "Systematic review / meta-analysis", "strength": "high",
      "stance": "support",          // support | contradict | neutral
      "source": "europepmc",        // which database it came from
      "cited_by": 543, "doi": "10.xxxx/...",
      "effect": {"measure":"HR","value":0.83,"ci_low":0.74,"ci_high":0.93,
                 "direction":"reduction","significant":true} }
  ],
  "sources": { "pubmed": 12, "europepmc": 10, "openalex": 8, "clinicaltrials": 5 },
  "population_note": "45% of your population is 80+, where trial evidence is thinnest.",
  "synthesis": null,                // optional AI plain-language summary
  "evidence_changed": false,
  "change": { "changed": true, "events": [ {"type":"upgraded","text":"..."} ] },
  "disclaimer": "Heuristic appraisal of public literature ..."
}
```

## The pipeline

Every verification runs an explicit, auditable pipeline. Each stage is recorded in
`audit_trail` with the time it took, so every conclusion is traceable:

```
understand -> expand -> retrieve -> dedup -> rank -> classify ->
extract -> contradiction -> grade -> synthesize -> audit
```

AI is optional and routed per task through a model-abstraction layer (`GET /v1/models`): hard
reasoning (extraction, contradiction, synthesis) uses the strong tier; mechanical steps
(classification, expansion) use a cheap tier; both fall back to free/local models and finally
to the transparent heuristic. Nothing fabricates precision: an effect estimate appears only
when a real one is in the text.

## Streaming

`POST /v1/verify/stream` returns **newline-delimited JSON** (`application/x-ndjson`), one
object per stage as it completes, ending with `{"type":"done","receipt":{...}}`. Ideal for a
progressive UI (initial sources in ~1s, full synthesis after).

```bash
curl -N -X POST $STRATA/v1/verify/stream -H "Authorization: Bearer $KEY" \
  -d '{"claim":"SGLT2 inhibitors reduce heart-failure hospitalization"}'
# {"type":"stage","stage":"retrieve","detail":"Retrieved 40 records...","ms":180}
# ... {"type":"done","receipt":{...}}
```

## Batch

`POST /v1/verify/batch` with `{"claims":[...]}` (max 25) returns `{"results":[receipt,...]}`.

## Key management

| Endpoint | Does |
|---|---|
| `POST /v1/keys` | issue a key (returned once); optional `label`, `rate_limit`, `scopes` |
| `GET /v1/keys` | list keys (redacted) with usage + last-used |
| `GET /v1/keys/rotate?id=` | issue a new secret for a key id (old secret stops working) |
| `GET /v1/keys/logs?id=` | recent request log for a key |
| `GET /v1/keys/revoke?id=` | revoke a key |

Keys carry a per-minute **rate limit** (default 60); exceeding it returns **429** with
`retry_after`. Creation can be gated with `STRATA_ADMIN_KEY` (`X-Admin-Key`).

## Errors

| Code | Meaning |
|---|---|
| 400 | bad request (missing `claim`, invalid batch, invalid demo form) |
| 401 | missing / invalid API key |
| 404 | unknown id (receipt, claim, key) |
| 429 | rate limit exceeded (`retry_after` seconds in the body) |
| 500 | internal error; sources fail soft individually, so a single source outage does not 500 |

Failures are never hidden: an unreachable source is simply absent from `sources`, a
heuristic effect extraction is labelled, and insufficient evidence returns
`INSUFFICIENT` rather than a confident guess.

## Webhooks (roadmap)

Monitored-claim change events (`upgraded`, `downgraded`, `conflict`, `new_study`) are
available today by polling `GET /v1/monitor/check`. Push delivery to a registered URL is on
the roadmap; the event shape is already stable (`change.events[]`).

## SDKs

Python ([`clients/python/strata_client.py`](../clients/python/strata_client.py)) and
JavaScript ([`clients/js/strata.js`](../clients/js/strata.js)), both zero-dependency. See the
[integration guide](integration.md) for end-to-end examples.

## Notes & limits

- Stance (support / contradict) is a heuristic over abstracts, optionally sharpened by an AI
  model when configured; every citation links to its source. A receipt is an appraisal, never
  a determination of truth.
- Live verification hits public APIs; the seeded demo claims resolve offline.
- No built-in rate limiting or billing. Put the service behind your gateway for production.
