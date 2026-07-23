# Strata Verify — API reference

The verification layer, over HTTP. Standard-library server; run it with `strata serve` (see
[self-hosting](self-hosting.md)). Base URL below is the local default.

```
http://127.0.0.1:8600
```

## Authentication

If the `STRATA_API_KEYS` environment variable is set (comma-separated keys), every `/v1/*`
call except the public Seal badge requires a matching key, supplied as any of:

```
Authorization: Bearer <key>
X-API-Key: <key>
?key=<key>
```

If `STRATA_API_KEYS` is unset, the API is **open** — intended only for a trusted private
network or local development.

## Endpoints

### `POST /v1/verify` — verify a claim
Body: `{"claim": "<text>"}` (or `GET /v1/verify?claim=...`). Returns an **Evidence Receipt**.

```bash
curl -X POST http://127.0.0.1:8600/v1/verify \
  -H "Authorization: Bearer $STRATA_KEY" \
  -H "Content-Type: application/json" \
  -d '{"claim":"Metformin reduces cardiovascular mortality in type 2 diabetes"}'
```

### `GET /v1/monitor` — list monitored claims
Returns `{tenant, claims: [{id, claim, status, strength, supporting, contradicting, evidence_changed, last_checked, checks}]}`.

### `GET /v1/monitor/register?claim=&tenant=` — start monitoring
Registers the claim and runs the first check. Returns `{id, receipt, change}`.

### `GET /v1/monitor/check?id=` — re-check
Re-verifies a monitored claim and returns `{id, receipt, change}`. The `change` object is the
"what changed" feed (see below).

### `GET /v1/monitor/get?id=` — current state
Returns `{protocol, receipt, history, change}` — the latest receipt plus the check history.

### `GET /v1/receipt/<id>` — a monitored claim's latest receipt

### `GET /v1/seal/<id>.svg` — the public trust badge
Returns an `image/svg+xml` "Evidence Verified" badge for the claim's latest receipt. Public
(no key). Embed it:

```html
<img src="http://127.0.0.1:8600/v1/seal/clm-sglt2-hf.svg" alt="Evidence Verified by Strata"/>
```

### `GET /v1/health`
`{status, version, auth}`.

## The Evidence Receipt

```jsonc
{
  "receipt_id": "STR-8F42A1C9",
  "claim": "Metformin reduces cardiovascular mortality in type 2 diabetes",
  "status": "Supported",          // Supported | Mixed | Contradicted | Insufficient | Unsupported
  "strength": "moderate",         // high | moderate | low | very low | none
  "supporting": 4,
  "contradicting": 0,
  "neutral": 1,
  "total": 5,
  "checked": "2026-07-23T09:00:00+00:00",
  "highest_evidence": {
    "pmid": "40022001", "title": "…", "year": 2020,
    "url": "https://pubmed.ncbi.nlm.nih.gov/40022001/",
    "label": "Systematic review / meta-analysis", "level": 1, "strength": "high"
  },
  "key_limitation": "Rests largely on a single high-quality study …",
  "citations": [
    {
      "n": 1, "pmid": "40022001", "title": "…", "year": 2020,
      "url": "…", "level": 1, "label": "Systematic review / meta-analysis",
      "strength": "high", "stance": "support",     // support | contradict | neutral
      "snippet": "…",
      "effect": {"measure": "HR", "value": 0.83, "ci_low": 0.74, "ci_high": 0.93,
                 "direction": "reduction", "significant": true}
    }
  ],
  "evidence_changed": false,
  "change": { /* the what-changed feed, see below */ },
  "query": "Metformin cardiovascular mortality type diabetes",
  "disclaimer": "Heuristic appraisal of public literature for decision support. …"
}
```

### The `change` (what-changed) feed
```jsonc
{
  "changed": true,
  "first_check": false,
  "headline": "Certainty upgraded: moderate → high",
  "events": [
    {"type": "upgraded",    "level": "green", "text": "Certainty upgraded: moderate → high"},
    {"type": "new_study",   "level": "green", "text": "New support study: …", "pmid": "…"},
    {"type": "conflict",    "level": "amber", "text": "Status changed: Supported → Mixed"}
  ]
}
```

## SDKs

**Python** ([`clients/python/strata_client.py`](../clients/python/strata_client.py)) — zero deps:

```python
from strata_client import Strata
strata = Strata(api_key="sk_live_...", base_url="https://api.your-strata.host")
r = strata.verify("SGLT2 inhibitors reduce heart-failure hospitalization")
cid = strata.monitor(r["claim"])["id"]
change = strata.check(cid)["change"]
badge = strata.seal_url(cid)          # embed as <img>
```

**JavaScript / TypeScript** ([`clients/js/strata.js`](../clients/js/strata.js)) — browser + Node:

```js
import { Strata } from "@strata/sdk";
const strata = new Strata({ apiKey: "sk_live_..." });
const r = await strata.verify("SGLT2 inhibitors reduce heart-failure hospitalization");
```

## Notes & limits

- Effect classification (support / contradict) is a **heuristic** over abstracts; every
  citation links to its source for review. Do not treat a receipt as a determination of truth.
- Live verification queries PubMed (public NCBI E-utilities). Set `NCBI_API_KEY` to raise the
  rate limit. The seeded demo claims verify offline.
- No rate limiting or billing is built in — put the service behind your gateway for production.
