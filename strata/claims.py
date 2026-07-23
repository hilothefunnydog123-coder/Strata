"""Claim service — the bridge between the Verify engine and the versioned store.

This is where a verdict becomes durable, auditable history. Ingesting a verdict
persists every study and its per-claim analysis, then diffs the new evidence set
against the claim's previous version to decide whether the evidence changed
*materially*. When it did, a new claim version is written and change events are
recorded — that append-only timeline is the moat: a versioned map of what the
evidence said, and when it changed.
"""
from __future__ import annotations

from typing import Any, Callable, Dict, List, Optional

from .db import Database
from .pico import structure
from .verify import Verdict, verify as _verify

_ORDER = ["none", "very low", "low", "moderate", "high"]


def create_claim_from_question(db: Database, workspace_id: int, question: str, *,
                               therapeutic_area: Optional[str] = None) -> int:
    """Create a claim, pre-filling its PICO from the question."""
    pico = structure(question)
    ta_id = db.ensure_therapeutic_area(workspace_id, therapeutic_area) if therapeutic_area else None
    return db.create_claim(
        workspace_id, question,
        population={"value": pico.population.get("value", ""),
                    "terms": pico.population.get("terms", []),
                    "age_min": pico.population.get("age_min"),
                    "age_max": pico.population.get("age_max")},
        intervention=pico.intervention.get("value", ""),
        comparator=pico.comparator.get("value", ""),
        outcome=pico.outcome.get("value", ""),
        therapeutic_area_id=ta_id)


def _persist_evidence(db: Database, claim_id: int, version: int, verdict: Verdict) -> None:
    for line in verdict.lines:
        a, e, g = line.article, line.extraction, line.grade
        study_id = db.upsert_study(
            dedup_key=a.dedup_key, source=a.source, pmid=a.pmid or None, doi=a.doi or None,
            title=a.title, abstract=a.abstract, journal=a.journal, year=a.year,
            authors=a.authors, publication_types=a.publication_types, url=a.url,
            has_full_text=a.has_full_text, extraction=e)
        effects = e.get("effects") or []
        db.add_evidence_item(
            claim_id, version, study_id, stance=line.stance,
            stance_reason=line.stance_reason, disagreement_type=line.disagreement_type,
            relevance_score=line.relevance, grade_level=g.level, grade_label=g.label,
            strength=g.strength, effect=effects[0] if effects else None,
            population_match=line.population_match)


def _diff(prev_version: Dict[str, Any], prev_keys: set, verdict: Verdict) -> Dict[str, Any]:
    """Compare a fresh verdict against the previous stored version."""
    new_keys = {l.article.dedup_key for l in verdict.lines}
    added = [l for l in verdict.lines if l.article.dedup_key not in prev_keys]

    prev_strength = prev_version["evidence_strength"]
    prev_status = prev_version["status"]
    new_strength = verdict.evidence_strength
    new_status = verdict.status

    si_prev = _ORDER.index(prev_strength) if prev_strength in _ORDER else 0
    si_new = _ORDER.index(new_strength) if new_strength in _ORDER else 0
    strength_direction = "up" if si_new > si_prev else ("down" if si_new < si_prev else "same")

    events: List[Dict[str, Any]] = []
    for l in added:
        if l.grade.level == 1:
            ctype, impact = "new_meta_analysis", "high"
        elif l.grade.level == 2:
            ctype, impact = "new_rct", "high"
        else:
            ctype, impact = "new_study", "low"
        events.append({"type": ctype, "impact": impact,
                       "summary": f"New {l.grade.label.lower()} ({l.article.year or 'n.d.'}): "
                                  f"{l.article.title}",
                       "line": l})
        if l.stance == "contradicting":
            events.append({"type": "new_contradiction",
                           "impact": "high" if l.grade.level <= 2 else "moderate",
                           "summary": f"New contradicting {l.grade.label.lower()}: "
                                      f"{l.article.title}",
                           "line": l})

    if strength_direction != "same":
        events.append({
            "type": "strength_change",
            "impact": "high" if strength_direction == "down" else "moderate",
            "summary": f"Evidence strength changed {prev_strength.upper()} → "
                       f"{new_strength.upper()}",
            "detail": {"direction": strength_direction, "from": prev_strength,
                       "to": new_strength}})
    if new_status != prev_status:
        events.append({
            "type": "status_change",
            "impact": "high" if new_status in ("contested", "unsupported") else "moderate",
            "summary": f"Claim status changed {prev_status} → {new_status}",
            "detail": {"from": prev_status, "to": new_status}})

    material = bool(added) or strength_direction != "same" or new_status != prev_status
    trend = ("strengthening" if strength_direction == "up"
             else "weakening" if strength_direction == "down" else "stable")
    return {"events": events, "material": material, "trend": trend,
            "added": added, "strength_direction": strength_direction}


def ingest(db: Database, claim_id: int, verdict: Verdict, *,
           monitor_id: Optional[int] = None,
           alert_types: Optional[set] = None) -> Dict[str, Any]:
    """Persist a verdict as claim history; return what changed.

    First verification writes the baseline (version 1). Later verifications
    write a new version only when the evidence changed materially, recording
    change events and raising alerts for the high-impact ones.
    """
    claim = db.get_claim(claim_id)
    if claim is None:
        raise ValueError(f"claim {claim_id} not found")
    prev = db.latest_version(claim_id)

    if prev is None:
        version = 1
        _persist_evidence(db, claim_id, version, verdict)
        db.add_claim_version(
            claim_id, version, status=verdict.status,
            evidence_strength=verdict.evidence_strength,
            best_level=verdict.assessment.get("best_level"),
            supporting=len(verdict.supporting), contradicting=len(verdict.contradicting),
            neutral=len(verdict.neutral), assessment=verdict.assessment,
            summary=verdict.assessment["summary"], fingerprint=verdict.fingerprint)
        db.update_claim_state(claim_id, status=verdict.status,
                              evidence_strength=verdict.evidence_strength,
                              trend="new", version=version)
        ev_id = db.record_change_event(
            claim_id, from_version=None, to_version=version, change_type="baseline",
            impact="info", summary="Baseline evidence assessment established.")
        return {"version": version, "material": True, "baseline": True,
                "events": 1, "alerts": 0, "trend": "new", "change_event_ids": [ev_id]}

    # -- subsequent verification: diff against the previous version ---------
    prev_items = db.evidence_for_version(claim_id, prev["version"])
    prev_keys = {it["dedup_key"] for it in prev_items}
    diff = _diff(prev, prev_keys, verdict)

    if not diff["material"]:
        db.update_claim_state(claim_id, status=verdict.status,
                              evidence_strength=verdict.evidence_strength,
                              trend="stable", version=prev["version"])
        return {"version": prev["version"], "material": False, "events": 0, "alerts": 0,
                "trend": "stable", "change_event_ids": []}

    version = prev["version"] + 1
    _persist_evidence(db, claim_id, version, verdict)
    db.add_claim_version(
        claim_id, version, status=verdict.status,
        evidence_strength=verdict.evidence_strength,
        best_level=verdict.assessment.get("best_level"),
        supporting=len(verdict.supporting), contradicting=len(verdict.contradicting),
        neutral=len(verdict.neutral), assessment=verdict.assessment,
        summary=verdict.assessment["summary"], fingerprint=verdict.fingerprint)
    db.update_claim_state(claim_id, status=verdict.status,
                          evidence_strength=verdict.evidence_strength,
                          trend=diff["trend"], version=version)

    event_ids, alerts = [], 0
    for ev in diff["events"]:
        line = ev.get("line")
        study_id = None
        if line is not None:
            row = db.one("SELECT id FROM studies WHERE dedup_key=?", (line.article.dedup_key,))
            study_id = row["id"] if row else None
        ev_id = db.record_change_event(
            claim_id, from_version=prev["version"], to_version=version,
            change_type=ev["type"], impact=ev["impact"], summary=ev["summary"],
            detail=ev.get("detail"), study_id=study_id)
        event_ids.append(ev_id)
        if ev["impact"] == "high" and (alert_types is None or ev["type"] in alert_types):
            db.create_alert(
                claim_id, change_event_id=ev_id, monitor_id=monitor_id,
                level="critical" if ev["type"] in ("strength_change", "status_change",
                                                    "new_contradiction") else "warning",
                title=ev["summary"],
                body=verdict.assessment["summary"],
                recommended_action=_recommended_action(ev["type"]))
            alerts += 1

    return {"version": version, "material": True, "events": len(diff["events"]),
            "alerts": alerts, "trend": diff["trend"], "change_event_ids": event_ids,
            "strength_direction": diff["strength_direction"]}


def _recommended_action(change_type: str) -> str:
    return {
        "strength_change": "Review the claim and any affected materials — the certainty of the "
                           "evidence has moved.",
        "status_change": "Review the claim: its overall support status has changed.",
        "new_contradiction": "Review the new contradicting study and assess whether the claim "
                             "still holds in your population.",
        "new_rct": "Assess the new randomized trial's effect against the existing evidence base.",
        "new_meta_analysis": "Assess the new meta-analysis — it may supersede earlier estimates.",
    }.get(change_type, "Review the affected claim materials.")
