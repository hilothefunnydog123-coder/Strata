"""Random-effects meta-analysis, done the way a methodologist would want it.

:func:`strata.stats.pool` is the fast path: DerSimonian-Laird, a Wald interval,
one number to orient a reader. It is what the terminal report shows and it is
fine for that. This module is what you use when the number is going into a
dossier.

The differences are not cosmetic:

**Four estimators for tau-squared.** DerSimonian-Laird is the default everywhere
because it is closed-form and old, not because it is good. It is known to
underestimate between-study variance when heterogeneity is real, and that
underestimate propagates straight into a confidence interval that is too narrow.
Paule-Mandel and REML are the estimators the current methodological literature
recommends; both are available here and both are iterative.

**Hartung-Knapp-Sidik-Jonkman intervals.** The standard Wald interval treats the
pooled estimate as if tau-squared were known rather than estimated from a
handful of studies. With fewer than about ten studies its coverage is badly
below nominal — a "95%" interval that contains the truth 88% of the time.
HKSJ substitutes a *t* interval with a variance estimated from the observed
dispersion, and is the default here for that reason.

**A prediction interval.** The confidence interval describes the *mean* effect
across studies. It answers "where is the average?" A clinician asking whether
this drug will work in their patient is asking a different question — "what
happens in the next setting?" — and that is the prediction interval, which under
real heterogeneity is often several times wider and frequently crosses the null
when the confidence interval does not. Reporting one without the other is how a
meta-analysis oversells itself.

**Q-profile bounds on tau-squared and I-squared.** A point estimate of
heterogeneity from six studies is nearly uninformative. The interval usually
runs from "none" to "enormous", and saying so is more honest than printing
``I² = 34%`` as though it were measured.

Everything here operates on :class:`Study` records — an effect and its standard
error on the analysis scale, log-transformed for ratio measures. Use
:func:`from_effects` to get there from the effect sizes Strata reads out of
abstracts.
"""
from __future__ import annotations

import math
from dataclasses import dataclass, field

from ..stats import RATIO_MEASURES, EffectSize, chi2_sf
from .dist import chi2_ppf, normal_cdf, normal_ppf, t_cdf, t_ppf

#: Estimators for the between-study variance, in the order a report lists them.
TAU2_METHODS = ("DL", "PM", "REML", "SJ")

_TAU2_LABEL = {
    "DL": "DerSimonian-Laird",
    "PM": "Paule-Mandel",
    "REML": "restricted maximum likelihood",
    "SJ": "Sidik-Jonkman",
}


@dataclass
class Study:
    """One contribution to a pooled estimate, on the analysis scale.

    ``y`` is the log of a ratio measure or the raw value of a difference
    measure; ``se`` is its standard error on that same scale. Keeping the
    transform at the boundary means every estimator below is scale-agnostic.
    """
    label: str
    y: float
    se: float
    measure: str = ""
    scale: str = "difference"          # "ratio" | "difference"
    n: int | None = None
    year: int | None = None
    pmid: str = ""
    subgroup: str = ""
    covariates: dict = field(default_factory=dict)

    @property
    def variance(self) -> float:
        return self.se * self.se

    def display(self) -> tuple[float, float, float]:
        """(estimate, ci_low, ci_high) back on the reporting scale."""
        lo, hi = self.y - 1.959963985 * self.se, self.y + 1.959963985 * self.se
        if self.scale == "ratio":
            return math.exp(self.y), math.exp(lo), math.exp(hi)
        return self.y, lo, hi

    def as_dict(self) -> dict:
        est, lo, hi = self.display()
        return {"label": self.label, "pmid": self.pmid, "measure": self.measure,
                "scale": self.scale, "estimate": round(est, 4),
                "ci_low": round(lo, 4), "ci_high": round(hi, 4),
                "y": round(self.y, 6), "se": round(self.se, 6),
                "n": self.n, "year": self.year,
                "subgroup": self.subgroup or None}


@dataclass
class Heterogeneity:
    tau2: float
    tau2_method: str
    tau2_ci: tuple[float, float] | None
    i2: float
    i2_ci: tuple[float, float] | None
    h2: float
    q: float
    q_df: int
    q_p: float

    @property
    def band(self) -> str:
        """Cochrane's rough bands. Rough is the operative word: the interval
        around I-squared usually spans two of them."""
        if self.i2 < 30:
            return "low"
        if self.i2 < 50:
            return "moderate"
        if self.i2 < 75:
            return "substantial"
        return "considerable"

    def as_dict(self) -> dict:
        return {"tau_squared": round(self.tau2, 6),
                "tau_squared_method": self.tau2_method,
                "tau_squared_label": _TAU2_LABEL.get(self.tau2_method, self.tau2_method),
                "tau_squared_ci": [round(v, 6) for v in self.tau2_ci]
                                  if self.tau2_ci else None,
                "i_squared": round(self.i2, 1),
                "i_squared_ci": [round(v, 1) for v in self.i2_ci] if self.i2_ci else None,
                "h_squared": round(self.h2, 3),
                "q": round(self.q, 4), "q_df": self.q_df,
                "q_p_value": round(self.q_p, 5),
                "band": self.band}


@dataclass
class MetaResult:
    """A pooled estimate with everything needed to judge whether to believe it."""
    measure: str
    scale: str
    k: int
    model: str                        # "random" | "fixed"
    ci_method: str                    # "hksj" | "wald"
    y: float                          # pooled, analysis scale
    se: float
    ci_low: float
    ci_high: float
    pi_low: float | None
    pi_high: float | None
    p_value: float
    statistic: float
    df: int | None
    heterogeneity: Heterogeneity
    weights: list[float]              # percent, aligned with ``studies``
    studies: list[Study] = field(default_factory=list)
    notes: list[str] = field(default_factory=list)

    # ------------------------------------------------------- reporting scale
    def _back(self, v: float | None) -> float | None:
        if v is None:
            return None
        return math.exp(v) if self.scale == "ratio" else v

    @property
    def estimate(self) -> float:
        return self._back(self.y)

    @property
    def ci(self) -> tuple[float, float]:
        return self._back(self.ci_low), self._back(self.ci_high)

    @property
    def prediction_interval(self) -> tuple[float, float] | None:
        if self.pi_low is None:
            return None
        return self._back(self.pi_low), self._back(self.pi_high)

    @property
    def null_value(self) -> float:
        return 1.0 if self.scale == "ratio" else 0.0

    @property
    def excludes_null(self) -> bool:
        lo, hi = self.ci
        return not (lo <= self.null_value <= hi)

    @property
    def prediction_excludes_null(self) -> bool:
        pi = self.prediction_interval
        if pi is None:
            return False
        return not (pi[0] <= self.null_value <= pi[1])

    def format(self) -> str:
        lo, hi = self.ci
        s = (f"{self.measure} {self.estimate:.2f} "
             f"({'95% CI' if self.ci_method == 'wald' else '95% HKSJ CI'} "
             f"{_interval(lo, hi)}) from {self.k} studies, "
             f"I² = {self.heterogeneity.i2:.0f}%")
        pi = self.prediction_interval
        if pi is not None:
            s += f"; 95% prediction interval {_interval(pi[0], pi[1])}"
        return s

    def as_dict(self) -> dict:
        lo, hi = self.ci
        pi = self.prediction_interval
        return {
            "measure": self.measure, "scale": self.scale, "k": self.k,
            "model": self.model, "ci_method": self.ci_method,
            "estimate": round(self.estimate, 4),
            "ci_low": round(lo, 4), "ci_high": round(hi, 4),
            "prediction_interval": ([round(pi[0], 4), round(pi[1], 4)]
                                    if pi else None),
            "prediction_excludes_null": self.prediction_excludes_null,
            "excludes_null": self.excludes_null,
            "p_value": round(self.p_value, 6),
            "statistic": round(self.statistic, 4), "df": self.df,
            "se": round(self.se, 6),
            "heterogeneity": self.heterogeneity.as_dict(),
            "weights": [round(w, 2) for w in self.weights],
            "studies": [s.as_dict() for s in self.studies],
            "notes": self.notes,
            "text": self.format(),
        }


def _interval(lo: float, hi: float) -> str:
    sep = " to " if lo < 0 or hi < 0 else "–"
    return f"{lo:.2f}{sep}{hi:.2f}"


# ------------------------------------------------------- tau-squared estimators

def _q_statistic(ys: list[float], vs: list[float]) -> tuple[float, float]:
    ws = [1.0 / v for v in vs]
    sw = sum(ws)
    mean = sum(w * y for w, y in zip(ws, ys)) / sw
    return sum(w * (y - mean) ** 2 for w, y in zip(ws, ys)), sw


def tau2_dl(ys: list[float], vs: list[float]) -> float:
    """DerSimonian-Laird: closed form, and the field's default by inertia."""
    k = len(ys)
    if k < 2:
        return 0.0
    q, sw = _q_statistic(ys, vs)
    ws = [1.0 / v for v in vs]
    c = sw - sum(w * w for w in ws) / sw
    return max(0.0, (q - (k - 1)) / c) if c > 0 else 0.0


def _generalised_q(ys: list[float], vs: list[float], tau2: float) -> float:
    ws = [1.0 / (v + tau2) for v in vs]
    sw = sum(ws)
    mean = sum(w * y for w, y in zip(ws, ys)) / sw
    return sum(w * (y - mean) ** 2 for w, y in zip(ws, ys))


def tau2_pm(ys: list[float], vs: list[float]) -> float:
    """Paule-Mandel: the tau-squared at which the generalised Q equals its
    expectation. Monotone in tau-squared, so bisection is exact and safe."""
    k = len(ys)
    if k < 2:
        return 0.0
    target = float(k - 1)
    if _generalised_q(ys, vs, 0.0) <= target:
        return 0.0
    lo, hi = 0.0, max(vs) * 10.0 + 1.0
    while _generalised_q(ys, vs, hi) > target and hi < 1e9:
        hi *= 4.0
    for _ in range(200):
        mid = (lo + hi) / 2.0
        if _generalised_q(ys, vs, mid) > target:
            lo = mid
        else:
            hi = mid
        if hi - lo < 1e-14:
            break
    return (lo + hi) / 2.0


def tau2_reml(ys: list[float], vs: list[float], itmax: int = 200) -> float:
    """REML by the standard fixed-point iteration, seeded from DerSimonian-Laird."""
    k = len(ys)
    if k < 2:
        return 0.0
    tau2 = tau2_dl(ys, vs)
    for _ in range(itmax):
        ws = [1.0 / (v + tau2) for v in vs]
        sw = sum(ws)
        mean = sum(w * y for w, y in zip(ws, ys)) / sw
        num = sum(w * w * ((y - mean) ** 2 - v)
                  for w, y, v in zip(ws, ys, vs))
        den = sum(w * w for w in ws)
        if den <= 0:
            break
        nxt = max(0.0, num / den + 1.0 / sw)
        if abs(nxt - tau2) < 1e-12:
            tau2 = nxt
            break
        tau2 = nxt
    return tau2


def tau2_sj(ys: list[float], vs: list[float]) -> float:
    """Sidik-Jonkman: a two-step estimator that is never zero.

    Its refusal to collapse to zero is the point. With four studies DL returns
    exactly zero often enough that the "random-effects" model silently becomes a
    fixed-effect one, and nothing in the output says so.
    """
    k = len(ys)
    if k < 2:
        return 0.0
    mean0 = sum(ys) / k
    tau0 = max(sum((y - mean0) ** 2 for y in ys) / k, 1e-8)
    rs = [v / tau0 for v in vs]
    ws = [1.0 / (r + 1.0) for r in rs]
    sw = sum(ws)
    mean = sum(w * y for w, y in zip(ws, ys)) / sw
    return sum(w * (y - mean) ** 2 for w, y in zip(ws, ys)) / (k - 1)


_TAU2_FN = {"DL": tau2_dl, "PM": tau2_pm, "REML": tau2_reml, "SJ": tau2_sj}


def tau2_ci_qprofile(ys: list[float], vs: list[float],
                     alpha: float = 0.05) -> tuple[float, float] | None:
    """Q-profile (Viechtbauer) bounds on tau-squared.

    The generalised Q statistic is strictly decreasing in tau-squared, so each
    bound is a single bisection against a chi-square quantile. Returns ``None``
    when there are too few studies for the interval to mean anything.
    """
    k = len(ys)
    if k < 3:
        return None
    df = k - 1
    hi_target = chi2_ppf(1.0 - alpha / 2.0, df)     # small tau2 side
    lo_target = chi2_ppf(alpha / 2.0, df)

    def solve(target: float) -> float:
        if _generalised_q(ys, vs, 0.0) <= target:
            return 0.0
        lo, hi = 0.0, max(vs) * 10.0 + 1.0
        while _generalised_q(ys, vs, hi) > target and hi < 1e9:
            hi *= 4.0
        for _ in range(200):
            mid = (lo + hi) / 2.0
            if _generalised_q(ys, vs, mid) > target:
                lo = mid
            else:
                hi = mid
        return (lo + hi) / 2.0

    return solve(hi_target), solve(lo_target)


def _typical_variance(vs: list[float]) -> float:
    """Higgins and Thompson's s-squared — the "typical" within-study variance.

    This is what makes I-squared computable for any tau-squared estimator rather
    than only for the DerSimonian-Laird one it was originally written against.
    """
    k = len(vs)
    ws = [1.0 / v for v in vs]
    sw = sum(ws)
    sw2 = sum(w * w for w in ws)
    denom = sw * sw - sw2
    return (k - 1) * sw / denom if denom > 0 else 0.0


# ------------------------------------------------------------------ the model

def meta_analyze(studies: list[Study], *, method: str = "PM",
                 ci_method: str = "hksj", model: str = "random",
                 level: float = 0.95,
                 prediction_interval: bool = True) -> MetaResult | None:
    """Pool ``studies`` and report the result honestly.

    ``method`` selects the tau-squared estimator (see :data:`TAU2_METHODS`),
    ``ci_method`` is ``"hksj"`` or ``"wald"``. Returns ``None`` for fewer than
    two studies — one study is not a meta-analysis, and dressing it up as one by
    printing a pooled estimate with k=1 is a category error.
    """
    studies = [s for s in studies if s.se > 0 and math.isfinite(s.y)]
    k = len(studies)
    if k < 2:
        return None

    method = method.upper()
    if method not in _TAU2_FN:
        raise ValueError(f"unknown tau-squared estimator {method!r}; "
                         f"expected one of {', '.join(TAU2_METHODS)}")

    ys = [s.y for s in studies]
    vs = [s.variance for s in studies]
    notes: list[str] = []

    q, _ = _q_statistic(ys, vs)
    q_df = k - 1
    q_p = chi2_sf(q, q_df)

    tau2 = 0.0 if model == "fixed" else _TAU2_FN[method](ys, vs)
    if model == "fixed":
        method = "—"
        notes.append("Fixed-effect model: assumes every study estimates one "
                     "common true effect.")

    ws = [1.0 / (v + tau2) for v in vs]
    sw = sum(ws)
    y = sum(w * yi for w, yi in zip(ws, ys)) / sw
    se_wald = math.sqrt(1.0 / sw)

    # --- interval -----------------------------------------------------------
    df = None
    if ci_method == "hksj" and k >= 3 and model == "random":
        se_hk = math.sqrt(sum(w * (yi - y) ** 2 for w, yi in zip(ws, ys))
                          / ((k - 1) * sw))
        # Röver's ad-hoc correction: HKSJ can produce an interval *narrower*
        # than the Wald one when the studies happen to agree closely, which is
        # the one direction an anti-conservative correction must never go.
        if se_hk < se_wald:
            se_hk = se_wald
            notes.append("HKSJ variance fell below the Wald variance and was "
                         "held at it (Röver's ad-hoc correction).")
        se = se_hk
        df = k - 1
        crit = t_ppf(1.0 - (1.0 - level) / 2.0, df)
        statistic = y / se if se > 0 else 0.0
        p_value = 2.0 * (1.0 - t_cdf(abs(statistic), df))
        used = "hksj"
    else:
        if ci_method == "hksj":
            notes.append("Too few studies for a Hartung-Knapp interval; "
                         "reported as a Wald interval.")
        se = se_wald
        crit = normal_ppf(1.0 - (1.0 - level) / 2.0)
        statistic = y / se if se > 0 else 0.0
        p_value = 2.0 * (1.0 - normal_cdf(abs(statistic)))
        used = "wald"

    ci_low, ci_high = y - crit * se, y + crit * se

    # --- prediction interval ------------------------------------------------
    pi_low = pi_high = None
    if prediction_interval and k >= 3 and model == "random":
        t_pi = t_ppf(1.0 - (1.0 - level) / 2.0, k - 2)
        spread = math.sqrt(tau2 + se_wald * se_wald)
        pi_low, pi_high = y - t_pi * spread, y + t_pi * spread
    elif prediction_interval and model == "random":
        notes.append("A prediction interval needs at least three studies.")

    # --- heterogeneity ------------------------------------------------------
    s2 = _typical_variance(vs)
    i2 = 100.0 * tau2 / (tau2 + s2) if (tau2 + s2) > 0 else 0.0
    h2 = (tau2 + s2) / s2 if s2 > 0 else 1.0
    tau2_ci = tau2_ci_qprofile(ys, vs) if model == "random" else None
    i2_ci = None
    if tau2_ci is not None and s2 > 0:
        i2_ci = (100.0 * tau2_ci[0] / (tau2_ci[0] + s2),
                 100.0 * tau2_ci[1] / (tau2_ci[1] + s2))

    if k < 5 and model == "random":
        notes.append(f"Only {k} studies: tau-squared is estimated with very "
                     f"little information and the heterogeneity interval below "
                     f"shows how little.")

    het = Heterogeneity(tau2=tau2, tau2_method=method, tau2_ci=tau2_ci,
                        i2=min(100.0, max(0.0, i2)), i2_ci=i2_ci, h2=h2,
                        q=q, q_df=q_df, q_p=q_p)

    weights = [100.0 * w / sw for w in ws]
    scale = studies[0].scale
    measure = studies[0].measure or ("ratio" if scale == "ratio" else "difference")

    return MetaResult(measure=measure, scale=scale, k=k, model=model,
                      ci_method=used, y=y, se=se, ci_low=ci_low, ci_high=ci_high,
                      pi_low=pi_low, pi_high=pi_high, p_value=p_value,
                      statistic=statistic, df=df, heterogeneity=het,
                      weights=weights, studies=studies, notes=notes)


# ------------------------------------------------------------------ adapters

def from_effects(effects: list[EffectSize], *, labels: list[str] | None = None,
                 pmids: list[str] | None = None,
                 subgroups: list[str] | None = None) -> list[Study]:
    """Turn extracted effect sizes into :class:`Study` records, one measure family.

    Follows the same rule as :func:`strata.stats.pool`: ratios and differences
    are not commensurable, the larger family wins, and within it the single most
    common measure wins so the label on the pooled number is true.
    """
    usable = []
    for i, e in enumerate(effects):
        pair = e.log_scale()
        if pair is None:
            continue
        usable.append((i, e, pair))
    if not usable:
        return []

    ratios = [t for t in usable if t[1].is_ratio]
    diffs = [t for t in usable if not t[1].is_ratio]
    group = ratios if len(ratios) >= len(diffs) else diffs
    if not group:
        return []

    counts: dict[str, int] = {}
    for _, e, _p in group:
        counts[e.measure] = counts.get(e.measure, 0) + 1
    measure = max(counts, key=lambda m: counts[m])
    group = [t for t in group if t[1].measure == measure]

    out = []
    for i, e, (y, se) in group:
        out.append(Study(
            label=(labels[i] if labels and i < len(labels) else f"study {i + 1}"),
            y=y, se=se, measure=e.measure,
            scale="ratio" if e.measure in RATIO_MEASURES else "difference",
            pmid=(pmids[i] if pmids and i < len(pmids) else ""),
            subgroup=(subgroups[i] if subgroups and i < len(subgroups) else "")))
    return out


def from_evidence(evidence: list) -> list[Study]:
    """Build the analysis set from graded :class:`strata.query.Evidence`.

    Retracted papers are excluded here rather than downweighted. A withdrawn
    result must not move a pooled estimate at all; it stays in the source list
    and on the forest plot, marked, where a reader can see it.
    """
    effects, labels, pmids, subs = [], [], [], []
    for e in evidence:
        g = getattr(e, "grade", None)
        if g is None or g.effect is None or g.retracted:
            continue
        art = e.article
        effects.append(g.effect)
        first = art.authors[0].split()[0] if art.authors else "Anon"
        labels.append(f"{first} {art.year or 'n.d.'}")
        pmids.append(art.pmid)
        subs.append(g.label)
    return from_effects(effects, labels=labels, pmids=pmids, subgroups=subs)
