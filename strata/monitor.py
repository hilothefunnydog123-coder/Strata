"""The evidence-change engine — continuous monitoring of claims.

This is what turns Strata from a research website into enterprise
infrastructure. A monitor re-runs verification for a claim on a schedule,
compares the fresh evidence against the stored version, and — when something
material appears (a new RCT, a new meta-analysis, a fresh contradiction, a shift
in strength or status) — records the change and raises an alert with a
recommended action. Think of it as CI for medical knowledge: the claim is the
build, new literature is the commit, and a weakening result is a failing check.
"""
from __future__ import annotations

import datetime as _dt
from typing import Any, Callable, Dict, List, Optional

from .claims import ingest
from .db import Database, now_iso
from .verify import verify as _verify

FREQUENCY_DAYS = {"daily": 1, "weekly": 7, "monthly": 30}

# The conditions an organization can choose to be alerted on.
ALERT_CONDITIONS = [
    "new_rct", "new_meta_analysis", "new_contradiction",
    "strength_change", "status_change", "new_study",
]


def _next_run(frequency: str, *, from_time: Optional[_dt.datetime] = None) -> str:
    base = from_time or _dt.datetime.now(_dt.timezone.utc)
    days = FREQUENCY_DAYS.get(frequency, 7)
    return (base + _dt.timedelta(days=days)).replace(microsecond=0).isoformat()


def create_monitor(db: Database, claim_id: int, *, frequency: str = "weekly",
                   conditions: Optional[List[str]] = None) -> int:
    """Start monitoring a claim. Conditions default to the high-impact set."""
    conditions = conditions or ["new_rct", "new_meta_analysis", "new_contradiction",
                                "strength_change", "status_change"]
    return db.create_monitor(claim_id, frequency=frequency, conditions=conditions,
                             next_run_at=_next_run(frequency))


def run_monitor(db: Database, claim_id: int, *,
                verify_fn: Callable[..., Any] = _verify,
                sources: Optional[List[str]] = None,
                current_year: Optional[int] = None,
                **verify_kwargs) -> Dict[str, Any]:
    """Re-verify one claim and ingest the result, raising alerts as configured."""
    claim = db.get_claim(claim_id)
    if claim is None:
        raise ValueError(f"claim {claim_id} not found")
    monitor = db.get_monitor(claim_id)
    alert_types = set(monitor["conditions"]) if monitor and monitor.get("conditions") else None

    verdict = verify_fn(claim["text"], claim_population=claim.get("population"),
                        sources=sources, current_year=current_year, **verify_kwargs)
    result = ingest(db, claim_id, verdict,
                    monitor_id=monitor["id"] if monitor else None,
                    alert_types=alert_types)
    if monitor:
        db.mark_monitor_run(claim_id, _next_run(monitor["frequency"]))
    result["claim_id"] = claim_id
    return result


def run_due(db: Database, *, workspace_id: Optional[int] = None,
            verify_fn: Callable[..., Any] = _verify, limit: int = 100,
            **kwargs) -> List[Dict[str, Any]]:
    """Run every monitor whose next run time has passed (the scheduler tick)."""
    now = now_iso()
    where = "m.active=1 AND (m.next_run_at IS NULL OR m.next_run_at<=?)"
    params: List[Any] = [now]
    if workspace_id is not None:
        where += " AND c.workspace_id=?"; params.append(workspace_id)
    due = db.query(
        f"SELECT m.claim_id FROM monitors m JOIN claims c ON c.id=m.claim_id "
        f"WHERE {where} LIMIT ?", params + [limit])
    out = []
    for row in due:
        try:
            out.append(run_monitor(db, row["claim_id"], verify_fn=verify_fn, **kwargs))
        except Exception as exc:
            out.append({"claim_id": row["claim_id"], "error": f"{type(exc).__name__}: {exc}"})
    return out
