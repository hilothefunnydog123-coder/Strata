"""Statistical distributions, implemented from scratch.

Strata has no third-party dependencies, which means no SciPy, which means every
distribution function the meta-analysis needs lives here. These are the standard
numerical recipes — continued-fraction incomplete beta and gamma, Wichura's
AS 241 for the normal quantile — chosen because they are the ones with published
accuracy bounds rather than the ones that are shortest to write.

Accuracy matters more here than it looks. A Hartung-Knapp confidence interval is
a t quantile on k-2 degrees of freedom; with k = 4 studies the difference between
the t and the normal quantile is over 40%, and that is the difference between an
interval that excludes no effect and one that does not. A tool that reports the
wrong one has told a clinician the opposite of the truth.

Every function here is checked against published reference values in
``tests/test_distributions.py``.
"""
from __future__ import annotations

import math

__all__ = [
    "normal_cdf", "normal_sf", "normal_ppf",
    "student_t_cdf", "student_t_sf", "student_t_ppf",
    "chi2_cdf", "chi2_sf", "chi2_ppf",
    "gammainc_lower", "gammainc_upper", "betainc",
    "fisher_f_sf",
]

_SQRT2 = math.sqrt(2.0)
_EPS = 3e-14
_TINY = 1e-300


# ------------------------------------------------------------------ normal

def normal_cdf(x: float) -> float:
    """P(Z <= x) for the standard normal."""
    return 0.5 * math.erfc(-x / _SQRT2)


def normal_sf(x: float) -> float:
    """P(Z > x). Computed from erfc directly rather than as ``1 - cdf``, which
    loses every significant digit in the far right tail."""
    return 0.5 * math.erfc(x / _SQRT2)


# Wichura's AS 241 rational approximation. Accurate to about 1e-16 across the
# whole range, against roughly 1e-9 for the Beasley-Springer/Moro form that is
# more commonly copied around.
_A = (3.3871328727963666080e0, 1.3314166789178437745e2,
      1.9715909503065514427e3, 1.3731693765509461125e4,
      4.5921953931549871457e4, 6.7265770927008700853e4,
      3.3430575583588128105e4, 2.5090809287301226727e3)
_B = (1.0, 4.2313330701600911252e1, 6.8718700749205790830e2,
      5.3941960214247511077e3, 2.1213794301586595867e4,
      3.9307895800092710610e4, 2.8729085735721942674e4,
      5.2264952788528545610e3)
_C = (1.42343711074968357734e0, 4.63033784615654529590e0,
      5.76949722146069140550e0, 3.64784832476320460504e0,
      1.27045825245236838258e0, 2.41780725177450611770e-1,
      2.27238449892691845833e-2, 7.74545014278341407640e-4)
_D = (1.0, 2.05319162663775882187e0, 1.67638483018380384940e0,
      6.89767334985100004550e-1, 1.48103976427480074590e-1,
      1.51986665636164571966e-2, 5.47593808499534494600e-4,
      1.05075007164441684324e-9)
_E = (6.65790464350110377720e0, 5.46378491116411436990e0,
      1.78482653991729133580e0, 2.96560571828504891230e-1,
      2.65321895265761230930e-2, 1.24266094738807843860e-3,
      2.71155556874348757815e-5, 2.01033439929228813265e-7)
_F = (1.0, 5.99832206555887937690e-1, 1.36929880922735805310e-1,
      1.48753612908506148525e-2, 7.86869131145613259100e-4,
      1.84631831751005468180e-5, 1.42151175831644588870e-7,
      2.04426310338993978564e-15)


def _poly(coeffs, x: float) -> float:
    total = 0.0
    for c in reversed(coeffs):
        total = total * x + c
    return total


def normal_ppf(p: float) -> float:
    """The standard normal quantile: the x with P(Z <= x) = p."""
    if not 0.0 < p < 1.0:
        if p == 0.0:
            return -math.inf
        if p == 1.0:
            return math.inf
        raise ValueError(f"normal_ppf: p must be in (0, 1), got {p!r}")

    q = p - 0.5
    if abs(q) <= 0.425:
        r = 0.180625 - q * q
        return q * _poly(_A, r) / _poly(_B, r)

    r = p if q < 0 else 1.0 - p
    r = math.sqrt(-math.log(r))
    if r <= 5.0:
        r -= 1.6
        value = _poly(_C, r) / _poly(_D, r)
    else:
        r -= 5.0
        value = _poly(_E, r) / _poly(_F, r)
    return -value if q < 0 else value


# ------------------------------------------------------- incomplete gamma

def gammainc_lower(a: float, x: float) -> float:
    """Regularised lower incomplete gamma P(a, x)."""
    return 1.0 - gammainc_upper(a, x)


def gammainc_upper(a: float, x: float) -> float:
    """Regularised upper incomplete gamma Q(a, x).

    Series expansion below the transition point, Lentz's continued fraction
    above it. Each form loses precision in the other's region, so the split is
    not an optimisation — it is what makes the result correct at both ends.
    """
    if a <= 0.0:
        return 1.0
    if x <= 0.0:
        return 1.0
    if x < a + 1.0:
        return 1.0 - _gser(a, x)
    return _gcf(a, x)


def _gser(a: float, x: float, itmax: int = 500) -> float:
    ap = a
    total = delta = 1.0 / a
    for _ in range(itmax):
        ap += 1.0
        delta *= x / ap
        total += delta
        if abs(delta) < abs(total) * _EPS:
            break
    return total * math.exp(-x + a * math.log(x) - math.lgamma(a))


def _gcf(a: float, x: float, itmax: int = 500) -> float:
    b = x + 1.0 - a
    c = 1.0 / _TINY
    d = 1.0 / b
    h = d
    for i in range(1, itmax + 1):
        an = -i * (i - a)
        b += 2.0
        d = an * d + b
        if abs(d) < _TINY:
            d = _TINY
        c = b + an / c
        if abs(c) < _TINY:
            c = _TINY
        d = 1.0 / d
        delta = d * c
        h *= delta
        if abs(delta - 1.0) < _EPS:
            break
    return h * math.exp(-x + a * math.log(x) - math.lgamma(a))


# -------------------------------------------------------- incomplete beta

def betainc(a: float, b: float, x: float) -> float:
    """Regularised incomplete beta I_x(a, b).

    The continued fraction converges quickly only for x below (a+1)/(a+b+2), so
    above that point the symmetry I_x(a,b) = 1 - I_{1-x}(b,a) is used instead.
    """
    if x <= 0.0:
        return 0.0
    if x >= 1.0:
        return 1.0
    lbeta = (math.lgamma(a + b) - math.lgamma(a) - math.lgamma(b)
             + a * math.log(x) + b * math.log1p(-x))
    front = math.exp(lbeta)
    if x < (a + 1.0) / (a + b + 2.0):
        return front * _betacf(a, b, x) / a
    return 1.0 - math.exp(
        math.lgamma(a + b) - math.lgamma(a) - math.lgamma(b)
        + b * math.log1p(-x) + a * math.log(x)) * _betacf(b, a, 1.0 - x) / b


def _betacf(a: float, b: float, x: float, itmax: int = 500) -> float:
    """Lentz's algorithm for the beta continued fraction."""
    qab, qap, qam = a + b, a + 1.0, a - 1.0
    c = 1.0
    d = 1.0 - qab * x / qap
    if abs(d) < _TINY:
        d = _TINY
    d = 1.0 / d
    h = d
    for m in range(1, itmax + 1):
        m2 = 2 * m
        aa = m * (b - m) * x / ((qam + m2) * (a + m2))
        d = 1.0 + aa * d
        if abs(d) < _TINY:
            d = _TINY
        c = 1.0 + aa / c
        if abs(c) < _TINY:
            c = _TINY
        d = 1.0 / d
        h *= d * c

        aa = -(a + m) * (qab + m) * x / ((a + m2) * (qap + m2))
        d = 1.0 + aa * d
        if abs(d) < _TINY:
            d = _TINY
        c = 1.0 + aa / c
        if abs(c) < _TINY:
            c = _TINY
        d = 1.0 / d
        delta = d * c
        h *= delta
        if abs(delta - 1.0) < _EPS:
            break
    return h


# ---------------------------------------------------------------- Student t

def student_t_cdf(t: float, df: float) -> float:
    """P(T <= t) for Student's t on ``df`` degrees of freedom."""
    if df <= 0:
        raise ValueError("student_t_cdf: df must be positive")
    if t == 0.0:
        return 0.5
    x = df / (df + t * t)
    tail = 0.5 * betainc(df / 2.0, 0.5, x)
    return 1.0 - tail if t > 0 else tail


def student_t_sf(t: float, df: float) -> float:
    """P(T > t). The two-sided p-value for a t statistic is ``2 * sf(abs(t))``."""
    return student_t_cdf(-t, df)


def student_t_ppf(p: float, df: float) -> float:
    """The t quantile, by bracketed Newton with a bisection guard.

    Newton alone diverges in the far tails on small df, and bisection alone
    needs about fifty iterations for full precision. Newton steps that leave the
    bracket are rejected and replaced by a bisection step, which keeps the
    quadratic convergence where it works and guarantees termination where it
    does not.
    """
    if not 0.0 < p < 1.0:
        if p == 0.0:
            return -math.inf
        if p == 1.0:
            return math.inf
        raise ValueError(f"student_t_ppf: p must be in (0, 1), got {p!r}")
    if df <= 0:
        raise ValueError("student_t_ppf: df must be positive")
    if df > 1e7:
        return normal_ppf(p)

    # Start from the normal quantile with the Cornish-Fisher correction for t.
    z = normal_ppf(p)
    g1 = (z ** 3 + z) / 4.0
    g2 = (5 * z ** 5 + 16 * z ** 3 + 3 * z) / 96.0
    x = z + g1 / df + g2 / (df * df)

    lo, hi = -1e6, 1e6
    log_norm = (math.lgamma((df + 1.0) / 2.0) - math.lgamma(df / 2.0)
                - 0.5 * math.log(df * math.pi))
    for _ in range(80):
        fx = student_t_cdf(x, df) - p
        if fx > 0:
            hi = x
        else:
            lo = x
        if abs(fx) < 1e-15:
            break
        pdf = math.exp(log_norm - (df + 1.0) / 2.0 * math.log1p(x * x / df))
        step = fx / pdf if pdf > 1e-300 else 0.0
        nx = x - step
        if not (lo < nx < hi) or nx != nx:
            nx = 0.5 * (lo + hi)
        if abs(nx - x) < 1e-14 * max(1.0, abs(x)):
            x = nx
            break
        x = nx
    return x


# ----------------------------------------------------------------- chi-square

def chi2_cdf(x: float, df: float) -> float:
    return gammainc_lower(df / 2.0, x / 2.0)


def chi2_sf(x: float, df: float) -> float:
    """Upper tail — the p-value for Cochran's Q and for a Wald chi-square."""
    if x <= 0 or df <= 0:
        return 1.0
    return gammainc_upper(df / 2.0, x / 2.0)


def chi2_ppf(p: float, df: float) -> float:
    """The chi-square quantile, by bisection on the CDF.

    Used by the Paule-Mandel and Q-profile methods, which need the quantile at
    fixed p and modest df, where a bisection to 1e-12 costs about forty
    evaluations and is not worth replacing with an approximation that has to be
    validated separately.
    """
    if not 0.0 <= p < 1.0:
        raise ValueError(f"chi2_ppf: p must be in [0, 1), got {p!r}")
    if p == 0.0:
        return 0.0
    lo, hi = 0.0, max(10.0, df * 4.0)
    while chi2_cdf(hi, df) < p and hi < 1e12:
        hi *= 2.0
    for _ in range(200):
        mid = 0.5 * (lo + hi)
        if chi2_cdf(mid, df) < p:
            lo = mid
        else:
            hi = mid
        if hi - lo < 1e-12 * max(1.0, hi):
            break
    return 0.5 * (lo + hi)


# ------------------------------------------------------------------------ F

def fisher_f_sf(f: float, df1: float, df2: float) -> float:
    """Upper tail of the F distribution — the omnibus p-value in meta-regression."""
    if f <= 0 or df1 <= 0 or df2 <= 0:
        return 1.0
    return betainc(df2 / 2.0, df1 / 2.0, df2 / (df2 + df1 * f))
