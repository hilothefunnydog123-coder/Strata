"""Strata Verify — the verification layer.

Input: a medical **claim** in plain language.
Output: an :class:`~strata.receipt.Receipt` — the claim traced across the open research world
(PubMed, Europe PMC, ClinicalTrials.gov, OpenAlex, Crossref), every source graded and
classified supporting / contradicting / neutral, aggregated into a status and strength, with
the strongest evidence, the key limitation, source provenance, and citations.

    from strata import verify
    r = verify.verify_claim("Metformin reduces cardiovascular mortality in type 2 diabetes")
    print(r.status, r.strength, r.supporting, r.contradicting, r.sources)

An optional AI layer (``strata.llm``) sharpens borderline stance calls when a key is set; it
is never the source of a fact. A local cohort profile (``context=``) folds population factors
into the generalizability note without ever leaving the machine. Every network call is
injectable (``_search``) so the whole thing runs, and is tested, offline.
"""
from __future__ import annotations

import datetime as _dt
import hashlib
import math
import re
from typing import Callable, Optional

from . import cohort as _cohort
from . import llm, sources
from .evidence import grade, summarize_body
from .query import rank
from .receipt import Receipt
from .review import _extract_effect, _first_sentences

_ORDER = ["very low", "low", "moderate", "high"]
_STOP = {"does", "do", "is", "are", "the", "a", "an", "of", "in", "for", "on", "to", "and",
         "with", "that", "this", "can", "could", "will"}
_UP = (r"increase", r"raise", r"rais", r"worsen", r"cause", r"higher risk", r"elevat",
       r"greater risk", r"more likely", r"harm")


def _now() -> str:
    return _dt.datetime.now(_dt.timezone.utc).isoformat(timespec="seconds")


def normalize(claim: str) -> str:
    return re.sub(r"\s+", " ", claim.strip().rstrip("?.").lower())


def receipt_id(claim: str) -> str:
    return "STR-" + hashlib.sha256(normalize(claim).encode("utf-8")).hexdigest()[:10].upper()


def _claim_direction(claim: str) -> str:
    low = claim.lower()
    if any(re.search(p, low) for p in _UP) and not re.search(r"reduc|lower|prevent|decreas", low):
        return "up"
    return "down"


def _query(claim: str) -> str:
    toks = re.findall(r"[a-zA-Z0-9\-]+", claim)
    kept = [t for t in toks if t.lower() not in _STOP and len(t) > 2]
    return " ".join(kept) or claim


def _stance(effect: Optional[dict], claim_dir: str, text: str) -> str:
    d = effect.get("direction") if effect else None
    if d == "null":
        return "neutral"
    if d in ("reduction", "increase"):
        study_dir = "down" if d == "reduction" else "up"
    else:
        low = text.lower()
        if re.search(r"no significant|no difference|not associated|no effect|no benefit|"
                     r"did not (?:reduce|improve|lower|prevent|affect)|ineffective|failed to", low):
            return "neutral"
        if re.search(r"reduc|lower|decreas|prevent|protect|improv|benefit|fewer|efficac|"
                     r"associated with (?:lower|reduced|fewer)", low):
            study_dir = "down"
        elif re.search(r"increas|higher|rais|worse|elevat|greater risk|"
                       r"associated with (?:increased|higher|greater)", low):
            study_dir = "up"
        else:
            return "neutral"
    return "support" if study_dir == claim_dir else "contradict"


def _weight(level: int, effect: Optional[dict], cited_by: Optional[int]) -> float:
    base = 7 - level
    if effect and effect.get("value") is not None:
        base *= 1.0 if effect.get("significant") else 0.65
    else:
        base *= 0.6
    if cited_by:                                    # influential work counts a little more
        base *= 1.0 + min(0.4, math.log10(cited_by + 1) / 6)
    return base


def _limitation(items: list, status: str) -> Optional[str]:
    aligned = [(a, g, e) for a, g, st, e in items
               if st == ("contradict" if status == "Contradicted" else "support")]
    if status in ("Insufficient", "Unsupported"):
        return "Too few directly relevant, good-quality studies to draw a firm conclusion."
    strong = [g for a, g, e in aligned if g.level <= 2]
    if not strong:
        return "No high-quality (RCT or meta-analysis) study directly backs this. Weaker designs only."
    pat = re.compile(r"(?:did not|does not|not) generalis?z?e|only in (?:patients|adults|women|men|"
                     r"children|those|people)[^.]{0,48}|limited to [^.]{0,40}|excluded [^.]{0,40}|"
                     r"aged \d{2}|(?:patients|adults) (?:over|under) \d{2}|"
                     r"(?:over|under|older than|younger than) \d{2} (?:years|yrs|y\b)", re.I)
    for a, g, e in aligned:
        m = pat.search(a.abstract or "")
        if m:
            return "May not generalize. " + re.sub(r"\s+", " ", m.group(0)).strip() + "."
    if len(strong) == 1:
        return "Rests largely on a single high-quality study, not yet replicated in the retrieved set."
    ns = [g.sample_size for a, g, e in aligned if g.sample_size]
    if ns and max(ns) < 100:
        return "Based on small studies (largest n < 100). Estimates may be imprecise."
    return None


def _status_and_strength(sup_w, con_w, sup, con, grades_by_stance, total):
    strong_total = sum(1 for gs in grades_by_stance.values() for g in gs if g.level <= 2)
    if total < 2 or (strong_total == 0 and total < 4):
        return "Insufficient", _cap(summarize_body(sum(grades_by_stance.values(), [])).overall_strength, "low")
    if sup_w == 0 and con_w == 0:
        # "Unsupported" is a null result — we looked at a real evidence base and found no
        # directional signal. Thin, all-neutral evidence has not earned that verdict; it is
        # Insufficient. (This distinction was surfaced by the calibration gold set.)
        if total < 4:
            return "Insufficient", _cap(summarize_body(sum(grades_by_stance.values(), [])).overall_strength, "low")
        return "Unsupported", "none"
    if sup_w >= 2.2 * con_w and sup > 0:
        return "Supported", summarize_body(grades_by_stance["support"]).overall_strength
    if con_w >= 2.2 * sup_w and con > 0:
        return "Contradicted", summarize_body(grades_by_stance["contradict"]).overall_strength
    return "Mixed", _cap(summarize_body(sum(grades_by_stance.values(), [])).overall_strength, "moderate")


def _cap(strength: str, ceiling: str) -> str:
    if strength not in _ORDER:
        return strength
    return _ORDER[min(_ORDER.index(strength), _ORDER.index(ceiling))]


def verify_claim(claim: str, *, current_year: Optional[int] = None, retmax: int = 40,
                 consider: int = 18, now: Optional[str] = None, context: Optional[dict] = None,
                 use_llm: Optional[bool] = None, pico: Optional[dict] = None,
                 _search: Optional[Callable] = None) -> Receipt:
    """Verify a claim through the full staged pipeline (understand -> ... -> audit)."""
    from . import pipeline           # lazy import: pipeline imports verify for its helpers
    return pipeline.run(claim, pico=pico, context=context, current_year=current_year,
                        retmax=retmax, consider=consider, now=now, use_llm=use_llm,
                        _search=_search)


# ------------------------------------------------------------------- comparison
_STATUS_SCORE = {"Supported": 3, "Mixed": 1, "Insufficient": 0, "Unsupported": 0, "Contradicted": -2}


def _score(r: Receipt) -> float:
    s = _STATUS_SCORE.get(r.status, 0)
    s += (_ORDER.index(r.strength) if r.strength in _ORDER else 0) * 0.5
    s += (r.supporting - r.contradicting) * 0.15
    return s


def compare_claims(claim_a: str, claim_b: str, *, now: Optional[str] = None,
                   _search: Optional[Callable] = None, **kw) -> dict:
    """Verify two claims and say which has the stronger evidence base."""
    ra = verify_claim(claim_a, now=now, _search=_search, **kw)
    rb = verify_claim(claim_b, now=now, _search=_search, **kw)
    sa, sb = _score(ra), _score(rb)
    if abs(sa - sb) < 0.4:
        winner, rationale = "tie", "Both claims have comparably strong (or weak) evidence behind them."
    else:
        winner = "a" if sa > sb else "b"
        strong, weak = (ra, rb) if winner == "a" else (rb, ra)
        rationale = (f"\"{_short(strong.claim)}\" has the stronger evidence base "
                     f"({strong.status}, {strong.strength}, {strong.supporting} supporting) versus "
                     f"({weak.status}, {weak.strength}, {weak.supporting} supporting).")
    return {"claim_a": claim_a, "claim_b": claim_b, "a": ra.to_dict(), "b": rb.to_dict(),
            "winner": winner, "rationale": rationale, "checked": now or _now()}


def _short(s: str, n: int = 60) -> str:
    return s if len(s) <= n else s[:n] + "..."


# ------------------------------------------------------------------- change detection
def diff(old: Optional[dict], new: Receipt) -> dict:
    if not old:
        return {"changed": False, "first_check": True, "events": [], "headline": "Baseline established."}
    events = []
    o_str, n_str = old.get("strength"), new.strength
    if o_str != n_str and o_str in _ORDER and n_str in _ORDER:
        up = _ORDER.index(n_str) > _ORDER.index(o_str)
        events.append({"type": "upgraded" if up else "downgraded", "level": "green" if up else "red",
                       "text": f"Certainty {'upgraded' if up else 'downgraded'}: {o_str} to {n_str}"})
    if old.get("status") != new.status:
        kind = "conflict" if new.status in ("Mixed", "Contradicted") else "resolved"
        events.append({"type": kind, "level": "amber" if kind == "conflict" else "green",
                       "text": f"Status changed: {old.get('status')} to {new.status}"})
    old_ids = {c.get("pmid") or c.get("doi") for c in old.get("citations", [])}
    fresh = [c for c in new.citations if (c.get("pmid") or c.get("doi")) not in old_ids]
    for c in fresh[:4]:
        events.append({"type": "new_study", "level": "amber" if c["stance"] == "contradict" else "green",
                       "text": f"New {c['stance']} study: {c['title']}", "pmid": c.get("pmid")})
    if new.contradicting > old.get("contradicting", 0):
        events.append({"type": "conflict", "level": "amber",
                       "text": f"Contradicting evidence grew: {old.get('contradicting', 0)} to {new.contradicting}"})
    changed = bool(events)
    return {"changed": changed, "first_check": False, "events": events,
            "headline": events[0]["text"] if events else "No change since last check."}
