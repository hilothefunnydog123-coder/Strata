"""Statistics and question-parsing tests. Run: ``python tests/test_stats.py``

The meta-analysis here is real DerSimonian-Laird, so it is checked against
worked values rather than against itself: the chi-square tail is compared with
published critical values, and the pooling is compared with a hand-computed
fixed-effect case where tau-squared is known to be zero.
"""
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

# These scripts print I-squared, tau and box-drawing characters. A Windows
# console defaulting to cp1252 would raise mid-run, so ask for UTF-8 explicitly.
try:
    sys.stdout.reconfigure(encoding="utf-8")
except (AttributeError, OSError):
    pass

import math                                                     # noqa: E402

from strata import cache, ranking                               # noqa: E402
from strata.pico import broaden, build_query, content_words, expand, parse  # noqa: E402
from strata.stats import (EffectSize, chi2_sf, extract_effects,   # noqa: E402
                          extract_i2, normal_cdf, pool, primary_effect)


def approx(a, b, tol=1e-3):
    return abs(a - b) <= tol


# ---------------------------------------------------------------- extraction

def test_extracts_every_common_reporting_format():
    cases = [
        ("(risk ratio 0.86, 95% CI 0.74 to 0.99; p = 0.04)", "RR", 0.86, True),
        ("The adjusted OR was 2.31 (95% CI 1.44-3.70).", "OR", 2.31, True),
        ("Pooled SMD -0.42 (95% CI -0.61 to -0.23), p<0.001.", "SMD", -0.42, True),
        ("hazard ratio for mortality was 1.12 (95%CI, 0.91-1.38), p=0.28",
         "HR", 1.12, False),
        ("Incidence rate ratio 1.03 (95% CI 0.88, 1.21); p = 0.71.",
         "IRR", 1.03, False),
        ("mean difference in systolic pressure was -5.4 mmHg (95% CI -7.2 to -3.6)",
         "MD", -5.4, True),
    ]
    for text, measure, estimate, significant in cases:
        found = extract_effects(text)
        assert found, f"nothing extracted from {text!r}"
        e = found[0]
        assert e.measure == measure, f"{text!r}: got {e.measure}"
        assert approx(e.estimate, estimate), f"{text!r}: got {e.estimate}"
        assert e.is_significant is significant, f"{text!r}: significance wrong"
    print(f"ok  effect extraction handles {len(cases)} reporting formats")


def test_rejects_intervals_that_do_not_bracket_the_estimate():
    e = extract_effects("RR was 0.5 (95% CI 0.9 to 1.4)")[0]
    assert not e.has_interval, "a CI that excludes its own point estimate is a parse error"
    assert e.is_significant is None, "unknowable, so it must not claim either way"
    print("ok  a nonsensical interval is dropped rather than trusted")


def test_extracts_nothing_when_there_is_nothing():
    assert extract_effects("We report the odds ratio and discuss it elsewhere.") == []
    assert extract_effects("") == []
    assert extract_effects(None) == []
    print("ok  no number, no effect — the extractor does not guess")


def test_direction_is_about_the_null_not_about_benefit():
    e = EffectSize("RR", 0.7, 0.6, 0.85)
    assert e.direction == "below"
    assert e.null_value == 1.0
    d = EffectSize("MD", -3.0, -5.0, -1.0)
    assert d.direction == "below" and d.null_value == 0.0
    print("ok  direction describes the null, not whether the news is good")


def test_i2_extraction():
    assert extract_i2("heterogeneity was substantial (I2 = 62%)") == 62.0
    assert extract_i2("I² of 88%") == 88.0
    assert extract_i2("no heterogeneity reported") is None
    assert extract_i2("I2 = 340%") is None, "out-of-range values are artefacts"
    print("ok  I² is read when stated and rejected when implausible")


def test_primary_effect_prefers_the_fullest_report():
    effects = [EffectSize("RR", 0.9), EffectSize("HR", 0.8, 0.7, 0.92, 0.01, "=")]
    assert primary_effect(effects).measure == "HR"
    assert primary_effect([]) is None
    print("ok  the effect shown next to a paper is its most complete one")


# ------------------------------------------------------------- distributions

def test_chi2_matches_published_critical_values():
    # 0.05 critical values for 1..10 degrees of freedom
    critical = {1: 3.841, 2: 5.991, 3: 7.815, 4: 9.488, 5: 11.070,
                6: 12.592, 7: 14.067, 8: 15.507, 9: 16.919, 10: 18.307}
    for df, x in critical.items():
        p = chi2_sf(x, df)
        assert approx(p, 0.05, 1e-3), f"df={df}: got {p:.5f}"
    assert chi2_sf(0.0, 3) == 1.0
    assert chi2_sf(-1.0, 3) == 1.0
    print("ok  chi-square upper tail matches published critical values")


def test_normal_cdf():
    assert approx(normal_cdf(0.0), 0.5)
    assert approx(normal_cdf(1.959963985), 0.975, 1e-6)
    assert approx(normal_cdf(-1.959963985), 0.025, 1e-6)
    print("ok  the normal CDF is accurate at the values that matter")


# ------------------------------------------------------------ meta-analysis

def test_pooling_matches_a_hand_computed_case():
    """Three identical studies must pool to their common estimate, exactly.

    With no between-study variation, Q is 0, tau-squared is 0, I-squared is 0,
    and the pooled estimate equals the shared point estimate. Any deviation means
    the weighting is wrong.
    """
    same = [EffectSize("RR", 0.80, 0.70, 0.914) for _ in range(3)]
    p = pool(same)
    assert p is not None
    assert approx(p.estimate, 0.80, 1e-6), p.estimate
    assert approx(p.q, 0.0, 1e-9) and approx(p.tau_squared, 0.0, 1e-9)
    assert approx(p.i_squared, 0.0, 1e-9)
    # Pooling three identical studies must narrow the interval by about root-3.
    single_width = math.log(0.914) - math.log(0.70)
    pooled_width = math.log(p.ci_high) - math.log(p.ci_low)
    assert approx(pooled_width, single_width / math.sqrt(3), 1e-3)
    print("ok  identical studies pool to their common estimate, narrowed as expected")


def test_heterogeneity_is_detected():
    scattered = [EffectSize("RR", 0.40, 0.32, 0.50),
                 EffectSize("RR", 1.60, 1.30, 1.97),
                 EffectSize("RR", 0.95, 0.80, 1.13),
                 EffectSize("RR", 1.20, 1.02, 1.41)]
    p = pool(scattered)
    assert p is not None
    assert p.i_squared > 75, f"expected considerable heterogeneity, got {p.i_squared}"
    assert p.heterogeneity == "considerable"
    assert p.tau_squared > 0, "scattered studies must produce a positive tau²"
    assert p.q_p_value < 0.01, "Cochran's Q should be significant here"
    print(f"ok  heterogeneity is measured, not hidden (I² = {p.i_squared:.0f}%)")


def test_pooling_declines_rather_than_guessing():
    assert pool([]) is None
    assert pool([EffectSize("RR", 0.8, 0.7, 0.9)]) is None
    assert pool([EffectSize("RR", 0.8, 0.7, 0.9),
                 EffectSize("RR", 0.9, 0.8, 1.0)]) is None, "two is not enough"
    # Intervals are required; a bare point estimate has no weight.
    assert pool([EffectSize("RR", 0.8), EffectSize("RR", 0.9),
                 EffectSize("RR", 0.7)]) is None
    print("ok  pooling returns None instead of inventing an estimate")


def test_pooling_picks_one_measure_and_says_which():
    mixed = ([EffectSize("OR", 1.5, 1.2, 1.9) for _ in range(4)]
             + [EffectSize("HR", 0.8, 0.7, 0.92) for _ in range(2)])
    p = pool(mixed)
    assert p.measure == "OR" and p.n_studies == 4, \
        "the most common measure wins; the rest are excluded, not blended"
    print("ok  a pooled label names one measure and pools only that measure")


def test_excludes_null_is_computed_correctly():
    tight = pool([EffectSize("RR", 0.70, 0.62, 0.79) for _ in range(3)])
    assert tight.excludes_null is True
    wide = pool([EffectSize("RR", 1.00, 0.60, 1.67) for _ in range(3)])
    assert wide.excludes_null is False
    print("ok  'excludes no effect' reflects the pooled interval")


# --------------------------------------------------------------------- BM25

def test_bm25_ranks_by_the_query_terms():
    docs = ["vitamin d and respiratory infection in adults",
            "metformin and cardiovascular mortality in diabetes",
            "vitamin d vitamin d vitamin d respiratory"]
    bm = ranking.BM25(docs)
    scores = bm.scores(["vitamin", "respiratory"])
    assert scores[2] > scores[0] > scores[1]
    assert scores[1] == 0.0, "a document with no query term scores nothing"
    print("ok  BM25 ranks by query terms and saturates repetition")


def test_normalize_scores_flattens_a_tie():
    assert ranking.normalize_scores([2.0, 2.0, 2.0]) == [0.0, 0.0, 0.0], \
        "if nothing separates the documents, relevance must contribute nothing"
    assert ranking.normalize_scores([0.0, 5.0]) == [0.0, 1.0]
    assert ranking.normalize_scores([]) == []
    print("ok  relevance contributes nothing when it separates nothing")


def test_jaccard_and_shingles_detect_near_duplicates():
    a = ranking.shingles("the quick brown fox jumps over the lazy dog today")
    b = ranking.shingles("the quick brown fox jumps over the lazy dog now")
    c = ranking.shingles("an entirely different sentence about something else")
    assert ranking.jaccard(a, b) > 0.5
    assert ranking.jaccard(a, c) == 0.0
    print("ok  shingle overlap separates near-duplicates from unrelated text")


def test_recency_decays_without_a_cliff():
    now = ranking.recency_score(2026, 2026)
    old = ranking.recency_score(2014, 2026)
    ancient = ranking.recency_score(1990, 2026)
    assert approx(now, 1.0), now
    assert approx(old, 0.5, 1e-9), f"one half-life should halve it, got {old}"
    # 36 years is three half-lives: 0.125, not zero. A landmark trial keeps some
    # weight rather than falling off a cliff.
    assert approx(ancient, 0.125, 1e-9), ancient
    assert 0.0 < ancient < old < now
    assert ranking.recency_score(None, 2026) == 0.35
    assert ranking.recency_score(2030, 2026) == 1.0, "future dates are not rewarded"
    print("ok  recency decays smoothly and handles missing and future dates")


def test_retraction_penalty_dominates_the_score():
    clean = ranking.combine(evidence=1.0, relevance=1.0, recency=1.0, rigour=1.0)
    gone = ranking.combine(evidence=1.0, relevance=1.0, recency=1.0, rigour=1.0,
                           retracted=True)
    assert gone.total < clean.total * 0.25
    assert "retracted" in gone.note
    assert gone.total >= 0.0, "the score is clamped, never negative"
    print("ok  a retracted paper cannot outrank a clean one")


# --------------------------------------------------------------------- PICO

def test_pico_shapes():
    cases = {
        "Does vitamin D prevent respiratory infections in children?":
            ("vitamin d", "children"),
        "Does metformin reduce cardiovascular mortality in type 2 diabetes?":
            ("metformin", "type 2 diabetes"),
        "What is the effect of exercise on depression in older adults?":
            ("exercise", "older adults"),
    }
    for question, (intervention, population) in cases.items():
        p = parse(question)
        assert p.intervention == intervention, f"{question}: got {p.intervention!r}"
        assert p.population == population, f"{question}: got {p.population!r}"
    print(f"ok  PICO extracts intervention and population across {len(cases)} shapes")


def test_pico_never_raises():
    for junk in ["", "?", "   ", "a", "does", "!!!", "in with for and or"]:
        p = parse(junk)
        assert isinstance(p.keywords, list)
        q = build_query(p)
        assert isinstance(q, str) and q, f"empty query for {junk!r}"
    print("ok  degenerate input parses to something searchable, never an exception")


def test_expansion_is_conservative():
    assert "cholecalciferol" in expand("vitamin d")
    assert "myocardial infarction" in expand("heart attack")
    # An unknown term expands to itself only — no speculative synonyms.
    assert expand("tozinameran") == ["tozinameran"]
    print("ok  synonym expansion is curated, not invented")


def test_broaden_is_looser_than_the_precise_query():
    p = parse("Does vitamin D prevent respiratory infections in children?")
    assert build_query(p).count(" AND ") > broaden(p).count(" AND ")
    print("ok  the fallback query is genuinely broader")


def test_content_words_drop_the_scaffolding():
    words = content_words("Does the use of vitamin D prevent infections?")
    assert "vitamin" in words and "infections" in words
    assert "does" not in words and "the" not in words and "use" not in words
    print("ok  question scaffolding is stripped from the search terms")


# -------------------------------------------------------------------- cache

def test_cache_roundtrip_and_isolation(tmpdir=None):
    import tempfile
    with tempfile.TemporaryDirectory() as d:
        old = os.environ.get("STRATA_CACHE_DIR")
        os.environ["STRATA_CACHE_DIR"] = d
        try:
            url = "https://example.invalid/eutils?term=x"
            assert cache.get(url) is None
            cache.put(url, b"<xml>payload</xml>")
            assert cache.get(url) == b"<xml>payload</xml>"
            assert cache.get(url, ttl=0) is None, "an expired entry is a miss"
            assert cache.get("https://example.invalid/other") is None
            assert cache.stats()["entries"] == 1
            assert cache.clear() == 1
            assert cache.get(url) is None
        finally:
            if old is None:
                os.environ.pop("STRATA_CACHE_DIR", None)
            else:
                os.environ["STRATA_CACHE_DIR"] = old
    print("ok  the cache round-trips, expires, isolates keys and clears")


if __name__ == "__main__":
    tests = [(n, f) for n, f in sorted(globals().items())
             if n.startswith("test_") and callable(f)]
    for name, fn in tests:
        fn()
    print(f"\nall {len(tests)} statistics and parsing tests passed")
