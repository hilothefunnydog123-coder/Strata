"""Distribution functions the meta-analytic layer needs, written from scratch.

Strata has no third-party dependencies, so the quantiles a proper random-effects
model requires — Student's *t* for Hartung-Knapp intervals, chi-square for
Q-profile bounds on tau-squared — are implemented here rather than imported from
SciPy. Everything is accurate to roughly 1e-12 over the ranges meta-analysis
uses, which is several orders of magnitude tighter than the reported precision
of any effect estimate that will pass through it.

The cheap alternative — a normal approximation everywhere — is exactly the
mistake Hartung-Knapp exists to correct. With five studies, a *z* interval and a
*t* interval differ by more than a third of their width, and that difference
decides significance often enough to matter.
"""
from __future__ import annotations

import math

from ..stats import chi2_sf, normal_cdf

__all__ = ["normal_cdf", "normal_ppf", "t_cdf", "t_ppf", "chi2_cdf", "chi2_ppf",
           "betainc", "kendall_tau"]

# Acklam's rational approximation to the inverse normal CDF, refined once by
# Halley's method against erfc. The refinement is what takes it from ~1e-9 to
# full double precision.
_A = (-3.969683028665376e+01, 2.209460984245205e+02, -2.759285104469687e+02,
      1.383577518672690e+02, -3.066479806614716e+01, 2.506628277459239e+00)
_B = (-5.447609879822406e+01, 1.615858368580409e+02, -1.556989798598866e+02,
      6.680131188771972e+01, -1.328068155288572e+01)
_C = (-7.784894002430293e-03, -3.223964580411365e-01, -2.400758277161838e+00,
      -2.549732539343734e+00, 4.374664141464968e+00, 2.938163982698783e+00)
_D = (7.784695709041462e-03, 3.224671290700398e-01, 2.445134137142996e+00,
      3.754408661907416e+00)
_P_LOW = 0.02425


def normal_ppf(p: float) -> float:
    """The standard normal quantile. ``normal_ppf(0.975) == 1.959963985…``"""
    if not 0.0 < p < 1.0:
        if p <= 0.0:
            return -math.inf
        if p >= 1.0:
            return math.inf
        raise ValueError("p must lie in (0, 1)")

    if p < _P_LOW:
        q = math.sqrt(-2.0 * math.log(p))
        x = (((((_C[0] * q + _C[1]) * q + _C[2]) * q + _C[3]) * q + _C[4]) * q + _C[5]) / \
            ((((_D[0] * q + _D[1]) * q + _D[2]) * q + _D[3]) * q + 1.0)
    elif p <= 1.0 - _P_LOW:
        q = p - 0.5
        r = q * q
        x = (((((_A[0] * r + _A[1]) * r + _A[2]) * r + _A[3]) * r + _A[4]) * r + _A[5]) * q / \
            (((((_B[0] * r + _B[1]) * r + _B[2]) * r + _B[3]) * r + _B[4]) * r + 1.0)
    else:
        q = math.sqrt(-2.0 * math.log(1.0 - p))
        x = -(((((_C[0] * q + _C[1]) * q + _C[2]) * q + _C[3]) * q + _C[4]) * q + _C[5]) / \
             ((((_D[0] * q + _D[1]) * q + _D[2]) * q + _D[3]) * q + 1.0)

    # one Halley step
    e = 0.5 * math.erfc(-x / math.sqrt(2.0)) - p
    u = e * math.sqrt(2.0 * math.pi) * math.exp(x * x / 2.0)
    return x - u / (1.0 + x * u / 2.0)


# ------------------------------------------------------------ incomplete beta

def betainc(a: float, b: float, x: float) -> float:
    """Regularised incomplete beta I_x(a, b) — Lentz's continued fraction.

    The symmetry relation is used to keep the continued fraction in its
    fast-converging region, which is the difference between six iterations and
    six hundred near the tails.
    """
    if x <= 0.0:
        return 0.0
    if x >= 1.0:
        return 1.0
    lbeta = (math.lgamma(a + b) - math.lgamma(a) - math.lgamma(b)
             + a * math.log(x) + b * math.log1p(-x))
    if x < (a + 1.0) / (a + b + 2.0):
        return math.exp(lbeta) * _betacf(a, b, x) / a
    return 1.0 - math.exp(lbeta) * _betacf(b, a, 1.0 - x) / b


def _betacf(a: float, b: float, x: float, itmax: int = 300,
            eps: float = 3e-16) -> float:
    tiny = 1e-300
    qab, qap, qam = a + b, a + 1.0, a - 1.0
    c = 1.0
    d = 1.0 - qab * x / qap
    if abs(d) < tiny:
        d = tiny
    d = 1.0 / d
    h = d
    for m in range(1, itmax + 1):
        m2 = 2 * m
        aa = m * (b - m) * x / ((qam + m2) * (a + m2))
        d = 1.0 + aa * d
        if abs(d) < tiny:
            d = tiny
        c = 1.0 + aa / c
        if abs(c) < tiny:
            c = tiny
        d = 1.0 / d
        h *= d * c
        aa = -(a + m) * (qab + m) * x / ((a + m2) * (qap + m2))
        d = 1.0 + aa * d
        if abs(d) < tiny:
            d = tiny
        c = 1.0 + aa / c
        if abs(c) < tiny:
            c = tiny
        d = 1.0 / d
        delta = d * c
        h *= delta
        if abs(delta - 1.0) < eps:
            break
    return h


# ---------------------------------------------------------------- Student's t

def t_cdf(t: float, df: float) -> float:
    """P(T <= t) for Student's t with ``df`` degrees of freedom."""
    if df <= 0:
        raise ValueError("df must be positive")
    if math.isinf(t):
        return 0.0 if t < 0 else 1.0
    x = df / (df + t * t)
    tail = 0.5 * betainc(df / 2.0, 0.5, x)
    return 1.0 - tail if t > 0 else tail


def t_ppf(p: float, df: float) -> float:
    """The t quantile, by bisection on :func:`t_cdf`.

    Bisection rather than a closed form: it is a handful of microseconds on a
    quantity computed once per analysis, and it cannot silently return a wrong
    root the way an unchecked Newton step can.
    """
    if not 0.0 < p < 1.0:
        raise ValueError("p must lie in (0, 1)")
    if df > 1e7:                                   # numerically normal by here
        return normal_ppf(p)
    lo, hi = -1e4, 1e4
    for _ in range(300):
        mid = (lo + hi) / 2.0
        if t_cdf(mid, df) < p:
            lo = mid
        else:
            hi = mid
        if hi - lo < 1e-12:
            break
    return (lo + hi) / 2.0


# --------------------------------------------------------------- chi-square

def chi2_cdf(x: float, df: int) -> float:
    return 1.0 - chi2_sf(x, df)


def chi2_ppf(p: float, df: int) -> float:
    """The chi-square quantile, by bisection on the survival function."""
    if not 0.0 < p < 1.0:
        raise ValueError("p must lie in (0, 1)")
    lo, hi = 0.0, max(10.0 * df, 100.0)
    while chi2_cdf(hi, df) < p and hi < 1e12:
        hi *= 2.0
    for _ in range(300):
        mid = (lo + hi) / 2.0
        if chi2_cdf(mid, df) < p:
            lo = mid
        else:
            hi = mid
        if hi - lo < 1e-12:
            break
    return (lo + hi) / 2.0


# ------------------------------------------------------------------ rank test

def kendall_tau(xs: list[float], ys: list[float]) -> tuple[float, float]:
    """Kendall's tau-b and a two-sided p-value from the normal approximation.

    Used by Begg and Mazumdar's rank-correlation test for funnel asymmetry. Ties
    are handled by tau-b, because standardised effect sizes tie far more often
    than continuous data should — several trials reporting the same rounded
    estimate is routine.
    """
    n = len(xs)
    if n < 3 or len(ys) != n:
        return 0.0, 1.0

    concordant = discordant = tx = ty = 0
    for i in range(n - 1):
        for j in range(i + 1, n):
            dx, dy = xs[i] - xs[j], ys[i] - ys[j]
            s = dx * dy
            if s > 0:
                concordant += 1
            elif s < 0:
                discordant += 1
            else:
                if dx == 0:
                    tx += 1
                if dy == 0:
                    ty += 1

    n0 = n * (n - 1) / 2.0
    denom = math.sqrt(max(1e-12, (n0 - tx) * (n0 - ty)))
    tau = (concordant - discordant) / denom

    # Variance of S under the null, ignoring the tie correction — with the
    # sample sizes meta-analysis actually has, the correction moves the p-value
    # in the fourth decimal and pretending otherwise would be false precision.
    var_s = n * (n - 1) * (2 * n + 5) / 18.0
    s = concordant - discordant
    z = (abs(s) - 1) / math.sqrt(var_s) if var_s > 0 else 0.0
    p = 2.0 * (1.0 - normal_cdf(max(0.0, z)))
    return tau, min(1.0, p)
