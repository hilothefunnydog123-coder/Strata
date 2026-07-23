"""Population / cohort context for the self-hosted platform.

A business running Strata on-prem can import a profile of the patients a claim actually
applies to: their ages, the medicines they take, their conditions. Strata folds those
factors into the verdict, above all the generalizability question ("does this evidence
even apply to *our* people?").

PRIVACY, BY DESIGN. This module runs only where you host it. It reduces rows to
**aggregates** immediately, stores only aggregates, and never transmits cohort data to any
external source or AI model. External literature searches use the claim's keywords only. It
is decision support for a population, never a decision about an individual.
"""
from __future__ import annotations

import datetime as _dt

from . import store

_KIND = "cohorts"

_AGE_BANDS = [("pediatric", 0, 17), ("adult", 18, 64), ("older", 65, 79), ("frail_elderly", 80, 200)]


def _now() -> str:
    return _dt.datetime.now(_dt.timezone.utc).isoformat(timespec="seconds")


def _norm(s) -> str:
    return " ".join(str(s or "").strip().lower().split())


def profile_from_rows(rows: list[dict]) -> dict:
    """Reduce patient rows to an aggregate profile. Accepts flexible keys:
    age | medications/meds/drugs | conditions/diagnoses (lists or comma strings)."""
    ages, meds, conds = [], {}, {}
    for r in rows:
        a = r.get("age") or r.get("Age")
        try:
            if a is not None and str(a) != "":
                ages.append(int(float(a)))
        except (ValueError, TypeError):
            pass
        for key in ("medications", "meds", "drugs", "Medications"):
            for m in _split(r.get(key)):
                meds[_norm(m)] = meds.get(_norm(m), 0) + 1
        for key in ("conditions", "diagnoses", "Conditions"):
            for c in _split(r.get(key)):
                conds[_norm(c)] = conds.get(_norm(c), 0) + 1
    n = len(rows)
    bands = {name: 0 for name, _, _ in _AGE_BANDS}
    for a in ages:
        for name, lo, hi in _AGE_BANDS:
            if lo <= a <= hi:
                bands[name] += 1
                break
    band_share = {k: round(v / len(ages), 3) for k, v in bands.items()} if ages else {}
    return {
        "n": n, "n_with_age": len(ages),
        "age_median": _median(ages), "age_bands": band_share,
        "top_medications": _top(meds, 8), "top_conditions": _top(conds, 8),
    }


def _split(v):
    if v is None:
        return []
    if isinstance(v, list):
        return [str(x) for x in v if str(x).strip()]
    return [p for p in str(v).replace(";", ",").split(",") if p.strip()]


def _median(xs):
    if not xs:
        return None
    s = sorted(xs)
    m = len(s) // 2
    return s[m] if len(s) % 2 else (s[m - 1] + s[m]) / 2


def _top(counts: dict, k: int) -> list:
    return [{"name": name, "count": c} for name, c in
            sorted(counts.items(), key=lambda kv: -kv[1])[:k]]


def import_cohort(name: str, rows: list[dict]) -> dict:
    """Store the aggregate profile only. Raw rows are not persisted."""
    prof = profile_from_rows(rows)
    rec = {"id": _slug(name), "name": name, "created": _now(), "profile": prof}
    store.save_protocol(rec, kind=_KIND)
    return rec


def _slug(name: str) -> str:
    s = "".join(c if c.isalnum() else "-" for c in name.lower()).strip("-")
    return "cohort-" + (s[:40] or "unnamed")


def get(cohort_id: str) -> dict | None:
    doc = store.get(cohort_id, kind=_KIND)
    return doc["protocol"] if doc else None


def list_cohorts() -> list[dict]:
    return [{"id": it["protocol"]["id"], "name": it["protocol"].get("name"),
             "n": it["protocol"].get("profile", {}).get("n"),
             "created": it["protocol"].get("created")}
            for it in store.list_items(_KIND)]


def population_note(profile: dict, citations: list) -> str | None:
    """A generalizability note for this population, from the aggregate profile and the
    retrieved evidence. Heuristic, honest, and computed locally."""
    if not profile:
        return None
    bands = profile.get("age_bands", {})
    frail = bands.get("frail_elderly", 0)
    ped = bands.get("pediatric", 0)
    text = " ".join((c.get("snippet", "") + " " + c.get("title", "")) for c in citations).lower()
    excl = any(w in text for w in ("excluded", "aged 18", "adults only", "over 80", "under 18",
                                   "did not generalize", "18 to 64", "18-64"))
    if frail >= 0.25:
        pct = round(frail * 100)
        tail = " and the retrieved trials note age exclusions" if excl else ""
        return (f"{pct}% of your population is 80+, where trial evidence is thinnest{tail}. "
                f"Weight the certainty down for those patients.")
    if ped >= 0.25:
        return (f"{round(ped*100)}% of your population is pediatric; most retrieved evidence is in "
                f"adults. Generalize with care.")
    meds = [m["name"] for m in profile.get("top_medications", [])[:3]]
    if meds:
        return (f"Your population's common medications ({', '.join(meds)}) may interact with this "
                f"intervention. The retrieved evidence does not account for your specific mix.")
    return None
