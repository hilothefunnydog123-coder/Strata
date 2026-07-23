"""Living systematic reviews — the wedge.

A one-off answer goes stale the moment it's printed. A *living* review is a standing
question with a protocol: define it once, and Strata keeps its evidence base fresh —
searching, grading, and re-grading published literature on every sync, and telling you
what *changed* since last time. New trial published? Certainty moved from weak to
moderate? A team of medical-affairs, guideline, or value-&-access people learns
immediately, with a full graded citation trail.

    from strata import review
    p = review.create("Vitamin D & respiratory infection",
                      "Does vitamin D supplementation prevent respiratory infections?")
    snapshot, surveillance = review.sync(p.id)     # runs it, diffs vs. last time
    view = review.view(p.id)                        # everything the Console renders

Every function that touches the network takes an injectable ``_search`` so the whole
pipeline runs — and is tested — offline. It stores graded bibliographic data only:
no patient data, no diagnosis, no advice.
"""
from __future__ import annotations

import datetime as _dt
import re
import uuid
from dataclasses import dataclass, field
from typing import Callable, Optional

from . import anatomy, sources, store
from .evidence import grade, summarize_body
from .query import rank

search_articles = sources.search_all      # reviews search every source, not just PubMed

_ORDER = ["very low", "low", "moderate", "high"]


# --------------------------------------------------------------------------- protocol
@dataclass
class Protocol:
    id: str
    title: str
    question: str
    query: str = ""
    include_levels: tuple = (1, 2, 3)      # evidence-pyramid levels admitted
    since_year: Optional[int] = None       # ignore anything older
    created: str = ""

    def to_dict(self) -> dict:
        return {"id": self.id, "title": self.title, "question": self.question,
                "query": self.query, "include_levels": list(self.include_levels),
                "since_year": self.since_year, "created": self.created}

    @classmethod
    def from_dict(cls, d: dict) -> "Protocol":
        return cls(id=d["id"], title=d["title"], question=d["question"],
                   query=d.get("query", ""),
                   include_levels=tuple(d.get("include_levels") or (1, 2, 3)),
                   since_year=d.get("since_year"), created=d.get("created", ""))


def _now() -> str:
    return _dt.datetime.now(_dt.timezone.utc).isoformat(timespec="seconds")


def _slug(title: str) -> str:
    s = re.sub(r"[^a-z0-9]+", "-", title.lower()).strip("-")
    return (s[:40] or "review") + "-" + uuid.uuid4().hex[:6]


def new_protocol(title: str, question: str, *, query: str = "",
                 include_levels=(1, 2, 3), since_year: Optional[int] = None,
                 id: Optional[str] = None, created: Optional[str] = None) -> Protocol:
    return Protocol(id=id or _slug(title), title=title, question=question,
                    query=query or question, include_levels=tuple(include_levels),
                    since_year=since_year, created=created or _now())


# ------------------------------------------------------------------- effect extraction
_MEASURE_CI = re.compile(
    r"\b(a?hazard ratio|a?risk ratio|a?odds ratio|aHR|aOR|HR|RR|OR)\b"
    r"[^0-9\-]{0,16}?(\d+\.\d+)"
    r"[^0-9]{0,44}?(?:95\s*%?\s*)?(?:CI|confidence interval)"
    r"[^0-9]{0,8}?(\d+\.\d+)\s*(?:to|–|—|-|,|;| and )\s*(\d+\.\d+)",
    re.I,
)


def _extract_effect(text: str) -> Optional[dict]:
    """Heuristically pull an effect signal from an abstract.

    Returns a ratio measure with its 95% CI when one is stated (usable on the forest
    plot), else a qualitative direction, else None. This is a *signal*, explicitly
    labelled as heuristic in the UI — verify against the source, never quote as fact.
    """
    m = _MEASURE_CI.search(text)
    if m:
        measure = m.group(1).upper().replace("AHR", "HR").replace("AOR", "OR")
        if measure not in ("HR", "RR", "OR"):
            measure = {"HAZARD RATIO": "HR", "RISK RATIO": "RR",
                       "ODDS RATIO": "OR"}.get(measure, measure[:2])
        value, lo, hi = float(m.group(2)), float(m.group(3)), float(m.group(4))
        if lo > hi:
            lo, hi = hi, lo
        significant = not (lo <= 1.0 <= hi)
        direction = "null" if not significant else ("reduction" if value < 1 else "increase")
        return {"measure": measure, "value": value, "ci_low": lo, "ci_high": hi,
                "direction": direction, "significant": significant}
    low = text.lower()
    if re.search(r"no significant|no difference|not associated|no effect|nonsignificant|"
                 r"no benefit|did not (?:reduce|improve|affect)", low):
        return {"measure": None, "value": None, "ci_low": None, "ci_high": None,
                "direction": "null", "significant": False}
    if re.search(r"reduc|lower|decreas|prevent|protect|improv|benefit", low):
        return {"measure": None, "value": None, "ci_low": None, "ci_high": None,
                "direction": "reduction", "significant": None}
    if re.search(r"increas|higher|rais|worse|elevat|greater risk", low):
        return {"measure": None, "value": None, "ci_low": None, "ci_high": None,
                "direction": "increase", "significant": None}
    return None


def _first_sentences(text: str, n: int = 2) -> str:
    parts = re.split(r"(?<=[.!?])\s+", (text or "").strip())
    return " ".join(parts[:n]).strip()


def _cumulative(items: list) -> list:
    """Per-year cumulative study count and best certainty reached by that year —
    the 'living evidence' curve."""
    per_year: dict[int, list] = {}
    for year, strength in items:
        if year:
            per_year.setdefault(year, []).append(strength)
    pts, run, best = [], 0, -1
    for y in sorted(per_year):
        run += len(per_year[y])
        for s in per_year[y]:
            if s in _ORDER:
                best = max(best, _ORDER.index(s))
        pts.append({"year": y, "count": run,
                    "strength": _ORDER[best] if best >= 0 else "very low"})
    return pts


_PLAIN = {
    "high": "The evidence is strong and consistent — high confidence in this finding.",
    "moderate": "The evidence is reasonably good, but not the last word — moderate confidence.",
    "low": "The evidence is thin — treat this as a weak signal, not a settled answer.",
    "very low": "There's very little solid evidence here — closer to a hunch than a fact.",
    "none": "No studies were found — absence of evidence, not evidence of absence.",
}


# ------------------------------------------------------------------------------ run
def run_protocol(protocol: Protocol, *, current_year: Optional[int] = None,
                 retmax: int = 60, now: Optional[str] = None,
                 _search: Callable = search_articles) -> dict:
    """Execute a protocol once and return a graded snapshot (a plain dict, ready to
    persist, diff, and render)."""
    if current_year is None:
        current_year = _dt.date.today().year
    now = now or _now()

    articles = _search(protocol.query or protocol.question, retmax=retmax)
    identified = len(articles)
    graded = [(a, grade(a, current_year)) for a in articles]

    include = set(protocol.include_levels or (1, 2, 3, 4, 5, 6))
    since = protocol.since_year
    included, excl_level, excl_year = [], 0, 0
    for a, g in graded:
        if g.level not in include:
            excl_level += 1
        elif since and (a.year or 0) < since:
            excl_year += 1
        else:
            included.append((a, g))

    ev = rank([a for a, _ in included], [g for _, g in included], current_year)
    body = summarize_body([e.grade for e in ev])

    studies, effects, pmids = [], [], []
    for i, e in enumerate(ev, 1):
        a, g = e.article, e.grade
        eff = _extract_effect(f"{a.title}. {a.abstract}")
        studies.append({"n": i, "pmid": a.pmid, "title": a.title, "year": a.year,
                        "level": g.level, "label": g.label, "strength": g.strength,
                        "sample_size": g.sample_size, "url": a.url,
                        "snippet": _first_sentences(a.abstract) or "(no abstract)",
                        "effect": eff})
        pmids.append(a.pmid)
        if eff and eff.get("value") is not None:
            effects.append({"n": i, "label": g.label, "year": a.year,
                            "strength": g.strength, "title": a.title,
                            **{k: eff[k] for k in ("measure", "value", "ci_low",
                                                    "ci_high", "direction", "significant")}})

    pyramid = {i: 0 for i in range(1, 7)}
    for _, g in included:
        pyramid[g.level] += 1

    cumulative = _cumulative([(a.year, g.strength) for a, g in included])
    text = " ".join([protocol.question]
                    + [a.title for a, _ in included]
                    + [a.abstract for a, _ in included[:8]])
    hotspots = [anatomy.to_dict(h) for h in anatomy.hotspots_for(text, body.overall_strength)]

    return {
        "taken": now,
        "overall_strength": body.overall_strength,
        "summary": body.summary,
        "best_level": body.best_level,
        "plain": _PLAIN.get(body.overall_strength, ""),
        "prisma": {"identified": identified, "screened": identified,
                   "included": len(included), "excluded_level": excl_level,
                   "excluded_year": excl_year},
        "pyramid": pyramid,
        "studies": studies,
        "effects": effects,
        "cumulative": cumulative,
        "hotspots": hotspots,
        "pmids": pmids,
    }


# --------------------------------------------------------------------- surveillance
def diff_snapshots(old: Optional[dict], new: dict) -> dict:
    """What changed between two syncs — the reason 'living' is worth paying for."""
    if not old:
        return {"changed": True, "first_sync": True, "new_pmids": [],
                "new_studies": [], "dropped": 0, "strength_change": None,
                "last_synced": None}
    old_ids = set(old.get("pmids", []))
    new_ids_set = set(new.get("pmids", []))
    fresh = [p for p in new.get("pmids", []) if p not in old_ids]
    fresh_set = set(fresh)
    new_studies = [s for s in new.get("studies", []) if s["pmid"] in fresh_set]
    dropped = len([p for p in old.get("pmids", []) if p not in new_ids_set])
    sc = None
    if old.get("overall_strength") != new.get("overall_strength"):
        sc = [old.get("overall_strength"), new.get("overall_strength")]
    changed = bool(fresh) or sc is not None or dropped > 0
    return {"changed": changed, "first_sync": False, "new_pmids": fresh,
            "new_studies": new_studies[:8], "dropped": dropped,
            "strength_change": sc, "last_synced": old.get("taken")}


# --------------------------------------------------------------- store-backed API
def create(title: str, question: str, *, query: str = "",
           include_levels=(1, 2, 3), since_year: Optional[int] = None,
           id: Optional[str] = None) -> Protocol:
    p = new_protocol(title, question, query=query, include_levels=include_levels,
                     since_year=since_year, id=id)
    store.save_protocol(p.to_dict())
    return p


def sync(review_id: str, *, current_year: Optional[int] = None, retmax: int = 60,
         now: Optional[str] = None, _search: Callable = search_articles):
    """Re-run a stored review, persist the new snapshot, return (snapshot, surveillance)."""
    doc = store.get(review_id)
    if doc is None:
        raise KeyError(f"no such review: {review_id}")
    protocol = Protocol.from_dict(doc["protocol"])
    prev = store.latest(review_id)
    snap = run_protocol(protocol, current_year=current_year, retmax=retmax,
                        now=now, _search=_search)
    surv = diff_snapshots(prev, snap)
    store.append_snapshot(review_id, snap)
    return snap, surv


def view(review_id: str) -> Optional[dict]:
    """Everything the Console needs to render one review."""
    doc = store.get(review_id)
    if doc is None:
        return None
    snaps = doc.get("snapshots", [])
    snap = snaps[-1] if snaps else None
    prev = snaps[-2] if len(snaps) >= 2 else None
    surv = diff_snapshots(prev, snap) if snap else None
    history = [{"taken": s["taken"], "overall_strength": s["overall_strength"],
                "included": s["prisma"]["included"]} for s in snaps]
    return {"protocol": doc["protocol"], "snapshot": snap,
            "surveillance": surv, "history": history}


def list_reviews() -> list:
    return store.list_reviews()
