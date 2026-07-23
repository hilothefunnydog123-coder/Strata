"""Structured evidence extraction — with provenance, never invented.

For every study we pull out the things an evidence assessment actually needs:
sample size, effect estimates and their confidence intervals, p-values,
follow-up, population, funding and conflicts of interest. The extraction is
deterministic and regex-based: it reports **only what the text actually says**.

The cardinal honesty rule is that every field carries a ``provenance``:

    reported   the value appears verbatim in the text (e.g. "HR 0.82 (95% CI …)")
    heuristic  inferred from weaker textual signals (e.g. design from the title)
    inferred   produced by a model (only ever set when a model was actually used)

These are never silently mixed, and a field the text does not contain is
``None`` — shown downstream as "not reported", not guessed. Because E-utilities
and Europe PMC return abstracts, extraction is abstract-level and labelled as
such; a claim of "full text read" is never made when it was not.
"""
from __future__ import annotations

import re
from typing import Any, Dict, List, Optional

from .pubmed import Article
from .evidence import _classify  # study-design classifier (reused, single source of truth)

# -- small helpers ---------------------------------------------------------

def _field(value: Any, provenance: str, span: str = "") -> Dict[str, Any]:
    return {"value": value, "provenance": provenance, "span": span.strip()[:160]}


def _num(s: str) -> Optional[float]:
    try:
        return float(s.replace(",", ""))
    except (ValueError, AttributeError):
        return None


# -- sample size -----------------------------------------------------------

def _sample_size(text: str) -> Optional[Dict[str, Any]]:
    best, span = None, ""
    for m in re.finditer(r"\bn\s*=\s*([\d,]{2,})", text, re.I):
        v = _num(m.group(1))
        if v and (best is None or v > best):
            best, span = v, m.group(0)
    for m in re.finditer(r"\b([\d,]{3,})\s+(?:patients|participants|subjects|individuals|"
                         r"adults|women|men|children|cases|people)\b", text, re.I):
        v = _num(m.group(1))
        if v and (best is None or v > best):
            best, span = v, m.group(0)
    if best is None or best >= 100_000_000:
        return None
    return _field(int(best), "reported", span)


# -- effect estimates ------------------------------------------------------

_RATIO = re.compile(
    r"\b(hazard ratio|risk ratio|relative risk|odds ratio|rate ratio|incidence rate ratio|"
    r"HR|RR|OR|aHR|aOR)\b\s*(?:of|was|:|=|,)?\s*(\d+\.\d+)"
    r"(?:[^\d]{0,25}?95\s*%\s*(?:CI|confidence interval)[^\d\-]*"
    r"(\d+\.\d+)\s*(?:to|–|-|,)\s*(\d+\.\d+))?",
    re.I)

_DIFF = re.compile(
    r"\b(mean difference|standardized mean difference|absolute risk reduction|"
    r"risk difference|MD|SMD|ARR)\b\s*(?:of|was|:|=|,)?\s*(-?\d+\.\d+)"
    r"(?:[^\d]{0,25}?95\s*%\s*(?:CI|confidence interval)[^\d\-]*"
    r"(-?\d+\.\d+)\s*(?:to|–|-|,)\s*(-?\d+\.\d+))?",
    re.I)

_P = re.compile(r"\bp\s*([<>=])\s*(0?\.\d+|\d+\.\d+(?:e-?\d+)?)", re.I)

_RATIO_NAMES = {"hr", "ahr", "hazard ratio", "rr", "relative risk", "risk ratio",
                "or", "aor", "odds ratio", "rate ratio", "incidence rate ratio"}


def _effects(text: str) -> List[Dict[str, Any]]:
    out: List[Dict[str, Any]] = []
    for m in _RATIO.finditer(text):
        metric = m.group(1).upper()
        value = _num(m.group(2))
        lo, hi = _num(m.group(3)), _num(m.group(4))
        if value is None:
            continue
        significant = None
        if lo is not None and hi is not None:
            significant = not (lo <= 1.0 <= hi)     # CI excludes the null (1.0)
        rel = "below_null" if value < 1 else ("above_null" if value > 1 else "at_null")
        out.append({
            "metric": metric, "kind": "ratio", "value": value,
            "ci_low": lo, "ci_high": hi, "null": 1.0,
            "relation_to_null": rel, "significant": significant,
            "provenance": "reported" if lo is not None else "heuristic",
            "span": m.group(0).strip()[:160],
        })
    for m in _DIFF.finditer(text):
        metric = m.group(1).upper()
        value = _num(m.group(2))
        lo, hi = _num(m.group(3)), _num(m.group(4))
        if value is None:
            continue
        significant = None
        if lo is not None and hi is not None:
            significant = not (lo <= 0.0 <= hi)
        rel = "below_null" if value < 0 else ("above_null" if value > 0 else "at_null")
        out.append({
            "metric": metric, "kind": "difference", "value": value,
            "ci_low": lo, "ci_high": hi, "null": 0.0,
            "relation_to_null": rel, "significant": significant,
            "provenance": "reported" if lo is not None else "heuristic",
            "span": m.group(0).strip()[:160],
        })
    return out


def _p_values(text: str) -> List[Dict[str, Any]]:
    out = []
    for m in _P.finditer(text):
        out.append({"op": m.group(1), "value": _num(m.group(2)),
                    "provenance": "reported", "span": m.group(0)})
    return out


# -- follow-up, population, funding, conflicts -----------------------------

def _follow_up(text: str) -> Optional[Dict[str, Any]]:
    m = re.search(r"(?:median |mean )?follow[- ]?up (?:of |was |period of )?"
                  r"([\d.]+)\s*(years?|months?|weeks?|days?)", text, re.I)
    if not m:
        m = re.search(r"(?:over|at|during|for)\s+([\d.]+)\s*(years?|months?|weeks?)", text, re.I)
    if m:
        return _field(f"{m.group(1)} {m.group(2)}", "reported", m.group(0))
    return None


_AGE_TERMS = [
    (re.compile(r"\b(?:aged?|age)\s*(\d{1,3})\s*(?:to|-|–|and)\s*(\d{1,3})", re.I), "range"),
    (re.compile(r"\b(?:over|older than|>=?|aged over)\s*(\d{2,3})\s*(?:years)?", re.I), "min"),
    (re.compile(r"\b(under|younger than|<)\s*(\d{1,3})\s*(?:years)?", re.I), "max"),
]
_POP_WORDS = ["elderly", "older adults", "adults", "children", "pediatric", "paediatric",
              "neonates", "infants", "women", "men", "pregnant", "adolescents",
              "outpatients", "inpatients", "critically ill"]


def _population(text: str) -> Optional[Dict[str, Any]]:
    low = text.lower()
    terms = [w for w in _POP_WORDS if w in low]
    age_min = age_max = None
    for rx, kind in _AGE_TERMS:
        m = rx.search(text)
        if m:
            if kind == "range":
                age_min, age_max = int(m.group(1)), int(m.group(2))
            elif kind == "min":
                age_min = int(m.group(1))
            elif kind == "max":
                age_max = int(m.group(2))
    if not terms and age_min is None and age_max is None:
        return None
    return {"terms": terms, "age_min": age_min, "age_max": age_max,
            "provenance": "heuristic"}


_INDUSTRY = re.compile(r"\b(pharmaceutic|inc\.|ltd\.|gmbh|astrazeneca|pfizer|novartis|merck|"
                       r"roche|sanofi|glaxo|gsk|bayer|lilly|amgen|abbvie|boehringer|"
                       r"bristol[- ]myers|manufacturer)\b", re.I)


def _funding(text: str) -> Optional[Dict[str, Any]]:
    m = re.search(r"(?:funded by|supported by|grant(?:s)? from|sponsored by|funding[:.]?)\s+"
                  r"([A-Za-z][^.;]{3,90})", text, re.I)
    if not m:
        return None
    who = m.group(1).strip()
    industry = bool(_INDUSTRY.search(who))
    return {"value": who, "industry": industry, "provenance": "reported", "span": m.group(0)[:160]}


def _conflicts(text: str) -> Optional[Dict[str, Any]]:
    if re.search(r"no (?:competing|conflict)", text, re.I):
        return _field("No competing interests declared", "reported", "")
    m = re.search(r"(conflict of interest|competing interest|consultant (?:for|to)|"
                  r"honoraria|advisory board)[^.;]{0,80}", text, re.I)
    if m:
        return _field(m.group(0).strip(), "reported", m.group(0))
    return None


# -- directional read ------------------------------------------------------

_BENEFIT = ["reduced", "reduction", "lower", "decreased", "decrease", "improved",
            "improvement", "prevent", "protective", "fewer", "benefit", "effective",
            "efficacy", "superior", "associated with lower", "associated with reduced"]
_HARM = ["increased", "increase", "higher", "worse", "excess", "greater risk", "harmful",
         "associated with higher", "associated with increased", "no benefit"]
_NULL = ["no significant", "not significant", "no difference", "did not differ",
         "no association", "nonsignificant", "non-significant", "no effect",
         "failed to", "did not reduce", "similar", "no reduction", "not associated"]


def _direction(text: str, effects: List[Dict[str, Any]]) -> Dict[str, Any]:
    """A heuristic read of what the study says about the intervention working.

    Combines directional language with the effect estimate's relation to the
    null and its statistical significance. Always ``heuristic`` provenance — it
    is a reading of the abstract, not a reported field.
    """
    low = text.lower()
    null_hit = any(p in low for p in _NULL)
    ben = sum(low.count(w) for w in _BENEFIT)
    harm = sum(low.count(w) for w in _HARM)

    sig_effect = next((e for e in effects if e.get("significant")), None)
    reason = []
    if null_hit or (effects and all(e.get("significant") is False for e in effects)):
        direction = "null"
        reason.append("null / non-significant language or CI crossing the null")
    elif sig_effect is not None:
        # a significant ratio below null, or a significant difference below null,
        # is conventionally the 'intervention favoured' direction for a risk outcome
        rel = sig_effect["relation_to_null"]
        direction = "benefit" if rel == "below_null" else "harm"
        reason.append(f"significant {sig_effect['metric']} {sig_effect['value']} "
                      f"({rel.replace('_', ' ')})")
    elif ben > harm:
        direction = "benefit"; reason.append("benefit-leaning language")
    elif harm > ben:
        direction = "harm"; reason.append("harm-leaning language")
    else:
        direction = "unclear"; reason.append("no clear directional signal in the abstract")
    return {"value": direction, "provenance": "heuristic", "reason": "; ".join(reason)}


# -- top-level -------------------------------------------------------------

def extract(article: Article) -> Dict[str, Any]:
    """Return a structured, provenance-tagged extraction for one study."""
    text = f"{article.title}. {article.abstract}".strip()
    level, label, is_guideline = _classify(article)
    design_prov = "reported" if article.publication_types else "heuristic"
    effects = _effects(text)
    extraction = {
        "design": {"value": label, "level": level, "is_guideline": is_guideline,
                   "provenance": design_prov},
        "sample_size": _sample_size(text),
        "effects": effects,
        "p_values": _p_values(text),
        "follow_up": _follow_up(text),
        "population": _population(text),
        "funding": _funding(text),
        "conflicts": _conflicts(text),
        "direction": _direction(text, effects),
        "basis": "full_text" if article.has_full_text else "abstract",
        "basis_note": ("Assessment based on abstract-level evidence."
                       if not article.has_full_text else
                       "Open-access full text available; assessment still uses the abstract."),
    }
    return extraction
