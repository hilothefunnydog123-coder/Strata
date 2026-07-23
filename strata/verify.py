"""Strata Verify — the verification layer.

Input: a medical **claim** in plain language.
Output: an :class:`~strata.receipt.Receipt` — the claim traced to the literature, every
source graded, each source classified as supporting / contradicting / neutral, aggregated
into an evidence status and strength, with the key limitation surfaced.

    from strata import verify
    r = verify.verify_claim("Metformin reduces cardiovascular mortality in type 2 diabetes")
    print(r.status, r.strength, r.supporting, r.contradicting)

This is a transparent heuristic over public literature — it appraises evidence, it does not
pronounce truth, and the receipt says so. Every network call is injectable (``_search``) so
the whole thing runs, and is tested, offline.
"""
from __future__ import annotations

import datetime as _dt
import hashlib
import re
from typing import Callable, Optional

from .evidence import grade, summarize_body
from .pubmed import search_articles
from .query import rank
from .receipt import Receipt
from .review import _extract_effect, _first_sentences

_ORDER = ["very low", "low", "moderate", "high"]
_STOP = {"does", "do", "is", "are", "the", "a", "an", "of", "in", "for", "on", "to", "and",
         "with", "that", "this", "can", "could", "will", "reduce", "reduces", "reducing"}

# words that flip the claim's asserted direction of effect on the (usually adverse) outcome
_UP = (r"increase", r"raise", r"rais", r"worsen", r"cause", r"higher risk", r"elevat",
       r"greater risk", r"more likely", r"harm")


def _now() -> str:
    return _dt.datetime.now(_dt.timezone.utc).isoformat(timespec="seconds")


def normalize(claim: str) -> str:
    return re.sub(r"\s+", " ", claim.strip().rstrip("?.").lower())


def receipt_id(claim: str) -> str:
    h = hashlib.sha256(normalize(claim).encode("utf-8")).hexdigest()
    return "STR-" + h[:10].upper()


def _claim_direction(claim: str) -> str:
    """The direction of effect the claim asserts on its outcome: 'up' (claims the
    intervention increases/worsens the outcome) or 'down' (reduces/prevents/effective)."""
    low = claim.lower()
    if any(re.search(p, low) for p in _UP) and not re.search(r"reduc|lower|prevent|decreas", low):
        return "up"
    return "down"          # benefit / effectiveness / reduction — the common case


def _query(claim: str) -> str:
    toks = re.findall(r"[a-zA-Z0-9\-]+", claim)
    kept = [t for t in toks if t.lower() not in _STOP and len(t) > 2]
    return " ".join(kept) or claim


def _stance(effect: Optional[dict], claim_dir: str, text: str) -> str:
    """Classify one study relative to the claim: support / contradict / neutral."""
    d = effect.get("direction") if effect else None
    if d == "null":
        return "neutral"
    if d in ("reduction", "increase"):
        study_dir = "down" if d == "reduction" else "up"
    else:
        low = text.lower()
        if re.search(r"no significant|no difference|not associated|no effect|no benefit|"
                     r"did not (?:reduce|improve|lower|prevent|affect)|ineffective|"
                     r"failed to", low):
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


def _weight(level: int, effect: Optional[dict]) -> float:
    base = 7 - level                                   # 1..6 -> 6..1
    if effect and effect.get("value") is not None:
        return base * (1.0 if effect.get("significant") else 0.65)
    return base * 0.6                                  # qualitative / textual signal


def _limitation(items: list, status: str) -> Optional[str]:
    """One honest sentence on the biggest caveat. items: (article, grade, stance, effect)."""
    aligned = [(a, g, e) for a, g, st, e in items
               if st == ("contradict" if status == "Contradicted" else "support")]
    if status in ("Insufficient", "Unsupported"):
        return "Too few directly relevant, good-quality studies to draw a firm conclusion."
    strong = [g for a, g, e in aligned if g.level <= 2]
    if not strong:
        return "No high-quality (RCT or meta-analysis) study directly backs this — weaker designs only."
    # generalizability signals in the aligned abstracts
    pat = re.compile(r"(?:did not|does not|not) generalis?z?e|only in (?:patients|adults|women|men|"
                     r"children|those|people)[^.]{0,48}|limited to [^.]{0,40}|excluded [^.]{0,40}|"
                     r"aged \d{2}|(?:patients|adults) (?:over|under) \d{2}|"
                     r"(?:over|under|older than|younger than) \d{2} (?:years|yrs|y\b)", re.I)
    for a, g, e in aligned:
        m = pat.search(a.abstract or "")
        if m:
            return "May not generalize — " + re.sub(r"\s+", " ", m.group(0)).strip() + "."
    if len(strong) == 1:
        return "Rests largely on a single high-quality study — not yet replicated in the retrieved set."
    ns = [g.sample_size for a, g, e in aligned if g.sample_size]
    if ns and max(ns) < 100:
        return "Based on small studies (largest n < 100) — estimates may be imprecise."
    return None


def _status_and_strength(sup_w, con_w, sup, con, grades_by_stance, total):
    strong_total = sum(1 for gs in grades_by_stance.values() for g in gs if g.level <= 2)
    if total < 2 or (strong_total == 0 and total < 4):
        return "Insufficient", _cap(summarize_body(sum(grades_by_stance.values(), [])).overall_strength, "low")
    if sup_w == 0 and con_w == 0:
        return "Unsupported", "none"
    if sup_w >= 2.2 * con_w and sup > 0:
        return "Supported", summarize_body(grades_by_stance["support"]).overall_strength
    if con_w >= 2.2 * sup_w and con > 0:
        return "Contradicted", summarize_body(grades_by_stance["contradict"]).overall_strength
    # genuine conflict
    return "Mixed", _cap(summarize_body(sum(grades_by_stance.values(), [])).overall_strength, "moderate")


def _cap(strength: str, ceiling: str) -> str:
    if strength not in _ORDER:
        return strength
    return _ORDER[min(_ORDER.index(strength), _ORDER.index(ceiling))]


def verify_claim(claim: str, *, current_year: Optional[int] = None, retmax: int = 40,
                 consider: int = 15, now: Optional[str] = None,
                 _search: Callable = search_articles) -> Receipt:
    if current_year is None:
        current_year = _dt.date.today().year
    now = now or _now()
    claim_dir = _claim_direction(claim)
    query = _query(claim)

    articles = _search(query, retmax=retmax)
    graded = [(a, grade(a, current_year)) for a in articles]
    ranked = rank([a for a, _ in graded], [g for _, g in graded], current_year)[:consider]

    items, by_stance = [], {"support": [], "contradict": [], "neutral": []}
    sup_w = con_w = 0.0
    for e in ranked:
        a, g = e.article, e.grade
        eff = _extract_effect(f"{a.title}. {a.abstract}")
        st = _stance(eff, claim_dir, f"{a.title}. {a.abstract}")
        by_stance[st].append(g)
        w = _weight(g.level, eff)
        if st == "support":
            sup_w += w
        elif st == "contradict":
            con_w += w
        items.append((a, g, st, eff))

    sup, con, neu = len(by_stance["support"]), len(by_stance["contradict"]), len(by_stance["neutral"])
    status, strength = _status_and_strength(sup_w, con_w, sup, con, by_stance, len(items))

    # strongest aligned (or overall) study
    aligned = [it for it in items if it[2] == ("contradict" if status == "Contradicted" else "support")]
    top = min(aligned or items, key=lambda it: it[1].level, default=None) if items else None
    highest = None
    if top:
        a, g = top[0], top[1]
        highest = {"pmid": a.pmid, "title": a.title, "year": a.year, "url": a.url,
                   "label": g.label, "level": g.level, "strength": g.strength}

    citations = [{
        "n": i, "pmid": a.pmid, "title": a.title, "year": a.year, "url": a.url,
        "level": g.level, "label": g.label, "strength": g.strength, "stance": st,
        "snippet": _first_sentences(a.abstract) or "(no abstract)",
        "effect": eff,
    } for i, (a, g, st, eff) in enumerate(items[:8], 1)]

    return Receipt(
        receipt_id=receipt_id(claim), claim=claim.strip(), status=status, strength=strength,
        supporting=sup, contradicting=con, neutral=neu, total=len(items), checked=now,
        highest_evidence=highest, key_limitation=_limitation(items, status),
        citations=citations, query=query,
    )


# ------------------------------------------------------------------- change detection
def diff(old: Optional[dict], new: Receipt) -> dict:
    """Compare a previous receipt (dict) to a new one — the 'what changed' feed."""
    if not old:
        return {"changed": False, "first_check": True, "events": [], "headline": "Baseline established."}
    events = []
    o_str, n_str = old.get("strength"), new.strength
    if o_str != n_str and o_str in _ORDER and n_str in _ORDER:
        up = _ORDER.index(n_str) > _ORDER.index(o_str)
        events.append({"type": "upgraded" if up else "downgraded", "level": "green" if up else "red",
                       "text": f"Certainty {'upgraded' if up else 'downgraded'}: {o_str} → {n_str}"})
    if old.get("status") != new.status:
        kind = "conflict" if new.status in ("Mixed", "Contradicted") else "resolved"
        events.append({"type": kind, "level": "amber" if kind == "conflict" else "green",
                       "text": f"Status changed: {old.get('status')} → {new.status}"})
    old_ids = {c.get("pmid") for c in old.get("citations", [])}
    fresh = [c for c in new.citations if c.get("pmid") not in old_ids]
    for c in fresh[:4]:
        events.append({"type": "new_study", "level": "amber" if c["stance"] == "contradict" else "green",
                       "text": f"New {c['stance']} study: {c['title']}", "pmid": c.get("pmid")})
    if new.contradicting > old.get("contradicting", 0):
        events.append({"type": "conflict", "level": "amber",
                       "text": f"Contradicting evidence grew: {old.get('contradicting',0)} → {new.contradicting}"})
    changed = bool(events)
    headline = events[0]["text"] if events else "No change since last check."
    return {"changed": changed, "first_check": False, "events": events, "headline": headline}
