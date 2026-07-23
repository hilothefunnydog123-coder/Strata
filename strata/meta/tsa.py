"""Trial sequential analysis — is the meta-analysis finished, or just early?

A meta-analysis is a repeated significance test. Every time a new trial is added
and the pool is re-run, the null gets another chance to be rejected by accident.
Run it after each of ten trials at alpha = 0.05 and the real type I error rate
is not 5%, it is closer to 20%. This is the same multiplicity problem that
interim analyses of a single trial have, and it has the same solution:
group-sequential monitoring boundaries.

Trial sequential analysis applies that machinery to cumulative meta-analysis:

**Required information size.** How many participants a *single* trial would need
to answer this question at the target power, inflated for the heterogeneity the
meta-analysis actually observed. Until the accrued sample reaches it, the
analysis is an interim analysis, and should be read as one.

**Monitoring boundaries.** O'Brien-Fleming alpha-spending, so early looks need
extreme evidence and the nominal 5% is only available once the information is
complete. A pooled p-value of 0.03 at 20% of the required information size does
not cross the boundary and is not a result.

**Futility boundaries.** Beta-spending, symmetric in construction, which answer
the question that matters more often in practice: can we stop looking because
the effect we were hunting for has been ruled out?

The honest framing this module exists to enforce: **most published
meta-analyses are underpowered and report significance anyway.** Strata will say
"the evidence is not yet conclusive, and here is how many more participants it
would take" rather than repeating a p-value that a sequential design would have
rejected.
"""
from __future__ import annotations

import math
from dataclasses import dataclass, field

from .core import MetaResult, Study, meta_analyze
from .dist import normal_cdf, normal_ppf


@dataclass
class Boundary:
    information_fraction: float
    z_benefit: float
    z_harm: float
    z_futility_low: float | None
    z_futility_high: float | None

    def as_dict(self) -> dict:
        return {"information_fraction": round(self.information_fraction, 4),
                "z_benefit": round(self.z_benefit, 4),
                "z_harm": round(self.z_harm, 4),
                "z_futility_low": (round(self.z_futility_low, 4)
                                   if self.z_futility_low is not None else None),
                "z_futility_high": (round(self.z_futility_high, 4)
                                    if self.z_futility_high is not None else None)}


@dataclass
class TrialSequential:
    conclusive: bool
    verdict: str
    accrued: int
    required: int
    information_fraction: float
    diversity: float                  # D-squared, %
    heterogeneity_adjustment: float   # the inflation factor applied to the RIS
    z_current: float
    z_boundary: float
    crossed: str                      # "benefit" | "harm" | "futility" | "none"
    alpha: float
    power: float
    control_event_rate: float | None
    relative_risk_reduction: float | None
    participants_still_needed: int
    boundaries: list[Boundary] = field(default_factory=list)
    cumulative: list[dict] = field(default_factory=list)
    notes: list[str] = field(default_factory=list)

    def as_dict(self) -> dict:
        return {
            "conclusive": self.conclusive, "verdict": self.verdict,
            "accrued_participants": self.accrued,
            "required_information_size": self.required,
            "information_fraction": round(self.information_fraction, 4),
            "diversity": round(self.diversity, 1),
            "heterogeneity_adjustment": round(self.heterogeneity_adjustment, 3),
            "z_current": round(self.z_current, 4),
            "z_boundary": round(self.z_boundary, 4),
            "crossed": self.crossed, "alpha": self.alpha, "power": self.power,
            "control_event_rate": self.control_event_rate,
            "relative_risk_reduction": self.relative_risk_reduction,
            "participants_still_needed": self.participants_still_needed,
            "boundaries": [b.as_dict() for b in self.boundaries],
            "cumulative": self.cumulative,
            "notes": self.notes,
        }


# ------------------------------------------------------------------ boundaries

def obrien_fleming_z(fraction: float, alpha: float = 0.05) -> float:
    """The two-sided O'Brien-Fleming boundary at an information fraction.

    Derived from the Lan-DeMets alpha-spending function
    ``a(t) = 2 - 2*Phi(z_{alpha/2} / sqrt(t))``, inverted to the nominal
    significance level available at that point. At t = 1 it returns
    ``z_{alpha/2}``; at t = 0.25 it demands roughly 2.9 sigma.
    """
    t = min(1.0, max(1e-6, fraction))
    z_alpha = normal_ppf(1.0 - alpha / 2.0)
    spent = 2.0 - 2.0 * normal_cdf(z_alpha / math.sqrt(t))
    spent = min(max(spent, 1e-12), alpha)
    return normal_ppf(1.0 - spent / 2.0)


def beta_spending_z(fraction: float, alpha: float = 0.05,
                    power: float = 0.80) -> float:
    """The inner (futility) boundary from a symmetric beta-spending function.

    Returns the z below which the analysis has ruled out the effect it was
    designed to find. Undefined before about a third of the information is in,
    where it would sit above the benefit boundary; callers get ``None`` there.
    """
    t = min(1.0, max(1e-6, fraction))
    beta = 1.0 - power
    spent = 2.0 - 2.0 * normal_cdf(normal_ppf(1.0 - beta / 2.0) / math.sqrt(t))
    spent = min(max(spent, 1e-12), beta)
    z_beta = normal_ppf(1.0 - spent / 2.0)
    z_alpha = normal_ppf(1.0 - alpha / 2.0)
    theta = z_alpha + normal_ppf(power)
    return theta * math.sqrt(t) - z_beta


# ------------------------------------------------------- required information

def required_information_size(control_event_rate: float,
                              relative_risk_reduction: float, *,
                              alpha: float = 0.05, power: float = 0.80,
                              diversity: float = 0.0) -> int:
    """Participants needed to detect the target effect, inflated for diversity.

    The unadjusted form is the ordinary two-proportion sample size. The
    inflation ``1 / (1 - D²)`` is Wetterslev's diversity adjustment: with
    substantial between-trial variance the meta-analysis needs materially more
    information than a single trial would, and ignoring that is the main reason
    published meta-analyses declare victory early.
    """
    p_c = min(0.999, max(0.001, control_event_rate))
    p_e = min(0.999, max(0.0001, p_c * (1.0 - relative_risk_reduction)))
    p_bar = (p_c + p_e) / 2.0
    delta = abs(p_c - p_e)
    if delta <= 0:
        return 0

    z_a = normal_ppf(1.0 - alpha / 2.0)
    z_b = normal_ppf(power)
    n_per_arm = (2.0 * p_bar * (1.0 - p_bar) * (z_a + z_b) ** 2) / (delta ** 2)
    n = 2.0 * n_per_arm

    d2 = min(0.95, max(0.0, diversity / 100.0))
    return int(math.ceil(n / (1.0 - d2)))


def diversity(result: MetaResult) -> float:
    """D-squared: the between-trial variance as a share of total variance.

    Distinct from I-squared, and always at least as large. I-squared compares
    the random-effects model to a fixed-effect one; D-squared compares the
    information a random-effects meta-analysis actually has to the information a
    fixed-effect analysis would pretend it has. For sample size purposes
    D-squared is the right quantity, and using I-squared instead — which is
    common — understates the requirement.
    """
    tau2 = result.heterogeneity.tau2
    if tau2 <= 0:
        return 0.0
    ws_fe = [1.0 / s.variance for s in result.studies]
    ws_re = [1.0 / (s.variance + tau2) for s in result.studies]
    var_fe = 1.0 / sum(ws_fe)
    var_re = 1.0 / sum(ws_re)
    if var_re <= 0:
        return 0.0
    return 100.0 * max(0.0, (var_re - var_fe) / var_re)


# ------------------------------------------------------------------- analysis

def analyse(studies: list[Study], pooled: MetaResult | None = None, *,
            control_event_rate: float | None = None,
            relative_risk_reduction: float = 0.20,
            alpha: float = 0.05, power: float = 0.80,
            method: str = "PM") -> TrialSequential | None:
    """Run a trial sequential analysis over the cumulative evidence.

    ``control_event_rate`` is the event rate in the comparator arm and is the
    one input that cannot be read out of an abstract reliably. When it is not
    supplied, the required information size is computed on the accrued sample
    instead — a weaker analysis, clearly labelled in the notes, that still
    answers the multiplicity question the boundaries exist for.
    """
    # The monitoring boundaries are z-scale, so the cumulative statistic has to
    # be the random-effects Wald z. A Hartung-Knapp interval is a t interval and
    # comparing its statistic against an O'Brien-Fleming boundary would be
    # mixing two different corrections for the same small-sample problem.
    if pooled is None or pooled.ci_method != "wald":
        pooled = meta_analyze(studies, method=method, ci_method="wald")
    if pooled is None or len(studies) < 2:
        return None

    notes: list[str] = []
    d2 = diversity(pooled)
    accrued = sum(s.n for s in studies if s.n) or 0

    if control_event_rate is not None:
        required = required_information_size(
            control_event_rate, relative_risk_reduction,
            alpha=alpha, power=power, diversity=d2)
        adjustment = 1.0 / (1.0 - min(0.95, d2 / 100.0))
    else:
        # No event rate: fall back on the variance-based information size —
        # how much information the target effect would need, expressed in the
        # same units as the accrued precision.
        z_a = normal_ppf(1.0 - alpha / 2.0)
        z_b = normal_ppf(power)
        target = abs(math.log(1.0 - relative_risk_reduction)) \
            if pooled.scale == "ratio" else relative_risk_reduction
        needed_info = ((z_a + z_b) / target) ** 2 if target > 0 else 0.0
        have_info = 1.0 / (pooled.se ** 2) if pooled.se > 0 else 0.0
        adjustment = 1.0 / (1.0 - min(0.95, d2 / 100.0))
        needed_info *= adjustment
        required = int(math.ceil(accrued * needed_info / have_info)) \
            if have_info > 0 and accrued else 0
        notes.append(
            "No control event rate was supplied, so the required information "
            "size is derived from the accrued precision rather than from an "
            "event rate. It is indicative; a formal TSA should state the "
            "comparator risk explicitly.")

    if not accrued:
        notes.append("No study reported a sample size that could be parsed, so "
                     "the information fraction is unknown. Boundaries are shown "
                     "against study count instead, which is much weaker.")
        fraction = min(1.0, len(studies) / 10.0)
    else:
        fraction = min(1.0, accrued / required) if required else 1.0

    z_current = pooled.y / pooled.se if pooled.se > 0 else 0.0
    z_bound = obrien_fleming_z(fraction, alpha)
    z_fut = beta_spending_z(fraction, alpha, power)
    futility_valid = 0 < z_fut < z_bound

    if abs(z_current) >= z_bound:
        crossed = "benefit" if z_current * _favourable(pooled) > 0 else "harm"
        conclusive = True
        verdict = (f"The cumulative evidence crosses the O'Brien-Fleming "
                   f"monitoring boundary (Z = {abs(z_current):.2f} against a "
                   f"boundary of {z_bound:.2f} at {fraction:.0%} of the "
                   f"required information). The finding survives correction for "
                   f"repeated testing — this is a conclusive result.")
    elif futility_valid and abs(z_current) < z_fut and fraction >= 0.5:
        crossed = "futility"
        conclusive = True
        verdict = (f"The evidence crosses the futility boundary: at "
                   f"{fraction:.0%} of the required information the target "
                   f"effect of {relative_risk_reduction:.0%} has been ruled "
                   f"out. Further trials of this size would be unlikely to "
                   f"change the answer.")
    else:
        crossed = "none"
        conclusive = False
        still = max(0, required - accrued)
        verdict = (f"Not yet conclusive. The pooled estimate reaches "
                   f"Z = {abs(z_current):.2f}, short of the {z_bound:.2f} that "
                   f"{fraction:.0%} of the required information demands after "
                   f"correcting for repeated testing. ")
        if still and accrued:
            verdict += (f"Approximately {still:,} further participants would be "
                        f"needed for a conclusive answer.")
        else:
            verdict += ("The accrued information is too incomplete to say how "
                        "much more would be needed.")
        if pooled.excludes_null:
            verdict += (" Note that the conventional confidence interval does "
                        "exclude no effect — this is exactly the situation "
                        "sequential analysis exists to catch.")

    boundaries = []
    for i in range(1, 21):
        t = i / 20.0
        zf = beta_spending_z(t, alpha, power)
        zb = obrien_fleming_z(t, alpha)
        ok = 0 < zf < zb
        boundaries.append(Boundary(information_fraction=t, z_benefit=zb,
                                   z_harm=-zb,
                                   z_futility_low=(-zf if ok else None),
                                   z_futility_high=(zf if ok else None)))

    cumulative = []
    ordered = sorted(studies, key=lambda s: (s.year or 0, s.label))
    running = []
    seen_n = 0
    for s in ordered:
        running.append(s)
        seen_n += s.n or 0
        step = meta_analyze(running, method=method, ci_method="wald") \
            if len(running) >= 2 else None
        cumulative.append({
            "label": s.label, "year": s.year, "k": len(running),
            "participants": seen_n or None,
            "information_fraction": round(min(1.0, seen_n / required), 4)
                                    if required and seen_n else None,
            "z": round(step.y / step.se, 4) if step and step.se > 0 else None,
            "estimate": round(step.estimate, 4) if step else None,
        })

    return TrialSequential(
        conclusive=conclusive, verdict=verdict, accrued=accrued,
        required=required, information_fraction=fraction, diversity=d2,
        heterogeneity_adjustment=adjustment, z_current=z_current,
        z_boundary=z_bound, crossed=crossed, alpha=alpha, power=power,
        control_event_rate=control_event_rate,
        relative_risk_reduction=relative_risk_reduction,
        participants_still_needed=max(0, required - accrued) if required else 0,
        boundaries=boundaries, cumulative=cumulative, notes=notes)


def _favourable(pooled: MetaResult) -> float:
    """+1 if a value below the null is the favourable direction, else -1.

    Strata does not know whether the outcome is death or recovery — that is the
    stance layer's job, and it abstains often. For boundary labelling only, a
    ratio below one is treated as the benefit direction, which is the
    convention in the outcomes trial sequential analysis is usually applied to.
    """
    return -1.0 if pooled.scale == "ratio" else 1.0
