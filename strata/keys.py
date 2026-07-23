"""Real, working API keys.

Generate ``sk_live_...`` keys that actually authorize requests. Only a SHA-256 hash and a
display prefix are stored, never the raw key. Each key tracks its request count and last use
and can be revoked. Persisted under ``$STRATA_HOME`` like everything else, so keys survive
restarts on a self-hosted deployment.

    from strata import keys
    raw, rec = keys.generate("Acme Health production")   # show `raw` once, never again
    keys.validate(raw)                                     # -> record (and bumps usage), or None
"""
from __future__ import annotations

import datetime as _dt
import hashlib
import secrets

from . import store

_KIND = "keys"
_SCOPES = ("verify", "monitor", "compare", "cohort")


def _now() -> str:
    return _dt.datetime.now(_dt.timezone.utc).isoformat(timespec="seconds")


def _hash(raw: str) -> str:
    return hashlib.sha256(raw.encode("utf-8")).hexdigest()


def generate(label: str = "", *, scopes=_SCOPES) -> tuple[str, dict]:
    """Return (raw_key, record). The raw key is shown once; only its hash is stored."""
    raw = "sk_live_" + secrets.token_hex(20)
    rec = {
        "id": "key_" + raw[-8:], "prefix": raw[:12] + "..." + raw[-4:],
        "hash": _hash(raw), "label": label or "default", "scopes": list(scopes),
        "created": _now(), "requests": 0, "last_used": None, "revoked": False,
    }
    store.save_protocol(rec, kind=_KIND)
    return raw, rec


def validate(raw: str) -> dict | None:
    """Return the key record if valid and active, bumping usage. Else None."""
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


def _redact(rec: dict) -> dict:
    return {k: rec.get(k) for k in ("id", "prefix", "label", "scopes",
                                    "created", "requests", "last_used", "revoked")}


def list_keys() -> list[dict]:
    return [_redact(it["protocol"]) for it in store.list_items(_KIND)]


def revoke(key_id: str) -> bool:
    doc = store.get(key_id, kind=_KIND)
    if not doc:
        return False
    doc["protocol"]["revoked"] = True
    store.save_protocol(doc["protocol"], kind=_KIND)
    return True


def delete(key_id: str) -> bool:
    return store.delete(key_id, kind=_KIND)
