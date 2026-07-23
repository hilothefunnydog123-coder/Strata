"""Small-study effects and publication bias.

A meta-analysis of the literature is a meta-analysis of *what got published*.
Trials that found nothing are slower to be written up, likelier to be rejected,
and more often left in a drawer, so the pooled estimate of a body of small
studies is biased away from the null by a mechanism that has nothing to do with
biology. This module measures how much the retrieved set looks like that.

Four instruments, each with a different failure mode:

**Egger's regression** asks whether small studies report systematically larger
effects. Sensitive, and prone to false positives when the effect measure is a
log odds ratio whose standard error is arithmetically tied to the estimate.

**Begg and Mazumdar's rank correlation** asks the same question without assuming
linearity. Robust, and badly underpowered — it rarely detects real asymmetry
below twenty studies.

**Trim-and-fill** imputes the studies that asymmetry implies are missing and
re-pools. It gives a number you can act on: how far the estimate moves once the
funnel is forced symmetric. It also assumes the only cause of asymmetry is
suppression, which is often wrong.

**The funnel plot** itself, as coordinates and pseudo-confidence contours, so a
reader can look at it. In practice the plot changes more minds than the tests.

The single most important thing in this module is the refusal in
:func:`assess_bias` to run any of it on fewer than ten studies. Cochrane's
handbook is explicit: below ten studies these tests cannot distinguish real
asymmetry from chance, and a non-significant Egger test on six studies is
routinely misreported as evidence that publication bias is absent. Strata
returns ``usable=False`` and says why, rather than printing a p-value that will
be quoted out of context.
"""
from __future__ import annotations

import math
from dataclasses import dataclass, field

from .core import MetaResult, Study, meta_analyze
from .dist import kendall_tau, normal_ppf, t_cdf

#: Cochrane's threshold. Below this the tests are noise generators.
MIN_STUDIES_FOR_TESTS = 10


@dataclass
class RegressionTest:
    name: str
    intercept: float
    se: float
    statistic: float
    df: int
    p_value: float
    direction: str                    # "small studies favour the intervention" | ...
    interpretation: str

    def as_dict(self) -> dict:
        return {"name": self.name, "intercept": round(self.intercept, 4),
                "se": round(self.se, 4), "statistic": round(self.statistic, 3),
                "df": self.df, "p_value": round(self.p_value, 5),
                "direction": self.direction,
                "interpretation": self.interpretation}


@dataclass
class RankTest:
    name: str
    tau: float
    p_value: float
    interpretation: str

    def as_dict(self) -> dict:
        return {"name": self.name, "kendall_tau": round(self.tau, 4),
                "p_value": round(self.p_value, 5),
                "interpretation": self.interpretation}


@dataclass
class TrimAndFill:
    side: str                         # "left" | "right" | "none"
    n_missing: int
    estimator: str                    # "R0" | "L0"
    original: float                   # reporting scale
    adjusted: float
    adjusted_ci: tuple[float, float]
    shift_percent: float
    changes_conclusion: bool
    imputed: list[dict] = field(default_factory=list)

    def as_dict(self) -> dict:
        return {"side": self.side, "n_missing": self.n_missing,
                "estimator": self.estimator,
                "original": round(self.original, 4),
                "adjusted": round(self.adjusted, 4),
                "adjusted_ci": [round(v, 4) for v in self.adjusted_ci],
                "shift_percent": round(self.shift_percent, 1),
                "changes_conclusion": self.changes_conclusion,
                "imputed": self.imputed}


@dataclass
class BiasAssessment:
    usable: bool
    k: int
    reason: str
    egger: RegressionTest | None = None
    peters: RegressionTest | None = None
    begg: RankTest | None = None
    trim_fill: TrimAndFill | None = None
    fail_safe_n: int | None = None
    funnel: dict = field(default_factory=dict)
    verdict: str = ""
    grade_domain: str = "undetected"   # GRADE's publication-bias domain
    grade_delta: int = 0

    def as_dict(self) -> dict:
        return {"usable": self.usable, "k": self.k, "reason": self.reason,
                "egger": self.egger.as_dict() if self.egger else None,
                "peters": self.peters.as_dict() if self.peters else None,
                "begg": self.begg.as_dict() if self.begg else None,
                "trim_and_fill": self.trim_fill.as_dict() if self.trim_fill else None,
                "fail_safe_n": self.fail_safe_n,
                "funnel": self.funnel,
                "verdict": self.verdict,
                "grade_publication_bias": self.grade_domain,
                "grade_delta": self.grade_delta}


# --------------------------------------------------------------------- Egger

def egger_test(studies: list[Study]) -> RegressionTest | None:
    """Regress the standard normal deviate on precision; test the intercept.

    Under no small-study effect the line passes through the origin: a study's
    signal-to-noise ratio should be proportional to its precision and nothing
    else. A non-zero intercept means the small studies are saying something
    different from the large ones.
    """
    k = len(studies)
    if k < 3:
        return None
    xs = [1.0 / s.se for s in studies]                 # precision
    ys = [s.y / s.se for s in studies]                 # standard normal deviate
    fit = _ols(xs, ys)
    if fit is None:
        return None
    intercept, _slope, se_int, _se_slope, df = fit
    t = intercept / se_int if se_int > 0 else 0.0
    p = 2.0 * (1.0 - t_cdf(abs(t), df)) if df > 0 else 1.0

    if abs(t) < 1e-9:
        direction = "none"
    else:
        direction = ("small studies report larger effects than large ones"
                     if intercept > 0 else
                     "small studies report smaller effects than large ones")
    return RegressionTest(
        name="Egger's regression test for funnel asymmetry",
        intercept=intercept, se=se_int, statistic=t, df=df, p_value=p,
        direction=direction,
        interpretation=_asym_text(p, direction))


def peters_test(studies: list[Study]) -> RegressionTest | None:
    """Peters' regression — the same question, with sample size as the predictor.

    Egger's test uses the standard error, which for a log odds ratio is a
    function of the estimate itself; that structural correlation manufactures
    asymmetry where none exists. Peters substitutes 1/n, which does not have
    that problem. It needs sample sizes, so it is skipped when the abstracts did
    not report them.
    """
    usable = [s for s in studies if s.n and s.n > 0]
    if len(usable) < 3:
        return None
    xs = [1.0 / s.n for s in usable]
    ys = [s.y for s in usable]
    ws = [1.0 / s.variance for s in usable]
    fit = _wls(xs, ys, ws)
    if fit is None:
        return None
    intercept, _slope, se_int, _se_slope, df = fit
    t = intercept / se_int if se_int > 0 else 0.0
    p = 2.0 * (1.0 - t_cdf(abs(t), df)) if df > 0 else 1.0
    return RegressionTest(
        name="Peters' regression test (sample-size based)",
        intercept=intercept, se=se_int, statistic=t, df=df, p_value=p,
        direction=("small studies report larger effects than large ones"
                   if intercept > 0 else
                   "small studies report smaller effects than large ones"),
        interpretation=_asym_text(p, "asymmetry"))


def _asym_text(p: float, direction: str) -> str:
    if p < 0.05:
        return (f"Statistically significant funnel asymmetry (p = {p:.3f}): "
                f"{direction}. Publication bias is one explanation; genuine "
                f"differences between small and large trials — different "
                f"populations, better-controlled delivery, shorter follow-up — "
                f"are others, and the test cannot separate them.")
    return (f"No statistically significant asymmetry (p = {p:.3f}). This is weak "
            f"reassurance rather than evidence of no bias: the test has low "
            f"power and a null result here is routinely over-read.")


def _ols(xs: list[float], ys: list[float]):
    n = len(xs)
    if n < 3:
        return None
    mx, my = sum(xs) / n, sum(ys) / n
    sxx = sum((x - mx) ** 2 for x in xs)
    if sxx <= 0:
        return None
    slope = sum((x - mx) * (y - my) for x, y in zip(xs, ys)) / sxx
    intercept = my - slope * mx
    resid = [y - (intercept + slope * x) for x, y in zip(xs, ys)]
    df = n - 2
    if df <= 0:
        return None
    s2 = sum(r * r for r in resid) / df
    se_slope = math.sqrt(s2 / sxx)
    se_int = math.sqrt(s2 * (1.0 / n + mx * mx / sxx))
    return intercept, slope, se_int, se_slope, df


def _wls(xs: list[float], ys: list[float], ws: list[float]):
    n = len(xs)
    if n < 3:
        return None
    sw = sum(ws)
    mx = sum(w * x for w, x in zip(ws, xs)) / sw
    my = sum(w * y for w, y in zip(ws, ys)) / sw
    sxx = sum(w * (x - mx) ** 2 for w, x in zip(ws, xs))
    if sxx <= 0:
        return None
    slope = sum(w * (x - mx) * (y - my) for w, x, y in zip(ws, xs, ys)) / sxx
    intercept = my - slope * mx
    resid = [y - (intercept + slope * x) for x, y in zip(xs, ys)]
    df = n - 2
    if df <= 0:
        return None
    s2 = sum(w * r * r for w, r in zip(ws, resid)) / df
    se_slope = math.sqrt(s2 / sxx)
    se_int = math.sqrt(s2 * (1.0 / sw + mx * mx / sxx))
    return intercept, slope, se_int, se_slope, df


# ----------------------------------------------------------------------- Begg

def begg_test(studies: list[Study]) -> RankTest | None:
    """Rank correlation between standardised effect and its variance."""
    k = len(studies)
    if k < 5:
        return None
    vs = [s.variance for s in studies]
    ws = [1.0 / v for v in vs]
    sw = sum(ws)
    fixed = sum(w * s.y for w, s in zip(ws, studies)) / sw

    starred, variances = [], []
    for s, v in zip(studies, vs):
        v_star = v - 1.0 / sw
        if v_star <= 0:
            continue
        starred.append((s.y - fixed) / math.sqrt(v_star))
        variances.append(v)
    if len(starred) < 5:
        return None

    tau, p = kendall_tau(starred, variances)
    if p < 0.05:
        text = (f"Rank correlation between effect size and its variance is "
                f"significant (tau = {tau:.2f}, p = {p:.3f}) — the smaller "
                f"studies rank differently from the larger ones.")
    else:
        text = (f"No significant rank correlation (tau = {tau:.2f}, "
                f"p = {p:.3f}). Begg's test is the least powerful of the "
                f"asymmetry tests; treat a null result as uninformative.")
    return RankTest(name="Begg and Mazumdar rank correlation test",
                    tau=tau, p_value=p, interpretation=text)


# -------------------------------------------------------------- trim and fill

def trim_and_fill(studies: list[Study], *, estimator: str = "R0",
                  method: str = "PM", itmax: int = 100) -> TrimAndFill | None:
    """Duval and Tweedie's non-parametric trim-and-fill.

    Iteratively estimates how many studies are missing from the sparse side of
    the funnel, mirrors them about the trimmed pooled estimate, and re-pools
    with the imputed set included. The headline number is how far the estimate
    moves — which is the question a reader actually has, and which no p-value
    from an asymmetry test answers.
    """
    k = len(studies)
    if k < 4:
        return None
    base = meta_analyze(studies, method=method, ci_method="wald")
    if base is None:
        return None

    # Which tail is sparse? Compare the pooled estimate to the unweighted
    # median: suppression of null results pulls the weighted mean away from it.
    ordered = sorted(studies, key=lambda s: s.y)
    median = ordered[k // 2].y
    side = "left" if base.y > median else "right"
    sign = -1.0 if side == "left" else 1.0

    n_missing = 0
    for _ in range(itmax):
        keep = sorted(studies, key=lambda s: sign * s.y)
        trimmed = keep[:k - n_missing] if n_missing else keep
        centre = meta_analyze(trimmed, method=method, ci_method="wald")
        if centre is None:
            break
        new_missing = _rank_estimate(studies, centre.y, sign, estimator)
        if new_missing == n_missing:
            break
        n_missing = new_missing
        if n_missing >= k:
            n_missing = k - 1
            break

    if n_missing <= 0:
        est = base.estimate
        return TrimAndFill(side="none", n_missing=0, estimator=estimator,
                           original=est, adjusted=est, adjusted_ci=base.ci,
                           shift_percent=0.0, changes_conclusion=False)

    keep = sorted(studies, key=lambda s: sign * s.y)
    centre = meta_analyze(keep[:k - n_missing], method=method, ci_method="wald")
    pivot = centre.y if centre else base.y

    extreme = sorted(studies, key=lambda s: -sign * s.y)[:n_missing]
    imputed = [Study(label=f"imputed ({s.label})", y=2 * pivot - s.y, se=s.se,
                     measure=s.measure, scale=s.scale) for s in extreme]

    filled = meta_analyze(list(studies) + imputed, method=method, ci_method="wald")
    if filled is None:
        return None

    original, adjusted = base.estimate, filled.estimate
    if base.scale == "ratio":
        shift = 100.0 * (adjusted - original) / original if original else 0.0
    else:
        span = abs(base.ci[1] - base.ci[0]) or 1.0
        shift = 100.0 * (adjusted - original) / span
    changed = base.excludes_null != filled.excludes_null

    return TrimAndFill(
        side=side, n_missing=n_missing, estimator=estimator,
        original=original, adjusted=adjusted, adjusted_ci=filled.ci,
        shift_percent=shift, changes_conclusion=changed,
        imputed=[{"y": round(s.y, 5), "se": round(s.se, 5),
                  "mirrors": s.label} for s in imputed])


def _rank_estimate(studies: list[Study], centre: float, sign: float,
                   estimator: str) -> int:
    """R0 or L0 estimate of the number of suppressed studies."""
    devs = [(s.y - centre) for s in studies]
    ranked = sorted(range(len(devs)), key=lambda i: abs(devs[i]))
    signed = []
    for rank, i in enumerate(ranked, 1):
        d = devs[i]
        if d == 0:
            continue
        signed.append(rank if (d * -sign) > 0 else -rank)
    n = len(signed)
    if n == 0:
        return 0

    if estimator == "L0":
        # L0 = (4*Tn - n(n+1)) / (2n - 1), Tn the sum of positive ranks.
        tn = sum(r for r in signed if r > 0)
        val = (4.0 * tn - n * (n + 1)) / (2.0 * n - 1.0)
    else:
        # R0 = right-most run length of consecutive positive ranks, minus one.
        run = 0
        for r in sorted(signed, key=abs, reverse=True):
            if r > 0:
                run += 1
            else:
                break
        val = run - 1.0
    return max(0, int(round(val)))


# ------------------------------------------------------------- fail-safe N

def fail_safe_n(studies: list[Study], alpha: float = 0.05) -> int:
    """Rosenthal's file-drawer number: null studies needed to erase significance.

    Included because reviewers ask for it, and flagged in the verdict because it
    answers the wrong question — it asks how many studies with *exactly zero*
    effect would be needed, and unpublished studies are not zero, they are
    small and noisy. A large fail-safe N is much weaker reassurance than its
    size suggests.
    """
    zs = [s.y / s.se for s in studies if s.se > 0]
    k = len(zs)
    if k < 2:
        return 0
    z_sum = sum(zs)
    z_alpha = normal_ppf(1.0 - alpha / 2.0)
    combined = z_sum / math.sqrt(k)
    if abs(combined) <= z_alpha:
        return 0
    return max(0, int(round((z_sum / z_alpha) ** 2 - k)))


# ------------------------------------------------------------------- funnel

def funnel(studies: list[Study], pooled: MetaResult) -> dict:
    """Coordinates for a funnel plot, plus the pseudo-95% contour lines.

    Standard error on the vertical axis, increasing downward, which is the
    convention — precise studies at the top, small ones fanning out below.
    """
    if not studies:
        return {}
    max_se = max(s.se for s in studies) * 1.1
    contour = []
    steps = 40
    for i in range(steps + 1):
        se = max_se * i / steps
        contour.append({"se": round(se, 6),
                        "low": round(pooled.y - 1.959963985 * se, 6),
                        "high": round(pooled.y + 1.959963985 * se, 6)})
    return {
        "scale": pooled.scale,
        "centre": round(pooled.y, 6),
        "max_se": round(max_se, 6),
        "points": [{"label": s.label, "pmid": s.pmid, "y": round(s.y, 6),
                    "se": round(s.se, 6), "n": s.n} for s in studies],
        "pseudo_95_contour": contour,
    }


# ------------------------------------------------------------------- verdict

def assess_bias(studies: list[Study], pooled: MetaResult | None = None, *,
                method: str = "PM") -> BiasAssessment:
    """Run everything applicable and return one defensible judgement.

    The ``grade_delta`` it reports is what GRADE's publication-bias domain would
    take off the certainty of this body of evidence: zero when the tests are
    reassuring or inapplicable, minus one when asymmetry is significant *and*
    trim-and-fill moves the estimate materially. Two independent signals are
    required because either alone is too noisy to justify downgrading a whole
    body of evidence.
    """
    k = len(studies)
    if pooled is None:
        pooled = meta_analyze(studies, method=method, ci_method="wald")

    if k < 3 or pooled is None:
        return BiasAssessment(
            usable=False, k=k,
            reason="Fewer than three pooled studies: funnel-plot methods have "
                   "nothing to work with.",
            verdict="Publication bias could not be assessed.")

    fun = funnel(studies, pooled)

    if k < MIN_STUDIES_FOR_TESTS:
        return BiasAssessment(
            usable=False, k=k, funnel=fun,
            reason=f"{k} studies. Cochrane advises against funnel-asymmetry "
                   f"tests below {MIN_STUDIES_FOR_TESTS}: they cannot separate "
                   f"real asymmetry from chance at this size, and a "
                   f"non-significant result is regularly misread as evidence "
                   f"that no bias exists.",
            verdict=f"Publication bias could not be assessed from {k} studies. "
                    f"The funnel coordinates are provided so a reader can look "
                    f"at the shape; no test was run on them.")

    egger = egger_test(studies)
    peters = peters_test(studies)
    begg = begg_test(studies)
    tf = trim_and_fill(studies, method=method)
    fsn = fail_safe_n(studies)

    asym = bool(egger and egger.p_value < 0.05) or bool(begg and begg.p_value < 0.05)
    material = bool(tf and (tf.changes_conclusion or abs(tf.shift_percent) >= 10))

    if asym and material:
        delta, domain = -1, "strongly suspected"
        verdict = (f"Funnel asymmetry is statistically significant and "
                   f"trim-and-fill moves the pooled estimate by "
                   f"{abs(tf.shift_percent):.0f}%"
                   + (" — enough to change whether the interval excludes no "
                      "effect." if tf.changes_conclusion else ".")
                   + " Both signals point the same way, so the certainty of this "
                     "body of evidence is downgraded for publication bias.")
    elif asym or material:
        delta, domain = 0, "suspected"
        verdict = ("One of the two signals fired — either the asymmetry test or "
                   "the trim-and-fill adjustment, not both. That is enough to "
                   "note publication bias as a possibility and not enough to "
                   "downgrade the evidence on.")
    else:
        delta, domain = 0, "undetected"
        verdict = ("No asymmetry detected. Note the wording: undetected is not "
                   "absent. These tests miss real suppression routinely, and "
                   "the only reliable check is comparing the published set "
                   "against a trial registry — which Strata does separately, "
                   "in `strata.sources.ctgov`.")

    return BiasAssessment(usable=True, k=k, reason="", egger=egger, peters=peters,
                          begg=begg, trim_fill=tf, fail_safe_n=fsn, funnel=fun,
                          verdict=verdict, grade_domain=domain, grade_delta=delta)
