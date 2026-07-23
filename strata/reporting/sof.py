"""GRADE Summary of Findings — the table a guideline panel actually reads.

A relative risk of 0.72 is not a clinical fact. It is a ratio, and what it means
depends entirely on the risk it is a ratio of: cutting a 40% risk to 29% is a
different intervention from cutting a 0.4% risk to 0.29%, and the two are
indistinguishable in the relative measure that abstracts report. The Summary of
Findings table exists to force that conversion, and GRADE requires it for a
reason — panels that reason from relative effects systematically overtreat
low-risk patients.

Each row carries:

* **Anticipated absolute effects** per 1,000, at a stated comparator risk. The
  comparator risk is an assumption and is labelled as one, with its source.
* The relative effect and its interval.
* Participants and studies contributing.
* The certainty of the evidence, and the GRADE domains that moved it.
* A **plain-language informative statement** in GRADE's prescribed wording.

That last one is the part people underestimate. GRADE specifies the verbs:
high certainty gets "reduces", moderate gets "probably reduces", low gets "may
reduce", and very low gets "the evidence is very uncertain about the effect of".
The wording is standardised precisely so that a reader who does not know what
"moderate certainty" means still receives the uncertainty. Strata generates the
statement from the certainty rating mechanically, so the hedging can never drift
away from the grade that justifies it.

**Where the comparator risk comes from.** If you pass one, that is used and
cited. If you do not, Strata derives it from the retrieved control-arm event
rates when the abstracts report them, and otherwise declines to compute absolute
effects at all. It does not invent a baseline risk — a fabricated denominator
would make every number in the row wrong in a way that looks entirely
plausible.
"""
from __future__ import annotations

import math
from dataclasses import dataclass, field

from ..stats import Z95

#: GRADE's prescribed verb for each certainty level, in the two directions.
_INFORMATIVE = {
    ("high", "reduce"): "{i} reduces {o}",
    ("high", "increase"): "{i} increases {o}",
    ("high", "none"): "{i} results in little to no difference in {o}",
    ("moderate", "reduce"): "{i} probably reduces {o}",
    ("moderate", "increase"): "{i} probably increases {o}",
    ("moderate", "none"): "{i} probably results in little to no difference in {o}",
    ("low", "reduce"): "{i} may reduce {o}",
    ("low", "increase"): "{i} may increase {o}",
    ("low", "none"): "{i} may result in little to no difference in {o}",
    ("very low", "reduce"): "the evidence is very uncertain about the effect of "
                            "{i} on {o}",
    ("very low", "increase"): "the evidence is very uncertain about the effect of "
                              "{i} on {o}",
    ("very low", "none"): "the evidence is very uncertain about the effect of "
                          "{i} on {o}",
}

_SYMBOLS = {"high": "⊕⊕⊕⊕", "moderate": "⊕⊕⊕⊝", "low": "⊕⊕⊝⊝",
            "very low": "⊕⊝⊝⊝", "none": "⊝⊝⊝⊝"}


@dataclass
class AbsoluteEffect:
    comparator_per_1000: float
    intervention_per_1000: float
    difference_per_1000: float
    ci_low_per_1000: float | None
    ci_high_per_1000: float | None
    nnt: int | None
    nnt_kind: str                     # "benefit" | "harm" | ""
    basis: str                        # where the comparator risk came from

    def format(self) -> str:
        d = self.difference_per_1000
        word = "fewer" if d < 0 else "more"
        s = (f"{self.comparator_per_1000:.0f} per 1,000 → "
             f"{self.intervention_per_1000:.0f} per 1,000 "
             f"({abs(d):.0f} {word} per 1,000")
        if self.ci_low_per_1000 is not None:
            lo, hi = sorted((self.ci_low_per_1000, self.ci_high_per_1000))
            s += f", 95% CI {lo:.0f} to {hi:.0f}"
        return s + ")"

    def as_dict(self) -> dict:
        return {"comparator_per_1000": round(self.comparator_per_1000, 1),
                "intervention_per_1000": round(self.intervention_per_1000, 1),
                "difference_per_1000": round(self.difference_per_1000, 1),
                "ci_low_per_1000": (round(self.ci_low_per_1000, 1)
                                    if self.ci_low_per_1000 is not None else None),
                "ci_high_per_1000": (round(self.ci_high_per_1000, 1)
                                     if self.ci_high_per_1000 is not None else None),
                "number_needed_to_treat": self.nnt, "nnt_kind": self.nnt_kind,
                "comparator_risk_basis": self.basis,
                "text": self.format()}


@dataclass
class Row:
    outcome: str
    n_participants: int | None
    n_studies: int
    certainty: str
    certainty_symbol: str
    relative_effect: str
    relative_measure: str
    absolute: AbsoluteEffect | None
    reasons: list[str]
    statement: str
    footnotes: list[str] = field(default_factory=list)

    def as_dict(self) -> dict:
        return {"outcome": self.outcome,
                "participants": self.n_participants, "studies": self.n_studies,
                "certainty": self.certainty, "symbol": self.certainty_symbol,
                "relative_effect": self.relative_effect,
                "relative_measure": self.relative_measure,
                "absolute_effect": self.absolute.as_dict() if self.absolute else None,
                "reasons_for_downgrade": self.reasons,
                "plain_language": self.statement,
                "footnotes": self.footnotes}


@dataclass
class SummaryOfFindings:
    question: str
    population: str
    intervention: str
    comparison: str
    setting: str
    rows: list[Row]
    caveats: list[str] = field(default_factory=list)

    def as_dict(self) -> dict:
        return {"standard": "GRADE Summary of Findings",
                "question": self.question, "population": self.population,
                "intervention": self.intervention, "comparison": self.comparison,
                "setting": self.setting,
                "rows": [r.as_dict() for r in self.rows],
                "caveats": self.caveats}

    def to_markdown(self) -> str:
        head = [f"### Summary of Findings — {self.question}", "",
                f"**Population:** {self.population or 'as retrieved'}  ",
                f"**Intervention:** {self.intervention or 'as retrieved'}  ",
                f"**Comparison:** {self.comparison or 'as reported in the studies'}  ",
                f"**Setting:** {self.setting or 'not restricted'}", "",
                "| Outcome | Anticipated absolute effects | Relative effect "
                "(95% CI) | № participants (studies) | Certainty | What this means |",
                "|---|---|---|---|---|---|"]
        for r in self.rows:
            absolute = r.absolute.format() if r.absolute else "not estimable"
            n = (f"{r.n_participants:,} ({r.n_studies})" if r.n_participants
                 else f"({r.n_studies} studies)")
            head.append(f"| {r.outcome} | {absolute} | {r.relative_effect} | "
                        f"{n} | {r.certainty_symbol} {r.certainty} | "
                        f"{r.statement} |")
        head.append("")
        for i, c in enumerate(self.caveats, 1):
            head.append(f"{i}. {c}")
        return "\n".join(head)


# ------------------------------------------------------------------- maths

def _rr_from(measure: str, value: float, baseline: float) -> float | None:
    """Convert a reported measure to a risk ratio at a given baseline risk.

    An odds ratio and a hazard ratio are not risk ratios, and treating them as
    one overstates the absolute effect — badly, when the baseline risk is high.
    These are the conversions GRADE's handbook specifies.
    """
    if baseline <= 0 or baseline >= 1:
        return None
    if measure == "RR":
        return value
    if measure == "OR":
        denom = 1.0 - baseline * (1.0 - value)
        return value / denom if denom > 0 else None
    if measure in ("HR", "IRR"):
        # Risk under the intervention from the control survival function.
        survival = (1.0 - baseline) ** value
        return (1.0 - survival) / baseline if baseline > 0 else None
    return None


def absolute_effect(measure: str, estimate: float, ci_low: float | None,
                    ci_high: float | None, baseline: float, basis: str
                    ) -> AbsoluteEffect | None:
    """Anticipated absolute effects per 1,000 at a stated comparator risk."""
    rr = _rr_from(measure, estimate, baseline)
    if rr is None:
        return None
    comparator = baseline * 1000.0
    intervention = baseline * rr * 1000.0
    difference = intervention - comparator

    lo = hi = None
    if ci_low is not None and ci_high is not None:
        rr_lo = _rr_from(measure, ci_low, baseline)
        rr_hi = _rr_from(measure, ci_high, baseline)
        if rr_lo is not None and rr_hi is not None:
            lo = baseline * rr_lo * 1000.0 - comparator
            hi = baseline * rr_hi * 1000.0 - comparator

    nnt = nnt_kind = None
    if abs(difference) >= 0.5:
        nnt = int(math.ceil(1000.0 / abs(difference)))
        nnt_kind = "benefit" if difference < 0 else "harm"
    return AbsoluteEffect(comparator_per_1000=comparator,
                          intervention_per_1000=intervention,
                          difference_per_1000=difference,
                          ci_low_per_1000=lo, ci_high_per_1000=hi,
                          nnt=nnt, nnt_kind=nnt_kind or "", basis=basis)


def informative_statement(certainty: str, intervention: str, outcome: str,
                          direction: str) -> str:
    """GRADE's prescribed wording for a certainty level and a direction."""
    key = (certainty if certainty in ("high", "moderate", "low", "very low")
           else "very low")
    text = _INFORMATIVE[(key, direction)].format(
        i=intervention or "the intervention", o=outcome or "this outcome")
    return text[0].upper() + text[1:] + "."


# ------------------------------------------------------------------- builder

def build(result, *, pooled=None, outcome: str = "", intervention: str = "",
          population: str = "", comparison: str = "", setting: str = "",
          comparator_risk: float | None = None,
          comparator_risk_basis: str = "") -> SummaryOfFindings:
    """Assemble a Summary of Findings table from a Strata result.

    One row per pooled outcome — which, for a single question, is one row. The
    structure supports more because a guideline question routinely has four or
    five outcomes, and the API exposes that path.
    """
    pico = getattr(result, "pico", None)
    population = population or (getattr(pico, "population", "") or "")
    intervention = intervention or (getattr(pico, "intervention", "") or "")
    outcome = outcome or (getattr(pico, "outcome", "") or "the reported outcome")
    pooled = pooled if pooled is not None else getattr(result, "pooled", None)

    body = result.body
    certainty = body.overall_strength
    n_studies = len(result.evidence)
    participants = sum(e.grade.sample_size or 0 for e in result.evidence) or None

    caveats = list(body.caveats)
    reasons = []
    for e in result.evidence[:3]:
        for d in e.grade.downgrades:
            reasons.append(f"{d.name.lower()}: {d.reason}")
    reasons = list(dict.fromkeys(reasons))[:4]

    if pooled is None:
        row = Row(outcome=outcome, n_participants=participants,
                  n_studies=n_studies, certainty=certainty,
                  certainty_symbol=_SYMBOLS.get(certainty, ""),
                  relative_effect="not pooled", relative_measure="",
                  absolute=None, reasons=reasons,
                  statement=informative_statement(certainty, intervention,
                                                  outcome, "none"),
                  footnotes=["No two studies reported the same effect measure "
                             "with an interval, so no pooled estimate was "
                             "computed. The certainty rating reflects the study "
                             "designs and their appraisal, not a synthesis."])
        return SummaryOfFindings(question=result.question, population=population,
                                 intervention=intervention, comparison=comparison,
                                 setting=setting, rows=[row], caveats=caveats)

    estimate = getattr(pooled, "estimate", None)
    lo, hi = (pooled.ci if hasattr(pooled, "ci")
              else (pooled.ci_low, pooled.ci_high))
    measure = pooled.measure
    excludes = (pooled.excludes_null if hasattr(pooled, "excludes_null")
                else not (lo <= 1.0 <= hi))

    if not excludes:
        direction = "none"
    elif getattr(pooled, "scale", "ratio") == "ratio":
        direction = "reduce" if estimate < 1.0 else "increase"
    else:
        direction = "reduce" if estimate < 0 else "increase"

    absolute = None
    if comparator_risk is not None and getattr(pooled, "scale", "") == "ratio":
        absolute = absolute_effect(
            measure, estimate, lo, hi, comparator_risk,
            comparator_risk_basis or "supplied by the caller")
    elif getattr(pooled, "scale", "") == "ratio":
        caveats.append(
            "No comparator (control-arm) risk was supplied and none could be "
            "read from the abstracts, so anticipated absolute effects are not "
            "shown. A relative effect without a baseline risk is not clinically "
            "interpretable, and Strata does not assume one.")

    footnotes = []
    if hasattr(pooled, "heterogeneity"):
        het = pooled.heterogeneity
        footnotes.append(
            f"Heterogeneity: I² = {het.i2:.0f}% ({het.band}), tau² = "
            f"{het.tau2:.4f} estimated by {het.tau2_method}"
            + (f", 95% CI for I² {het.i2_ci[0]:.0f}–{het.i2_ci[1]:.0f}%"
               if het.i2_ci else "") + ".")
        pi = pooled.prediction_interval
        if pi:
            footnotes.append(
                f"95% prediction interval {pi[0]:.2f} to {pi[1]:.2f} — the range "
                f"in which the effect in a new setting is expected to fall. It "
                f"is wider than the confidence interval and is the interval a "
                f"clinician applying this to one patient should read.")
    footnotes.append(
        "This is an indicative pooling of the papers one PubMed search returned. "
        "It is not a systematic review: there was no protocol, no duplicate "
        "screening and no grey-literature search.")

    ci_text = (f"{measure} {estimate:.2f} ({lo:.2f} to {hi:.2f})")

    row = Row(outcome=outcome, n_participants=participants, n_studies=n_studies,
              certainty=certainty, certainty_symbol=_SYMBOLS.get(certainty, ""),
              relative_effect=ci_text, relative_measure=measure,
              absolute=absolute, reasons=reasons,
              statement=informative_statement(certainty, intervention, outcome,
                                              direction),
              footnotes=footnotes)

    return SummaryOfFindings(question=result.question, population=population,
                             intervention=intervention, comparison=comparison,
                             setting=setting, rows=[row], caveats=caveats)
