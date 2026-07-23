"""The contradiction engine — Strata's core differentiator.

Most tools average everything into one confident answer. Strata does the
opposite: for every claim it actively separates the evidence that *supports* it
from the evidence that *weakens* it, and then explains **why** they disagree —
because the disagreement is usually the most decision-relevant thing in the
literature.

A study's stance toward a claim is derived from the claim's polarity (does it
assert the intervention helps?) and the study's own directional read (does the
study find a benefit, a harm, or a null result?), tempered by how well the
study's population matches the claim. When a study contradicts, we attribute a
*reason for disagreement* — different population, dose, outcome, design,
severity, statistical uncertainty, or genuine scientific conflict — rather than
silently down-weighting it.
"""
from __future__ import annotations

import re
from typing import Any, Dict, List, Optional

_BENEFIT_VERBS = ["reduc", "prevent", "improv", "lower", "decreas", "protect",
                  "effective", "benefit", "increases survival", "slows"]
_HARM_VERBS = ["increase risk", "increases risk", "cause", "harm", "worsen", "raises risk"]


def claim_polarity(claim_text: str) -> str:
    """What does the claim assert? benefit | harm | association."""
    low = claim_text.lower()
    if any(v in low for v in _HARM_VERBS):
        return "harm"
    if any(v in low for v in _BENEFIT_VERBS):
        return "benefit"
    if "associated with" in low or "linked to" in low or "correlat" in low:
        return "association"
    return "benefit"      # clinical claims are usually efficacy assertions


def population_match(claim_pop: Optional[Dict[str, Any]],
                     study_pop: Optional[Dict[str, Any]]) -> Dict[str, Any]:
    """How well does the study population fit the claim's population?

    Returns match ∈ good | partial | different | unknown with the reasons, so
    directness can be judged transparently rather than assumed.
    """
    if not study_pop:
        return {"match": "unknown", "reasons": ["study population not reported in abstract"]}
    if not claim_pop:
        return {"match": "unknown", "reasons": ["claim did not specify a population"]}

    reasons: List[str] = []
    score = 0
    total = 0
    c_terms = set(t.lower() for t in claim_pop.get("terms", []))
    s_terms = set(t.lower() for t in study_pop.get("terms", []))
    if c_terms:
        total += 1
        if c_terms & s_terms:
            score += 1; reasons.append(f"shared population terms: {', '.join(sorted(c_terms & s_terms))}")
        else:
            reasons.append(f"claim population {sorted(c_terms)} not confirmed in study")

    c_min, c_max = claim_pop.get("age_min"), claim_pop.get("age_max")
    s_min, s_max = study_pop.get("age_min"), study_pop.get("age_max")
    if c_min is not None and (s_min is not None or s_max is not None):
        total += 1
        # claim wants ">= c_min"; study covers it if its range overlaps
        study_hi = s_max if s_max is not None else 200
        study_lo = s_min if s_min is not None else 0
        if study_hi >= c_min and (c_max is None or study_lo <= c_max):
            score += 1; reasons.append(f"age range overlaps (claim ≥{c_min})")
        else:
            reasons.append(f"age mismatch: claim ≥{c_min}, study {s_min}-{s_max}")

    if total == 0:
        return {"match": "unknown", "reasons": ["insufficient population detail to compare"]}
    ratio = score / total
    match = "good" if ratio >= 0.99 else ("partial" if ratio > 0 else "different")
    return {"match": match, "reasons": reasons, "score": round(ratio, 2)}


def classify_stance(polarity: str, extraction: Dict[str, Any],
                    pop: Dict[str, Any]) -> Dict[str, Any]:
    """Assign a study's stance toward the claim, with a reason (and, if it
    contradicts, the *type* of disagreement)."""
    direction = (extraction.get("direction") or {}).get("value", "unclear")
    effects = extraction.get("effects", [])
    sig = next((e for e in effects if e.get("significant")), None)

    # Map the study's benefit/harm/null read onto the claim's polarity.
    if polarity == "harm":
        supports = direction == "harm"
        opposes = direction == "benefit"
    else:  # benefit or association treated as "intervention does something"
        supports = direction == "benefit"
        opposes = direction == "harm"

    match = pop.get("match", "unknown")

    if direction == "unclear":
        return {"stance": "neutral", "reason": "no clear directional finding in the abstract",
                "disagreement_type": None}

    if supports:
        if match == "different":
            return {"stance": "neutral",
                    "reason": "directionally supportive but in a different population",
                    "disagreement_type": None}
        detail = f"reports a {direction} consistent with the claim"
        if sig:
            detail += f" ({sig['metric']} {sig['value']}, statistically significant)"
        return {"stance": "supporting", "reason": detail, "disagreement_type": None}

    if opposes:
        dtype = _disagreement_type(extraction, pop)
        return {"stance": "contradicting",
                "reason": f"reports a {direction}, the opposite direction to the claim",
                "disagreement_type": dtype}

    # direction == "null" (no effect / non-significant): weakens an efficacy claim
    if direction == "null":
        if match == "different":
            dtype = "population"
        elif _imprecise(extraction):
            dtype = "statistical"        # underpowered / wide interval
        else:
            dtype = "genuine"            # a precise, well-powered null is a real conflict
        detail = ("reports an imprecise null result" if dtype == "statistical"
                  else "reports a precise null result, not the effect the claim asserts")
        return {"stance": "contradicting", "reason": detail, "disagreement_type": dtype}

    return {"stance": "neutral", "reason": "not clearly for or against the claim",
            "disagreement_type": None}


def _imprecise(extraction: Dict[str, Any]) -> bool:
    """A wide confidence interval or a small sample → the result is imprecise.

    Distinguishing this from a *precise* null is what separates 'we can't tell'
    (statistical uncertainty) from 'it genuinely didn't work here' (real conflict).
    """
    for e in extraction.get("effects", []):
        lo, hi = e.get("ci_low"), e.get("ci_high")
        if lo is not None and hi is not None:
            width = hi - lo
            if (e["kind"] == "ratio" and width > 0.5) or (e["kind"] == "difference" and width > 5):
                return True
    n = (extraction.get("sample_size") or {}).get("value")
    return n is not None and n < 100


def _disagreement_type(extraction: Dict[str, Any], pop: Dict[str, Any]) -> str:
    """Best guess at *why* a study disagrees — attributed, not hidden."""
    if pop.get("match") == "different":
        return "population"
    if _imprecise(extraction):
        return "statistical"
    level = (extraction.get("design") or {}).get("level", 6)
    if level >= 4:
        return "design"     # weaker design disagreeing with a claim
    return "genuine"        # comparable, precise design in real scientific conflict


DISAGREEMENT_LABELS = {
    "population": "Different population studied",
    "dose": "Different dose or regimen",
    "outcome": "Different outcome measured",
    "design": "Weaker or different study design",
    "severity": "Different disease severity",
    "statistical": "Statistical uncertainty / imprecision",
    "genuine": "Genuine scientific disagreement",
}
