"""Persistence — plain JSON on disk, standard library only.

Two record kinds share one store: living **reviews** (a therapeutic-area question) and
monitored **claims** (a single medical assertion being watched). Each is one JSON file —
its protocol plus a bounded history of graded snapshots / receipts — so a re-check can diff
against the previous state and report what changed.

Location: ``$STRATA_HOME`` if set, else ``~/.strata``. No database, no service. It stores
bibliographic metadata, grades, and receipts only — never patient data.
"""
from __future__ import annotations

import json
import os
from pathlib import Path

_MAX_SNAPSHOTS = 24          # keep history bounded; enough for a trend line


def home() -> Path:
    return Path(os.environ.get("STRATA_HOME", Path.home() / ".strata"))


def _dir(kind: str) -> Path:
    p = home() / kind
    p.mkdir(parents=True, exist_ok=True)
    return p


def _path(item_id: str, kind: str) -> Path:
    safe = "".join(c for c in item_id if c.isalnum() or c in "-_")
    return _dir(kind) / f"{safe}.json"


def _read(item_id: str, kind: str) -> dict | None:
    p = _path(item_id, kind)
    if not p.exists():
        return None
    try:
        return json.loads(p.read_text(encoding="utf-8"))
    except (json.JSONDecodeError, OSError):
        return None


def _write(item_id: str, doc: dict, kind: str) -> None:
    p = _path(item_id, kind)
    tmp = p.with_suffix(".json.tmp")
    tmp.write_text(json.dumps(doc, indent=2), encoding="utf-8")
    tmp.replace(p)          # atomic-ish swap


def save_protocol(protocol: dict, *, kind: str = "reviews") -> None:
    rid = protocol["id"]
    doc = _read(rid, kind) or {"protocol": protocol, "snapshots": []}
    doc["protocol"] = protocol
    _write(rid, doc, kind)


def append_snapshot(item_id: str, snapshot: dict, *, kind: str = "reviews") -> None:
    doc = _read(item_id, kind)
    if doc is None:
        raise KeyError(f"no such {kind[:-1]}: {item_id}")
    doc["snapshots"].append(snapshot)
    doc["snapshots"] = doc["snapshots"][-_MAX_SNAPSHOTS:]
    _write(item_id, doc, kind)


def get(item_id: str, *, kind: str = "reviews") -> dict | None:
    """Full document: {'protocol': ..., 'snapshots': [...]} or None."""
    return _read(item_id, kind)


def latest(item_id: str, *, kind: str = "reviews") -> dict | None:
    doc = _read(item_id, kind)
    if not doc or not doc["snapshots"]:
        return None
    return doc["snapshots"][-1]


def list_items(kind: str = "reviews") -> list[dict]:
    """Every item's protocol plus a light status line, newest activity first."""
    out = []
    for f in sorted(_dir(kind).glob("*.json")):
        try:
            doc = json.loads(f.read_text(encoding="utf-8"))
        except (json.JSONDecodeError, OSError):
            continue
        snaps = doc.get("snapshots", [])
        out.append({"protocol": doc.get("protocol", {}), "snapshots": snaps,
                    "last": snaps[-1] if snaps else None, "count": len(snaps)})
    out.sort(key=lambda r: ((r["last"] or {}).get("taken")
                            or (r["last"] or {}).get("checked") or ""), reverse=True)
    return out


def list_reviews() -> list[dict]:
    """Back-compat summary for living reviews."""
    rows = []
    for it in list_items("reviews"):
        last = it["last"]
        rows.append({
            "protocol": it["protocol"], "syncs": it["count"],
            "last_synced": last.get("taken") if last else None,
            "overall_strength": last.get("overall_strength") if last else None,
            "included": (last.get("prisma", {}) or {}).get("included") if last else None,
        })
    return rows


def delete(item_id: str, *, kind: str = "reviews") -> bool:
    p = _path(item_id, kind)
    if p.exists():
        p.unlink()
        return True
    return False
