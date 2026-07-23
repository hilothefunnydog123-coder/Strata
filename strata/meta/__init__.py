"""Research-grade meta-analysis.

:func:`strata.stats.pool` gives one number to orient a reader. This package is
what you use when that number is going into a regulatory dossier, an HTA
submission or a manuscript — where the reviewer will ask which tau-squared
estimator you used, whether the interval is Hartung-Knapp, what the prediction
interval was, whether the funnel was symmetric, which study was carrying the
result, and whether the required information size was ever reached.

    from strata.meta import full_analysis, from_evidence

    studies  = from_evidence(result.evidence)
    analysis = full_analysis(studies)

    analysis.pooled.format()          # HKSJ interval + prediction interval
    analysis.bias.verdict             # publication bias, or why it wasn't tested
    analysis.sensitivity.verdict      # what happens if the biggest study goes
    analysis.tsa.verdict              # is it conclusive, or an interim look?

Every component refuses to run when the data cannot support it, and says why
rather than returning a number that reads as an answer.
"""
from __future__ import annotations

from dataclasses import dataclass

from . import bias as bias_mod
from . import influence as influence_mod
from . import subgroup as subgroup_mod
from . import tsa as tsa_mod
from .bias import BiasAssessment, assess_bias, egger_test, funnel, trim_and_fill
from .core import (TAU2_METHODS, Heterogeneity, MetaResult, Study, from_effects,
                   from_evidence, meta_analyze)
from .influence import Sensitivity, leave_one_out
from .subgroup import MetaRegression, SubgroupAnalysis, meta_regression, subgroup_analysis
from .tsa import TrialSequential, required_information_size

__all__ = [
    "Study", "MetaResult", "Heterogeneity", "meta_analyze", "from_effects",
    "from_evidence", "TAU2_METHODS",
    "BiasAssessment", "assess_bias", "egger_test", "trim_and_fill", "funnel",
    "Sensitivity", "leave_one_out",
    "SubgroupAnalysis", "subgroup_analysis", "MetaRegression", "meta_regression",
    "TrialSequential", "required_information_size",
    "FullAnalysis", "full_analysis",
]


@dataclass
class FullAnalysis:
    """Everything the meta layer can say about one set of studies."""
    pooled: MetaResult | None
    bias: BiasAssessment | None = None
    sensitivity: Sensitivity | None = None
    subgroups: SubgroupAnalysis | None = None
    tsa: TrialSequential | None = None
    alternatives: dict | None = None

    def as_dict(self) -> dict:
        return {
            "pooled": self.pooled.as_dict() if self.pooled else None,
            "publication_bias": self.bias.as_dict() if self.bias else None,
            "sensitivity": self.sensitivity.as_dict() if self.sensitivity else None,
            "subgroups": self.subgroups.as_dict() if self.subgroups else None,
            "trial_sequential": self.tsa.as_dict() if self.tsa else None,
            "estimator_sensitivity": self.alternatives,
        }


def full_analysis(studies: list[Study], *, method: str = "PM",
                  ci_method: str = "hksj",
                  control_event_rate: float | None = None,
                  relative_risk_reduction: float = 0.20,
                  subgroup_key=None) -> FullAnalysis:
    """Pool, then run every diagnostic the data can support.

    The ``alternatives`` field re-pools under each tau-squared estimator. That
    comparison is the cheapest honesty check in meta-analysis: if the answer
    depends on which of four defensible estimators you picked, the reader needs
    to know that before they read the point estimate.
    """
    pooled = meta_analyze(studies, method=method, ci_method=ci_method)
    if pooled is None:
        return FullAnalysis(pooled=None)

    alternatives = {}
    for alt in TAU2_METHODS:
        res = meta_analyze(studies, method=alt, ci_method=ci_method)
        if res is None:
            continue
        lo, hi = res.ci
        alternatives[alt] = {
            "estimate": round(res.estimate, 4),
            "ci_low": round(lo, 4), "ci_high": round(hi, 4),
            "tau_squared": round(res.heterogeneity.tau2, 6),
            "i_squared": round(res.heterogeneity.i2, 1),
            "excludes_null": res.excludes_null,
        }
    if alternatives:
        verdicts = {v["excludes_null"] for v in alternatives.values()}
        alternatives["_agree"] = len(verdicts) == 1
        alternatives["_note"] = (
            "All four between-study variance estimators agree on whether the "
            "interval excludes no effect."
            if len(verdicts) == 1 else
            "The estimators disagree on whether the interval excludes no "
            "effect. The conclusion is an artefact of the estimator chosen and "
            "should not be reported as a finding.")

    return FullAnalysis(
        pooled=pooled,
        bias=assess_bias(studies, pooled, method=method),
        sensitivity=influence_mod.analyse(studies, pooled, method=method,
                                          ci_method=ci_method),
        subgroups=subgroup_analysis(studies, method=method, key=subgroup_key),
        tsa=tsa_mod.analyse(studies, pooled, method=method,
                            control_event_rate=control_event_rate,
                            relative_risk_reduction=relative_risk_reduction),
        alternatives=alternatives or None,
    )
