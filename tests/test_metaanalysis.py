"""Meta-analysis against a published benchmark and against defining properties.

Two kinds of check, deliberately.

**The benchmark.** Colditz et al.'s thirteen BCG vaccination trials are the
canonical worked example for meta-analysis software; the ``metafor`` package's
documented output for this dataset is reproduced here to four decimal places for
the random-effects model, the latitude meta-regression, and the heterogeneity
statistics. If a refactor moves any of these, it has changed the answer.

**The properties.** For everything with no convenient published reference, the
test asserts the estimator's *defining equation* instead — Paule-Mandel is the
tau-squared that makes the generalised Q equal its degrees of freedom, REML
satisfies its own fixed point, the fixed-effect estimate is the
inverse-variance-weighted mean. A property test cannot be invalidated by a
misremembered table value, which is the failure mode a benchmark has.
"""
import math
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from strata import distributions as dist
from strata.metaanalysis import (Study, absolute_effect, begg_test, cumulative,
                                 egger_test, from_effects, influence_diagnostics,
                                 leave_one_out, meta_analyze, meta_regression,
                                 subgroup_analysis, trial_sequential_analysis,
                                 trim_and_fill, fail_safe_n)
from strata.stats import EffectSize

# tpos, tneg, cpos, cneg, year, absolute latitude
BCG = [("Aronson 1948", 4, 119, 11, 128, 1948, 44),
       ("Ferguson 1949", 6, 300, 29, 274, 1949, 55),
       ("Rosenthal 1960", 3, 228, 11, 209, 1960, 42),
       ("Hart 1977", 62, 13536, 248, 12619, 1977, 52),
       ("Frimodt-Moller 1973", 33, 5036, 47, 5761, 1973, 13),
       ("Stein 1953", 180, 1361, 372, 1079, 1953, 44),
       ("Vandiviere 1973", 8, 2537, 10, 619, 1973, 19),
       ("TPT Madras 1980", 505, 87886, 499, 87892, 1980, 13),
       ("Coetzee 1968", 29, 7470, 45, 7232, 1968, 27),
       ("Rosenthal 1961", 17, 1699, 65, 1600, 1961, 42),
       ("Comstock 1974", 186, 50448, 141, 27197, 1974, 18),
       ("Comstock 1969", 5, 2493, 3, 2338, 1969, 33),
       ("Comstock 1976", 27, 16886, 29, 17825, 1976, 33)]


def bcg_studies():
    out = []
    for name, tp, tn, cp, cn, yr, lat in BCG:
        yi = math.log((tp / (tp + tn)) / (cp / (cp + cn)))
        vi = 1 / tp - 1 / (tp + tn) + 1 / cp - 1 / (cp + cn)
        out.append(Study(label=name, yi=yi, vi=vi, measure="RR", scale="ratio",
                         year=yr, n=tp + tn + cp + cn,
                         events_treatment=tp, events_control=cp,
                         n_treatment=tp + tn, n_control=cp + cn,
                         subgroup="temperate" if lat >= 33 else "tropical",
                         covariates={"latitude": lat, "year": yr}))
    return out


def close(a, b, tol, what=""):
    assert abs(a - b) <= tol, f"{what}: {a!r} != {b!r} (tol {tol})"


# ---------------------------------------------------------------- benchmark

def test_bcg_random_effects_reml():
    """metafor: rma(yi, vi, method='REML') on dat.bcg."""
    r = meta_analyze(bcg_studies(), tau2_method="REML", knha=False)
    close(r.estimate, -0.7145, 5e-4, "REML estimate")
    close(r.se, 0.1798, 5e-4, "REML se")
    close(r.ci_low, -1.0669, 5e-4, "REML ci.lb")
    close(r.ci_high, -0.3622, 5e-4, "REML ci.ub")
    close(r.heterogeneity.tau_squared, 0.3132, 5e-4, "REML tau2")
    close(r.heterogeneity.q, 152.2330, 5e-4, "Q")
    assert r.heterogeneity.df == 12
    # metafor prints I2 for a random-effects model as tau2 / (tau2 + s2).
    close(r.heterogeneity.i_squared_re, 92.22, 0.02, "REML I2 (tau-based)")
    close(r.heterogeneity.h_squared, 12.686, 0.02, "H2")


def test_bcg_random_effects_dl():
    """metafor: rma(yi, vi, method='DL') on dat.bcg."""
    r = meta_analyze(bcg_studies(), tau2_method="DL", knha=False)
    close(r.estimate, -0.7141, 5e-4, "DL estimate")
    close(r.se, 0.1787, 5e-4, "DL se")
    close(r.ci_low, -1.0644, 5e-4, "DL ci.lb")
    close(r.ci_high, -0.3638, 5e-4, "DL ci.ub")
    close(r.heterogeneity.tau_squared, 0.3088, 5e-4, "DL tau2")
    close(r.heterogeneity.i_squared, 92.12, 0.02, "DL I2 (Q-based)")
    # Under DL the two I-squared definitions coincide. That they do is the
    # check that the tau-based one is implemented correctly.
    close(r.heterogeneity.i_squared_re, r.heterogeneity.i_squared, 0.02,
          "DL: the two I2 definitions agree")


def test_bcg_meta_regression_on_latitude():
    """metafor: rma(yi, vi, mods=~ablat) — the classic BCG moderator."""
    mr = meta_regression(bcg_studies(), ["latitude"], test="z")
    close(mr.coefficients[0], 0.2515, 5e-4, "intercept")
    close(mr.std_errors[0], 0.2491, 5e-4, "intercept se")
    close(mr.coefficients[1], -0.0291, 5e-4, "latitude slope")
    close(mr.std_errors[1], 0.0072, 5e-4, "latitude se")
    close(mr.tau2, 0.0764, 5e-4, "residual tau2")
    close(mr.r_squared, 75.62, 0.1, "R^2")
    assert mr.p_values[1] < 0.001, "latitude effect should be strongly significant"
    assert any("ecological fallacy" in n for n in mr.notes), \
        "the ecological-fallacy caveat must ride along with every regression"


def test_bcg_fixed_effect():
    """The fixed-effect estimate is exactly the inverse-variance-weighted mean."""
    studies = bcg_studies()
    r = meta_analyze(studies, model="fixed")
    ws = [1 / s.vi for s in studies]
    expected = sum(w * s.yi for w, s in zip(ws, studies)) / sum(ws)
    close(r.estimate, expected, 1e-12, "fixed effect = IV mean")
    close(r.se, math.sqrt(1 / sum(ws)), 1e-12, "fixed effect se")
    assert r.heterogeneity.tau_squared == 0.0


# ------------------------------------------------------ estimator properties

def test_paule_mandel_satisfies_its_definition():
    """PM is by definition the tau-squared making generalised Q equal k - 1."""
    studies = bcg_studies()
    r = meta_analyze(studies, tau2_method="PM", knha=False)
    t2 = r.heterogeneity.tau_squared
    ws = [1 / (s.vi + t2) for s in studies]
    mu = sum(w * s.yi for w, s in zip(ws, studies)) / sum(ws)
    gen_q = sum(w * (s.yi - mu) ** 2 for w, s in zip(ws, studies))
    close(gen_q, len(studies) - 1, 1e-6, "generalised Q at tau2_PM")


def test_reml_satisfies_its_fixed_point():
    """The REML update must return tau-squared unchanged at the solution."""
    studies = bcg_studies()
    r = meta_analyze(studies, tau2_method="REML", knha=False)
    t2 = r.heterogeneity.tau_squared
    ws = [1 / (s.vi + t2) for s in studies]
    sw = sum(ws)
    mu = sum(w * s.yi for w, s in zip(ws, studies)) / sw
    num = sum(w * w * ((s.yi - mu) ** 2 - s.vi) for w, s in zip(ws, studies))
    den = sum(w * w for w in ws)
    close(num / den + 1.0 / sw, t2, 1e-8, "REML fixed point")


def test_hedges_estimator_closed_form():
    studies = bcg_studies()
    r = meta_analyze(studies, tau2_method="HE", knha=False)
    k = len(studies)
    mean = sum(s.yi for s in studies) / k
    expected = (sum((s.yi - mean) ** 2 for s in studies) / (k - 1)
                - sum(s.vi for s in studies) / k)
    close(r.heterogeneity.tau_squared, expected, 1e-12, "Hedges closed form")


def test_estimators_are_ordered_sensibly():
    """ML is known to be the most downward-biased; DL is below REML here."""
    s = bcg_studies()
    taus = {m: meta_analyze(s, tau2_method=m, knha=False).heterogeneity.tau_squared
            for m in ("ML", "DL", "REML", "PM", "SJ", "HE")}
    assert taus["ML"] < taus["DL"] < taus["REML"] < taus["PM"], \
        f"unexpected ordering: {taus}"
    assert all(v > 0 for v in taus.values())


# ------------------------------------------------------- small-sample methods

def test_hartung_knapp_widens_the_interval():
    """The whole point of HK is coverage; it must not narrow the interval."""
    s = bcg_studies()[:5]
    wald = meta_analyze(s, knha=False)
    hk = meta_analyze(s, knha=True)
    assert hk.ci_method == "knha" and wald.ci_method == "wald"
    assert (hk.ci_high - hk.ci_low) >= (wald.ci_high - wald.ci_low), \
        "the truncated HK variant must never produce a narrower interval"
    assert hk.df == len(s) - 1


def test_prediction_interval_is_wider_than_the_confidence_interval():
    r = meta_analyze(bcg_studies(), knha=False)
    pi = r.prediction_interval
    assert pi is not None
    lo, hi = r.effect_ci
    assert pi[0] < lo and pi[1] > hi, "a prediction interval must contain the CI"
    # On BCG the mean effect is clearly protective but a new trial is not
    # guaranteed to be — the single most useful thing the PI says.
    assert r.excludes_null is True
    assert r.prediction_excludes_null is False


def test_tau2_confidence_interval_brackets_the_estimate():
    r = meta_analyze(bcg_studies(), knha=False)
    h = r.heterogeneity
    assert h.tau2_ci_low <= h.tau_squared <= h.tau2_ci_high


def test_too_few_studies_returns_none():
    s = bcg_studies()[:1]
    assert meta_analyze(s, min_studies=2) is None


def test_mixed_measures_are_refused():
    a = Study("a", -0.3, 0.02, measure="RR", scale="ratio")
    b = Study("b", -0.3, 0.02, measure="OR", scale="ratio")
    c = Study("c", -0.3, 0.02, measure="RR", scale="ratio")
    try:
        meta_analyze([a, b, c])
    except ValueError as exc:
        assert "mixed measures" in str(exc)
    else:
        raise AssertionError("pooling RR with OR must raise, not silently blend")


def test_retracted_studies_are_excluded_and_reported():
    s = bcg_studies()
    s[0].retracted = True
    r = meta_analyze(s)
    assert r.k == len(s) - 1
    assert any("retracted" in n for n in r.notes)
    assert all(not st.retracted for st in r.studies)


# ---------------------------------------------------------- publication bias

def test_egger_on_a_symmetric_funnel():
    """A funnel built symmetric by construction must not read as asymmetric.

    Mirrored pairs at each precision, rather than a column of identical zeros:
    a degenerate funnel with no residual variance at all has no regression to
    run, and :func:`egger_test` correctly declines it (see the test below).
    """
    studies = []
    for i, v in enumerate([0.01, 0.02, 0.04, 0.08, 0.16, 0.32]):
        se = math.sqrt(v)
        studies.append(Study(f"hi{i}", yi=+0.2 * se, vi=v, measure="RR",
                             scale="ratio"))
        studies.append(Study(f"lo{i}", yi=-0.2 * se, vi=v, measure="RR",
                             scale="ratio"))
    e = egger_test(studies)
    assert e is not None
    close(e.statistic, 0.0, 1e-9, "Egger t on a perfectly symmetric funnel")
    assert e.p_value > 0.9
    assert not e.underpowered


def test_egger_declines_a_degenerate_funnel():
    """Identical effects give the regression nothing to fit; None, not zero."""
    studies = [Study(f"s{i}", yi=0.0, vi=v, measure="RR", scale="ratio")
               for i, v in enumerate([0.01, 0.02, 0.04, 0.08, 0.16])]
    assert egger_test(studies) is None


def test_egger_detects_a_built_in_asymmetry():
    """Small studies given systematically larger effects must be detected."""
    studies = []
    for i, v in enumerate([0.005, 0.006, 0.008, 0.01, 0.02, 0.05, 0.09,
                           0.13, 0.18, 0.25, 0.33, 0.42]):
        # effect grows with the standard error: the signature of small-study bias
        studies.append(Study(f"s{i}", yi=-0.10 - 1.6 * math.sqrt(v), vi=v,
                             measure="RR", scale="ratio"))
    e = egger_test(studies)
    assert e.p_value < 0.05, f"asymmetry should be detected, got p={e.p_value}"
    assert not e.underpowered
    assert "asymmetric" in e.interpretation


def test_bias_tests_flag_themselves_as_underpowered_below_ten():
    studies = bcg_studies()[:6]
    for test in (egger_test(studies), begg_test(studies)):
        assert test.underpowered is True
        assert "power" in test.interpretation or "underpowered" in test.interpretation


def test_trim_and_fill_imputes_nothing_on_a_symmetric_funnel():
    studies = [Study(f"s{i}", yi=y, vi=0.04, measure="RR", scale="ratio")
               for i, y in enumerate([-0.4, -0.2, -0.1, 0.0, 0.1, 0.2, 0.4])]
    tf = trim_and_fill(studies)
    assert tf is not None and tf.n_missing == 0
    assert "symmetric" in tf.interpretation


def test_fail_safe_n_carries_its_own_criticism():
    fs = fail_safe_n(bcg_studies())
    assert fs["fail_safe_n"] > 0
    assert "upper bound" in fs["caveat"]


# ------------------------------------------------------------- sensitivity

def test_leave_one_out_refits_every_study():
    loo = leave_one_out(bcg_studies())
    assert len(loo) == len(BCG)
    assert all(r.k == len(BCG) - 1 for _, r in loo)


def test_influence_identifies_the_heaviest_studies():
    inf = influence_diagnostics(bcg_studies())
    assert len(inf) == len(BCG)
    close(sum(i.weight for i in inf), 100.0, 0.5, "weights sum to 100%")
    # No single BCG trial flips the conclusion — the finding is robust, and the
    # diagnostic must say so rather than manufacture drama.
    assert not any(i.changes_conclusion for i in inf)


def test_influence_detects_a_conclusion_flipping_study():
    """One discordant outlier that alone keeps the interval across the null.

    Five consistent trials showing benefit, plus one showing the opposite. The
    outlier inflates tau-squared enough to widen the pooled interval across no
    effect; drop it and the conclusion reverses. That is precisely the case a
    reader needs flagged, and reporting only the pooled estimate hides it.
    """
    base = [Study(f"s{i}", yi=-0.30, vi=0.02, measure="RR", scale="ratio")
            for i in range(5)]
    base.append(Study("outlier", yi=+1.20, vi=0.02, measure="RR", scale="ratio"))

    full = meta_analyze(base)
    assert not full.excludes_null, "the outlier should widen the CI across null"

    inf = influence_diagnostics(base)
    flipped = [i for i in inf if i.changes_conclusion]
    assert len(flipped) == 1 and flipped[0].label == "outlier", \
        f"expected only the outlier to flip, got {[i.label for i in flipped]}"
    assert abs(flipped[0].standardised_residual) > 1.96
    assert abs(flipped[0].dffits) == max(abs(i.dffits) for i in inf)


def test_cumulative_grows_one_study_at_a_time():
    cum = cumulative(bcg_studies())
    assert [r.k for _, r in cum] == list(range(2, len(BCG) + 1))
    assert cum[0][1].k == 2 and cum[-1][1].k == len(BCG)


# --------------------------------------------------------------- subgroups

def test_subgroup_analysis_tests_between_group_difference():
    sg = subgroup_analysis(bcg_studies())
    assert sg is not None
    assert set(sg.groups) == {"temperate", "tropical"}
    assert sg.df_between == 1
    # Both subgroup intervals differ in whether they exclude the null, and the
    # between-group test is nonetheless not significant. That gap is exactly
    # the mistake the test exists to prevent.
    assert sg.groups["temperate"].excludes_null
    assert not sg.groups["tropical"].excludes_null
    assert sg.p_between > 0.05
    assert "consistent with chance" in sg.interpretation


def test_subgroup_needs_two_populated_groups():
    s = bcg_studies()
    for st in s:
        st.subgroup = "all"
    assert subgroup_analysis(s) is None


# ------------------------------------------------------------------- TSA

def test_tsa_reports_insufficient_information_when_underpowered():
    """Four small null trials must read as 'not enough evidence', not 'no effect'."""
    s = [Study(f"t{i}", yi=-0.05, vi=0.09, measure="RR", scale="ratio", n=200,
               events_control=20, n_control=100) for i in range(4)]
    tsa = trial_sequential_analysis(s, relative_risk_reduction=0.20)
    assert tsa is not None
    assert tsa.information_fraction < 1.0
    assert not tsa.crosses_benefit and not tsa.crosses_harm
    assert not tsa.futility
    assert "insufficient evidence, not evidence of no effect" in tsa.conclusion
    assert tsa.boundary_z > 1.96, "the boundary must be stricter than a fixed test"


def test_tsa_boundary_converges_to_the_fixed_sample_critical_value():
    s = bcg_studies()
    tsa = trial_sequential_analysis(s, total_len := None) if False else \
        trial_sequential_analysis(s, total_n=10_000_000)
    close(tsa.boundary_z, dist.normal_ppf(0.975), 1e-9,
          "at full information the boundary is the fixed-sample z")


# ------------------------------------------------------------ absolute effect

def test_absolute_effect_uses_odds_not_risk_for_odds_ratios():
    """The substitution that is harmless at low risk and wrong at high risk."""
    s = [Study(f"s{i}", yi=math.log(0.5), vi=0.01, measure="OR", scale="ratio")
         for i in range(4)]
    r = meta_analyze(s)
    ae = absolute_effect(r, 0.40)
    # OR 0.5 on a baseline of 40%: odds 0.667 -> 0.333, risk 25.0%, not 20%.
    close(ae.intervention_per_1000, 250.0, 1.0, "OR applied through the odds")

    s2 = [Study(f"s{i}", yi=math.log(0.5), vi=0.01, measure="RR", scale="ratio")
          for i in range(4)]
    ae2 = absolute_effect(meta_analyze(s2), 0.40)
    close(ae2.intervention_per_1000, 200.0, 1.0, "RR applied as a risk ratio")


def test_absolute_effect_computes_nnt():
    s = [Study(f"s{i}", yi=math.log(0.5), vi=0.01, measure="RR", scale="ratio")
         for i in range(4)]
    ae = absolute_effect(meta_analyze(s), 0.20)
    close(ae.difference_per_1000, -100.0, 1.0, "risk difference per 1000")
    close(ae.nnt, 10.0, 0.1, "NNT")
    assert ae.nnh is None


def test_absolute_effect_refuses_difference_measures():
    s = [Study(f"s{i}", yi=-0.3, vi=0.01, measure="MD", scale="difference")
         for i in range(4)]
    assert absolute_effect(meta_analyze(s), 0.2) is None


# ------------------------------------------------------------ input handling

def test_from_effects_drops_intervals_it_cannot_use():
    effects = [
        EffectSize("RR", 0.80, 0.70, 0.92),
        EffectSize("RR", 0.75, None, None),      # no interval: no precision
        EffectSize("RR", 0.85, 0.75, 0.96),
        EffectSize("MD", -2.0, -3.0, -1.0),      # minority family: dropped
    ]
    studies = from_effects(effects)
    assert len(studies) == 2
    assert all(s.measure == "RR" for s in studies)
    close(studies[0].yi, math.log(0.80), 1e-12, "log transform")


def test_from_effects_carries_metadata_through():
    effects = [EffectSize("RR", 0.8, 0.7, 0.92), EffectSize("RR", 0.9, 0.8, 1.01)]
    studies = from_effects(effects, labels=["A", "B"], years=[2019, 2021],
                           source_ids=["111", "222"])
    assert [s.label for s in studies] == ["A", "B"]
    assert [s.year for s in studies] == [2019, 2021]
    assert [s.source_id for s in studies] == ["111", "222"]


def main():
    tests = [v for k, v in sorted(globals().items()) if k.startswith("test_")]
    failed = 0
    for t in tests:
        try:
            t()
            print(f"  ok  {t.__name__}")
        except AssertionError as exc:
            failed += 1
            print(f"  FAIL {t.__name__}: {exc}")
    print(f"\n{len(tests) - failed}/{len(tests)} meta-analysis tests passed")
    return 1 if failed else 0


if __name__ == "__main__":
    raise SystemExit(main())
