"""The Strata Evidence Graph — the proprietary, compounding knowledge layer.

Anyone can search PubMed. The moat is what accumulates *on top of* the search: a graph that
links every monitored claim to the graded studies behind it, across the whole evidence base,
and the intelligence that only exists once you hold that graph.

    Claim ──cites(stance,version)──▶ Study ──▶ Population / Intervention / Outcome / Effect
       ▲                                │
       └────────── shares evidence ─────┘

From the accumulated graph this module computes signals a single query never can:

* **Hub studies**   — the studies that underpin the most claims (a new one ripples widely).
* **Contested studies** — cited as *support* by some claims and *contradict* by others.
* **Unstable claims**   — high version/status churn; the conclusions least safe to rely on.
* **Evidence gaps**     — populations / interventions / outcomes where the evidence is thin.
* **Shared-evidence links** — which claims move together because they rest on the same trials.
* **Study reliability**  — a compounding score: does a study hold up across the claims it touches?

Every signal is computed from data Strata already holds (claims + their graded citations +
version history). It gets richer as more claims are monitored and more history accrues — that
is the compounding asset. Heuristic and honest: it reasons over graded bibliographic
metadata, never over patient data, and labels its scores as heuristic.
"""
from __future__ import annotations

import math
import re
from typing import Optional

from . import store
from .entities import _area_index, _versioned  # reuse the claim-model helpers

_CONFLICT = {"Mixed", "Contradicted"}
_SUP = {"none": 0, "very low": 1, "low": 2, "moderate": 3, "high": 4}


def _norm_title(t: str) -> str:
    return re.sub(r"[^a-z0-9]", "", (t or "").lower())[:60]


def _study_key(c: dict) -> str:
    return (c.get("pmid") or c.get("doi") or ("ttl:" + _norm_title(c.get("title", "")))) or "?"


def _claims(workspace_id: Optional[str] = None) -> list:
    out = []
    for it in store.list_items("claims"):
        p = it["protocol"]
        if workspace_id and p.get("workspace_id") != workspace_id:
            continue
        out.append(it)
    return out


# --------------------------------------------------------------------------- build
def build(workspace_id: Optional[str] = None) -> dict:
    """Assemble the graph: study nodes with the claims that cite them, and per-claim history."""
    areas = _area_index()
    studies: dict = {}
    claims: dict = {}
    for it in _claims(workspace_id):
        p = it["protocol"]
        snaps = it.get("snapshots", [])
        if not snaps:
            continue
        cur = snaps[-1]
        versioned = _versioned(snaps)
        cid = p["id"]
        claims[cid] = {
            "id": cid, "claim": p.get("claim"), "area_id": p.get("area_id"),
            "area": (areas.get(p.get("area_id")) or {}).get("name") if p.get("area_id") else None,
            "status": cur.get("status"), "strength": cur.get("strength"),
            "version": versioned[-1][0] if versioned else 0,
            "history": [{"status": s.get("status"), "strength": s.get("strength"),
                         "checked": s.get("checked"), "changed": bool(s.get("evidence_changed"))}
                        for s in snaps],
            "study_keys": set(),
        }
        for c in cur.get("citations", []):
            k = _study_key(c)
            claims[cid]["study_keys"].add(k)
            s = studies.setdefault(k, {
                "key": k, "pmid": c.get("pmid"), "doi": c.get("doi"), "title": c.get("title"),
                "label": c.get("label"), "level": c.get("level"), "year": c.get("year"),
                "source": c.get("source"), "url": c.get("url"), "cited_by": c.get("cited_by"),
                "edges": []})
            # keep the strongest-labelled metadata if seen again
            if (c.get("level") or 9) < (s.get("level") or 9):
                s.update({"label": c.get("label"), "level": c.get("level")})
            s["edges"].append({"claim_id": cid, "claim": p.get("claim"),
                               "stance": c.get("stance"), "status": cur.get("status"),
                               "strength": cur.get("strength")})
    return {"studies": studies, "claims": claims}


# ------------------------------------------------------------------- instability
def _instability(hist: list) -> float:
    """0..1 churn score from a claim's history: status transitions dominate, then strength
    moves, then sheer number of material changes."""
    if len(hist) < 2:
        return 0.0
    status_tx = sum(1 for a, b in zip(hist, hist[1:]) if a["status"] != b["status"])
    strength_tx = sum(1 for a, b in zip(hist, hist[1:])
                      if a["strength"] != b["strength"])
    changes = sum(1 for h in hist[1:] if h.get("changed"))
    raw = status_tx * 2.0 + strength_tx * 1.0 + changes * 0.5
    return round(min(1.0, raw / (len(hist) + 1.5)), 3)


# ------------------------------------------------------------- study reliability
def _reliability(study: dict) -> float:
    """A compounding, heuristic 0..1 reliability signal for a study.

    Rewards: high design level, breadth (cited by many claims), and consistently sitting on
    the *supporting* side of well-supported claims. Penalises: sitting on the contradicting
    side, or association with claims that are themselves Mixed / Contradicted.
    """
    edges = study["edges"]
    if not edges:
        return 0.0
    level = study.get("level") or 6
    design = {1: 1.0, 2: 0.9, 3: 0.65, 4: 0.45, 5: 0.3, 6: 0.35}.get(level, 0.4)
    breadth = min(1.0, math.log10(len(edges) + 1) / math.log10(6))   # saturates ~5 claims
    agree = 0.0
    for e in edges:
        base = _SUP.get(e.get("strength") or "none", 0) / 4.0
        if e.get("stance") == "support" and e.get("status") not in _CONFLICT:
            agree += 0.5 + 0.5 * base
        elif e.get("stance") == "contradict":
            agree -= 0.3
        elif e.get("status") in _CONFLICT:
            agree -= 0.1
    agree = max(0.0, min(1.0, 0.5 + agree / (2 * len(edges))))
    score = 0.5 * design + 0.2 * breadth + 0.3 * agree
    return round(max(0.0, min(1.0, score)), 3)


def _study_out(s: dict) -> dict:
    claim_ids = sorted({e["claim_id"] for e in s["edges"]})
    stances = [e["stance"] for e in s["edges"]]
    return {
        "key": s["key"], "pmid": s["pmid"], "doi": s["doi"], "title": s["title"],
        "label": s["label"], "level": s["level"], "year": s["year"], "source": s["source"],
        "url": s["url"], "cited_by": s["cited_by"],
        "claim_count": len(claim_ids), "claim_ids": claim_ids,
        "support": stances.count("support"), "contradict": stances.count("contradict"),
        "neutral": stances.count("neutral"),
        "contested": stances.count("support") > 0 and stances.count("contradict") > 0,
        "reliability": _reliability(s),
    }


# ------------------------------------------------------------------- signals
def hub_studies(g: dict, limit: int = 10) -> list:
    rows = [_study_out(s) for s in g["studies"].values()]
    rows = [r for r in rows if r["claim_count"] >= 1]
    rows.sort(key=lambda r: (-r["claim_count"], -(r["cited_by"] or 0), r["level"] or 9))
    return rows[:limit]


def contested_studies(g: dict, limit: int = 10) -> list:
    rows = [_study_out(s) for s in g["studies"].values()]
    rows = [r for r in rows if r["contested"] or r["contradict"] >= 1]
    rows.sort(key=lambda r: (-(1 if r["contested"] else 0), -min(r["support"], r["contradict"])
                             if r["contested"] else 0, -r["contradict"], -r["claim_count"]))
    return rows[:limit]


def unstable_claims(g: dict, limit: int = 10) -> list:
    rows = []
    for c in g["claims"].values():
        score = _instability(c["history"])
        rows.append({"id": c["id"], "claim": c["claim"], "area": c["area"],
                     "status": c["status"], "strength": c["strength"], "version": c["version"],
                     "instability": score,
                     "in_conflict": c["status"] in _CONFLICT})
    rows.sort(key=lambda r: (-r["instability"], -r["version"]))
    return [r for r in rows if r["instability"] > 0 or r["in_conflict"]][:limit]


def evidence_gaps(g: dict, limit: int = 10) -> list:
    """Claims whose evidence is thin (Insufficient/Unsupported, or weak strength with little
    aligned support) — the places an organization is exposed."""
    rows = []
    for c in g["claims"].values():
        weak = (c["status"] in ("Insufficient", "Unsupported")
                or (_SUP.get(c["strength"] or "none", 0) <= 1))
        if not weak:
            continue
        rows.append({"id": c["id"], "claim": c["claim"], "area": c["area"],
                     "status": c["status"], "strength": c["strength"],
                     "n_studies": len(c["study_keys"])})
    rows.sort(key=lambda r: (_SUP.get(r["strength"] or "none", 0), r["n_studies"]))
    return rows[:limit]


def related_claims(g: dict, claim_id: str, limit: int = 8) -> list:
    """Claims that share graded evidence with this one — how a single new study ripples."""
    me = g["claims"].get(claim_id)
    if not me:
        return []
    out = []
    for cid, c in g["claims"].items():
        if cid == claim_id:
            continue
        shared = me["study_keys"] & c["study_keys"]
        if not shared:
            continue
        # weight a shared meta-analysis / RCT more than a shared observational study
        weight = 0.0
        for k in shared:
            lvl = (g["studies"].get(k) or {}).get("level") or 6
            weight += {1: 3.0, 2: 2.2, 3: 1.4}.get(lvl, 1.0)
        out.append({"id": cid, "claim": c["claim"], "area": c["area"], "status": c["status"],
                    "strength": c["strength"], "shared": len(shared), "weight": round(weight, 1),
                    "shared_studies": sorted(shared)})
    out.sort(key=lambda r: (-r["weight"], -r["shared"]))
    return out[:limit]


def study_detail(g: dict, study_id: str) -> Optional[dict]:
    s = g["studies"].get(study_id)
    if not s:
        for cand in g["studies"].values():           # allow lookup by pmid/doi
            if cand.get("pmid") == study_id or cand.get("doi") == study_id:
                s = cand
                break
    if not s:
        return None
    out = _study_out(s)
    out["claims"] = [{"claim_id": e["claim_id"], "claim": e["claim"], "stance": e["stance"],
                      "status": e["status"], "strength": e["strength"]} for e in s["edges"]]
    return out


def summary(workspace_id: Optional[str] = None, *, g: Optional[dict] = None) -> dict:
    """The Evidence-Graph rollup — the size and shape of the accumulated asset."""
    g = g or build(workspace_id)
    studies = [_study_out(s) for s in g["studies"].values()]
    edges = sum(s["claim_count"] for s in studies)
    contested = [s for s in studies if s["contested"]]
    shared = sum(1 for s in studies if s["claim_count"] >= 2)
    unstable = unstable_claims(g, limit=10_000)
    gaps = evidence_gaps(g, limit=10_000)
    reliab = [s["reliability"] for s in studies] or [0.0]
    return {
        "claims": len(g["claims"]),
        "studies": len(studies),
        "edges": edges,
        "hub_studies": sum(1 for s in studies if s["claim_count"] >= 2),
        "shared_evidence_studies": shared,
        "contested_studies": len(contested),
        "unstable_claims": len(unstable),
        "evidence_gaps": len(gaps),
        "avg_reliability": round(sum(reliab) / len(reliab), 3),
        "density": round(edges / max(1, len(g["claims"])), 2),   # avg studies per claim
    }


def graph_view(workspace_id: Optional[str] = None, *, top_studies: int = 40) -> dict:
    """A node-link view for the explorer: claim nodes + the studies that connect them, biased
    to the shared / high-level evidence that actually shapes the graph."""
    g = build(workspace_id)
    claim_nodes = [{"id": c["id"], "type": "claim", "label": c["claim"], "area": c["area"],
                    "status": c["status"], "strength": c["strength"]}
                   for c in g["claims"].values()]
    studies = [_study_out(s) for s in g["studies"].values()]
    # prefer studies that connect multiple claims, then strong designs
    studies.sort(key=lambda r: (-r["claim_count"], r["level"] or 9, -(r["cited_by"] or 0)))
    keep = studies[:top_studies]
    study_nodes, links = [], []
    for s in keep:
        study_nodes.append({"id": s["key"], "type": "study", "label": s["title"],
                            "level": s["level"], "reliability": s["reliability"],
                            "claim_count": s["claim_count"], "contested": s["contested"],
                            "url": s["url"]})
        raw = g["studies"][s["key"]]
        for e in raw["edges"]:
            links.append({"source": e["claim_id"], "target": s["key"], "stance": e["stance"]})
    return {"claims": claim_nodes, "studies": study_nodes, "links": links,
            "summary": summary(workspace_id, g=g)}
