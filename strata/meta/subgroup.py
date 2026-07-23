"""Subgroup analysis and meta-regression — where heterogeneity comes from.

A high I-squared says the studies disagree. It does not say why. Subgroup
analysis and meta-regression are the two ways to ask, and both are so easy to
abuse that the safeguards matter more than the arithmetic:

**The between-group test is the only test that counts.** The standard mistake is
to run the analysis separately in each subgroup, find that the effect is
significant in one and not the other, and report that as a difference. It is
not: "significant here, not significant there" is compatible with identical
effects and different sample sizes. The question is whether the subgroup
*estimates* differ, which is Cochran's Q for between-group heterogeneity, and it
is the only number this module puts in the headline.

**Credibility, not just significance.** Even a significant between-group test is
weak evidence when the subgroups were chosen after seeing the data, when there
are few studies per group, or when the comparison is across studies rather than
within them. Every result here carries an explicit credibility judgement drawn
from the ICEMAN criteria, and a subgroup effect found in an exploratory analysis
is labelled exploratory wherever it is shown.

**Meta-regression needs studies.** Ten studies per covariate is the conventional
minimum and it is generous. Below it, the module fits nothing and says why,
because a regression on six studies will find a moderator every time you ask it
to.
"""
from __future__ import annotations

import math
from dataclasses import dataclass, field

from ..stats import chi2_sf
from .core import MetaResult, Study, meta_analyze
from .dist import t_cdf, t_ppf

#: Conventional minimum number of studies per covariate in a meta-regression.
STUDIES_PER_COVARIATE = 10

#: Below this many studies in a group, its own estimate is not worth reporting.
MIN_GROUP_SIZE = 2


@dataclass
class SubgroupResult:
    name: str
    k: int
    result: MetaResult | None

    def as_dict(self) -> dict:
        return {"name": self.name, "k": self.k,
                "result": self.result.as_dict() if self.result else None}


@dataclass
class SubgroupAnalysis:
    covariate: str
    groups: list[SubgroupResult]
    q_between: float
    df: int
    p_value: float
    i2_between: float
    prespecified: bool
    credibility: str                  # "high" | "moderate" | "low" | "very low"
    verdict: str
    caveats: list[str] = field(default_factory=list)

    @property
    def significant(self) -> bool:
        return self.p_value < 0.05

    def as_dict(self) -> dict:
        return {"covariate": self.covariate,
                "groups": [g.as_dict() for g in self.groups],
                "q_between": round(self.q_between, 4), "df": self.df,
                "p_value": round(self.p_value, 5),
                "i_squared_between": round(self.i2_between, 1),
                "significant": self.significant,
                "prespecified": self.prespecified,
                "credibility": self.credibility,
                "verdict": self.verdict, "caveats": self.caveats}


def subgroup_analysis(studies: list[Study], *, covariate: str = "subgroup",
                      key=None, method: str = "PM",
                      prespecified: bool = False) -> SubgroupAnalysis | None:
    """Split, pool within each group, and test whether the groups differ.

    ``key`` is a callable taking a :class:`Study` and returning the group label;
    it defaults to the study's ``subgroup`` field. Groups with fewer than
    :data:`MIN_GROUP_SIZE` studies are reported with a count and no estimate.
    """
    key = key or (lambda s: s.subgroup or "unspecified")
    buckets: dict[str, list[Study]] = {}
    for s in studies:
        buckets.setdefault(key(s) or "unspecified", []).append(s)

    named = {g: v for g, v in buckets.items() if g != "unspecified"}
    if len(named) < 2:
        return None

    groups: list[SubgroupResult] = []
    q_within_total = 0.0
    poolable = 0
    for name in sorted(named, key=lambda g: -len(named[g])):
        members = named[name]
        res = (meta_analyze(members, method=method, ci_method="wald")
               if len(members) >= MIN_GROUP_SIZE else None)
        if res is not None:
            q_within_total += res.heterogeneity.q
            poolable += 1
        groups.append(SubgroupResult(name=name, k=len(members), result=res))

    if poolable < 2:
        return None

    total = meta_analyze([s for g in named.values() for s in g],
                         method=method, ci_method="wald")
    if total is None:
        return None

    q_between = max(0.0, total.heterogeneity.q - q_within_total)
    df = poolable - 1
    p = chi2_sf(q_between, df) if df > 0 else 1.0
    i2_between = (100.0 * max(0.0, (q_between - df) / q_between)
                  if q_between > 0 else 0.0)

    caveats: list[str] = []
    small = [g.name for g in groups if g.k < 4 and g.result is not None]
    if small:
        caveats.append(f"fewer than four studies in {', '.join(small)}")
    if not prespecified:
        caveats.append("the subgroups were not declared before the analysis")
    if len(named) > 3:
        caveats.append(f"{len(named)} subgroups were tested, so a significant "
                       f"difference somewhere is likely by chance alone")

    credibility = _credibility(p, groups, prespecified, len(named))

    if p < 0.05:
        verdict = (f"The subgroups differ (Q = {q_between:.2f}, df = {df}, "
                   f"p = {p:.3f}); {i2_between:.0f}% of the variation between "
                   f"them exceeds chance. Credibility of this subgroup effect: "
                   f"{credibility}.")
        if not prespecified:
            verdict += (" Because the split was not pre-specified, treat this as "
                        "hypothesis-generating, not as a finding.")
    else:
        verdict = (f"No evidence that the subgroups differ (Q = {q_between:.2f}, "
                   f"df = {df}, p = {p:.3f}). Note that this test is "
                   f"underpowered: it not differing is not the same as it "
                   f"being the same.")

    return SubgroupAnalysis(covariate=covariate, groups=groups,
                            q_between=q_between, df=df, p_value=p,
                            i2_between=i2_between, prespecified=prespecified,
                            credibility=credibility, verdict=verdict,
                            caveats=caveats)


def _credibility(p: float, groups: list[SubgroupResult], prespecified: bool,
                 n_tested: int) -> str:
    """An ICEMAN-flavoured judgement of how much to trust a subgroup effect."""
    score = 0
    if prespecified:
        score += 2
    if p < 0.01:
        score += 2
    elif p < 0.05:
        score += 1
    if all(g.k >= 4 for g in groups if g.result is not None):
        score += 1
    if n_tested <= 2:
        score += 1
    return {5: "high", 6: "high", 7: "high", 4: "moderate", 3: "moderate"} \
        .get(score, "low" if score >= 2 else "very low")


# ------------------------------------------------------------ meta-regression

@dataclass
class Coefficient:
    name: str
    estimate: float
    se: float
    statistic: float
    p_value: float
    ci_low: float
    ci_high: float

    def as_dict(self) -> dict:
        return {"name": self.name, "estimate": round(self.estimate, 5),
                "se": round(self.se, 5), "statistic": round(self.statistic, 3),
                "p_value": round(self.p_value, 5),
                "ci_low": round(self.ci_low, 5), "ci_high": round(self.ci_high, 5)}


@dataclass
class MetaRegression:
    fitted: bool
    reason: str
    covariates: list[str] = field(default_factory=list)
    coefficients: list[Coefficient] = field(default_factory=list)
    tau2_residual: float = 0.0
    tau2_total: float = 0.0
    r_squared: float = 0.0
    q_residual: float = 0.0
    q_residual_p: float = 1.0
    k: int = 0
    verdict: str = ""

    def as_dict(self) -> dict:
        return {"fitted": self.fitted, "reason": self.reason, "k": self.k,
                "covariates": self.covariates,
                "coefficients": [c.as_dict() for c in self.coefficients],
                "tau_squared_residual": round(self.tau2_residual, 6),
                "tau_squared_total": round(self.tau2_total, 6),
                "r_squared": round(self.r_squared, 3),
                "q_residual": round(self.q_residual, 4),
                "q_residual_p": round(self.q_residual_p, 5),
                "verdict": self.verdict}


def meta_regression(studies: list[Study], covariates: list[str], *,
                    method: str = "PM", knapp_hartung: bool = True
                    ) -> MetaRegression:
    """Weighted least squares with a residual between-study variance.

    Covariate values come from each study's ``covariates`` dict. The model is
    the standard mixed-effects meta-regression: weights ``1 / (v_i + tau2_res)``
    with tau-squared-residual estimated by the method of moments, and — by
    default — Knapp-Hartung standard errors, which are to a meta-regression
    coefficient what HKSJ is to a pooled estimate.
    """
    k = len(studies)
    needed = STUDIES_PER_COVARIATE * len(covariates)
    if k < max(4, needed):
        return MetaRegression(
            fitted=False, k=k, covariates=covariates,
            reason=f"{k} studies for {len(covariates)} covariate"
                   f"{'s' if len(covariates) != 1 else ''}. The convention is "
                   f"at least {STUDIES_PER_COVARIATE} studies per covariate "
                   f"({needed} here); below that a meta-regression will find a "
                   f"moderator whether or not one exists.",
            verdict="Not fitted — too few studies.")

    rows, ys, vs = [], [], []
    for s in studies:
        try:
            values = [float(s.covariates[c]) for c in covariates]
        except (KeyError, TypeError, ValueError):
            continue
        rows.append([1.0] + values)
        ys.append(s.y)
        vs.append(s.variance)

    if len(rows) < max(4, needed):
        return MetaRegression(
            fitted=False, k=len(rows), covariates=covariates,
            reason=f"only {len(rows)} of {k} studies carry a numeric value for "
                   f"every covariate.",
            verdict="Not fitted — incomplete covariate data.")

    total = meta_analyze(studies, method=method, ci_method="wald")
    tau2_total = total.heterogeneity.tau2 if total else 0.0

    # Method-of-moments residual tau-squared, iterated to a fixed point.
    tau2 = tau2_total
    beta = None
    for _ in range(100):
        ws = [1.0 / (v + tau2) for v in vs]
        solved = _wls_solve(rows, ys, ws)
        if solved is None:
            return MetaRegression(fitted=False, k=len(rows), covariates=covariates,
                                  reason="the design matrix is singular — a "
                                         "covariate is constant or duplicated.",
                                  verdict="Not fitted — singular design.")
        beta, xtwx_inv = solved
        resid = [y - sum(b * x for b, x in zip(beta, row))
                 for y, row in zip(ys, rows)]
        q_res = sum(w * r * r for w, r in zip(ws, resid))
        df_res = len(rows) - len(rows[0])
        if df_res <= 0:
            break
        trace = _moment_trace(rows, ws, xtwx_inv, vs)
        nxt = max(0.0, (q_res - df_res) / trace) if trace > 0 else 0.0
        if abs(nxt - tau2) < 1e-12:
            tau2 = nxt
            break
        tau2 = nxt

    ws = [1.0 / (v + tau2) for v in vs]
    solved = _wls_solve(rows, ys, ws)
    beta, xtwx_inv = solved
    resid = [y - sum(b * x for b, x in zip(beta, row))
             for y, row in zip(ys, rows)]
    q_res = sum(w * r * r for w, r in zip(ws, resid))
    df_res = len(rows) - len(rows[0])

    scale = 1.0
    if knapp_hartung and df_res > 0:
        scale = q_res / df_res

    names = ["intercept"] + list(covariates)
    coefs = []
    crit = t_ppf(0.975, df_res) if df_res > 0 else 1.959963985
    for j, name in enumerate(names):
        var = xtwx_inv[j][j] * scale
        se = math.sqrt(var) if var > 0 else 0.0
        stat = beta[j] / se if se > 0 else 0.0
        p = (2.0 * (1.0 - t_cdf(abs(stat), df_res)) if df_res > 0 else 1.0)
        coefs.append(Coefficient(name=name, estimate=beta[j], se=se,
                                 statistic=stat, p_value=p,
                                 ci_low=beta[j] - crit * se,
                                 ci_high=beta[j] + crit * se))

    r2 = (100.0 * max(0.0, (tau2_total - tau2) / tau2_total)
          if tau2_total > 0 else 0.0)
    q_res_p = chi2_sf(q_res, df_res) if df_res > 0 else 1.0

    explained = [c for c in coefs[1:] if c.p_value < 0.05]
    if explained:
        verdict = (f"{', '.join(c.name for c in explained)} predicts the effect "
                   f"size across studies; the model accounts for {r2:.0f}% of "
                   f"the between-study variance. This is an observational "
                   f"association between study-level characteristics — it is "
                   f"subject to ecological bias and does not license a claim "
                   f"about individual patients.")
    else:
        verdict = (f"No covariate reaches significance; {r2:.0f}% of the "
                   f"between-study variance is accounted for. With "
                   f"{len(rows)} studies the regression is underpowered, so "
                   f"read this as 'not shown' rather than 'not so'.")

    return MetaRegression(fitted=True, reason="", k=len(rows),
                          covariates=list(covariates), coefficients=coefs,
                          tau2_residual=tau2, tau2_total=tau2_total,
                          r_squared=r2, q_residual=q_res, q_residual_p=q_res_p,
                          verdict=verdict)


# ----------------------------------------------------------------- small linalg

def _wls_solve(rows: list[list[float]], ys: list[float], ws: list[float]):
    """Solve (X'WX)b = X'Wy, returning b and (X'WX)^-1.

    Gauss-Jordan with partial pivoting. The systems here are at most a handful
    of columns wide, so the cost is irrelevant and the explicit inverse is worth
    having for the coefficient standard errors.
    """
    p = len(rows[0])
    xtwx = [[0.0] * p for _ in range(p)]
    xtwy = [0.0] * p
    for row, y, w in zip(rows, ys, ws):
        for i in range(p):
            xtwy[i] += w * row[i] * y
            for j in range(p):
                xtwx[i][j] += w * row[i] * row[j]

    inv = _invert(xtwx)
    if inv is None:
        return None
    beta = [sum(inv[i][j] * xtwy[j] for j in range(p)) for i in range(p)]
    return beta, inv


def _invert(m: list[list[float]]) -> list[list[float]] | None:
    n = len(m)
    a = [list(row) + [1.0 if i == j else 0.0 for j in range(n)]
         for i, row in enumerate(m)]
    for col in range(n):
        pivot = max(range(col, n), key=lambda r: abs(a[r][col]))
        if abs(a[pivot][col]) < 1e-12:
            return None
        a[col], a[pivot] = a[pivot], a[col]
        scale = a[col][col]
        a[col] = [v / scale for v in a[col]]
        for r in range(n):
            if r == col:
                continue
            factor = a[r][col]
            if factor:
                a[r] = [v - factor * pv for v, pv in zip(a[r], a[col])]
    return [row[n:] for row in a]


def _moment_trace(rows, ws, xtwx_inv, vs) -> float:
    """tr(W) - tr((X'WX)^-1 X'W^2X) — the denominator of the moment estimator."""
    p = len(rows[0])
    xtw2x = [[0.0] * p for _ in range(p)]
    for row, w in zip(rows, ws):
        w2 = w * w
        for i in range(p):
            for j in range(p):
                xtw2x[i][j] += w2 * row[i] * row[j]
    trace_term = sum(sum(xtwx_inv[i][j] * xtw2x[j][i] for j in range(p))
                     for i in range(p))
    return sum(ws) - trace_term
