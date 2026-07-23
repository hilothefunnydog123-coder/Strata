"""openFDA — what the regulator approved, and what patients reported afterwards.

Two kinds of evidence live here and they are not the same kind at all.

**Labels** are the FDA-approved prescribing information: indications, boxed
warnings, contraindications. This is not a study — it is a regulatory decision
made after reviewing studies, and for questions of the form "is this drug
contraindicated in pregnancy?" it outranks any single trial a literature search
will return.

**FAERS** is the adverse event reporting system, and it must be read with more
care than any other source Strata touches. Every number in it is a *spontaneous
report*: someone chose to file it. That means:

- **There is no denominator.** FAERS knows that 412 reports named a drug. It does
  not know whether four thousand or forty million people took it. Any statement
  of the form "the rate of X is Y%" is unobtainable from this data, and Strata
  refuses to compute one.
- **Reporting is wildly biased.** A drug in the news is reported more. A newly
  approved drug is reported more (the Weber effect). A serious event is reported
  more than a mild one.
- **A report is not a causal claim.** The reporter suspected a link. Nobody
  adjudicated it.

The standard method for this data is *disproportionality*: not "how often does
this happen" but "does this drug-event pair appear more often than the rest of
the database would predict". Strata implements the two conventional measures —
the proportional reporting ratio and the reporting odds ratio — with the
signal thresholds pharmacovigilance actually uses (PRR ≥ 2, chi-square ≥ 4, at
least 3 reports).

Those thresholds generate a *signal*, meaning "worth a human looking at this".
They do not establish that the drug causes the event, and this module says so in
every structure it returns rather than leaving it to the reader to remember.

Public API, no key required. ``OPENFDA_API_KEY`` raises the daily quota.
"""
from __future__ import annotations

import json
import math
import os
from dataclasses import dataclass, field

from .. import cache, net

API = "https://api.fda.gov"
SERVICE = "openFDA"

#: EMA/MHRA-style signal criteria. All three must hold; the count floor exists
#: because a PRR computed from one report is arithmetic, not evidence.
PRR_THRESHOLD = 2.0
CHI2_THRESHOLD = 4.0
MIN_REPORTS = 3

_LABEL_SECTIONS = [
    ("boxed_warning", "Boxed warning"),
    ("contraindications", "Contraindications"),
    ("warnings_and_cautions", "Warnings and precautions"),
    ("warnings", "Warnings"),
    ("adverse_reactions", "Adverse reactions"),
    ("drug_interactions", "Drug interactions"),
    ("pregnancy", "Pregnancy"),
    ("pediatric_use", "Paediatric use"),
    ("geriatric_use", "Geriatric use"),
    ("indications_and_usage", "Indications"),
]


def _params(extra: dict) -> dict:
    params = dict(extra)
    key = os.environ.get("OPENFDA_API_KEY")
    if key:
        params["api_key"] = key
    return params


def _get(endpoint: str, params: dict) -> dict | None:
    """Query openFDA. ``None`` for "no matches", which it signals with a 404.

    A 404 here means the search returned nothing, not that the endpoint is wrong,
    and a drug with no reports for an event is a perfectly ordinary — and
    informative — answer. Turning it into an exception would make the common case
    look like a failure.
    """
    url = net.plain_url(API, endpoint, _params(params))
    hit = cache.get(url, ttl=cache.DEFAULT_TTL)
    if hit is None:
        try:
            hit = net.get(url, service=SERVICE, accept="application/json")
        except net.NetworkError as exc:
            if "404" in str(exc) or "not found" in str(exc).lower():
                return None
            raise
        cache.put(url, hit)
    try:
        return json.loads(hit)
    except ValueError:
        return None


def _total(endpoint: str, search: str) -> int:
    """How many records match, without downloading them."""
    payload = _get(endpoint, {"search": search, "limit": 1})
    if not payload:
        return 0
    return int(((payload.get("meta") or {}).get("results") or {}).get("total") or 0)


def _quote(term: str) -> str:
    """Escape a term for an openFDA search expression."""
    return '"' + str(term).replace('"', "").strip() + '"'


# ----------------------------------------------------------------------- label

@dataclass
class DrugLabel:
    """The approved prescribing information, reduced to what an appraiser needs."""
    brand_names: list[str] = field(default_factory=list)
    generic_names: list[str] = field(default_factory=list)
    manufacturer: str = ""
    sections: dict[str, str] = field(default_factory=dict)
    effective_time: str = ""
    application_number: str = ""

    @property
    def has_boxed_warning(self) -> bool:
        return bool(self.sections.get("boxed_warning"))

    @property
    def name(self) -> str:
        return (self.generic_names or self.brand_names or ["unknown"])[0]

    def as_dict(self) -> dict:
        return {"name": self.name, "brand_names": self.brand_names[:6],
                "generic_names": self.generic_names[:6],
                "manufacturer": self.manufacturer,
                "application_number": self.application_number,
                "effective_time": self.effective_time,
                "has_boxed_warning": self.has_boxed_warning,
                "sections": {k: _truncate(v) for k, v in self.sections.items()}}


def _truncate(text: str, limit: int = 1500) -> str:
    """Label sections run to thousands of words; keep the opening, mark the cut."""
    body = " ".join((text or "").split())
    return body if len(body) <= limit else body[:limit].rstrip() + " […]"


def label(drug: str) -> DrugLabel | None:
    """The current FDA label for a drug, searched by generic then brand name."""
    for field_name in ("openfda.generic_name", "openfda.brand_name",
                       "openfda.substance_name"):
        payload = _get("drug/label.json",
                       {"search": f"{field_name}:{_quote(drug)}", "limit": 1})
        results = (payload or {}).get("results") or []
        if results:
            return _parse_label(results[0])
    return None


def _parse_label(raw: dict) -> DrugLabel:
    meta = raw.get("openfda") or {}
    sections = {}
    for key, _ in _LABEL_SECTIONS:
        value = raw.get(key)
        if isinstance(value, list):
            value = " ".join(str(v) for v in value)
        if value:
            sections[key] = " ".join(str(value).split())
    return DrugLabel(
        brand_names=meta.get("brand_name") or [],
        generic_names=meta.get("generic_name") or [],
        manufacturer=(meta.get("manufacturer_name") or [""])[0],
        application_number=(meta.get("application_number") or [""])[0],
        effective_time=raw.get("effective_time") or "",
        sections=sections,
    )


# ---------------------------------------------------------- disproportionality

@dataclass
class Disproportionality:
    """One drug-event pair, measured against the rest of the database.

    The 2×2 is over *reports*, never over patients, and the field names say so.
    """
    reaction: str
    reports_with_both: int          # a
    reports_drug_only: int          # b
    reports_event_only: int         # c
    reports_neither: int            # d
    prr: float
    prr_ci_low: float
    prr_ci_high: float
    ror: float
    chi_squared: float

    @property
    def is_signal(self) -> bool:
        """Whether this meets the conventional signal-detection criteria.

        A signal is an instruction to investigate. It is not a finding, it is not
        an incidence, and it is not causation — this is spontaneous report data
        with no denominator.
        """
        return (self.reports_with_both >= MIN_REPORTS
                and self.prr >= PRR_THRESHOLD
                and self.chi_squared >= CHI2_THRESHOLD)

    def as_dict(self) -> dict:
        return {"reaction": self.reaction,
                "reports_with_both": self.reports_with_both,
                "prr": round(self.prr, 2),
                "prr_ci": [round(self.prr_ci_low, 2), round(self.prr_ci_high, 2)],
                "ror": round(self.ror, 2),
                "chi_squared": round(self.chi_squared, 1),
                "is_signal": self.is_signal,
                "interpretation": (
                    "signal — reported disproportionately often; warrants review"
                    if self.is_signal else
                    "no disproportionality signal on the conventional criteria"),
                "caveat": ("Spontaneous reports. No denominator, so no rate can "
                           "be computed; reporting is biased and a report is not "
                           "a causal finding.")}


def disproportionality(drug: str, reaction: str) -> Disproportionality | None:
    """PRR, ROR and chi-square for one drug-event pair.

    Four counts are needed for the 2×2 and each is one round trip, so this is
    four requests per pair. That is the honest cost of the calculation: the
    shortcut of using the drug's own report counts as if they were the whole
    database gives a number that looks like a PRR and is not one.
    """
    drug_q = f"patient.drug.medicinalproduct:{_quote(drug)}"
    rxn_q = f"patient.reaction.reactionmeddrapt:{_quote(reaction)}"

    a = _total("drug/event.json", f"{drug_q} AND {rxn_q}")
    drug_total = _total("drug/event.json", drug_q)
    event_total = _total("drug/event.json", rxn_q)
    grand_total = _total("drug/event.json", "_exists_:patient")
    if not drug_total or not grand_total or grand_total <= drug_total:
        return None

    b = max(0, drug_total - a)
    c = max(0, event_total - a)
    d = max(0, grand_total - drug_total - c)
    if a == 0 or c == 0 or b == 0 or d == 0:
        # A zero cell makes both ratios undefined. The Haldane-Anscombe
        # correction adds 0.5 everywhere, which is the standard fix and is
        # applied here rather than returning nothing — but only for the ratio,
        # and the reported counts stay the raw ones.
        a_, b_, c_, d_ = a + 0.5, b + 0.5, c + 0.5, d + 0.5
    else:
        a_, b_, c_, d_ = float(a), float(b), float(c), float(d)

    prr = (a_ / (a_ + b_)) / (c_ / (c_ + d_))
    ror = (a_ / b_) / (c_ / d_)

    # 95% interval for the PRR, on the log scale.
    se = math.sqrt(1 / a_ - 1 / (a_ + b_) + 1 / c_ - 1 / (c_ + d_))
    lo, hi = math.exp(math.log(prr) - 1.96 * se), math.exp(math.log(prr) + 1.96 * se)

    n = a_ + b_ + c_ + d_
    denom = (a_ + b_) * (c_ + d_) * (a_ + c_) * (b_ + d_)
    chi2 = (n * (a_ * d_ - b_ * c_) ** 2 / denom) if denom > 0 else 0.0

    return Disproportionality(
        reaction=reaction, reports_with_both=a, reports_drug_only=b,
        reports_event_only=c, reports_neither=d, prr=prr,
        prr_ci_low=lo, prr_ci_high=hi, ror=ror, chi_squared=chi2)


def top_reactions(drug: str, limit: int = 20) -> list[tuple[str, int]]:
    """The most-reported reactions for a drug, by report count.

    Ranked by raw count, which is the ranking most likely to mislead: the
    commonest reported reaction for almost any drug is whatever the drug is
    *prescribed for*. Use :func:`disproportionality` to find out which of these
    are actually disproportionate.
    """
    payload = _get("drug/event.json", {
        "search": f"patient.drug.medicinalproduct:{_quote(drug)}",
        "count": "patient.reaction.reactionmeddrapt.exact",
        "limit": max(1, min(limit, 100))})
    if not payload:
        return []
    return [(r.get("term", ""), int(r.get("count") or 0))
            for r in payload.get("results") or [] if r.get("term")]


@dataclass
class SafetyProfile:
    drug: str
    label: DrugLabel | None
    signals: list[Disproportionality] = field(default_factory=list)
    screened: list[tuple[str, int]] = field(default_factory=list)
    total_reports: int = 0

    def as_dict(self) -> dict:
        return {
            "drug": self.drug,
            "total_faers_reports": self.total_reports,
            "label": self.label.as_dict() if self.label else None,
            "signals": [s.as_dict() for s in self.signals],
            "reactions_screened": [{"reaction": r, "reports": n}
                                   for r, n in self.screened],
            "method": (f"Proportional reporting ratio against the whole FAERS "
                       f"database. Signal criteria: PRR ≥ {PRR_THRESHOLD}, "
                       f"chi-square ≥ {CHI2_THRESHOLD}, at least {MIN_REPORTS} "
                       f"reports."),
            "limitations": [
                "Spontaneous reports have no denominator — no incidence or rate "
                "can be derived from them.",
                "Reporting is biased by publicity, recency of approval and event "
                "severity.",
                "A report records a suspicion, not an adjudicated causal link.",
                "A disproportionality signal is a prompt to investigate, not a "
                "finding of harm.",
            ]}


def safety_profile(drug: str, *, screen: int = 8) -> SafetyProfile:
    """Label plus a disproportionality screen of the drug's commonest reactions.

    ``screen`` is small by default because each candidate costs four requests.
    """
    lab = label(drug)
    reactions = top_reactions(drug, limit=max(screen, 1))
    total = _total("drug/event.json",
                   f"patient.drug.medicinalproduct:{_quote(drug)}")

    signals = []
    for reaction, _count in reactions[:screen]:
        measured = disproportionality(drug, reaction)
        if measured is not None and measured.is_signal:
            signals.append(measured)
    signals.sort(key=lambda s: -s.prr)

    return SafetyProfile(drug=drug, label=lab, signals=signals,
                         screened=reactions[:screen], total_reports=total)
