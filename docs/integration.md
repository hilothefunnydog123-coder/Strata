# Integrating Strata

A step-by-step guide to wrapping your medical AI (or any product that makes medical claims)
in Strata verification. Ten minutes to first receipt.

## 1. Get the service running

Hosted: point at your Strata URL. Self-hosted (recommended for health data):

```bash
pip install strata-evidence
strata serve                      # http://127.0.0.1:8600
# or: STRATA_API_KEYS=sk_live_x docker compose up --build
```

## 2. Generate an API key

From the UI (open `/app`, click **Get an API key**) or the API:

```bash
curl -X POST http://127.0.0.1:8600/v1/keys -d '{"label":"production"}'
# { "key": "sk_live_9f...", ... }   <-- shown once, store it in your secrets manager
```

Keys track their own usage and can be revoked (`GET /v1/keys/revoke?id=key_...`). If you set
`STRATA_ADMIN_KEY`, pass `X-Admin-Key` to create keys.

## 3. Verify a claim

Whenever your system produces a medical assertion, verify it before you show or act on it.

**Python**

```python
from strata_client import Strata          # clients/python/strata_client.py
strata = Strata(api_key="sk_live_9f...", base_url="http://127.0.0.1:8600")

receipt = strata.verify("Metformin reduces cardiovascular mortality in type 2 diabetes")

if receipt["status"] in ("Contradicted", "Mixed"):
    flag_for_review(receipt)              # don't present a shaky claim as settled
elif receipt["status"] == "Supported" and receipt["strength"] in ("high", "moderate"):
    present_with_evidence(receipt)        # attach the citations + strength
```

**JavaScript / TypeScript**

```js
import { Strata } from "@strata/sdk";     // clients/js/strata.js
const strata = new Strata({ apiKey: "sk_live_9f...", baseUrl: "http://127.0.0.1:8600" });

const r = await strata.verify("SGLT2 inhibitors reduce heart-failure hospitalization");
console.log(r.status, r.strength, r.sources);   // "Supported" "high" { pubmed: 12, ... }
```

**curl**

```bash
curl -X POST $STRATA/v1/verify -H "Authorization: Bearer $KEY" \
  -d '{"claim":"SGLT2 inhibitors reduce heart-failure hospitalization"}'
```

## 4. Read the receipt

| Field | Use it to |
|---|---|
| `status` | Gate the answer: Supported / Mixed / Contradicted / Insufficient / Unsupported |
| `strength` | Show a certainty (high / moderate / low / very low) |
| `supporting` / `contradicting` | Show the split, or block on conflict |
| `key_limitation` | Surface the main caveat to the user |
| `citations[]` | Render sources (each has `stance`, `source`, `cited_by`, `url`) |
| `sources` | Show how much evidence, across which databases |
| `receipt_id` | Store it; link back to the evidence |

A good UI pattern: show the status pill, the split bar, the top 3 citations, and the
limitation. Never present a claim without its receipt.

## 5. Compare options

```python
cmp = strata._req("/v1/compare", "POST", body={
    "claim_a": "Drug A reduces mortality in heart failure",
    "claim_b": "Drug B reduces mortality in heart failure"})
print(cmp["winner"], cmp["rationale"])
```

## 6. Monitor the claims that matter

Register your key claims once; poll for change events (a scheduler is on the roadmap).

```python
cid = strata.monitor("SGLT2 inhibitors reduce heart-failure hospitalization")["id"]
change = strata.check(cid)["change"]
for e in change["events"]:
    notify_team(e["text"])                # "Certainty upgraded: moderate to high"
```

## 7. Embed the trust badge

The Seal is public. Drop it next to a verified answer:

```html
<img src="http://127.0.0.1:8600/v1/seal/<claim_id>.svg" alt="Evidence Verified by Strata"/>
```

## 8. (Self-host) Tailor to your population

Import your population profile once so verdicts flag generalizability to *your* patients.
This runs only where you host it and never leaves the box.

```bash
curl -X POST $STRATA/v1/cohort -H "Authorization: Bearer $KEY" \
  -d '{"name":"clinic A","rows":[{"age":82,"medications":"metformin","conditions":"diabetes"}]}'

curl -X POST $STRATA/v1/verify -H "Authorization: Bearer $KEY" \
  -d '{"claim":"Metformin reduces cardiovascular mortality","cohort":"cohort-clinic-a"}'
# receipt.population_note -> "X% of your population is 80+, where evidence is thinnest..."
```

## 9. (Optional) Turn on AI

Set a free-tier key to sharpen borderline stance calls (see [self-hosting](self-hosting.md)):

```bash
export STRATA_LLM_BASE_URL=https://api.groq.com/openai/v1
export STRATA_LLM_KEY=gsk_...   STRATA_LLM_MODEL=llama-3.3-70b-versatile
```

The model only ever sees the claim and public abstracts. It never sees cohort data, and it is
never the source of a fact.

## Error handling

| Code | Meaning | Do |
|---|---|---|
| 401 | missing/invalid key | check `Authorization` header |
| 400 | missing `claim` | validate input |
| 404 | unknown id | check the receipt/claim id |
| 500 | evidence source unreachable | retry with backoff; sources fail soft individually |

## Production checklist

- Terminate TLS + rate-limit at your gateway.
- One key per client; rotate and revoke as needed.
- Self-host if any population/patient data is involved (no PHI leaves your network).
- Back up `STRATA_HOME` (keys, monitored claims, cohorts).
- Show the receipt. The point of Strata is that every claim is defensible.
