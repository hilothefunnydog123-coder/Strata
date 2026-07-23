"""Tests for the API layer: keys, auth, scopes, rate limiting, handlers.

Run: python tests/test_api.py
"""
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from strata.db import Database                                       # noqa: E402
from strata.pubmed import Article                                    # noqa: E402
from strata.sources import RetrievalResult                           # noqa: E402
from strata.verify import verify                                     # noqa: E402
from strata import api                                               # noqa: E402


def _ret(arts):
    return lambda q, retmax, sources=None: RetrievalResult(
        articles=arts, per_source={"pubmed": len(arts)}, retrieved_total=len(arts),
        unique=len(arts), sources_used=["pubmed"])


ARTS = [Article("1", "Treatment X reduces hospitalization: meta-analysis",
                "In 18 trials (n=24,500), Treatment X reduced hospitalization (RR 0.79, "
                "95% CI 0.71 to 0.88).", "Lancet", 2022, ["Au"], ["Meta-Analysis"], doi="10/m")]


def _fake_verify(q, **kw):
    return verify(q, current_year=2026, retrieve_fn=_ret(ARTS),
                  **{k: v for k, v in kw.items() if k in ("claim_population", "sources", "k")})


def _db_key(scopes=None, rate=60):
    db = Database(":memory:")
    org = db.get_or_create_org("Acme Pharma")
    key = db.create_api_key(org, "prod", rate_limit_per_min=rate, scopes=scopes)
    return db, org, key


def test_key_is_hashed_not_stored():
    db, org, key = _db_key()
    row = db.one("SELECT * FROM api_keys WHERE id=?", (key["id"],))
    assert "key_hash" in row and row.get("key") is None
    assert key["key"] not in str(row.values())          # plaintext never persisted
    assert key["key"].startswith("sk_live_")
    print("ok  API keys are stored only as a hash; plaintext shown once")


def test_auth_and_revocation():
    db, org, key = _db_key()
    ctx = api.authenticate(db, key["key"])
    assert ctx.org_id == org
    try:
        api.authenticate(db, "sk_live_wrong"); assert False
    except api.ApiError as e:
        assert e.status == 401
    db.revoke_api_key(ctx.key_id)
    try:
        api.authenticate(db, key["key"]); assert False
    except api.ApiError as e:
        assert e.status == 401
    print("ok  auth accepts valid keys, rejects bad and revoked ones")


def test_scope_enforced():
    db, org, key = _db_key(scopes=["verify"])
    ctx = api.authenticate(db, key["key"])
    try:
        api.monitor_handler(db, {"claim": "x"}, ctx, verify_fn=_fake_verify); assert False
    except api.ApiError as e:
        assert e.status == 403 and e.code == "insufficient_scope"
    print("ok  scopes are enforced server-side")


def test_rate_limit():
    db, org, key = _db_key(rate=2)
    ctx = api.authenticate(db, key["key"])
    for _ in range(2):
        db.log_usage(ctx.key_id, endpoint="/v1/verify", method="POST", status_code=200, latency_ms=1)
    try:
        api.enforce_rate_limit(db, ctx); assert False
    except api.ApiError as e:
        assert e.status == 429
    print("ok  per-key rate limiting returns 429 when exceeded")


def test_handlers():
    db, org, key = _db_key(scopes=["*"])
    ctx = api.authenticate(db, key["key"])
    v = api.verify_handler(db, {"claim": "Does Treatment X reduce hospitalization?"}, ctx,
                           verify_fn=_fake_verify)
    assert v["claim_status"] and v["evidence_strength"] and "audit_trail" in v
    m = api.monitor_handler(db, {"claim": "Does Treatment X reduce hospitalization?"}, ctx,
                            verify_fn=_fake_verify)
    assert m["monitored"] and m["version"] == 1
    gc = api.get_claim_handler(db, m["claim_id"], ctx)
    assert gc["id"] == m["claim_id"] and gc["timeline"]
    ch = api.get_changes_handler(db, {}, ctx)
    assert ch["count"] >= 1
    print("ok  verify / monitor / get_claim / changes handlers return real data")


def test_missing_claim_is_400():
    db, org, key = _db_key(scopes=["*"])
    ctx = api.authenticate(db, key["key"])
    try:
        api.verify_handler(db, {}, ctx, verify_fn=_fake_verify); assert False
    except api.ApiError as e:
        assert e.status == 400
    print("ok  a missing claim is a clean 400, not a crash")


if __name__ == "__main__":
    for name, fn in sorted(globals().items()):
        if name.startswith("test_") and callable(fn):
            fn()
    print("\nall api tests passed")
