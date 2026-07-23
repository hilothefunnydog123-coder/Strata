"""Transparent evidence-strength assessment — the grade must be inspectable.

An AI saying "the evidence is strong" is worth nothing. This module computes a
strength grade the way a methodologist would defend it: from a base set by the
best supporting study design, then adjusted across GRADE-style domains —
quantity, consistency, directness, precision, risk of bias, recency,
replication, and (critically) contradiction. Every adjustment is recorded as a
human-readable ``+`` reason or ``-`` limitation, so the number can always be
opened up and challenged.

    strength ∈ high | moderate | low | very low | none
    status   ∈ supported | partially_supported | contested | unsupported
             | insufficient_evidence
"""
from __future__ import annotations

from typing import Any, Dict, List, Optional

_ORDER = ["very low", "low", "moderate", "high"]
_BASE_BY_LEVEL = {1: "high", 2: "high", 3: "moderate", 4: "low", 5: "very low", 6: "very low"}
_DESIGN = {1: "systematic review / meta-analysis", 2: "randomized controlled trial",
           3: "cohort / prospective study", 4: "observational study",
           5: "case report / series", 6: "review / opinion"}


def _down(idx: int, n: int = 1) -> int:
    return max(0, idx - n)


def assess(records: List[Dict[str, Any]], *, current_year: int,
           claim_population: Optional[Dict[str, Any]] = None) -> Dict[str, Any]:
    """Grade a body of evidence for one claim.

    ``records`` is one dict per retrieved study with the fields the pipeline has
    already computed: level, label, stance, significant, population_match, year,
    sample_size, industry_funded, direction.
    """
    if not records:
        return {
            "strength": "none", "status": "insufficient_evidence", "score": 0.0,
            "best_level": None, "counts": {"supporting": 0, "contradicting": 0, "neutral": 0},
            "reasons": [], "limitations": ["No studies were retrieved for this claim."],
            "domains": {}, "basis": "no evidence",
            "summary": "No evidence retrieved — the claim is unverified, which is not the "
                       "same as false.",
        }

    supporting = [r for r in records if r["stance"] == "supporting"]
    contradicting = [r for r in records if r["stance"] == "contradicting"]
    neutral = [r for r in records if r["stance"] == "neutral"]
    counts = {"supporting": len(supporting), "contradicting": len(contradicting),
              "neutral": len(neutral)}

    reasons: List[str] = []
    limitations: List[str] = []
    domains: Dict[str, Any] = {}

    # -- base: best supporting design (fall back to best overall) -----------
    pool = supporting or records
    best_level = min((r["level"] for r in pool), default=6)
    best_support_level = min((r["level"] for r in supporting), default=best_level)
    base = _BASE_BY_LEVEL[best_level]
    idx = _ORDER.index(base)
    domains["study_design"] = {
        "best_level": best_level, "design": _DESIGN[best_level], "base_certainty": base,
        "note": f"Strongest {'supporting ' if supporting else ''}evidence is a "
                f"{_DESIGN[best_level]}."}
    reasons.append(f"Strongest {'supporting ' if supporting else ''}evidence is a "
                   f"{_DESIGN[best_level]}")

    # -- quantity -----------------------------------------------------------
    # A lone meta-analysis or systematic review (level 1) already aggregates many
    # studies, so it is not penalised as "a single study"; a lone primary study is.
    strong_support = [r for r in supporting if r["level"] <= 3]
    if not supporting:
        idx = _down(idx, 2)
        limitations.append("No study clearly supports the claim as stated")
    elif len(strong_support) >= 3:
        reasons.append(f"Replicated across {len(strong_support)} higher-quality studies")
    elif len(supporting) == 1 and best_support_level >= 2:
        idx = _down(idx)
        limitations.append("Rests on a single supporting study")
    domains["quantity"] = {"supporting": len(supporting), "strong_supporting": len(strong_support)}

    # -- consistency / contradiction ---------------------------------------
    # A study within one tier of the best supporting design is "comparable
    # quality": if such a study contradicts, the body is genuinely inconsistent
    # and certainty must come down — a lone null RCT against a meta-analysis is
    # real disagreement, not noise to be averaged away.
    comparable_contra = [r for r in contradicting if r["level"] <= best_support_level + 1]
    strong_contra = [r for r in contradicting if r["level"] <= 3]
    if comparable_contra:
        idx = _down(idx)
        limitations.append(f"{len(comparable_contra)} comparable-quality study(ies) "
                           f"contradict the claim")
    elif contradicting:
        limitations.append(f"{len(contradicting)} weaker study(ies) disagree")
    else:
        reasons.append("No comparable-quality study contradicts the claim")
    domains["consistency"] = {"contradicting": len(contradicting),
                              "comparable_contradicting": len(comparable_contra),
                              "strong_contradicting": len(strong_contra)}

    # -- directness (population match) --------------------------------------
    matches = [r.get("population_match", "unknown") for r in (supporting or records)]
    direct = sum(1 for m in matches if m == "good")
    if matches and direct == 0:
        idx = _down(idx)
        limitations.append("No supporting study clearly matches the claim's population")
    elif direct:
        reasons.append("Direct evidence in the claim's population")
    domains["directness"] = {"direct_matches": direct, "assessed": len(matches)}

    # -- precision ----------------------------------------------------------
    sig = [r for r in supporting if r.get("significant") is True]
    imprecise = [r for r in supporting if r.get("significant") is False]
    if supporting and not sig:
        idx = _down(idx)
        limitations.append("Supporting effects are not statistically significant / are imprecise")
    elif sig:
        reasons.append("Statistically significant effect in supporting studies")
    domains["precision"] = {"significant": len(sig), "imprecise": len(imprecise)}

    # -- risk of bias -------------------------------------------------------
    small = [r for r in supporting if (r.get("sample_size") or 10**9) < 100]
    industry = [r for r in supporting if r.get("industry_funded")]
    rob_notes = []
    if small:
        idx = _down(idx) if len(small) >= max(1, len(supporting) // 2) else idx
        rob_notes.append(f"{len(small)} small supporting study(ies) (n<100)")
        limitations.append(f"{len(small)} supporting study(ies) are small (n<100)")
    if industry:
        rob_notes.append(f"{len(industry)} industry-funded")
    domains["risk_of_bias"] = {"small_studies": len(small), "industry_funded": len(industry),
                               "notes": rob_notes}

    # -- recency ------------------------------------------------------------
    years = [r["year"] for r in (supporting or records) if r.get("year")]
    newest = max(years) if years else None
    if newest and (current_year - newest) > 15:
        idx = _down(idx)
        limitations.append(f"Newest supporting evidence is from {newest} (>15 years old)")
    domains["recency"] = {"newest_year": newest,
                          "age_years": (current_year - newest) if newest else None}

    strength = _ORDER[idx]
    if not supporting and strength != "very low":
        strength = "very low"

    # -- status -------------------------------------------------------------
    status = _status(counts, strong_support, strong_contra, strength)

    score = round(idx + 0.25 * len(strong_support) - 0.25 * len(strong_contra), 2)
    summary = _summary(status, strength, counts, best_level)
    basis = "abstract-level"

    return {
        "strength": strength, "status": status, "score": score, "best_level": best_level,
        "counts": counts, "reasons": reasons, "limitations": limitations,
        "domains": domains, "basis": basis, "summary": summary,
    }


def _status(counts: Dict[str, int], strong_support: list, strong_contra: list,
            strength: str) -> str:
    s, c = counts["supporting"], counts["contradicting"]
    if s == 0 and c == 0:
        return "insufficient_evidence"
    if s == 0 and c > 0:
        return "unsupported"
    if len(strong_contra) >= max(1, len(strong_support)) and c >= 1:
        return "contested"
    if c > 0 or strength in ("low", "very low"):
        return "partially_supported"
    return "supported"


_STATUS_PHRASE = {
    "supported": "supported", "partially_supported": "partially supported",
    "contested": "contested", "unsupported": "unsupported by the retrieved evidence",
    "insufficient_evidence": "not answerable from the retrieved evidence",
}


def _summary(status: str, strength: str, counts: Dict[str, int], best_level: int) -> str:
    phrase = _STATUS_PHRASE.get(status, status)
    return (f"The claim is {phrase} — {strength} certainty. "
            f"{counts['supporting']} supporting vs {counts['contradicting']} contradicting "
            f"study(ies); strongest design is a {_DESIGN.get(best_level, 'study')}. "
            f"Assessment is abstract-level.")
