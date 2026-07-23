# Strata API

Evidence verification and change-monitoring as infrastructure. One call answers:
*is this medical claim actually supported, by what, how strongly — and has it
changed?*

A rendered version is available at `/docs` when the server is running.

## Authentication

Every request uses a secret key sent as a bearer token. Keys are shown once at
creation; Strata stores only a SHA-256 hash. Keys carry scopes
(`verify`, `search`, `monitor`, or `*`), a per-minute rate limit, and can be
revoked at any time.

```
Authorization: Bearer sk_live_<your-key>
```

Mint one from the CLI:

```bash
strata apikey create --org "Acme Pharma" --name "prod" --scopes "*" --rate 120
```

## Endpoints

| Method | Path | Scope | Purpose |
|---|---|---|---|
| POST | `/v1/verify` | verify | Verify a claim; full supporting/contradicting trail. |
| POST | `/v1/search` | search | Raw multi-source literature search. |
| POST | `/v1/compare` | verify | Compare the evidence behind two claims/populations. |
| POST | `/v1/monitor` | monitor | Register a claim for continuous monitoring. |
| GET | `/v1/claims/:id` | — | A monitored claim: current state + version timeline. |
| GET | `/v1/changes` | — | Recent evidence-change events for your organization. |

## Verify

```bash
curl https://your-host/v1/verify \
  -H "Authorization: Bearer sk_live_..." \
  -H "Content-Type: application/json" \
  -d '{"claim": "Treatment X reduces hospitalization in heart failure",
       "population": "Adults over 65"}'
```

```json
{
  "claim_status": "partially_supported",
  "evidence_strength": "moderate",
  "supporting_evidence": [
    {"n": 1, "title": "...", "study_type": "Systematic review / meta-analysis",
     "strength": "high", "stance": "supporting",
     "effect": {"metric": "RR", "value": 0.79, "ci_low": 0.71, "ci_high": 0.88,
                "significant": true, "provenance": "reported"},
     "population_match": {"match": "good"}, "url": "https://pubmed.ncbi.nlm.nih.gov/..."}
  ],
  "contradicting_evidence": [
    {"n": 2, "title": "...", "study_type": "Randomized controlled trial",
     "stance": "contradicting", "disagreement_label": "Genuine scientific disagreement"}
  ],
  "supporting_reasons": ["Strongest supporting evidence is a systematic review / meta-analysis"],
  "key_limitations": ["1 comparable-quality study(ies) contradict the claim"],
  "assessment": {"strength": "moderate", "status": "partially_supported",
                 "domains": { "...": "inspectable GRADE-style domains" }},
  "retrieval": {"identified": 42, "duplicates_removed": 7, "screened": 35,
                "sources": ["pubmed", "europepmc", "openalex"], "errors": {}},
  "audit_trail": [{"step": "structure_question"}, {"step": "retrieve"}, {"step": "assess_strength"}],
  "evidence_fingerprint": "0760a0aa83849ea1",
  "basis": "abstract-level",
  "disclaimer": "Decision support from public literature — not medical advice."
}
```

Verification never fabricates: if a source is unreachable it appears in
`retrieval.errors`, and a claim with no retrieved studies returns
`insufficient_evidence` rather than an invented answer. Assessments are
abstract-level unless open-access full text is available, and are labelled as such.

## Monitor (Python)

```python
import requests

r = requests.post("https://your-host/v1/monitor",
    headers={"Authorization": "Bearer sk_live_..."},
    json={"claim": "Drug X reduces hospitalization in heart failure",
          "frequency": "weekly",
          "alert_conditions": ["new_rct", "new_meta_analysis",
                               "new_contradiction", "strength_change"]})
claim_id = r.json()["claim_id"]

# later — poll changes (webhooks are on the roadmap)
changes = requests.get("https://your-host/v1/changes",
    headers={"Authorization": "Bearer sk_live_..."}).json()
```

## Compare (JavaScript / TypeScript)

```javascript
const res = await fetch("https://your-host/v1/compare", {
  method: "POST",
  headers: { Authorization: `Bearer ${process.env.STRATA_KEY}`,
             "Content-Type": "application/json" },
  body: JSON.stringify({
    a: { claim: "Statins reduce stroke risk in adults over 65" },
    b: { claim: "Statins reduce stroke risk in adults over 80" },
  }),
});
const { comparison } = await res.json();   // { stronger: "a", strength_gap: 1, note: "..." }
```

## Errors & rate limits

Errors are JSON with a stable code:

```json
{ "error": { "code": "invalid_api_key", "message": "API key not recognized or revoked." } }
```

| Status | Code | Meaning |
|---|---|---|
| 400 | `missing_claim` / `missing_query` / `missing_pair` | Malformed request. |
| 401 | `missing_api_key` / `invalid_api_key` | Auth failed. |
| 403 | `insufficient_scope` / `forbidden` | Key lacks scope, or cross-org access. |
| 429 | `rate_limited` | Per-key per-minute limit exceeded. |

Every request is logged for usage accounting (endpoint, status, latency).
