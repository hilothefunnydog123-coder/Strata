"""Strata Monitor — continuous claim watching.

Register a claim once; every *check* re-verifies it against current literature and diffs the
new receipt against the last, emitting change events: certainty upgraded / downgraded, a new
supporting or contradicting study, a conflict detected. This is the killer feature — not
"what's the answer" but "tell me when the answer changes."

    from strata import monitor
    c = monitor.register("SGLT2 inhibitors reduce heart-failure hospitalization")
    receipt, change = monitor.check(c["id"])     # -> events since last time
    monitor.view(c["id"])                         # current receipt + history + change feed
"""
from __future__ import annotations

from typing import Callable, Optional

from . import store, verify
from .pubmed import search_articles
from .receipt import Receipt

_KIND = "claims"


def register(claim: str, *, tenant: Optional[str] = None,
             id: Optional[str] = None, created: Optional[str] = None) -> dict:
    rid = id or verify.receipt_id(claim)
    proto = {"id": rid, "claim": claim.strip(), "tenant": tenant,
             "created": created or verify._now()}
    store.save_protocol(proto, kind=_KIND)
    return proto


def check(claim_id: str, *, now: Optional[str] = None,
          _search: Callable = search_articles):
    """Re-verify a monitored claim, persist the receipt, return (receipt_dict, change)."""
    doc = store.get(claim_id, kind=_KIND)
    if doc is None:
        raise KeyError(f"no such monitored claim: {claim_id}")
    claim = doc["protocol"]["claim"]
    prev = store.latest(claim_id, kind=_KIND)
    r = verify.verify_claim(claim, now=now, _search=_search)
    ch = verify.diff(prev, r)
    rd = r.to_dict()
    rd["evidence_changed"] = ch["changed"] and not ch["first_check"]
    rd["change"] = ch
    rd["taken"] = r.checked                       # for store ordering
    store.append_snapshot(claim_id, rd, kind=_KIND)
    return rd, ch


def view(claim_id: str) -> Optional[dict]:
    doc = store.get(claim_id, kind=_KIND)
    if doc is None:
        return None
    snaps = doc.get("snapshots", [])
    cur = snaps[-1] if snaps else None
    history = [{"checked": s["checked"], "status": s["status"], "strength": s["strength"],
                "supporting": s["supporting"], "contradicting": s["contradicting"]}
               for s in snaps]
    return {"protocol": doc["protocol"], "receipt": cur, "history": history,
            "change": cur.get("change") if cur else None}


def get_receipt(claim_id: str) -> Optional[Receipt]:
    last = store.latest(claim_id, kind=_KIND)
    return Receipt.from_dict(last) if last else None


def list_claims() -> list:
    rows = []
    for it in store.list_items(_KIND):
        p, last = it["protocol"], it["last"]
        rows.append({
            "id": p.get("id"), "claim": p.get("claim"), "tenant": p.get("tenant"),
            "status": last.get("status") if last else None,
            "strength": last.get("strength") if last else None,
            "supporting": last.get("supporting") if last else None,
            "contradicting": last.get("contradicting") if last else None,
            "evidence_changed": last.get("evidence_changed") if last else None,
            "last_checked": last.get("checked") if last else None,
            "checks": it["count"],
        })
    return rows


def delete(claim_id: str) -> bool:
    return store.delete(claim_id, kind=_KIND)
