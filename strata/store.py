"""Persistence for living reviews — plain JSON on disk, standard library only.

A living systematic review is only "living" if it remembers what it saw last time. This
module keeps each review — its protocol plus a bounded history of graded snapshots — in a
single JSON file, so a re-run can diff against the previous state and report what changed.

Location: ``$STRATA_HOME`` if set, else ``~/.strata``. No database, no service, nothing to
operate. It stores bibliographic metadata and grades only — never patient data.
"""
from __future__ import annotations

import json
import os
from pathlib import Path

_MAX_SNAPSHOTS = 24          # keep history bounded; enough for a trend line


def home() -> Path:
    p = Path(os.environ.get("STRATA_HOME", Path.home() / ".strata"))
    (p / "reviews").mkdir(parents=True, exist_ok=True)
    return p


def _path(review_id: str) -> Path:
    safe = "".join(c for c in review_id if c.isalnum() or c in "-_")
    return home() / "reviews" / f"{safe}.json"


def _read(review_id: str) -> dict | None:
    p = _path(review_id)
    if not p.exists():
        return None
    try:
        return json.loads(p.read_text(encoding="utf-8"))
    except (json.JSONDecodeError, OSError):
        return None


def _write(review_id: str, doc: dict) -> None:
    p = _path(review_id)
    tmp = p.with_suffix(".json.tmp")
    tmp.write_text(json.dumps(doc, indent=2), encoding="utf-8")
    tmp.replace(p)          # atomic-ish swap


def save_protocol(protocol: dict) -> None:
    rid = protocol["id"]
    doc = _read(rid) or {"protocol": protocol, "snapshots": []}
    doc["protocol"] = protocol
    _write(rid, doc)


def append_snapshot(review_id: str, snapshot: dict) -> None:
    doc = _read(review_id)
    if doc is None:
        raise KeyError(f"no such review: {review_id}")
    doc["snapshots"].append(snapshot)
    doc["snapshots"] = doc["snapshots"][-_MAX_SNAPSHOTS:]
    _write(review_id, doc)


def get(review_id: str) -> dict | None:
    """Full document: {'protocol': ..., 'snapshots': [...]} or None."""
    return _read(review_id)


def latest(review_id: str) -> dict | None:
    doc = _read(review_id)
    if not doc or not doc["snapshots"]:
        return None
    return doc["snapshots"][-1]


def list_reviews() -> list[dict]:
    """Every review's protocol plus a light status line, newest activity first."""
    out = []
    for f in sorted((home() / "reviews").glob("*.json")):
        try:
            doc = json.loads(f.read_text(encoding="utf-8"))
        except (json.JSONDecodeError, OSError):
            continue
        snaps = doc.get("snapshots", [])
        last = snaps[-1] if snaps else None
        out.append({
            "protocol": doc.get("protocol", {}),
            "syncs": len(snaps),
            "last_synced": last.get("taken") if last else None,
            "overall_strength": last.get("overall_strength") if last else None,
            "included": last.get("prisma", {}).get("included") if last else None,
        })
    out.sort(key=lambda r: (r["last_synced"] or ""), reverse=True)
    return out


def delete(review_id: str) -> bool:
    p = _path(review_id)
    if p.exists():
        p.unlink()
        return True
    return False
