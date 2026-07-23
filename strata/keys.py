"""API keys — generate, authenticate, rate-limit, rotate, log.

Real keys: ``sk_live_...`` that authorize requests. Only a SHA-256 hash and a display prefix
are stored, never the raw key. Each key tracks usage, keeps a bounded request log, carries a
per-minute rate limit and scopes, and can be rotated or revoked. Persisted under
``$STRATA_HOME`` so keys survive restarts.

    raw, rec = keys.generate("Acme prod", rate_limit=120)
    rec = keys.validate(raw)                    # -> record (+usage) or None
    ok, retry_after = keys.check_rate(rec)      # sliding-window limiter
    keys.log_request(rec["id"], "/v1/verify", 200)
    new_raw, rec = keys.rotate(rec["id"])       # same id + label, new secret
"""
from __future__ import annotations

import datetime as _dt
import hashlib
import secrets
import time

from . import store

_KIND = "keys"
_SCOPES = ("verify", "compare", "monitor", "cohort", "batch")
_LOG_MAX = 50
_HITS: dict = {}                     # in-memory sliding window: key_id -> [epoch_seconds]


def _now() -> str:
    return _dt.datetime.now(_dt.timezone.utc).isoformat(timespec="seconds")


def _hash(raw: str) -> str:
    return hashlib.sha256(raw.encode("utf-8")).hexdigest()


def generate(label: str = "", *, scopes=_SCOPES, rate_limit: int = 60) -> tuple[str, dict]:
    """Return (raw_key, record). The raw key is shown once; only its hash is stored."""
    raw = "sk_live_" + secrets.token_hex(20)
    rec = {
        "id": "key_" + raw[-8:], "prefix": raw[:12] + "..." + raw[-4:],
        "hash": _hash(raw), "label": label or "default", "scopes": list(scopes),
        "rate_limit": int(rate_limit), "created": _now(), "rotated": None,
        "requests": 0, "last_used": None, "revoked": False, "log": [],
    }
    store.save_protocol(rec, kind=_KIND)
    return raw, rec


def validate(raw: str) -> dict | None:
    """Authenticate a raw key. Returns the record (usage bumped) or None."""
    if not raw or not raw.startswith("sk_"):
        return None
    h = _hash(raw)
    for it in store.list_items(_KIND):
        rec = it["protocol"]
        if rec.get("hash") == h and not rec.get("revoked"):
            rec["requests"] = rec.get("requests", 0) + 1
            rec["last_used"] = _now()
            store.save_protocol(rec, kind=_KIND)
            return rec
    return None


def check_rate(rec: dict) -> tuple[bool, int]:
    """Sliding-window rate limit. Returns (allowed, retry_after_seconds)."""
    limit = int(rec.get("rate_limit") or 60)
    if limit <= 0:
        return True, 0
    kid, nowt = rec["id"], time.time()
    hits = [t for t in _HITS.get(kid, []) if nowt - t < 60]
    if len(hits) >= limit:
        return False, max(1, int(60 - (nowt - hits[0])))
    hits.append(nowt)
    _HITS[kid] = hits
    return True, 0


def log_request(key_id: str, path: str, status: int) -> None:
    doc = store.get(key_id, kind=_KIND)
    if not doc:
        return
    rec = doc["protocol"]
    rec.setdefault("log", []).append({"t": _now(), "path": path, "status": status})
    rec["log"] = rec["log"][-_LOG_MAX:]
    store.save_protocol(rec, kind=_KIND)


def rotate(key_id: str) -> tuple[str | None, dict | None]:
    """Issue a new secret for an existing key id (invalidates the old secret)."""
    doc = store.get(key_id, kind=_KIND)
    if not doc:
        return None, None
    rec = doc["protocol"]
    raw = "sk_live_" + secrets.token_hex(20)
    rec["hash"] = _hash(raw)
    rec["prefix"] = raw[:12] + "..." + raw[-4:]
    rec["rotated"] = _now()
    store.save_protocol(rec, kind=_KIND)
    return raw, _redact(rec)


def has_scope(rec: dict, scope: str) -> bool:
    return scope in (rec.get("scopes") or _SCOPES)


def _redact(rec: dict) -> dict:
    return {k: rec.get(k) for k in ("id", "prefix", "label", "scopes", "rate_limit",
                                    "created", "rotated", "requests", "last_used", "revoked")}


def list_keys() -> list[dict]:
    return [_redact(it["protocol"]) for it in store.list_items(_KIND)]


def get_logs(key_id: str) -> list[dict]:
    doc = store.get(key_id, kind=_KIND)
    return (doc["protocol"].get("log", []) if doc else [])


def revoke(key_id: str) -> bool:
    doc = store.get(key_id, kind=_KIND)
    if not doc:
        return False
    doc["protocol"]["revoked"] = True
    store.save_protocol(doc["protocol"], kind=_KIND)
    return True


def delete(key_id: str) -> bool:
    return store.delete(key_id, kind=_KIND)
