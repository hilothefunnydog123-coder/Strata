"""The Strata API — evidence verification as infrastructure.

Transport-agnostic handlers so the same logic is exercised by the HTTP server
and by tests. Every call is authenticated with a real, hashed API key, rate
limited per key, and logged for usage. The endpoints mirror the product:

    POST /v1/verify        verify a claim/question, return the full evidence trail
    POST /v1/search        raw multi-source literature search
    POST /v1/compare       compare the evidence behind two claims (or populations)
    POST /v1/monitor       register a claim for continuous monitoring (persisted)
    GET  /v1/claims/:id     a stored claim: current state + timeline
    GET  /v1/changes        recent evidence-change events for your organization

The design goal is that a developer at a medical-AI company can wire
``POST /v1/verify`` into their generation pipeline in fifteen minutes and get
back "is this claim actually supported, and by what?" — with citations and an
audit trail, not a vibe.
"""
from __future__ import annotations

import datetime as _dt
from typing import Any, Callable, Dict, List, Optional

from .db import Database
from .verify import verify as _verify
from .sources import retrieve as _retrieve
from . import claims as _claims
from . import monitor as _monitor


class ApiError(Exception):
    def __init__(self, status: int, code: str, message: str):
        super().__init__(message)
        self.status = status
        self.code = code
        self.message = message


class AuthContext:
    def __init__(self, key_row: Dict[str, Any]):
        self.key_id = key_row["id"]
        self.org_id = key_row["org_id"]
        self.scopes = key_row.get("scopes", [])
        self.rate_limit = key_row.get("rate_limit_per_min", 60)


# -- middleware ------------------------------------------------------------

def authenticate(db: Database, presented_key: Optional[str]) -> AuthContext:
    if not presented_key:
        raise ApiError(401, "missing_api_key",
                       "Provide your key as 'Authorization: Bearer sk_live_…'.")
    row = db.find_api_key(presented_key.strip())
    if not row:
        raise ApiError(401, "invalid_api_key", "API key not recognized or revoked.")
    db.touch_api_key(row["id"])
    return AuthContext(row)


def enforce_rate_limit(db: Database, ctx: AuthContext) -> None:
    since = (_dt.datetime.now(_dt.timezone.utc) - _dt.timedelta(seconds=60)
             ).replace(microsecond=0).isoformat()
    used = db.usage_count_since(ctx.key_id, since)
    if used >= ctx.rate_limit:
        raise ApiError(429, "rate_limited",
                       f"Rate limit of {ctx.rate_limit} requests/minute exceeded.")


def require_scope(ctx: AuthContext, scope: str) -> None:
    if ctx.scopes and scope not in ctx.scopes and "*" not in ctx.scopes:
        raise ApiError(403, "insufficient_scope",
                       f"This key lacks the '{scope}' scope.")


def _default_workspace(db: Database, ctx: AuthContext) -> int:
    if ctx.org_id is None:
        raise ApiError(403, "no_organization", "This key is not attached to an organization.")
    return db.get_or_create_workspace(ctx.org_id, "API", "api")


# -- handlers --------------------------------------------------------------

def verify_handler(db: Database, body: Dict[str, Any], ctx: AuthContext, *,
                   verify_fn: Callable[..., Any] = _verify) -> Dict[str, Any]:
    require_scope(ctx, "verify")
    claim = (body.get("claim") or body.get("question") or "").strip()
    if not claim:
        raise ApiError(400, "missing_claim", "Body must include 'claim' (or 'question').")
    population = body.get("population")
    claim_pop = {"value": population} if isinstance(population, str) else population
    verdict = verify_fn(claim, claim_population=claim_pop,
                        sources=body.get("sources"), k=int(body.get("k", 10)))
    return verdict.to_dict()


def search_handler(db: Database, body: Dict[str, Any], ctx: AuthContext, *,
                   retrieve_fn: Callable[..., Any] = _retrieve) -> Dict[str, Any]:
    require_scope(ctx, "search")
    q = (body.get("query") or body.get("q") or "").strip()
    if not q:
        raise ApiError(400, "missing_query", "Body must include 'query'.")
    result = retrieve_fn(q, int(body.get("retmax", 25)), sources=body.get("sources"))
    return {
        "query": q, "retrieval": result.prisma,
        "results": [{"title": a.title, "year": a.year, "journal": a.journal,
                     "pmid": a.pmid, "doi": a.doi, "url": a.url, "source": a.source,
                     "publication_types": a.publication_types,
                     "has_full_text": a.has_full_text} for a in result.articles],
    }


def compare_handler(db: Database, body: Dict[str, Any], ctx: AuthContext, *,
                    verify_fn: Callable[..., Any] = _verify) -> Dict[str, Any]:
    require_scope(ctx, "verify")
    a, b = body.get("a"), body.get("b")
    if not (isinstance(a, dict) and isinstance(b, dict) and a.get("claim") and b.get("claim")):
        raise ApiError(400, "missing_pair",
                       "Body must include 'a' and 'b', each an object with a 'claim'.")
    va = verify_fn(a["claim"], claim_population=a.get("population"))
    vb = verify_fn(b["claim"], claim_population=b.get("population"))
    order = ["none", "very low", "low", "moderate", "high"]
    ia, ib = order.index(va.evidence_strength), order.index(vb.evidence_strength)
    stronger = "a" if ia > ib else ("b" if ib > ia else "tie")
    return {
        "a": {"claim": a["claim"], "claim_status": va.status,
              "evidence_strength": va.evidence_strength,
              "supporting": len(va.supporting), "contradicting": len(va.contradicting)},
        "b": {"claim": b["claim"], "claim_status": vb.status,
              "evidence_strength": vb.evidence_strength,
              "supporting": len(vb.supporting), "contradicting": len(vb.contradicting)},
        "comparison": {"stronger": stronger,
                       "strength_gap": abs(ia - ib),
                       "note": f"Claim {stronger.upper()} has the stronger evidence base."
                               if stronger != "tie" else "Both claims are equally supported."},
    }


def monitor_handler(db: Database, body: Dict[str, Any], ctx: AuthContext, *,
                    verify_fn: Callable[..., Any] = _verify) -> Dict[str, Any]:
    require_scope(ctx, "monitor")
    claim_text = (body.get("claim") or body.get("question") or "").strip()
    if not claim_text:
        raise ApiError(400, "missing_claim", "Body must include 'claim'.")
    ws = _default_workspace(db, ctx)
    claim_id = _claims.create_claim_from_question(
        db, ws, claim_text, therapeutic_area=body.get("therapeutic_area"))
    frequency = body.get("frequency", "weekly")
    conditions = body.get("alert_conditions")
    _monitor.create_monitor(db, claim_id, frequency=frequency, conditions=conditions)
    # establish the baseline immediately so the customer sees state on day one
    verdict = verify_fn(claim_text, claim_population=db.get_claim(claim_id).get("population"))
    result = _claims.ingest(db, claim_id, verdict)
    return {
        "claim_id": claim_id, "monitored": True, "frequency": frequency,
        "claim_status": verdict.status, "evidence_strength": verdict.evidence_strength,
        "version": result["version"],
        "message": "Claim registered and baselined; you will be alerted when the evidence changes.",
    }


def get_claim_handler(db: Database, claim_id: int, ctx: AuthContext) -> Dict[str, Any]:
    claim = db.get_claim(claim_id)
    if claim is None:
        raise ApiError(404, "not_found", f"Claim {claim_id} not found.")
    ws = db.one("SELECT workspace_id FROM claims WHERE id=?", (claim_id,))
    _authorize_claim(db, ctx, claim_id)
    latest = db.latest_version(claim_id)
    timeline = db.claim_timeline(claim_id)
    return {
        "id": claim_id, "claim": claim["text"],
        "population": claim.get("population"), "intervention": claim.get("intervention"),
        "outcome": claim.get("outcome"),
        "claim_status": claim["status"], "evidence_strength": claim["evidence_strength"],
        "trend": claim["trend"], "version": claim["current_version"],
        "last_verified_at": claim.get("last_verified_at"),
        "assessment": (latest or {}).get("assessment"),
        "timeline": [{"version": t["version"], "status": t["status"],
                      "evidence_strength": t["evidence_strength"],
                      "supporting": t["supporting_count"],
                      "contradicting": t["contradicting_count"],
                      "created_at": t["created_at"], "summary": t["summary"]}
                     for t in timeline],
    }


def get_changes_handler(db: Database, query: Dict[str, Any], ctx: AuthContext) -> Dict[str, Any]:
    if ctx.org_id is None:
        raise ApiError(403, "no_organization", "This key is not attached to an organization.")
    ws_rows = db.query("SELECT id FROM workspaces WHERE org_id=?", (ctx.org_id,))
    since = query.get("since")
    changes: List[Dict[str, Any]] = []
    for w in ws_rows:
        changes.extend(db.list_changes(w["id"], since=since, limit=int(query.get("limit", 100))))
    changes.sort(key=lambda c: c["created_at"], reverse=True)
    return {"changes": changes[:int(query.get("limit", 100))], "count": len(changes)}


def _authorize_claim(db: Database, ctx: AuthContext, claim_id: int) -> None:
    row = db.one("SELECT c.workspace_id, w.org_id FROM claims c "
                 "JOIN workspaces w ON w.id=c.workspace_id WHERE c.id=?", (claim_id,))
    if row and ctx.org_id is not None and row["org_id"] != ctx.org_id:
        raise ApiError(403, "forbidden", "This claim belongs to another organization.")
