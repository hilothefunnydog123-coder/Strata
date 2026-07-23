"""Sensitivity analysis: which study is holding the conclusion up?

A pooled estimate is a weighted average, and a weighted average can be one study
wearing a trench coat. Before anyone acts on a meta-analysis they should know
whether removing the single most influential trial changes the answer — and if
it does, that fact belongs next to the estimate, not in a supplementary
appendix nobody opens.

Three views, all cheap to compute and all standard:

**Leave-one-out.** Re-pool k times, each time omitting one study. If any single
omission flips whether the interval excludes the null, the result is fragile and
Strata says so in plain language.

**Baujat coordinates.** Each study's contribution to heterogeneity on one axis
against its influence on the pooled estimate on the other. Studies in the
top-right corner are the ones both driving the disagreement and moving the
answer — the ones worth reading in full.

**Standardised residuals and hat values.** How far each study sits from the
pooled estimate relative to its own precision, and how much leverage its weight
gives it. A large residual on a low-precision study is unremarkable; the same
residual on a study carrying 40% of the weight is the whole analysis.
"""
from __future__ import annotations

import math
from dataclasses import dataclass, field

from .core import MetaResult, Study, meta_analyze


@dataclass
class StudyInfluence:
    label: str
    pmid: str
    weight: float                     # percent in the full model
    estimate_without: float           # reporting scale
    ci_without: tuple[float, float]
    i2_without: float
    tau2_without: float
    shift_percent: float              # how far omitting it moves the estimate
    flips_significance: bool
    baujat_x: float                   # contribution to Q
    baujat_y: float                   # influence on the pooled estimate
    std_residual: float
    hat: float

    @property
    def influential(self) -> bool:
        return self.flips_significance or abs(self.std_residual) > 1.96 \
            or abs(self.shift_percent) >= 10.0

    def as_dict(self) -> dict:
        return {"label": self.label, "pmid": self.pmid,
                "weight": round(self.weight, 2),
                "estimate_without": round(self.estimate_without, 4),
                "ci_without": [round(v, 4) for v in self.ci_without],
                "i_squared_without": round(self.i2_without, 1),
                "tau_squared_without": round(self.tau2_without, 6),
                "shift_percent": round(self.shift_percent, 1),
                "flips_significance": self.flips_significance,
                "baujat_x": round(self.baujat_x, 4),
                "baujat_y": round(self.baujat_y, 4),
                "std_residual": round(self.std_residual, 3),
                "hat": round(self.hat, 4),
                "influential": self.influential}


@dataclass
class Sensitivity:
    k: int
    robust: bool
    verdict: str
    studies: list[StudyInfluence] = field(default_factory=list)
    range_low: float = 0.0
    range_high: float = 0.0
    dominant: str = ""

    def as_dict(self) -> dict:
        return {"k": self.k, "robust": self.robust, "verdict": self.verdict,
                "leave_one_out_range": [round(self.range_low, 4),
                                        round(self.range_high, 4)],
                "dominant_study": self.dominant or None,
                "studies": [s.as_dict() for s in self.studies]}


def leave_one_out(studies: list[Study], *, method: str = "PM",
                  ci_method: str = "hksj") -> list[MetaResult]:
    """The k re-pooled estimates, in the order of ``studies``."""
    out = []
    for i in range(len(studies)):
        subset = studies[:i] + studies[i + 1:]
        out.append(meta_analyze(subset, method=method, ci_method=ci_method))
    return out


def analyse(studies: list[Study], pooled: MetaResult | None = None, *,
            method: str = "PM", ci_method: str = "hksj") -> Sensitivity | None:
    """Full influence diagnostics for a pooled set."""
    k = len(studies)
    if k < 3:
        return None
    if pooled is None:
        pooled = meta_analyze(studies, method=method, ci_method=ci_method)
    if pooled is None:
        return None

    ws = [1.0 / (s.variance + pooled.heterogeneity.tau2) for s in studies]
    sw = sum(ws)

    # Fixed-effect quantities for the Baujat x-axis, which is defined against
    # the fixed-effect Q rather than the random-effects one.
    ws_fe = [1.0 / s.variance for s in studies]
    sw_fe = sum(ws_fe)
    mean_fe = sum(w * s.y for w, s in zip(ws_fe, studies)) / sw_fe

    rows: list[StudyInfluence] = []
    loo = leave_one_out(studies, method=method, ci_method=ci_method)

    for i, (s, without) in enumerate(zip(studies, loo)):
        if without is None:
            continue
        if pooled.scale == "ratio":
            shift = (100.0 * (without.estimate - pooled.estimate) / pooled.estimate
                     if pooled.estimate else 0.0)
        else:
            span = abs(pooled.ci[1] - pooled.ci[0]) or 1.0
            shift = 100.0 * (without.estimate - pooled.estimate) / span

        baujat_x = ws_fe[i] * (s.y - mean_fe) ** 2
        # Influence on the pooled estimate, scaled by its own variance — the
        # standard Baujat y-axis.
        var_pooled = 1.0 / sw
        baujat_y = ((pooled.y - without.y) ** 2) / var_pooled if var_pooled > 0 else 0.0

        hat = ws[i] / sw
        denom = math.sqrt(max(1e-12, s.variance + pooled.heterogeneity.tau2
                              - var_pooled))
        resid = (s.y - pooled.y) / denom

        rows.append(StudyInfluence(
            label=s.label, pmid=s.pmid, weight=100.0 * hat,
            estimate_without=without.estimate, ci_without=without.ci,
            i2_without=without.heterogeneity.i2,
            tau2_without=without.heterogeneity.tau2,
            shift_percent=shift,
            flips_significance=(without.excludes_null != pooled.excludes_null),
            baujat_x=baujat_x, baujat_y=baujat_y,
            std_residual=resid, hat=hat))

    if not rows:
        return None

    ests = [r.estimate_without for r in rows]
    flips = [r for r in rows if r.flips_significance]
    dominant = max(rows, key=lambda r: r.weight)

    if flips:
        names = ", ".join(r.label for r in flips[:3])
        more = f" (and {len(flips) - 3} more)" if len(flips) > 3 else ""
        lead = (f"Removing {names} flips" if len(flips) == 1
                else f"Removing any one of {names}{more} flips")
        verdict = (f"Not robust. {lead} whether the pooled interval excludes no "
                   f"effect. A conclusion that depends on one study is a "
                   f"conclusion about that study.")
        robust = False
    elif dominant.weight >= 50.0:
        verdict = (f"One study ({dominant.label}) carries "
                   f"{dominant.weight:.0f}% of the weight. The significance of "
                   f"the pooled estimate survives its removal, but the estimate "
                   f"is substantially that study's estimate.")
        robust = True
    else:
        verdict = (f"Robust to leaving out any single study: the pooled estimate "
                   f"stays between {min(ests):.2f} and {max(ests):.2f} and no "
                   f"omission changes whether the interval excludes no effect.")
        robust = True

    return Sensitivity(k=k, robust=robust, verdict=verdict, studies=rows,
                       range_low=min(ests), range_high=max(ests),
                       dominant=dominant.label if dominant.weight >= 50 else "")
