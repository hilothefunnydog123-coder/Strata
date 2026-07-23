"""Transparent evidence assessment — the inspectable GRADE and the contradiction explainer.

Two questions a medical chatbot never answers honestly:

* *Why* is this evidence strong or weak? :func:`strength_rationale` breaks the grade into
  GRADE-style domains (design, consistency, directness, precision, recency, replication),
  each rated from the *actual* retrieved studies, and turns them into plain-language
  upgrades (+) and limitations (-). The grade becomes inspectable, not a black box.
* *Why* do the studies disagree? :func:`contradiction_analysis` compares the supporting and
  contradicting studies and names the likely reasons — different populations, doses,
  outcomes, follow-up windows, study designs, or plain statistical uncertainty — citing the
  studies that show each difference. It never averages a conflict away; it explains it.

Both are heuristics computed from titles + abstracts only. They never invent numbers, they
label themselves as heuristic in the UI, and they say so plainly when the signal is thin.
Pure functions, no I/O, unit-tested offline against injected records.
"""
from __future__ import annotations

import re
from typing import Optional

_ORDER = ["very low", "low", "moderate", "high"]

# a study "item" is the pipeline's [article, grade, stance, effect] row.


# --------------------------------------------------------------------------- helpers
def _aligned(items: list, status: str) -> list:
    want = "contradict" if status == "Contradicted" else "support"
    return [it for it in items if it[2] == want]


def _n_total(items: list) -> int:
    ns = [it[1].sample_size for it in items if it[1].sample_size]
    return sum(ns)


def _followup_months(text: str) -> Optional[float]:
    """Longest follow-up window mentioned, normalised to months (heuristic)."""
    best = None
    for m in re.finditer(r"(\d+(?:\.\d+)?)\s*(year|yr|month|mo|week|wk|day)s?\b", text, re.I):
        val, unit = float(m.group(1)), m.group(2).lower()
        mo = {"year": 12, "yr": 12, "month": 1, "mo": 1, "week": 0.23, "wk": 0.23,
              "day": 0.033}[unit]
        months = val * mo
        if 0 < months <= 600:                       # ignore obvious noise (>50 years)
            best = max(best or 0.0, months)
    return best


_DOSE = re.compile(r"\b(high[- ]dose|low[- ]dose|standard[- ]dose|\d+\s?mg\b|\d+\s?mcg\b|"
                   r"\d+\s?iu\b|\d+\s?units?\b)", re.I)
_SEVERITY = (
    ("reduced ejection fraction", "reduced ejection fraction (HFrEF)"),
    ("preserved ejection fraction", "preserved ejection fraction (HFpEF)"),
    ("severe", "severe disease"), ("mild", "mild disease"), ("moderate", "moderate disease"),
    ("critically ill", "critically ill"), ("advanced", "advanced disease"),
    ("early-stage", "early-stage"), ("acute", "acute"), ("chronic", "chronic"),
)
_POP_WORDS = (
    ("elderly", "elderly"), ("older adults", "older adults"), ("children", "children"),
    ("pediatric", "pediatric"), ("women", "women"), ("men", "men"),
    ("pregnan", "pregnancy"), ("diabet", "diabetes"), ("baseline deficiency", "baseline-deficient"),
)


def _phrases(text: str, table) -> set:
    low = text.lower()
    return {label for needle, label in table if needle in low}


def _side_text(items: list) -> str:
    return " ".join(f"{it[0].title}. {it[0].abstract}" for it in items)


def _example(items: list) -> Optional[dict]:
    """Pick a representative study (strongest design, then most cited) to cite in an
    explanation."""
    if not items:
        return None
    best = min(items, key=lambda it: (it[1].level, -(it[0].cited_by or 0)))
    a, g = best[0], best[1]
    return {"pmid": a.pmid, "title": a.title, "year": a.year, "label": g.label,
            "level": g.level, "url": a.url, "source": a.source}


# ------------------------------------------------------------------- strength rationale
def strength_rationale(items: list, status: str, strength: str,
                       current_year: int, *, pico: Optional[dict] = None,
                       supporting: int = 0, contradicting: int = 0) -> dict:
    """Break a strength grade into GRADE-style domains + plain-language +/- reasons.

    Every rating is computed from the retrieved studies, so the grade is inspectable rather
    than asserted. Returns a dict the UI renders as a "why this grade" panel.
    """
    aligned = _aligned(items, status)
    directional = [it for it in items if it[2] in ("support", "contradict")]
    levels = [it[1].level for it in aligned] or [it[1].level for it in items]
    best_level = min(levels) if levels else 6
    n_aligned = len(aligned)

    # --- domains ---
    design = ("high" if best_level <= 2 else "moderate" if best_level == 3
              else "low" if best_level == 4 else "very low")

    if directional:
        maj = max(supporting, contradicting)
        agree = maj / len(directional)
        consistency = ("high" if agree >= 0.85 else "moderate" if agree >= 0.65 else "low")
    else:
        agree, consistency = 1.0, "moderate"

    effs = [it[3] for it in aligned if it[3] and it[3].get("value") is not None]
    numeric_frac = (len(effs) / n_aligned) if n_aligned else 0.0
    sig = [e for e in effs if e.get("significant")]
    directness = ("high" if numeric_frac >= 0.5 else "moderate" if numeric_frac > 0 else "low")
    if effs:
        precision = ("high" if len(sig) / len(effs) >= 0.66 else
                     "moderate" if sig else "low")
    else:
        precision = "low"

    recent = [it for it in aligned if it[0].year and (current_year - it[0].year) <= 10]
    within15 = [it for it in aligned if it[0].year and (current_year - it[0].year) <= 15]
    recency = ("high" if aligned and len(recent) / len(aligned) >= 0.6 else
               "moderate" if aligned and len(within15) / len(aligned) >= 0.6 else "low")

    top = [it for it in aligned if it[1].level == best_level]
    replicated = len(top) >= 2
    total_n = _n_total(aligned)

    dimensions = {
        "study_design": design, "consistency": consistency, "directness": directness,
        "precision": precision, "recency": recency,
        "replication": "high" if replicated else ("moderate" if len(top) == 1 else "low"),
        "quantity": n_aligned,
    }

    # --- plain-language factors (upgrades) ---
    factors: list[dict] = []
    n_meta = sum(1 for it in aligned if it[1].level == 1)
    n_rct = sum(1 for it in aligned if it[1].level == 2)
    if n_meta:
        factors.append(_f("+", "study_design",
                          f"{n_meta} systematic review/meta-analysis at the top of the evidence pyramid"))
    if n_rct:
        factors.append(_f("+", "study_design", f"{n_rct} randomized controlled trial(s)"))
    if total_n >= 5000:
        factors.append(_f("+", "precision", f"Large combined sample size (n≈{total_n:,})"))
    if consistency == "high" and len(directional) >= 2:
        factors.append(_f("+", "consistency", "Studies agree on the direction of effect"))
    if replicated:
        factors.append(_f("+", "replication", f"Replicated across {len(top)} independent studies"))
    if recency == "high":
        factors.append(_f("+", "recency", "Evidence is current — most within the last 10 years"))
    if precision == "high":
        factors.append(_f("+", "precision", "Effect estimates are precise (confidence intervals exclude no-effect)"))
    pop = (pico or {}).get("population") or ""
    _generic = {"patients", "adults", "people", "those", "individuals", "subjects", "participants"}
    pop_tokens = [t for t in re.findall(r"[a-z0-9]+", pop.lower()) if len(t) > 3 and t not in _generic]
    if pop_tokens and any(re.search(re.escape(t), _side_text(aligned), re.I) for t in pop_tokens):
        factors.append(_f("+", "directness", f"Direct match to the population in question ({pop})"))

    # --- plain-language limitations (downgrades) ---
    limits: list[dict] = []
    if best_level > 2:
        limits.append(_f("-", "study_design",
                         "No RCT or meta-analysis directly backs this — weaker study designs only"))
    if contradicting:
        limits.append(_f("-", "consistency",
                         f"{contradicting} contradicting stud{'y' if contradicting == 1 else 'ies'} in the retrieved set"))
    if consistency == "low":
        limits.append(_f("-", "consistency", "Studies disagree in direction (heterogeneity)"))
    if best_level <= 2 and len(top) == 1:
        limits.append(_f("-", "replication", "Rests largely on a single high-quality study, not yet replicated here"))
    small = [it[1].sample_size for it in aligned if it[1].sample_size]
    if small and max(small) < 100:
        limits.append(_f("-", "precision", f"Based on small studies (largest n={max(small):,})"))
    if precision == "low" and effs:
        limits.append(_f("-", "precision", "Wide or null-spanning confidence intervals reduce certainty"))
    if recency == "low" and aligned:
        limits.append(_f("-", "recency", "Most aligned evidence is more than 15 years old"))
    if n_aligned < 2 and status not in ("Unsupported",):
        limits.append(_f("-", "quantity", "Too few directly relevant studies to be confident"))

    summary = _summary(strength, dimensions, factors, limits)
    return {"grade": strength, "summary": summary, "dimensions": dimensions,
            "factors": factors[:6], "limitations": limits[:6]}


def _f(sign: str, domain: str, text: str) -> dict:
    return {"sign": sign, "domain": domain, "text": text}


def _summary(strength: str, dims: dict, factors: list, limits: list) -> str:
    strong_bits = ", ".join(f["text"].split(" —")[0].lstrip("+ ").lower() for f in factors[:2])
    weak_bits = ", ".join(l["text"].lstrip("- ").lower() for l in limits[:1])
    lead = {"high": "Strong, high-quality evidence", "moderate": "Moderate-quality evidence",
            "low": "Weak evidence", "very low": "Very weak evidence",
            "none": "No directional evidence"}.get(strength, strength.title() + " evidence")
    out = lead
    if strong_bits:
        out += f" — {strong_bits}"
    if weak_bits:
        out += f"; limited by {weak_bits}"
    return out + "."


# ------------------------------------------------------------------ contradiction engine
def contradiction_analysis(support_items: list, contradict_items: list) -> dict:
    """Explain *why* the supporting and contradicting studies disagree.

    Returns named reasons (population / dose / outcome / follow-up / design / statistics),
    each with the studies that exhibit the difference. Never averages a conflict into a
    false consensus; when no signal explains it, says so.
    """
    if not contradict_items or not support_items:
        note = ("No contradicting evidence was retrieved — the aligned studies point the same way."
                if not contradict_items else
                "No supporting evidence was retrieved for this exact claim.")
        return {"disagreement": bool(contradict_items and support_items), "reasons": [], "note": note,
                "supporting": len(support_items), "contradicting": len(contradict_items)}

    s_text, c_text = _side_text(support_items), _side_text(contradict_items)
    reasons: list[dict] = []

    # 1) population / severity differences
    s_pop = _phrases(s_text, _POP_WORDS) | _phrases(s_text, _SEVERITY)
    c_pop = _phrases(c_text, _POP_WORDS) | _phrases(c_text, _SEVERITY)
    only_s, only_c = s_pop - c_pop, c_pop - s_pop
    if only_s or only_c:
        bits = []
        if only_s:
            bits.append(f"supporting studies emphasise {_join(only_s)}")
        if only_c:
            bits.append(f"contradicting studies emphasise {_join(only_c)}")
        reasons.append(_reason("population", "Different populations or disease severity",
                               "; ".join(bits) + ". Effects can genuinely differ between these groups.",
                               support_items, contradict_items))

    # 2) dose / regimen differences
    s_dose = {m.group(0).lower() for m in _DOSE.finditer(s_text)}
    c_dose = {m.group(0).lower() for m in _DOSE.finditer(c_text)}
    if (s_dose or c_dose) and s_dose != c_dose and (s_dose - c_dose or c_dose - s_dose):
        reasons.append(_reason("dose", "Different doses or regimens",
                               f"Supporting: {_join(s_dose) or 'unspecified'}; contradicting: "
                               f"{_join(c_dose) or 'unspecified'}. Dose can move the effect.",
                               support_items, contradict_items))

    # 3) follow-up differences
    s_fu = max((_followup_months(f"{it[0].title}. {it[0].abstract}") or 0) for it in support_items)
    c_fu = max((_followup_months(f"{it[0].title}. {it[0].abstract}") or 0) for it in contradict_items)
    if s_fu and c_fu and max(s_fu, c_fu) >= 2 * min(s_fu, c_fu) and abs(s_fu - c_fu) >= 6:
        reasons.append(_reason("follow_up", "Different follow-up windows",
                               f"Longest follow-up differs (~{_mo(s_fu)} vs ~{_mo(c_fu)}). "
                               "Short trials can miss effects that only emerge later, and vice versa.",
                               support_items, contradict_items))

    # 4) study-design differences
    s_best = min((it[1].level for it in support_items), default=6)
    c_best = min((it[1].level for it in contradict_items), default=6)
    if abs(s_best - c_best) >= 2:
        weaker = "contradicting" if c_best > s_best else "supporting"
        reasons.append(_reason("design", "Different study designs",
                               f"The {weaker} evidence rests on weaker designs (observational rather than "
                               "randomized), which are more prone to confounding.",
                               support_items, contradict_items))

    # 5) statistical uncertainty on the contradicting side
    c_effs = [it[3] for it in contradict_items if it[3] and it[3].get("value") is not None]
    if c_effs and all(not e.get("significant") for e in c_effs):
        reasons.append(_reason("statistics", "Statistical uncertainty",
                               "The contradicting effect estimates cross the no-effect line — the conflict "
                               "may be statistical noise rather than a true reversal.",
                               support_items, contradict_items))

    if not reasons:
        reasons.append({"factor": "unresolved",
                        "title": "Genuine scientific disagreement",
                        "explanation": "No population, dose, outcome, follow-up, or design difference in the "
                        "abstracts explains the conflict. Treat this as unsettled science and read the primary "
                        "sources.",
                        "support_example": _example(support_items),
                        "contradict_example": _example(contradict_items)})

    return {"disagreement": True, "reasons": reasons[:5], "note": "",
            "supporting": len(support_items), "contradicting": len(contradict_items)}


def _reason(factor: str, title: str, explanation: str, s_items: list, c_items: list) -> dict:
    return {"factor": factor, "title": title, "explanation": explanation,
            "support_example": _example(s_items), "contradict_example": _example(c_items)}


def _join(items) -> str:
    xs = sorted(items)
    if not xs:
        return ""
    if len(xs) == 1:
        return xs[0]
    return ", ".join(xs[:-1]) + " and " + xs[-1]


def _mo(months: float) -> str:
    if months >= 12:
        y = months / 12
        return f"{y:.0f} year{'s' if y >= 1.5 else ''}"
    return f"{months:.0f} months"
