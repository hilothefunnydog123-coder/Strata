"""Reading effect sizes out of abstracts, and pooling them properly.

Abstracts report their results in a small number of conventional forms — a ratio
measure with a confidence interval, or a difference with one. This module finds
those, converts them to a common scale, and where several papers report the same
kind of measure, pools them with a DerSimonian-Laird random-effects model.

Three deliberate limits, because the alternative is a plausible-looking number
that is wrong:

**Only what is stated.** No effect size is imputed from a p-value or a bare
percentage. If a paper does not report an interval, it contributes to the picture
but not to the pool.

**Ratios and differences never mix.** A risk ratio and a mean difference are not
commensurable, so pooling happens within a measure family and the family with the
most contributors wins.

**A pooled estimate is not a meta-analysis.** Papers found by one PubMed search
are not a systematic review: there is no protocol, no duplicate screening, no
grey literature, and the same trial may appear twice. Strata labels the result
"indicative pooling" everywhere it is shown, and :func:`pool` refuses to return
one from fewer than three studies.
"""
from __future__ import annotations

import math
import re
from dataclasses import dataclass

#: z for a 95% interval. Used both to derive a standard error from a reported
#: interval and to build one back up from a pooled estimate.
Z95 = 1.959963985

RATIO_MEASURES = {"RR", "OR", "HR", "IRR"}
DIFF_MEASURES = {"MD", "SMD"}

_MEASURE_WORDS = [
    (r"risk\s+ratios?|relative\s+risks?|\bRR\b", "RR"),
    (r"hazard\s+ratios?|\bHR\b|\baHR\b", "HR"),
    (r"odds\s+ratios?|\bORs?\b|\baOR\b", "OR"),
    (r"incidence\s+rate\s+ratios?|rate\s+ratios?|\bIRR\b", "IRR"),
    (r"standardi[sz]ed\s+mean\s+differences?|\bSMD\b", "SMD"),
    (r"mean\s+differences?|\bMDs?\b|\bWMD\b", "MD"),
]
_MEASURE_RE = re.compile("|".join(f"(?P<m{i}>{p})" for i, (p, _) in
                                  enumerate(_MEASURE_WORDS)), re.I)
_MEASURE_NAME = {f"m{i}": name for i, (_, name) in enumerate(_MEASURE_WORDS)}

_NUM = r"-?\d+(?:[.·]\d+)?"
# The estimate. Abstracts put a variable amount of prose between the measure and
# its number — "RR 0.86", "odds ratio = 0.86", "hazard ratio for mortality was
# 1.12" — so a bounded run of words is allowed, stopping at any sentence or
# bracket boundary so an interval or a later clause can never be mistaken for
# the point estimate.
_EST_RE = re.compile(rf"[^.;:()\[\]\d]{{0,40}}?[\s=:,]?({_NUM})", re.I)
# Intervals: "95% CI 0.74 to 0.99", "(95% CI, 0.74-0.99)", "95%CI: 0.74, 0.99".
_CI_RE = re.compile(
    rf"9[05]\s*%?\s*(?:confidence\s+interval|CI|CrI)\s*[,:=]?\s*"
    rf"\[?\(?\s*({_NUM})\s*(?:to|-|–|—|,|;)\s*({_NUM})\s*\)?\]?", re.I)
_P_RE = re.compile(rf"\bp\s*(<|>|=|≤|≥)\s*({_NUM})", re.I)
_I2_RE = re.compile(rf"I\s*[²2]\s*(?:=|of|was)?\s*({_NUM})\s*%", re.I)


def _f(s: str) -> float:
    return float(s.replace("·", "."))          # some journals use a middle dot


@dataclass
class EffectSize:
    """One reported effect, with whatever precision the abstract gave."""
    measure: str                 # RR | OR | HR | IRR | MD | SMD
    estimate: float
    ci_low: float | None = None
    ci_high: float | None = None
    p_value: float | None = None
    p_operator: str | None = None
    context: str = ""

    @property
    def is_ratio(self) -> bool:
        return self.measure in RATIO_MEASURES

    @property
    def null_value(self) -> float:
        return 1.0 if self.is_ratio else 0.0

    @property
    def has_interval(self) -> bool:
        return (self.ci_low is not None and self.ci_high is not None
                and self.ci_high > self.ci_low)

    @property
    def is_significant(self) -> bool | None:
        """Whether the interval excludes the null. None when unknowable."""
        if self.has_interval:
            n = self.null_value
            return not (self.ci_low <= n <= self.ci_high)
        if self.p_value is not None and self.p_operator in ("<", "=", "≤"):
            return self.p_value < 0.05
        return None

    @property
    def direction(self) -> str:
        """below / above / at the null — *not* benefit or harm.

        Whether a ratio under 1 is good news depends on whether the outcome is
        death or recovery, and nothing in the number says which. Strata gets
        direction-of-benefit from the stance network and keeps these separate on
        purpose; conflating them is how a tool ends up reporting that a drug
        prevents the disease it causes.
        """
        n = self.null_value
        if self.estimate > n:
            return "above"
        if self.estimate < n:
            return "below"
        return "at"

    def log_scale(self) -> tuple[float, float] | None:
        """(y, se) on the scale pooling happens on, or None if not poolable."""
        if not self.has_interval:
            return None
        if self.is_ratio:
            if self.estimate <= 0 or self.ci_low <= 0 or self.ci_high <= 0:
                return None
            y = math.log(self.estimate)
            se = (math.log(self.ci_high) - math.log(self.ci_low)) / (2 * Z95)
        else:
            y = self.estimate
            se = (self.ci_high - self.ci_low) / (2 * Z95)
        return (y, se) if se > 0 else None

    def format(self) -> str:
        s = f"{self.measure} {self.estimate:.2f}"
        if self.has_interval:
            s += f" (95% CI {_interval(self.ci_low, self.ci_high)})"
        if self.p_value is not None:
            s += f", p {self.p_operator} {self.p_value:g}"
        return s


def _interval(lo: float, hi: float) -> str:
    """An en dash reads as a minus sign next to a negative bound, so a
    difference interval spells the word instead."""
    sep = " to " if lo < 0 or hi < 0 else "–"
    return f"{lo:.2f}{sep}{hi:.2f}"


def extract_effects(text: str, limit: int = 6) -> list[EffectSize]:
    """Find reported effect sizes, most complete first.

    Scans for a measure word, takes the number that follows it, then looks a
    short way ahead for an interval and a p-value. The lookahead is bounded so an
    interval belonging to the *next* sentence is not attached to this estimate.
    """
    if not text:
        return []
    out: list[EffectSize] = []
    for m in _MEASURE_RE.finditer(text):
        name = next((_MEASURE_NAME[g] for g in m.groupdict()
                     if m.group(g) is not None), None)
        if name is None:
            continue
        tail = text[m.end():m.end() + 90]
        em = _EST_RE.match(tail)
        if not em:
            continue
        try:
            estimate = _f(em.group(1))
        except ValueError:
            continue
        # A ratio of 0 or a wildly out-of-range value is a parse artefact.
        if name in RATIO_MEASURES and not (0.001 < estimate < 1000):
            continue

        window = text[m.end():m.end() + 170]
        lo = hi = None
        cm = _CI_RE.search(window)
        if cm:
            try:
                lo, hi = _f(cm.group(1)), _f(cm.group(2))
                if lo > hi:
                    lo, hi = hi, lo
                if not (lo <= estimate <= hi):
                    lo = hi = None          # interval doesn't bracket the point
            except ValueError:
                lo = hi = None

        p_val = p_op = None
        pm = _P_RE.search(window)
        if pm:
            try:
                p_val, p_op = _f(pm.group(2)), pm.group(1)
                if not 0.0 <= p_val <= 1.0:
                    p_val = p_op = None
            except ValueError:
                p_val = p_op = None

        start = max(0, m.start() - 60)
        out.append(EffectSize(measure=name, estimate=estimate, ci_low=lo,
                              ci_high=hi, p_value=p_val, p_operator=p_op,
                              context=" ".join(text[start:m.end() + 90].split())))

    # Prefer the most informative reports, and drop duplicates of the same number.
    seen = set()
    unique = []
    for e in sorted(out, key=lambda e: (not e.has_interval, e.p_value is None)):
        key = (e.measure, round(e.estimate, 3), e.ci_low, e.ci_high)
        if key in seen:
            continue
        seen.add(key)
        unique.append(e)
    return unique[:limit]


def extract_i2(text: str) -> float | None:
    """A reported I² percentage, if the abstract states one."""
    m = _I2_RE.search(text or "")
    if not m:
        return None
    try:
        v = _f(m.group(1))
    except ValueError:
        return None
    return v if 0.0 <= v <= 100.0 else None


def primary_effect(effects: list[EffectSize]) -> EffectSize | None:
    """The one effect worth showing next to a paper: fullest, then earliest."""
    if not effects:
        return None
    return sorted(effects, key=lambda e: (not e.has_interval, e.p_value is None))[0]


# ------------------------------------------------------------ meta-analysis

@dataclass
class Pooled:
    measure: str
    estimate: float
    ci_low: float
    ci_high: float
    n_studies: int
    i_squared: float             # 0-100
    tau_squared: float
    q: float
    q_p_value: float
    p_value: float
    scale: str                   # "ratio" or "difference"

    @property
    def null_value(self) -> float:
        return 1.0 if self.scale == "ratio" else 0.0

    @property
    def excludes_null(self) -> bool:
        return not (self.ci_low <= self.null_value <= self.ci_high)

    @property
    def heterogeneity(self) -> str:
        """Cochrane's rough bands for interpreting I²."""
        if self.i_squared < 30:
            return "low"
        if self.i_squared < 50:
            return "moderate"
        if self.i_squared < 75:
            return "substantial"
        return "considerable"

    def format(self) -> str:
        return (f"{self.measure} {self.estimate:.2f} "
                f"(95% CI {_interval(self.ci_low, self.ci_high)}) "
                f"from {self.n_studies} studies, I² = {self.i_squared:.0f}%")


def pool(effects: list[EffectSize], min_studies: int = 3) -> Pooled | None:
    """DerSimonian-Laird random-effects pooling within one measure family.

    Random effects rather than fixed: papers retrieved by a keyword search differ
    in population, dose and follow-up, so assuming they share one true effect is
    indefensible. The between-study variance tau-squared is estimated by the
    method-of-moments estimator, and I-squared reports what share of the observed
    variation exceeds what sampling error alone would produce.

    Returns None rather than guessing when there are too few contributors, or
    when no measure family has enough of them.
    """
    usable = [e for e in effects if e.log_scale() is not None]
    if len(usable) < min_studies:
        return None

    ratios = [e for e in usable if e.is_ratio]
    diffs = [e for e in usable if not e.is_ratio]
    group = ratios if len(ratios) >= len(diffs) else diffs
    if len(group) < min_studies:
        return None

    # Within the family, use the single most common measure so the pooled label
    # is honest: "RR 0.82", not a blend of RR and OR presented as one of them.
    counts: dict[str, int] = {}
    for e in group:
        counts[e.measure] = counts.get(e.measure, 0) + 1
    measure = max(counts, key=lambda k: counts[k])
    group = [e for e in group if e.measure == measure]
    if len(group) < min_studies:
        return None

    pairs = [e.log_scale() for e in group]
    ys = [y for y, _ in pairs]
    vs = [se * se for _, se in pairs]
    ws = [1.0 / v for v in vs]

    sw = sum(ws)
    fixed = sum(w * y for w, y in zip(ws, ys)) / sw
    q = sum(w * (y - fixed) ** 2 for w, y in zip(ws, ys))
    k = len(ys)
    c = sw - sum(w * w for w in ws) / sw
    tau2 = max(0.0, (q - (k - 1)) / c) if c > 0 else 0.0

    ws2 = [1.0 / (v + tau2) for v in vs]
    sw2 = sum(ws2)
    est = sum(w * y for w, y in zip(ws2, ys)) / sw2
    se = math.sqrt(1.0 / sw2)
    lo, hi = est - Z95 * se, est + Z95 * se

    i2 = max(0.0, (q - (k - 1)) / q * 100.0) if q > 0 else 0.0
    z = est / se if se > 0 else 0.0
    p = 2.0 * (1.0 - normal_cdf(abs(z)))

    is_ratio = measure in RATIO_MEASURES
    if is_ratio:
        est, lo, hi = math.exp(est), math.exp(lo), math.exp(hi)

    return Pooled(measure=measure, estimate=est, ci_low=lo, ci_high=hi,
                  n_studies=k, i_squared=min(100.0, i2), tau_squared=tau2,
                  q=q, q_p_value=chi2_sf(q, max(1, k - 1)), p_value=p,
                  scale="ratio" if is_ratio else "difference")


# ------------------------------------------------------- distribution helpers

def normal_cdf(x: float) -> float:
    return 0.5 * (1.0 + math.erf(x / math.sqrt(2.0)))


def chi2_sf(x: float, df: int) -> float:
    """Upper tail of the chi-square distribution — the p-value for Cochran's Q."""
    if x <= 0 or df <= 0:
        return 1.0
    return _gammainc_upper(df / 2.0, x / 2.0)


def _gammainc_upper(a: float, x: float) -> float:
    """Regularised upper incomplete gamma Q(a, x).

    Series expansion below the transition point, Lentz's continued fraction
    above it — the standard split, because each form loses precision in the
    other's region.
    """
    if x < 0.0 or a <= 0.0:
        return 1.0
    if x == 0.0:
        return 1.0
    if x < a + 1.0:
        return 1.0 - _gser(a, x)
    return _gcf(a, x)


def _gser(a: float, x: float, itmax: int = 300, eps: float = 3e-14) -> float:
    ap = a
    total = 1.0 / a
    delta = total
    for _ in range(itmax):
        ap += 1.0
        delta *= x / ap
        total += delta
        if abs(delta) < abs(total) * eps:
            break
    return total * math.exp(-x + a * math.log(x) - math.lgamma(a))


def _gcf(a: float, x: float, itmax: int = 300, eps: float = 3e-14) -> float:
    tiny = 1e-300
    b = x + 1.0 - a
    c = 1.0 / tiny
    d = 1.0 / b
    h = d
    for i in range(1, itmax + 1):
        an = -i * (i - a)
        b += 2.0
        d = an * d + b
        if abs(d) < tiny:
            d = tiny
        c = b + an / c
        if abs(c) < tiny:
            c = tiny
        d = 1.0 / d
        delta = d * c
        h *= delta
        if abs(delta - 1.0) < eps:
            break
    return h * math.exp(-x + a * math.log(x) - math.lgamma(a))
