"""Meta-analysis proper: the methods a synthesis has to survive review with.

:mod:`strata.stats` pools with DerSimonian-Laird and stops there, which is the
right amount of machinery for an orientation number shown next to a search
result. It is not enough to put in front of an HTA committee, a regulator, or a
journal referee. Those readers ask a specific and predictable set of questions,
and this module exists to answer them:

**"Is DerSimonian-Laird really your estimator?"** It is known to underestimate
between-study variance when k is small, which makes intervals too narrow exactly
when the evidence is thinnest. Restricted maximum likelihood is the default here,
with Paule-Mandel, Sidik-Jonkman, Hedges and ML available and every result
carrying the name of the estimator that produced it.

**"Did you use Hartung-Knapp?"** With fewer than about twenty studies the normal
quantile produces intervals with well-documented under-coverage. The
Hartung-Knapp-Sidik-Jonkman adjustment uses a t quantile on k-1 degrees of
freedom and a variance-corrected standard error, and it is on by default.

**"What is the prediction interval?"** A confidence interval describes the mean
of the effect distribution. A clinician deciding for a patient in front of them
wants the interval a *new* study would land in, which under heterogeneity is far
wider — often spanning benefit and harm where the confidence interval does not.
Higgins, Thompson and Spiegelhalter's prediction interval is reported alongside
every random-effects estimate and is frequently the single most honest number in
the output.

**"How do you know the funnel is not asymmetric?"** Egger's regression, Begg's
rank correlation, and Duval-Tweedie trim-and-fill, with the k >= 10 caution
Cochrane attaches to all three stated in the result rather than left to the
reader.

**"Which study is driving this?"** Leave-one-out, DFFITS, Cook's distance,
Baujat coordinates, and cumulative meta-analysis by year.

**"Do the subgroups differ, or does that just look true?"** Q-between with its
own p-value, and mixed-effects meta-regression with an omnibus test, so a
subgroup claim has to clear a bar rather than be asserted from two forest plots
placed near each other.

**"Is the evidence base large enough to conclude anything?"** Trial sequential
analysis: the diversity-adjusted required information size, and O'Brien-Fleming
alpha-spending boundaries, which is how you distinguish "no effect" from "not
enough data to tell yet" — a distinction conventional meta-analysis erases.

Nothing here imputes. A study with no reported interval contributes to the
narrative and not to the arithmetic, and every function returns ``None`` rather
than a number it cannot stand behind.
"""
from __future__ import annotations

import math
from dataclasses import dataclass, field
from typing import Callable, Iterable, Optional, Sequence

from . import distributions as dist
from .stats import RATIO_MEASURES, EffectSize

__all__ = [
    "Study", "MetaResult", "Heterogeneity", "BiasAssessment", "Influence",
    "SubgroupAnalysis", "MetaRegression", "SequentialAnalysis", "AbsoluteEffect",
    "from_effects", "meta_analyze", "egger_test", "begg_test", "trim_and_fill",
    "fail_safe_n", "leave_one_out", "influence_diagnostics", "cumulative",
    "subgroup_analysis", "meta_regression", "trial_sequential_analysis",
    "absolute_effect", "TAU2_METHODS",
]

Z95 = 1.959963985

#: Between-study variance estimators, in the order a methods section lists them.
TAU2_METHODS = ("REML", "PM", "DL", "ML", "SJ", "HE")

_TAU2_NAME = {
    "REML": "restricted maximum likelihood",
    "PM": "Paule-Mandel",
    "DL": "DerSimonian-Laird",
    "ML": "maximum likelihood",
    "SJ": "Sidik-Jonkman",
    "HE": "Hedges",
}

#: Cochrane's threshold for attempting any funnel-plot asymmetry test. Below it
#: the tests have so little power that a null result means nothing at all.
MIN_STUDIES_FOR_BIAS = 10


# --------------------------------------------------------------------- inputs

@dataclass
class Study:
    """One study on the analysis scale.

    ``yi`` is the effect and ``vi`` its variance, both already transformed:
    ratio measures arrive as natural logs so that the sampling distribution is
    approximately normal and the interval is symmetric where the arithmetic
    needs it to be. :func:`from_effects` does that transformation; construct
    :class:`Study` directly only when you have ``yi`` and ``vi`` in hand.
    """
    label: str
    yi: float
    vi: float
    measure: str = ""
    scale: str = "ratio"
    year: int | None = None
    n: int | None = None
    events_treatment: int | None = None
    events_control: int | None = None
    n_treatment: int | None = None
    n_control: int | None = None
    subgroup: str | None = None
    covariates: dict = field(default_factory=dict)
    source_id: str = ""
    retracted: bool = False

    @property
    def sei(self) -> float:
        return math.sqrt(self.vi)

    @property
    def is_ratio(self) -> bool:
        return self.scale == "ratio"

    @property
    def weight_fixed(self) -> float:
        return 1.0 / self.vi if self.vi > 0 else 0.0

    def display(self) -> tuple[float, float, float]:
        """(estimate, ci_low, ci_high) back on the scale a reader recognises."""
        lo, hi = self.yi - Z95 * self.sei, self.yi + Z95 * self.sei
        if self.is_ratio:
            return math.exp(self.yi), math.exp(lo), math.exp(hi)
        return self.yi, lo, hi

    def as_dict(self) -> dict:
        est, lo, hi = self.display()
        return {"label": self.label, "measure": self.measure, "scale": self.scale,
                "yi": round(self.yi, 6), "vi": round(self.vi, 8),
                "se": round(self.sei, 6), "estimate": round(est, 4),
                "ci_low": round(lo, 4), "ci_high": round(hi, 4),
                "year": self.year, "n": self.n, "subgroup": self.subgroup,
                "source_id": self.source_id, "retracted": self.retracted}


def from_effects(effects: Sequence[EffectSize], *,
                 labels: Optional[Sequence[str]] = None,
                 years: Optional[Sequence[int | None]] = None,
                 sample_sizes: Optional[Sequence[int | None]] = None,
                 source_ids: Optional[Sequence[str]] = None,
                 subgroups: Optional[Sequence[str | None]] = None,
                 measure: Optional[str] = None) -> list[Study]:
    """Turn extracted effect sizes into analysis-scale studies.

    Only effects with a usable interval survive: a point estimate with no
    interval carries no information about its own precision, and inventing one
    from the sample size assumes the analysis that was not reported. Mixed
    measure families are resolved the same way :func:`strata.stats.pool` does —
    the most common measure wins and the rest are dropped, because pooling a
    risk ratio with a mean difference produces a number with no interpretation.
    """
    n = len(effects)
    labels = list(labels or [f"Study {i + 1}" for i in range(n)])
    years = list(years or [None] * n)
    sample_sizes = list(sample_sizes or [None] * n)
    source_ids = list(source_ids or [""] * n)
    subgroups = list(subgroups or [None] * n)

    rows: list[Study] = []
    for i, e in enumerate(effects):
        if e is None:
            continue
        pair = e.log_scale()
        if pair is None:
            continue
        yi, se = pair
        if se <= 0 or not math.isfinite(yi) or not math.isfinite(se):
            continue
        rows.append(Study(
            label=labels[i] if i < len(labels) else f"Study {i + 1}",
            yi=yi, vi=se * se, measure=e.measure,
            scale="ratio" if e.measure in RATIO_MEASURES else "difference",
            year=years[i] if i < len(years) else None,
            n=sample_sizes[i] if i < len(sample_sizes) else None,
            subgroup=subgroups[i] if i < len(subgroups) else None,
            source_id=source_ids[i] if i < len(source_ids) else ""))

    if not rows:
        return []
    if measure is None:
        counts: dict[str, int] = {}
        for s in rows:
            counts[s.measure] = counts.get(s.measure, 0) + 1
        measure = max(counts, key=lambda k: (counts[k], k))
    return [s for s in rows if s.measure == measure]


# --------------------------------------------------------------- heterogeneity

@dataclass
class Heterogeneity:
    """The between-study variation, reported several ways because each answers a
    different question and none of them answers all three.

    Two I-squared values are carried, and the difference between them is a
    question reviewers ask. :attr:`i_squared` is Higgins and Thompson's original
    ``(Q - df) / Q``, which depends only on the data. :attr:`i_squared_re` is
    ``tau² / (tau² + s²)``, which depends on which estimator produced tau-squared
    and is what ``metafor`` prints for a random-effects model. They agree exactly
    under DerSimonian-Laird and diverge slightly elsewhere, so Strata reports
    both rather than picking one and being accused of the other.
    """
    q: float
    df: int
    p_value: float
    tau_squared: float
    tau: float
    i_squared: float             # (Q - df) / Q — Higgins & Thompson
    h_squared: float             # total variation relative to sampling error
    method: str
    i_squared_re: float | None = None   # tau² / (tau² + s²)
    tau2_ci_low: float | None = None
    tau2_ci_high: float | None = None

    @property
    def band(self) -> str:
        """Cochrane's rough interpretation bands for I-squared."""
        if self.i_squared < 30:
            return "low"
        if self.i_squared < 50:
            return "moderate"
        if self.i_squared < 75:
            return "substantial"
        return "considerable"

    def format(self) -> str:
        s = (f"tau² = {self.tau_squared:.4f}, I² = {self.i_squared:.0f}% "
             f"({self.band}), Q({self.df}) = {self.q:.2f}, p = {_p(self.p_value)}")
        return s

    def as_dict(self) -> dict:
        return {"q": round(self.q, 4), "df": self.df,
                "p_value": round(self.p_value, 6),
                "tau_squared": round(self.tau_squared, 6), "tau": round(self.tau, 6),
                "i_squared": round(self.i_squared, 2),
                "i_squared_re": (None if self.i_squared_re is None
                                 else round(self.i_squared_re, 2)),
                "h_squared": round(self.h_squared, 4),
                "method": self.method, "method_name": _TAU2_NAME.get(self.method, self.method),
                "band": self.band,
                "tau2_ci": (None if self.tau2_ci_low is None else
                            [round(self.tau2_ci_low, 6), round(self.tau2_ci_high, 6)]),
                "text": self.format()}


def _q_statistic(ys: list[float], vs: list[float]) -> tuple[float, float]:
    """Cochran's Q and the fixed-effect mean it is computed around."""
    ws = [1.0 / v for v in vs]
    sw = sum(ws)
    mu = sum(w * y for w, y in zip(ws, ys)) / sw
    q = sum(w * (y - mu) ** 2 for w, y in zip(ws, ys))
    return q, mu


def _tau2_dl(ys, vs) -> float:
    k = len(ys)
    q, _ = _q_statistic(ys, vs)
    ws = [1.0 / v for v in vs]
    sw = sum(ws)
    c = sw - sum(w * w for w in ws) / sw
    return max(0.0, (q - (k - 1)) / c) if c > 0 else 0.0


def _tau2_he(ys, vs) -> float:
    """Hedges' estimator: the variance of the unweighted mean, less the mean
    sampling variance. Unbiased, and noticeably noisy for small k."""
    k = len(ys)
    if k < 2:
        return 0.0
    mean = sum(ys) / k
    s2 = sum((y - mean) ** 2 for y in ys) / (k - 1)
    return max(0.0, s2 - sum(vs) / k)


def _tau2_sj(ys, vs) -> float:
    """Sidik-Jonkman. Strictly positive by construction, which is a virtue when
    the point of the estimate is to widen an interval that would otherwise be
    falsely narrow."""
    k = len(ys)
    if k < 2:
        return 0.0
    tau0 = _tau2_he(ys, vs) or (sum((y - sum(ys) / k) ** 2 for y in ys) / k) or 0.01
    tau0 = max(tau0, 1e-8)
    ri = [v / tau0 for v in vs]
    wi = [1.0 / (r + 1.0) for r in ri]
    mu = sum(w * y for w, y in zip(wi, ys)) / sum(wi)
    return max(1e-10, sum(w * (y - mu) ** 2 for w, y in zip(wi, ys)) / (k - 1))


def _tau2_pm(ys, vs, tol: float = 1e-10, itmax: int = 200) -> float:
    """Paule-Mandel: the tau-squared that makes the generalised Q equal its
    degrees of freedom. Solved by bisection because the function is monotone
    decreasing in tau-squared and bracketing is trivial."""
    k = len(ys)
    if k < 2:
        return 0.0

    def gen_q(t2: float) -> float:
        ws = [1.0 / (v + t2) for v in vs]
        sw = sum(ws)
        mu = sum(w * y for w, y in zip(ws, ys)) / sw
        return sum(w * (y - mu) ** 2 for w, y in zip(ws, ys))

    if gen_q(0.0) <= k - 1:
        return 0.0
    lo, hi = 0.0, max(vs) + 1.0
    while gen_q(hi) > k - 1 and hi < 1e8:
        hi *= 2.0
    for _ in range(itmax):
        mid = 0.5 * (lo + hi)
        if gen_q(mid) > k - 1:
            lo = mid
        else:
            hi = mid
        if hi - lo < tol * max(1.0, hi):
            break
    return 0.5 * (lo + hi)


def _tau2_likelihood(ys, vs, *, restricted: bool, itmax: int = 200) -> float:
    """ML or REML by fixed-point iteration.

    The REML update carries the extra ``1 / sum(w)`` term that corrects for
    having estimated the mean from the same data — the whole reason REML exists
    and the reason it does not collapse to zero as readily as ML when k is small.
    """
    k = len(ys)
    if k < 2:
        return 0.0
    t2 = max(0.0, _tau2_dl(ys, vs))
    for _ in range(itmax):
        ws = [1.0 / (v + t2) for v in vs]
        sw = sum(ws)
        mu = sum(w * y for w, y in zip(ws, ys)) / sw
        num = sum(w * w * ((y - mu) ** 2 - v) for w, y, v in zip(ws, ys, vs))
        den = sum(w * w for w in ws)
        if den <= 0:
            return max(0.0, t2)
        new = num / den
        if restricted:
            # Viechtbauer's REML fixed point adds 1 / sum(w), which is the
            # correction for having estimated mu from the same data. Without it
            # this is the ML update, which collapses to zero far too readily
            # when k is small.
            new += 1.0 / sw
        new = max(0.0, new)
        if abs(new - t2) < 1e-12 * max(1.0, t2):
            t2 = new
            break
        t2 = new
    return max(0.0, t2)


def _estimate_tau2(ys, vs, method: str) -> float:
    method = method.upper()
    if method == "DL":
        return _tau2_dl(ys, vs)
    if method == "HE":
        return _tau2_he(ys, vs)
    if method == "SJ":
        return _tau2_sj(ys, vs)
    if method == "PM":
        return _tau2_pm(ys, vs)
    if method == "ML":
        return _tau2_likelihood(ys, vs, restricted=False)
    if method == "REML":
        return _tau2_likelihood(ys, vs, restricted=True)
    raise ValueError(f"unknown tau-squared method {method!r}; "
                     f"expected one of {', '.join(TAU2_METHODS)}")


def _typical_variance(vs: list[float]) -> float:
    """Higgins and Thompson's "typical" within-study variance s².

    The value that makes ``tau² / (tau² + s²)`` reduce to ``(Q - df) / Q`` when
    tau-squared comes from DerSimonian-Laird.
    """
    k = len(vs)
    if k < 2:
        return 0.0
    ws = [1.0 / v for v in vs]
    sw = sum(ws)
    sw2 = sum(w * w for w in ws)
    denom = sw * sw - sw2
    return ((k - 1) * sw / denom) if denom > 0 else 0.0


def _tau2_qprofile(ys, vs, level: float = 0.95) -> tuple[float, float]:
    """Q-profile (Viechtbauer) confidence bounds for tau-squared.

    Inverts the generalised Q statistic against its chi-square distribution.
    Reported because a tau-squared point estimate on eight studies is very
    imprecise, and a heterogeneity claim resting on one should show that.
    """
    k = len(ys)
    if k < 3:
        return (0.0, float("inf"))
    alpha = 1.0 - level

    def gen_q(t2: float) -> float:
        ws = [1.0 / (v + t2) for v in vs]
        sw = sum(ws)
        mu = sum(w * y for w, y in zip(ws, ys)) / sw
        return sum(w * (y - mu) ** 2 for w, y in zip(ws, ys))

    hi_crit = dist.chi2_ppf(1.0 - alpha / 2.0, k - 1)
    lo_crit = dist.chi2_ppf(alpha / 2.0, k - 1)

    def solve(target: float) -> float:
        if gen_q(0.0) <= target:
            return 0.0
        lo, hi = 0.0, max(vs) + 1.0
        while gen_q(hi) > target and hi < 1e10:
            hi *= 2.0
        for _ in range(200):
            mid = 0.5 * (lo + hi)
            if gen_q(mid) > target:
                lo = mid
            else:
                hi = mid
        return 0.5 * (lo + hi)

    return solve(hi_crit), solve(lo_crit)


# ------------------------------------------------------------------- the model

@dataclass
class MetaResult:
    """A pooled estimate with everything needed to defend it."""
    model: str                       # "fixed" | "random"
    measure: str
    scale: str
    k: int
    estimate: float                  # analysis scale (log for ratios)
    se: float
    ci_low: float
    ci_high: float
    statistic: float
    p_value: float
    ci_method: str                   # "wald" | "knha"
    df: float | None
    heterogeneity: Heterogeneity
    weights: list[float] = field(default_factory=list)     # percent
    studies: list[Study] = field(default_factory=list)
    pi_low: float | None = None
    pi_high: float | None = None
    notes: list[str] = field(default_factory=list)

    # ------------------------------------------------------- reported scale
    @property
    def is_ratio(self) -> bool:
        return self.scale == "ratio"

    def _back(self, v: float) -> float:
        return math.exp(v) if self.is_ratio else v

    @property
    def effect(self) -> float:
        return self._back(self.estimate)

    @property
    def effect_ci(self) -> tuple[float, float]:
        return self._back(self.ci_low), self._back(self.ci_high)

    @property
    def prediction_interval(self) -> tuple[float, float] | None:
        if self.pi_low is None:
            return None
        return self._back(self.pi_low), self._back(self.pi_high)

    @property
    def null_value(self) -> float:
        return 1.0 if self.is_ratio else 0.0

    @property
    def excludes_null(self) -> bool:
        lo, hi = self.effect_ci
        return not (lo <= self.null_value <= hi)

    @property
    def prediction_excludes_null(self) -> bool | None:
        """Whether a future study is predicted to fall entirely on one side.

        Routinely false where :attr:`excludes_null` is true, and that gap is the
        point: it says the *average* effect is non-null while an individual
        setting may still see nothing, which is the honest reading of a
        heterogeneous body of evidence.
        """
        pi = self.prediction_interval
        if pi is None:
            return None
        return not (pi[0] <= self.null_value <= pi[1])

    # ------------------------------------------------------------- rendering
    def format(self) -> str:
        lo, hi = self.effect_ci
        s = (f"{self.measure} {self.effect:.2f} "
             f"(95% CI {_interval(lo, hi)}) from {self.k} studies")
        if self.model == "random":
            s += f", I² = {self.heterogeneity.i_squared:.0f}%"
        pi = self.prediction_interval
        if pi is not None:
            s += f"; 95% prediction interval {_interval(pi[0], pi[1])}"
        return s

    def methods_sentence(self) -> str:
        """A sentence fit to drop into a methods section verbatim."""
        if self.model == "fixed":
            return (f"Effects were pooled under a fixed-effect (inverse-variance) "
                    f"model across {self.k} studies.")
        bits = [f"Effects were pooled under a random-effects model "
                f"({_TAU2_NAME.get(self.heterogeneity.method, self.heterogeneity.method)} "
                f"estimator for tau²)"]
        if self.ci_method == "knha":
            bits.append("with the Hartung-Knapp-Sidik-Jonkman adjustment to the "
                        "confidence interval")
        bits.append(f"across {self.k} studies")
        return ", ".join(bits) + "."

    def as_dict(self) -> dict:
        lo, hi = self.effect_ci
        pi = self.prediction_interval
        return {
            "model": self.model, "measure": self.measure, "scale": self.scale,
            "k": self.k, "estimate": round(self.effect, 4),
            "ci_low": round(lo, 4), "ci_high": round(hi, 4),
            "log_estimate": round(self.estimate, 6), "se": round(self.se, 6),
            "statistic": round(self.statistic, 4),
            "p_value": round(self.p_value, 6),
            "ci_method": self.ci_method, "df": self.df,
            "excludes_null": self.excludes_null,
            "prediction_interval": (None if pi is None else
                                    [round(pi[0], 4), round(pi[1], 4)]),
            "prediction_excludes_null": self.prediction_excludes_null,
            "heterogeneity": self.heterogeneity.as_dict(),
            "weights": [round(w, 2) for w in self.weights],
            "studies": [s.as_dict() for s in self.studies],
            "notes": self.notes,
            "methods_sentence": self.methods_sentence(),
            "text": self.format(),
        }


def meta_analyze(studies: Sequence[Study], *, model: str = "random",
                 tau2_method: str = "REML", knha: bool = True,
                 level: float = 0.95,
                 prediction_interval: bool = True,
                 min_studies: int = 2,
                 exclude_retracted: bool = True) -> MetaResult | None:
    """Pool a set of studies. Returns ``None`` when there are too few to pool.

    Defaults are chosen for correctness under small k rather than for agreement
    with whatever a given software package happens to do: REML for tau-squared,
    Hartung-Knapp for the interval, and a prediction interval reported alongside.
    Pass ``tau2_method="DL"`` and ``knha=False`` to reproduce the classical
    DerSimonian-Laird output exactly.
    """
    rows = [s for s in studies if s.vi > 0 and math.isfinite(s.yi)]
    if exclude_retracted:
        dropped = [s for s in rows if s.retracted]
        rows = [s for s in rows if not s.retracted]
    else:
        dropped = []
    k = len(rows)
    if k < max(1, min_studies):
        return None

    scales = {s.scale for s in rows}
    if len(scales) > 1:
        raise ValueError("cannot pool ratio and difference measures together")
    measures = {s.measure for s in rows if s.measure}
    if len(measures) > 1:
        raise ValueError(f"cannot pool mixed measures {sorted(measures)}; "
                         f"select one family first")

    ys = [s.yi for s in rows]
    vs = [s.vi for s in rows]
    notes: list[str] = []
    if dropped:
        notes.append(f"{len(dropped)} retracted stud"
                     f"{'ies were' if len(dropped) > 1 else 'y was'} excluded "
                     f"from the pooled estimate")

    q, _ = _q_statistic(ys, vs)
    df = k - 1
    q_p = dist.chi2_sf(q, df) if df > 0 else 1.0

    if model == "fixed":
        tau2, method_used = 0.0, "none"
    else:
        method_used = tau2_method.upper()
        tau2 = _estimate_tau2(ys, vs, method_used)

    ws = [1.0 / (v + tau2) for v in vs]
    sw = sum(ws)
    est = sum(w * y for w, y in zip(ws, ys)) / sw
    se = math.sqrt(1.0 / sw)

    # Higgins & Thompson's I² and H², from Q rather than from tau-squared, so
    # they stay comparable across the estimators above.
    i2 = max(0.0, min(100.0, (q - df) / q * 100.0)) if q > 0 and df > 0 else 0.0
    h2 = max(1.0, q / df) if df > 0 else 1.0

    ci_method, stat_df = "wald", None
    if model == "random" and knha and k >= 3:
        # Hartung-Knapp: replace the model-based variance with one estimated
        # from the weighted residuals, and read the quantile off a t on k-1 df.
        resid = sum(w * (y - est) ** 2 for w, y in zip(ws, ys)) / df
        # The truncated ("ad hoc") variant: HK can produce an interval narrower
        # than the classical one when the residuals happen to be small, which
        # is not a defensible direction for a small-sample correction to move.
        se_hk = math.sqrt(max(resid, 1.0) / sw)
        se = se_hk
        ci_method, stat_df = "knha", float(df)

    alpha = 1.0 - level
    if ci_method == "knha":
        crit = dist.student_t_ppf(1.0 - alpha / 2.0, stat_df)
        statistic = est / se if se > 0 else 0.0
        p = 2.0 * dist.student_t_sf(abs(statistic), stat_df)
    else:
        crit = dist.normal_ppf(1.0 - alpha / 2.0)
        statistic = est / se if se > 0 else 0.0
        p = 2.0 * dist.normal_sf(abs(statistic))

    lo, hi = est - crit * se, est + crit * se

    pi_lo = pi_hi = None
    if prediction_interval and model == "random" and k >= 3 and tau2 > 0:
        # Higgins-Thompson-Spiegelhalter, on k-2 degrees of freedom.
        t_pi = dist.student_t_ppf(1.0 - alpha / 2.0, max(1, k - 2))
        spread = math.sqrt(tau2 + se * se)
        pi_lo, pi_hi = est - t_pi * spread, est + t_pi * spread
    elif prediction_interval and model == "random" and k >= 3:
        notes.append("no prediction interval: tau² estimated as zero, so it "
                     "would coincide with the confidence interval")

    if model == "random" and k < 5:
        notes.append(f"only {k} studies — the between-study variance is estimated "
                     f"very imprecisely and the interval should be read as "
                     f"approximate")

    tau2_lo = tau2_hi = None
    if model == "random" and k >= 3:
        try:
            tau2_lo, tau2_hi = _tau2_qprofile(ys, vs, level)
        except Exception:
            tau2_lo = tau2_hi = None

    s2 = _typical_variance(vs)
    i2_re = (100.0 * tau2 / (tau2 + s2)) if (tau2 + s2) > 0 else 0.0

    het = Heterogeneity(q=q, df=df, p_value=q_p, tau_squared=tau2,
                        tau=math.sqrt(tau2), i_squared=i2, h_squared=h2,
                        method=method_used, i_squared_re=i2_re,
                        tau2_ci_low=tau2_lo, tau2_ci_high=tau2_hi)

    return MetaResult(
        model=model, measure=(rows[0].measure or "effect"), scale=rows[0].scale,
        k=k, estimate=est, se=se, ci_low=lo, ci_high=hi, statistic=statistic,
        p_value=p, ci_method=ci_method, df=stat_df, heterogeneity=het,
        weights=[100.0 * w / sw for w in ws], studies=rows,
        pi_low=pi_lo, pi_high=pi_hi, notes=notes)


# ------------------------------------------------------------ publication bias

@dataclass
class BiasAssessment:
    """One funnel-asymmetry test, with its own power caveat attached."""
    test: str
    statistic: float
    p_value: float
    k: int
    interpretation: str
    underpowered: bool
    detail: dict = field(default_factory=dict)

    def as_dict(self) -> dict:
        return {"test": self.test, "statistic": round(self.statistic, 4),
                "p_value": round(self.p_value, 6), "k": self.k,
                "interpretation": self.interpretation,
                "underpowered": self.underpowered, **self.detail}


def egger_test(studies: Sequence[Study]) -> BiasAssessment | None:
    """Egger's regression test for funnel-plot asymmetry.

    Regresses each study's standard normal deviate on its precision. Under
    symmetry the intercept is zero; a non-zero intercept says small studies
    report systematically different effects from large ones. That is *evidence
    of asymmetry*, not evidence of publication bias — genuine heterogeneity by
    study size produces it too — and the interpretation string says so.
    """
    rows = [s for s in studies if s.vi > 0]
    k = len(rows)
    if k < 3:
        return None

    xs = [1.0 / s.sei for s in rows]                 # precision
    ys = [s.yi / s.sei for s in rows]                # standard normal deviate
    fit = _ols(xs, ys)
    if fit is None:
        return None
    intercept, slope, se_intercept, _ = fit
    df = k - 2
    if se_intercept <= 0 or df < 1:
        return None
    t = intercept / se_intercept
    p = 2.0 * dist.student_t_sf(abs(t), df)

    under = k < MIN_STUDIES_FOR_BIAS
    if under:
        interp = (f"only {k} studies — Egger's test has very little power below "
                  f"{MIN_STUDIES_FOR_BIAS} and a non-significant result here is "
                  f"uninformative")
    elif p < 0.10:
        interp = ("the funnel is asymmetric (p < 0.10, Egger's conventional "
                  "threshold): smaller studies report systematically different "
                  "effects, which is consistent with publication bias but also "
                  "with genuine size-related heterogeneity")
    else:
        interp = "no statistically significant funnel asymmetry detected"

    return BiasAssessment(test="Egger regression", statistic=t, p_value=p, k=k,
                          interpretation=interp, underpowered=under,
                          detail={"intercept": round(intercept, 4),
                                  "intercept_se": round(se_intercept, 4),
                                  "slope": round(slope, 4), "df": df})


def begg_test(studies: Sequence[Study]) -> BiasAssessment | None:
    """Begg and Mazumdar's rank correlation test.

    Kendall's tau between the variance-standardised effect and its variance,
    with the tie-corrected normal approximation. Less powerful than Egger's but
    free of its distributional assumption, so the two are reported together and
    disagreement between them is itself informative.
    """
    rows = [s for s in studies if s.vi > 0]
    k = len(rows)
    if k < 3:
        return None

    ws = [1.0 / s.vi for s in rows]
    sw = sum(ws)
    mu = sum(w * s.yi for w, s in zip(ws, rows)) / sw
    # Standardise so the effect and its variance are uncorrelated under the null.
    starred, variances = [], []
    for s in rows:
        var_star = s.vi - 1.0 / sw
        if var_star <= 0:
            continue
        starred.append((s.yi - mu) / math.sqrt(var_star))
        variances.append(s.vi)
    n = len(starred)
    if n < 3:
        return None

    concordant = discordant = 0
    tie_x = tie_y = 0
    for i in range(n):
        for j in range(i + 1, n):
            dx = starred[i] - starred[j]
            dy = variances[i] - variances[j]
            if dx == 0 and dy == 0:
                continue
            if dx == 0:
                tie_x += 1
                continue
            if dy == 0:
                tie_y += 1
                continue
            if (dx > 0) == (dy > 0):
                concordant += 1
            else:
                discordant += 1

    n0 = n * (n - 1) / 2.0
    denom = math.sqrt(max(1e-12, (n0 - tie_x) * (n0 - tie_y)))
    tau = (concordant - discordant) / denom
    var_tau = (2.0 * (2 * n + 5)) / (9.0 * n * (n - 1))
    z = tau / math.sqrt(var_tau) if var_tau > 0 else 0.0
    p = 2.0 * dist.normal_sf(abs(z))

    under = n < MIN_STUDIES_FOR_BIAS
    if under:
        interp = (f"only {n} studies — the rank correlation test is badly "
                  f"underpowered here")
    elif p < 0.10:
        interp = ("effect size correlates with study precision, consistent with "
                  "funnel asymmetry")
    else:
        interp = "no significant rank correlation between effect and precision"

    return BiasAssessment(test="Begg rank correlation", statistic=z, p_value=p,
                          k=n, interpretation=interp, underpowered=under,
                          detail={"kendall_tau": round(tau, 4),
                                  "concordant": concordant,
                                  "discordant": discordant})


@dataclass
class TrimFillResult:
    """Duval and Tweedie's non-parametric adjustment for funnel asymmetry."""
    n_missing: int
    side: str                       # "left" | "right" | "none"
    original: MetaResult
    adjusted: MetaResult | None
    estimator: str
    interpretation: str

    def as_dict(self) -> dict:
        return {"n_missing": self.n_missing, "side": self.side,
                "estimator": self.estimator,
                "original": round(self.original.effect, 4),
                "adjusted": (None if self.adjusted is None
                             else round(self.adjusted.effect, 4)),
                "adjusted_ci": (None if self.adjusted is None else
                                [round(v, 4) for v in self.adjusted.effect_ci]),
                "adjusted_excludes_null": (None if self.adjusted is None
                                           else self.adjusted.excludes_null),
                "interpretation": self.interpretation}


def trim_and_fill(studies: Sequence[Study], *, estimator: str = "L0",
                  model: str = "random", tau2_method: str = "REML",
                  itmax: int = 100) -> TrimFillResult | None:
    """Estimate how many studies are missing, mirror them in, and re-pool.

    The value is not the adjusted point estimate — which is a thought experiment
    built on studies that do not exist — but the comparison. If filling in six
    hypothetical missing trials moves the result from "clear benefit" to
    "interval crosses no effect", the original conclusion was never robust, and
    that is worth knowing regardless of whether the missing trials are real.
    """
    rows = [s for s in studies if s.vi > 0 and not s.retracted]
    k0 = len(rows)
    if k0 < 3:
        return None
    original = meta_analyze(rows, model=model, tau2_method=tau2_method)
    if original is None:
        return None

    def rank_stat(subset: list[Study], centre: float) -> tuple[float, str]:
        """(estimated missing count, side) from the L0 or R0 estimator."""
        centred = sorted(((s.yi - centre, s) for s in subset),
                         key=lambda p: abs(p[0]))
        n = len(centred)
        # Signed ranks of the absolute deviations from the current centre.
        signed = [(i + 1) * (1 if d > 0 else -1) for i, (d, _) in enumerate(centred)]
        tn = sum(r for r in signed if r > 0)
        side = "left" if tn > n * (n + 1) / 4.0 else "right"
        if estimator.upper() == "R0":
            # The length of the rightmost run of same-signed ranks, less one.
            run = 0
            for r in reversed(signed):
                if (r > 0) == (signed[-1] > 0):
                    run += 1
                else:
                    break
            val = run - 1
        else:                                          # L0
            val = (4.0 * tn - n * (n + 1)) / (2.0 * n - 1) if n > 0.5 else 0.0
        return max(0.0, val), side

    trimmed = list(rows)
    n_missing = 0
    side = "none"
    for _ in range(itmax):
        res = meta_analyze(trimmed, model=model, tau2_method=tau2_method,
                           min_studies=1, knha=False)
        if res is None:
            break
        val, side = rank_stat(rows, res.estimate)
        new_missing = int(round(val))
        if new_missing == n_missing:
            break
        n_missing = new_missing
        if n_missing <= 0 or n_missing >= k0:
            n_missing = max(0, min(n_missing, k0 - 1))
            break
        # Trim the n most extreme studies on the heavier side.
        order = sorted(rows, key=lambda s: s.yi, reverse=(side == "right"))
        trimmed = order[n_missing:]
        if len(trimmed) < 2:
            break

    if n_missing <= 0:
        return TrimFillResult(
            n_missing=0, side="none", original=original, adjusted=original,
            estimator=estimator.upper(),
            interpretation="the funnel is symmetric; no studies were imputed")

    # Mirror the n most extreme studies about the trimmed centre and re-pool.
    base = meta_analyze(trimmed, model=model, tau2_method=tau2_method,
                        min_studies=1, knha=False)
    centre = base.estimate if base else original.estimate
    extreme = sorted(rows, key=lambda s: s.yi, reverse=(side == "right"))[:n_missing]
    filled = list(rows) + [
        Study(label=f"imputed {i + 1}", yi=2 * centre - s.yi, vi=s.vi,
              measure=s.measure, scale=s.scale)
        for i, s in enumerate(extreme)]
    adjusted = meta_analyze(filled, model=model, tau2_method=tau2_method)

    if adjusted is None:
        interp = f"{n_missing} studies imputed, but the adjusted model did not converge"
    elif original.excludes_null and not adjusted.excludes_null:
        interp = (f"{n_missing} potentially missing stud"
                  f"{'ies' if n_missing > 1 else 'y'} imputed on the "
                  f"{side}; the adjusted interval no longer excludes no effect, "
                  f"so the finding is not robust to plausible publication bias")
    else:
        interp = (f"{n_missing} potentially missing stud"
                  f"{'ies' if n_missing > 1 else 'y'} imputed on the {side}; "
                  f"the direction of the conclusion is unchanged after adjustment")

    return TrimFillResult(n_missing=n_missing, side=side, original=original,
                          adjusted=adjusted, estimator=estimator.upper(),
                          interpretation=interp)


def fail_safe_n(studies: Sequence[Study], *, alpha: float = 0.05,
                method: str = "rosenthal") -> dict | None:
    """How many null studies would have to be sitting in file drawers.

    Rosenthal's number is widely criticised — it assumes the unpublished studies
    average exactly zero effect, which is not what publication bias produces —
    and it is included because reviewers still ask for it, with the criticism
    stated in the result so nobody reads it as a clean bill of health.
    """
    rows = [s for s in studies if s.vi > 0]
    k = len(rows)
    if k < 3:
        return None
    zs = [s.yi / s.sei for s in rows]
    z_sum = sum(zs)
    if z_sum == 0:
        return None
    z_alpha = dist.normal_ppf(1.0 - alpha / 2.0)
    n = max(0.0, (z_sum * z_sum) / (z_alpha * z_alpha) - k)
    return {"method": method, "fail_safe_n": int(math.ceil(n)), "k": k,
            "alpha": alpha,
            "robust": n > 5 * k + 10,
            "caveat": ("Rosenthal's fail-safe N assumes unpublished studies "
                       "average a null effect. Publication bias produces "
                       "unpublished studies with effects opposite to the "
                       "published ones, so this number is an upper bound on "
                       "robustness, not an estimate of it.")}


# ------------------------------------------------------------- sensitivity

@dataclass
class Influence:
    """What one study is doing to the pooled result."""
    label: str
    weight: float
    estimate_without: float
    ci_without: tuple[float, float]
    i2_without: float
    tau2_without: float
    standardised_residual: float
    dffits: float
    cooks_distance: float
    q_contribution: float
    baujat_x: float
    baujat_y: float
    changes_conclusion: bool

    def as_dict(self) -> dict:
        return {"label": self.label, "weight": round(self.weight, 2),
                "estimate_without": round(self.estimate_without, 4),
                "ci_without": [round(v, 4) for v in self.ci_without],
                "i2_without": round(self.i2_without, 1),
                "tau2_without": round(self.tau2_without, 6),
                "standardised_residual": round(self.standardised_residual, 3),
                "dffits": round(self.dffits, 4),
                "cooks_distance": round(self.cooks_distance, 4),
                "q_contribution": round(self.q_contribution, 3),
                "baujat": [round(self.baujat_x, 3), round(self.baujat_y, 3)],
                "changes_conclusion": self.changes_conclusion,
                "influential": (abs(self.standardised_residual) > 1.96
                                or self.changes_conclusion)}


def leave_one_out(studies: Sequence[Study], **kw) -> list[tuple[str, MetaResult]]:
    """Re-pool k times, each time omitting one study."""
    rows = [s for s in studies if s.vi > 0 and not s.retracted]
    if len(rows) < 3:
        return []
    out = []
    for i, s in enumerate(rows):
        subset = rows[:i] + rows[i + 1:]
        res = meta_analyze(subset, **kw)
        if res is not None:
            out.append((s.label, res))
    return out


def influence_diagnostics(studies: Sequence[Study], **kw) -> list[Influence]:
    """Per-study influence, including the one thing that actually matters:
    whether dropping the study flips the conclusion."""
    rows = [s for s in studies if s.vi > 0 and not s.retracted]
    if len(rows) < 3:
        return []
    full = meta_analyze(rows, **kw)
    if full is None:
        return []

    ys = [s.yi for s in rows]
    vs = [s.vi for s in rows]
    q_full, mu_fixed = _q_statistic(ys, vs)

    out: list[Influence] = []
    for i, s in enumerate(rows):
        subset = rows[:i] + rows[i + 1:]
        res = meta_analyze(subset, **kw)
        if res is None:
            continue

        # Standardised residual against the model fitted without this study.
        pred_var = res.se ** 2 + res.heterogeneity.tau_squared + s.vi
        resid = (s.yi - res.estimate) / math.sqrt(pred_var) if pred_var > 0 else 0.0

        # DFFITS: the shift in the pooled estimate in units of its own precision.
        dffits = ((full.estimate - res.estimate) / res.se) if res.se > 0 else 0.0
        cooks = ((full.estimate - res.estimate) ** 2 / full.se ** 2) \
            if full.se > 0 else 0.0

        w_fixed = 1.0 / s.vi
        q_contrib = w_fixed * (s.yi - mu_fixed) ** 2
        # Baujat: heterogeneity contributed (x) against influence on the
        # pooled estimate (y). The top-right corner is where the trouble is.
        baujat_y = (w_fixed * (full.estimate - res.estimate) ** 2)

        out.append(Influence(
            label=s.label,
            weight=full.weights[i] if i < len(full.weights) else 0.0,
            estimate_without=res.effect,
            ci_without=res.effect_ci,
            i2_without=res.heterogeneity.i_squared,
            tau2_without=res.heterogeneity.tau_squared,
            standardised_residual=resid, dffits=dffits, cooks_distance=cooks,
            q_contribution=q_contrib, baujat_x=q_contrib, baujat_y=baujat_y,
            changes_conclusion=(full.excludes_null != res.excludes_null)))
    return out


def cumulative(studies: Sequence[Study], *,
               key: Optional[Callable[[Study], object]] = None,
               **kw) -> list[tuple[str, MetaResult]]:
    """Cumulative meta-analysis: add studies one at a time in order.

    Ordered by year unless told otherwise. Shows when the evidence base first
    became conclusive — and, more usefully, when it stopped changing, which is
    the argument that further trials on the question would be unethical.
    """
    rows = [s for s in studies if s.vi > 0 and not s.retracted]
    if len(rows) < 2:
        return []
    keyfn = key or (lambda s: (s.year if s.year is not None else 9999, s.label))
    ordered = sorted(rows, key=keyfn)
    out = []
    for i in range(2, len(ordered) + 1):
        res = meta_analyze(ordered[:i], min_studies=2, **kw)
        if res is not None:
            label = ordered[i - 1].label
            if ordered[i - 1].year:
                label = f"{label} ({ordered[i - 1].year})"
            out.append((label, res))
    return out


# -------------------------------------------------------------- subgroups

@dataclass
class SubgroupAnalysis:
    groups: dict
    q_between: float
    df_between: int
    p_between: float
    common_tau2: bool
    interpretation: str

    def as_dict(self) -> dict:
        return {"groups": {k: v.as_dict() for k, v in self.groups.items()},
                "q_between": round(self.q_between, 4),
                "df_between": self.df_between,
                "p_between": round(self.p_between, 6),
                "common_tau2": self.common_tau2,
                "significant": self.p_between < 0.05,
                "interpretation": self.interpretation}


def subgroup_analysis(studies: Sequence[Study], *,
                      key: Optional[Callable[[Study], str]] = None,
                      common_tau2: bool = True, min_per_group: int = 2,
                      **kw) -> SubgroupAnalysis | None:
    """Pool within groups and test whether the groups genuinely differ.

    The test is the point. Two subgroup forest plots placed side by side, one
    with an interval excluding no effect and one without, look like a difference
    and usually are not — the standard error in the smaller group is simply
    larger. Q-between asks whether the *effects* differ, which is the claim
    being made.
    """
    rows = [s for s in studies if s.vi > 0 and not s.retracted]
    keyfn = key or (lambda s: s.subgroup or "unspecified")
    buckets: dict[str, list[Study]] = {}
    for s in rows:
        buckets.setdefault(keyfn(s), []).append(s)
    buckets = {k: v for k, v in buckets.items() if len(v) >= min_per_group}
    if len(buckets) < 2:
        return None

    tau2_fixed = None
    if common_tau2:
        overall = meta_analyze(rows, **kw)
        tau2_fixed = overall.heterogeneity.tau_squared if overall else 0.0

    results: dict[str, MetaResult] = {}
    for name, group in buckets.items():
        if tau2_fixed is not None:
            ws = [1.0 / (s.vi + tau2_fixed) for s in group]
            sw = sum(ws)
            est = sum(w * s.yi for w, s in zip(ws, group)) / sw
            se = math.sqrt(1.0 / sw)
            crit = dist.normal_ppf(0.975)
            q_g, _ = _q_statistic([s.yi for s in group], [s.vi for s in group])
            dfg = len(group) - 1
            het = Heterogeneity(
                q=q_g, df=dfg, p_value=dist.chi2_sf(q_g, dfg) if dfg else 1.0,
                tau_squared=tau2_fixed, tau=math.sqrt(tau2_fixed),
                i_squared=max(0.0, (q_g - dfg) / q_g * 100.0) if q_g > 0 and dfg else 0.0,
                h_squared=max(1.0, q_g / dfg) if dfg else 1.0,
                method="shared")
            results[name] = MetaResult(
                model="random", measure=group[0].measure, scale=group[0].scale,
                k=len(group), estimate=est, se=se, ci_low=est - crit * se,
                ci_high=est + crit * se, statistic=est / se if se else 0.0,
                p_value=2.0 * dist.normal_sf(abs(est / se)) if se else 1.0,
                ci_method="wald", df=None, heterogeneity=het,
                weights=[100.0 * w / sw for w in ws], studies=group,
                notes=["between-study variance shared across subgroups"])
        else:
            res = meta_analyze(group, **kw)
            if res is not None:
                results[name] = res

    if len(results) < 2:
        return None

    # Q-between: the weighted spread of the subgroup means around their own
    # inverse-variance-weighted mean.
    ests = [(r.estimate, 1.0 / (r.se ** 2)) for r in results.values() if r.se > 0]
    if len(ests) < 2:
        return None
    sw = sum(w for _, w in ests)
    grand = sum(e * w for e, w in ests) / sw
    q_between = sum(w * (e - grand) ** 2 for e, w in ests)
    df_between = len(ests) - 1
    p_between = dist.chi2_sf(q_between, df_between)

    if p_between < 0.05:
        interp = (f"the subgroups differ (Q = {q_between:.2f}, df = {df_between}, "
                  f"p = {_p(p_between)}). Subgroup effects are observational even "
                  f"within randomised trials: this is a hypothesis, not a "
                  f"treatment-effect modifier established by the data.")
    else:
        interp = (f"no significant difference between subgroups "
                  f"(p = {_p(p_between)}); apparent differences in the separate "
                  f"intervals are consistent with chance and differing precision")

    return SubgroupAnalysis(groups=results, q_between=q_between,
                            df_between=df_between, p_between=p_between,
                            common_tau2=common_tau2, interpretation=interp)


# ------------------------------------------------------------ meta-regression

@dataclass
class MetaRegression:
    covariates: list[str]
    coefficients: list[float]
    std_errors: list[float]
    statistics: list[float]
    p_values: list[float]
    ci_low: list[float]
    ci_high: list[float]
    tau2: float
    tau2_residual_i2: float
    r_squared: float
    q_residual: float
    q_residual_df: int
    q_residual_p: float
    omnibus_f: float
    omnibus_p: float
    k: int
    omnibus_q: float = 0.0
    omnibus_q_p: float = 1.0
    test: str = "knha"
    notes: list[str] = field(default_factory=list)

    def as_dict(self) -> dict:
        return {
            "terms": [
                {"term": name, "coefficient": round(b, 5), "se": round(se, 5),
                 "statistic": round(t, 4), "p_value": round(p, 6),
                 "ci_low": round(lo, 5), "ci_high": round(hi, 5)}
                for name, b, se, t, p, lo, hi in zip(
                    self.covariates, self.coefficients, self.std_errors,
                    self.statistics, self.p_values, self.ci_low, self.ci_high)],
            "tau2_residual": round(self.tau2, 6),
            "i2_residual": round(self.tau2_residual_i2, 2),
            "r_squared": round(self.r_squared, 4),
            "q_residual": round(self.q_residual, 4),
            "q_residual_df": self.q_residual_df,
            "q_residual_p": round(self.q_residual_p, 6),
            "omnibus_f": round(self.omnibus_f, 4),
            "omnibus_p": round(self.omnibus_p, 6),
            "omnibus_q": round(self.omnibus_q, 4),
            "omnibus_q_p": round(self.omnibus_q_p, 6),
            "test": self.test,
            "k": self.k, "notes": self.notes}


def _residual_tau2(X: list[list[float]], y: list[float], v: list[float],
                   method: str) -> float:
    """Residual between-study variance for a mixed-effects regression.

    Two estimators, and the distinction matters more here than in the
    intercept-only case because a naive iteration mixes them and produces
    standard errors that are far too small — the covariates absorb the
    heterogeneity, tau-squared collapses, and every coefficient looks
    significant.

    ``MM`` is the non-iterative method of moments (the DerSimonian-Laird
    analogue), which requires the residual Q to be computed with *fixed-effect*
    weights and corrected by the trace of the hat matrix.

    ``REML`` and ``ML`` are Fisher-scoring iterations on the projection matrix
    ``P = W - WX(X'WX)⁻¹X'W``, which is the standard formulation and the one
    ``metafor`` implements.
    """
    k, p = len(y), len(X[0])
    df_res = k - p
    if df_res <= 0:
        return 0.0

    method = method.upper()
    if method in ("DL", "MM", "HE", "SJ", "PM"):
        # Method of moments. Q_E uses fixed-effect weights; the denominator is
        # tr(W) - tr((X'WX)^-1 X'W²X), not simply sum(w).
        w0 = [1.0 / vi for vi in v]
        fit = _wls(X, y, w0)
        if fit is None:
            return 0.0
        beta0, _ = fit
        resid = [yi - sum(b * xj for b, xj in zip(beta0, row))
                 for yi, row in zip(y, X)]
        q_e = sum(wi * r * r for wi, r in zip(w0, resid))
        denom = sum(w0) - _trace_hat(X, v)
        return max(0.0, (q_e - df_res) / denom) if denom > 0 else 0.0

    restricted = method != "ML"
    tau2 = _residual_tau2(X, y, v, "MM")
    for _ in range(200):
        w = [1.0 / (vi + tau2) for vi in v]
        P = _projection(X, w)
        if P is None:
            return max(0.0, tau2)
        Py = [sum(P[i][j] * y[j] for j in range(k)) for i in range(k)]
        ypy = sum(y[i] * Py[i] for i in range(k))
        ypp_y = sum(Py[i] * Py[i] for i in range(k))
        tr_p = sum(P[i][i] for i in range(k))
        tr_pp = sum(P[i][j] * P[i][j] for i in range(k) for j in range(k))
        if not restricted:
            # ML drops the projection correction to the trace terms.
            tr_p = sum(w) - _trace_hat(X, v)
            tr_pp = sum(wi * wi for wi in w)
            ypp_y = sum(wi * wi * (y[i] - sum(
                b * xj for b, xj in zip(_wls(X, y, w)[0], X[i]))) ** 2
                for i, wi in enumerate(w))
            ypy = tr_p
        if tr_pp <= 0:
            return max(0.0, tau2)
        step = (ypp_y - tr_p) / tr_pp
        new = max(0.0, tau2 + step)
        if abs(new - tau2) < 1e-12 * max(1.0, tau2):
            return new
        tau2 = new
    return max(0.0, tau2)


def _projection(X: list[list[float]], w: list[float]):
    """P = W - W X (X'WX)^-1 X' W, the residual projection under weights ``w``."""
    k, p = len(X), len(X[0])
    xtwx = [[0.0] * p for _ in range(p)]
    for row, wi in zip(X, w):
        for a in range(p):
            for b in range(p):
                xtwx[a][b] += wi * row[a] * row[b]
    inv = _invert(xtwx)
    if inv is None:
        return None
    P = [[0.0] * k for _ in range(k)]
    for i in range(k):
        for j in range(k):
            quad = sum(X[i][a] * inv[a][b] * X[j][b]
                       for a in range(p) for b in range(p))
            P[i][j] = (w[i] if i == j else 0.0) - w[i] * quad * w[j]
    return P


def meta_regression(studies: Sequence[Study], covariates: Sequence[str], *,
                    tau2_method: str = "REML", intercept: bool = True,
                    test: str = "knha") -> MetaRegression | None:
    """Mixed-effects meta-regression on study-level covariates.

    Weighted least squares with weights ``1 / (vi + tau²)``, where the residual
    tau-squared is estimated by :func:`_residual_tau2` rather than carried over
    from the intercept-only model — the covariates are supposed to explain some
    of the heterogeneity, and reusing the unconditional tau-squared would credit
    them with none of it.

    ``test`` selects the reference distribution for the coefficients: ``knha``
    (default) uses a t on ``k - p`` degrees of freedom, ``z`` uses the normal.
    The t is the safer default at the study counts meta-regression actually
    runs on; ``z`` reproduces ``metafor``'s default output.

    A warning that belongs in the output and not only in a textbook: these are
    study-level associations. Concluding that a patient characteristic modifies
    treatment effect from a regression on trial means is the ecological fallacy,
    and it has produced several widely believed claims that individual-patient
    data later contradicted. The note is attached to every result.
    """
    rows = [s for s in studies if s.vi > 0 and not s.retracted
            and all(_num(s.covariates.get(c)) is not None for c in covariates)]
    p = len(covariates) + (1 if intercept else 0)
    k = len(rows)
    if k < p + 2:
        return None

    names = (["intercept"] if intercept else []) + list(covariates)
    X = [([1.0] if intercept else []) + [_num(s.covariates[c]) for c in covariates]
         for s in rows]
    y = [s.yi for s in rows]
    v = [s.vi for s in rows]

    tau2 = _residual_tau2(X, y, v, tau2_method)
    w = [1.0 / (vi + tau2) for vi in v]
    fit = _wls(X, y, w)
    if fit is None:
        return None
    beta, cov = fit

    resid = [yi - sum(b * xj for b, xj in zip(beta, row))
             for yi, row in zip(y, X)]
    q_res = sum(wi * r * r for wi, r in zip(w, resid))
    df_res = k - p
    q_res_p = dist.chi2_sf(q_res, df_res) if df_res > 0 else 1.0

    ses = [math.sqrt(max(0.0, cov[i][i])) for i in range(p)]
    stats_ = [b / se if se > 0 else 0.0 for b, se in zip(beta, ses)]
    if test == "z":
        pvals = [2.0 * dist.normal_sf(abs(t)) for t in stats_]
        crit = dist.normal_ppf(0.975)
    else:
        pvals = [2.0 * dist.student_t_sf(abs(t), max(1, df_res)) for t in stats_]
        crit = dist.student_t_ppf(0.975, max(1, df_res))
    lows = [b - crit * se for b, se in zip(beta, ses)]
    highs = [b + crit * se for b, se in zip(beta, ses)]

    # R²: the share of between-study variance the covariates account for. Both
    # tau-squared values must come from the same estimator or the ratio is
    # meaningless.
    tau2_null = _estimate_tau2(y, v, tau2_method) if tau2_method in TAU2_METHODS \
        else _estimate_tau2(y, v, "REML")
    r2 = max(0.0, (tau2_null - tau2) / tau2_null * 100.0) if tau2_null > 0 else 0.0

    # Omnibus test on the non-intercept terms.
    idx = list(range(1, p)) if intercept else list(range(p))
    qm, qm_p = 0.0, 1.0
    if idx:
        sub_beta = [beta[i] for i in idx]
        sub_cov = [[cov[i][j] for j in idx] for i in idx]
        inv = _invert(sub_cov)
        if inv is None:
            f_stat, f_p = 0.0, 1.0
        else:
            qm = sum(sub_beta[i] * inv[i][j] * sub_beta[j]
                     for i in range(len(idx)) for j in range(len(idx)))
            m = len(idx)
            qm_p = dist.chi2_sf(qm, m)
            f_stat = qm / m
            f_p = dist.fisher_f_sf(f_stat, m, max(1, df_res))
    else:
        f_stat, f_p = 0.0, 1.0

    i2_resid = 0.0
    if q_res > df_res > 0:
        i2_resid = max(0.0, (q_res - df_res) / q_res * 100.0)

    notes = [
        "Coefficients describe associations between study-level characteristics "
        "and study-level effects. Attributing them to individual patients is the "
        "ecological fallacy; only individual-participant data can establish "
        "effect modification at the patient level.",
    ]
    if k < 10 * len(covariates):
        notes.append(f"{k} studies for {len(covariates)} covariate(s) — the "
                     f"usual guidance is at least ten studies per covariate, so "
                     f"this model is prone to overfitting")

    return MetaRegression(
        covariates=names, coefficients=beta, std_errors=ses, statistics=stats_,
        p_values=pvals, ci_low=lows, ci_high=highs, tau2=tau2,
        tau2_residual_i2=i2_resid, r_squared=r2, q_residual=q_res,
        q_residual_df=df_res, q_residual_p=q_res_p, omnibus_f=f_stat,
        omnibus_p=f_p, k=k, omnibus_q=qm, omnibus_q_p=qm_p, test=test,
        notes=notes)


# ------------------------------------------------- trial sequential analysis

@dataclass
class SequentialAnalysis:
    """Trial sequential analysis: is there enough evidence to conclude anything?"""
    required_information_size: int
    accrued_information: int
    information_fraction: float
    cumulative_z: float
    boundary_z: float
    crosses_benefit: bool
    crosses_harm: bool
    futility: bool
    alpha: float
    power: float
    diversity: float
    relative_risk_reduction: float
    control_event_rate: float
    conclusion: str

    def as_dict(self) -> dict:
        return {"required_information_size": self.required_information_size,
                "accrued_information": self.accrued_information,
                "information_fraction": round(self.information_fraction, 4),
                "cumulative_z": round(self.cumulative_z, 4),
                "boundary_z": round(self.boundary_z, 4),
                "crosses_benefit": self.crosses_benefit,
                "crosses_harm": self.crosses_harm,
                "futility": self.futility,
                "alpha": self.alpha, "power": self.power,
                "diversity": round(self.diversity, 4),
                "assumptions": {
                    "relative_risk_reduction": self.relative_risk_reduction,
                    "control_event_rate": self.control_event_rate},
                "conclusion": self.conclusion}


def trial_sequential_analysis(
        studies: Sequence[Study], *, control_event_rate: float = 0.0,
        relative_risk_reduction: float = 0.20, alpha: float = 0.05,
        power: float = 0.90, total_n: Optional[int] = None) -> SequentialAnalysis | None:
    """Whether the accrued evidence is enough to stop asking the question.

    A conventional meta-analysis run after every new trial is a repeated
    significance test, and repeated testing at alpha = 0.05 finds a spurious
    effect far more often than one time in twenty. Trial sequential analysis
    borrows the interim-monitoring machinery from single trials: compute the
    information size a single adequately powered trial would need, adjust it
    upward for the observed heterogeneity, and compare the cumulative z against
    an O'Brien-Fleming alpha-spending boundary that is deliberately hard to cross
    early.

    The practical payoff is a third verdict beyond "effective" and "not
    effective": *not yet enough evidence to say*, which is the true state of a
    great many meta-analyses that report a null result on four small trials.
    """
    rows = [s for s in studies if s.vi > 0 and not s.retracted]
    k = len(rows)
    if k < 2:
        return None

    res = meta_analyze(rows, model="random", knha=False)
    if res is None:
        return None

    # Diversity (D²) rather than I²: it is the quantity that actually inflates
    # the required information size under a random-effects model.
    ys = [s.yi for s in rows]
    vs = [s.vi for s in rows]
    tau2 = res.heterogeneity.tau_squared
    ws_fixed = [1.0 / v for v in vs]
    var_fixed = 1.0 / sum(ws_fixed)
    ws_rand = [1.0 / (v + tau2) for v in vs]
    var_rand = 1.0 / sum(ws_rand)
    diversity = max(0.0, min(0.99, 1.0 - var_fixed / var_rand)) if var_rand > 0 else 0.0

    accrued = total_n if total_n is not None else sum(
        s.n for s in rows if s.n) or 0

    if control_event_rate <= 0:
        # Derive a control event rate from the studies if any reported arms.
        events = sum(s.events_control or 0 for s in rows)
        denom = sum(s.n_control or 0 for s in rows)
        control_event_rate = (events / denom) if denom > 0 else 0.10

    pc = min(0.999, max(0.001, control_event_rate))
    pe = max(0.0005, pc * (1.0 - relative_risk_reduction))
    pbar = (pc + pe) / 2.0
    z_a = dist.normal_ppf(1.0 - alpha / 2.0)
    z_b = dist.normal_ppf(power)
    delta = abs(pc - pe)
    if delta <= 0:
        return None
    # Two-arm sample size for a difference in proportions, then the diversity
    # adjustment that turns it into a heterogeneity-corrected information size.
    per_arm = ((z_a * math.sqrt(2 * pbar * (1 - pbar))
                + z_b * math.sqrt(pc * (1 - pc) + pe * (1 - pe))) ** 2) / (delta ** 2)
    naive = 2.0 * per_arm
    ris = int(math.ceil(naive / max(0.01, 1.0 - diversity)))

    frac = (accrued / ris) if ris > 0 else 0.0
    frac = max(1e-6, min(1.0, frac))

    # O'Brien-Fleming alpha spending: the boundary is very conservative early
    # and converges to the fixed-sample critical value at full information.
    boundary = z_a / math.sqrt(frac)
    boundary = min(boundary, 12.0)

    signed = res.estimate / res.se if res.se > 0 else 0.0
    cum_z = abs(signed)
    # On both scales the analysis-scale null is zero, so the sign of the
    # cumulative z is the direction: below the null on a log ratio, or below
    # zero on a difference.
    benefit = cum_z >= boundary and signed < 0
    harm = cum_z >= boundary and signed > 0

    # Futility: enough information accrued that the effect being sought would
    # have shown by now.
    futility = frac >= 0.95 and cum_z < z_a

    if benefit or harm:
        conclusion = (f"the cumulative evidence crosses the monitoring boundary "
                      f"at {frac * 100:.0f}% of the required information size — "
                      f"the effect is established and further trials of the same "
                      f"question would add little")
    elif futility:
        conclusion = (f"the required information size has been reached without "
                      f"crossing the boundary — an effect as large as a "
                      f"{relative_risk_reduction * 100:.0f}% relative reduction "
                      f"can be ruled out")
    else:
        conclusion = (f"only {frac * 100:.0f}% of the required information size "
                      f"({accrued:,} of {ris:,} participants) has accrued, and the "
                      f"cumulative z ({cum_z:.2f}) has not crossed the "
                      f"monitoring boundary ({boundary:.2f}). This is "
                      f"insufficient evidence, not evidence of no effect — a "
                      f"distinction a conventional p-value here would erase.")

    return SequentialAnalysis(
        required_information_size=ris, accrued_information=accrued,
        information_fraction=frac, cumulative_z=signed, boundary_z=boundary,
        crosses_benefit=benefit, crosses_harm=harm, futility=futility,
        alpha=alpha, power=power, diversity=diversity,
        relative_risk_reduction=relative_risk_reduction,
        control_event_rate=pc, conclusion=conclusion)


# ------------------------------------------------------------ absolute effect

@dataclass
class AbsoluteEffect:
    """A relative effect made concrete against a baseline risk.

    GRADE Summary of Findings tables are built on this and not on the ratio,
    because a 30% relative reduction is either a major clinical finding or an
    irrelevance depending entirely on whether the baseline risk is 40% or 0.4%,
    and the ratio alone cannot tell a reader which.
    """
    baseline_per_1000: float
    intervention_per_1000: float
    difference_per_1000: float
    ci_low_per_1000: float
    ci_high_per_1000: float
    nnt: float | None
    nnh: float | None
    measure: str
    baseline_source: str

    def format(self) -> str:
        d = self.difference_per_1000
        verb = "fewer" if d < 0 else "more"
        s = (f"{self.baseline_per_1000:.0f} per 1,000 → "
             f"{self.intervention_per_1000:.0f} per 1,000 "
             f"({abs(d):.0f} {verb} per 1,000, "
             f"95% CI {abs(self.ci_low_per_1000):.0f} to "
             f"{abs(self.ci_high_per_1000):.0f})")
        if self.nnt:
            s += f"; NNT {self.nnt:.0f}"
        elif self.nnh:
            s += f"; NNH {self.nnh:.0f}"
        return s

    def as_dict(self) -> dict:
        return {"baseline_per_1000": round(self.baseline_per_1000, 1),
                "intervention_per_1000": round(self.intervention_per_1000, 1),
                "difference_per_1000": round(self.difference_per_1000, 1),
                "ci_per_1000": [round(self.ci_low_per_1000, 1),
                                round(self.ci_high_per_1000, 1)],
                "nnt": None if self.nnt is None else round(self.nnt, 1),
                "nnh": None if self.nnh is None else round(self.nnh, 1),
                "measure": self.measure, "baseline_source": self.baseline_source,
                "text": self.format()}


def absolute_effect(result: MetaResult, baseline_risk: float, *,
                    source: str = "assumed") -> AbsoluteEffect | None:
    """Convert a pooled ratio to an absolute risk difference per 1,000.

    Odds ratios are converted through the odds, not treated as risk ratios — a
    substitution that is harmless at low baseline risk and badly wrong above
    about 20%, which is exactly where the clinically important questions live.
    """
    if not result.is_ratio or not 0.0 < baseline_risk < 1.0:
        return None
    est, lo, hi = result.effect, *result.effect_ci

    def apply(ratio: float) -> float:
        if result.measure == "OR":
            odds = baseline_risk / (1.0 - baseline_risk) * ratio
            return odds / (1.0 + odds)
        # RR, HR and IRR are all applied as risk ratios here. For HR this is an
        # approximation that holds when the event is uncommon and follow-up is
        # comparable across arms.
        return min(0.999999, baseline_risk * ratio)

    p1 = apply(est)
    p_lo, p_hi = apply(lo), apply(hi)
    base = baseline_risk * 1000.0
    inter = p1 * 1000.0
    diff = inter - base
    d_lo, d_hi = p_lo * 1000.0 - base, p_hi * 1000.0 - base
    if d_lo > d_hi:
        d_lo, d_hi = d_hi, d_lo

    nnt = nnh = None
    if abs(diff) >= 0.5:
        n = 1000.0 / abs(diff)
        if diff < 0:
            nnt = n
        else:
            nnh = n

    return AbsoluteEffect(baseline_per_1000=base, intervention_per_1000=inter,
                          difference_per_1000=diff, ci_low_per_1000=d_lo,
                          ci_high_per_1000=d_hi, nnt=nnt, nnh=nnh,
                          measure=result.measure, baseline_source=source)


# --------------------------------------------------------------- small helpers

def _num(v) -> float | None:
    try:
        f = float(v)
    except (TypeError, ValueError):
        return None
    return f if math.isfinite(f) else None


def _p(p: float) -> str:
    return "< 0.001" if p < 0.001 else f"{p:.3f}"


def _interval(lo: float, hi: float) -> str:
    sep = " to " if lo < 0 or hi < 0 else "–"
    return f"{lo:.2f}{sep}{hi:.2f}"


def _ols(xs: list[float], ys: list[float]):
    """(intercept, slope, se_intercept, se_slope) or None if degenerate."""
    n = len(xs)
    if n < 3:
        return None
    mx, my = sum(xs) / n, sum(ys) / n
    sxx = sum((x - mx) ** 2 for x in xs)
    if sxx <= 0:
        return None
    sxy = sum((x - mx) * (y - my) for x, y in zip(xs, ys))
    slope = sxy / sxx
    intercept = my - slope * mx
    resid = [y - (intercept + slope * x) for x, y in zip(xs, ys)]
    df = n - 2
    if df <= 0:
        return None
    s2 = sum(r * r for r in resid) / df
    se_slope = math.sqrt(s2 / sxx)
    se_intercept = math.sqrt(s2 * (1.0 / n + mx * mx / sxx))
    return intercept, slope, se_intercept, se_slope


def _wls(X: list[list[float]], y: list[float], w: list[float]):
    """Weighted least squares. Returns (beta, covariance) or None."""
    p = len(X[0])
    xtwx = [[0.0] * p for _ in range(p)]
    xtwy = [0.0] * p
    for row, yi, wi in zip(X, y, w):
        for a in range(p):
            xtwy[a] += wi * row[a] * yi
            for b in range(p):
                xtwx[a][b] += wi * row[a] * row[b]
    inv = _invert(xtwx)
    if inv is None:
        return None
    beta = [sum(inv[a][b] * xtwy[b] for b in range(p)) for a in range(p)]
    return beta, inv


def _trace_hat(X: list[list[float]], v: list[float]) -> float:
    """tr((X'WX)^-1 X'W²X) — the correction term in the residual tau² update."""
    p = len(X[0])
    w = [1.0 / vi for vi in v]
    xtwx = [[0.0] * p for _ in range(p)]
    xtw2x = [[0.0] * p for _ in range(p)]
    for row, wi in zip(X, w):
        for a in range(p):
            for b in range(p):
                xtwx[a][b] += wi * row[a] * row[b]
                xtw2x[a][b] += wi * wi * row[a] * row[b]
    inv = _invert(xtwx)
    if inv is None:
        return 0.0
    return sum(sum(inv[a][b] * xtw2x[b][a] for b in range(p)) for a in range(p))


def _invert(M: list[list[float]]) -> list[list[float]] | None:
    """Gauss-Jordan with partial pivoting. Small matrices only, which is all
    meta-regression ever produces."""
    n = len(M)
    a = [list(row) + [1.0 if i == j else 0.0 for j in range(n)]
         for i, row in enumerate(M)]
    for col in range(n):
        pivot = max(range(col, n), key=lambda r: abs(a[r][col]))
        if abs(a[pivot][col]) < 1e-14:
            return None
        a[col], a[pivot] = a[pivot], a[col]
        pv = a[col][col]
        a[col] = [v / pv for v in a[col]]
        for r in range(n):
            if r == col:
                continue
            factor = a[r][col]
            if factor == 0.0:
                continue
            a[r] = [vr - factor * vc for vr, vc in zip(a[r], a[col])]
    return [row[n:] for row in a]
