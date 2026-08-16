from __future__ import annotations

import unittest
from datetime import timedelta

from strata_vp.gemini import (
    REGIME_RANK,
    GeminiJudge,
    _parse,
    _reconcile,
    deterministic_verdict,
)
from strata_vp.regime import classify, measure
from tests.helpers import bar, levels, utc


def _session(direction: float, count: int = 40):
    start = utc(2026, 6, 10, 14)
    bars = []
    price = 100.0
    for index in range(count):
        price += direction
        bars.append(
            bar(
                start + timedelta(minutes=index),
                price - direction,
                price + 0.5,
                price - 0.5 - abs(direction) * 0.1,
                price,
            )
        )
    return bars


class TestFeatures(unittest.TestCase):
    def test_no_bars_means_no_measurement(self):
        self.assertIsNone(measure(session_bars=[], reference=levels(), developing=None))

    def test_distances_are_signed_toward_the_level(self):
        bars = _session(0.0, count=20)
        reference = levels(poc=120.0, vah=130.0, val=110.0)
        features = measure(session_bars=bars, reference=reference, developing=None)
        assert features is not None
        # Every level is above a price of 100, so every distance is positive.
        self.assertGreater(features.atr_to_reference_poc, 0)
        self.assertGreater(features.atr_to_reference_val, 0)
        self.assertEqual(features.position_vs_reference, "below_value")

    def test_open_type_reads_the_reference_value_area(self):
        bars = _session(0.0, count=20)
        below = measure(session_bars=bars, reference=levels(poc=200, vah=210, val=190), developing=None)
        above = measure(session_bars=bars, reference=levels(poc=50, vah=60, val=40), developing=None)
        assert below is not None and above is not None
        self.assertEqual(below.open_type, "below_value")
        self.assertEqual(above.open_type, "above_value")

    def test_point_of_control_migration_is_in_value_area_widths(self):
        reference = levels(poc=100, vah=110, val=90)  # width 20
        features = measure(
            session_bars=_session(0.0, count=20),
            reference=reference,
            developing=None,
            prior_pocs=[80.0, 90.0, 100.0],
        )
        assert features is not None
        self.assertAlmostEqual(features.poc_migration, 0.5)


class TestClassifier(unittest.TestCase):
    def test_rising_points_of_control_and_a_rising_session_is_an_uptrend(self):
        features = measure(
            session_bars=_session(1.0, count=40),
            reference=levels(poc=100, vah=110, val=90),
            developing=None,
            prior_pocs=[70.0, 85.0, 100.0],
        )
        assert features is not None
        regime, confidence = classify(features)
        self.assertIn(regime, ("uptrend", "strong_uptrend"))
        self.assertGreater(confidence, 0.3)

    def test_the_mirror_is_a_downtrend(self):
        features = measure(
            session_bars=_session(-1.0, count=40),
            reference=levels(poc=100, vah=110, val=90),
            developing=None,
            prior_pocs=[130.0, 115.0, 100.0],
        )
        assert features is not None
        regime, _ = classify(features)
        self.assertIn(regime, ("downtrend", "strong_downtrend"))

    def test_a_flat_session_is_balanced(self):
        features = measure(
            session_bars=_session(0.0, count=40),
            reference=levels(poc=100, vah=110, val=90),
            developing=None,
            prior_pocs=[100.0, 100.0, 100.0],
        )
        assert features is not None
        self.assertEqual(classify(features)[0], "balanced")

    def test_no_strong_call_in_the_first_few_bars(self):
        features = measure(
            session_bars=_session(2.0, count=8),
            reference=levels(poc=100, vah=110, val=90),
            developing=None,
            prior_pocs=[50.0, 75.0, 100.0],
        )
        assert features is not None
        self.assertNotIn(classify(features)[0], ("strong_uptrend", "strong_downtrend"))


class TestDeterministicVerdict(unittest.TestCase):
    def test_a_strong_uptrend_moves_the_long_zone_to_the_point_of_control(self):
        """This is the judgement the brief asks for, available with no model
        at all: in a one directional session price may never reach the far
        side of value, so the point of control becomes the entry."""
        features = measure(
            session_bars=_session(1.5, count=40),
            reference=levels(poc=100, vah=110, val=90),
            developing=None,
            prior_pocs=[55.0, 78.0, 100.0],
        )
        assert features is not None
        verdict = deterministic_verdict(features)
        self.assertEqual(verdict.regime, "strong_uptrend")
        self.assertEqual(verdict.preferred_long_zone, "point_of_control")
        self.assertFalse(verdict.short_allowed)
        self.assertEqual(verdict.long_target, "value_area_high")


class TestJudgeCage(unittest.TestCase):
    def _features(self):
        return measure(
            session_bars=_session(0.0, count=30),
            reference=levels(),
            developing=None,
            prior_pocs=[100.0, 100.0],
        )

    def test_no_api_key_means_the_deterministic_answer(self):
        judge = GeminiJudge(api_key=None)
        features = self._features()
        assert features is not None
        verdict = judge.judge(features)
        self.assertEqual(verdict.source, "deterministic")
        self.assertEqual(judge.calls, 0)

    def test_disabled_judge_never_calls_out(self):
        judge = GeminiJudge(api_key="not-a-real-key", enabled=False)
        features = self._features()
        assert features is not None
        self.assertEqual(judge.judge(features).source, "deterministic")
        self.assertEqual(judge.calls, 0)

    def test_a_side_needs_both_opinions_to_allow_it(self):
        features = measure(
            session_bars=_session(1.5, count=40),
            reference=levels(poc=100, vah=110, val=90),
            developing=None,
            prior_pocs=[55.0, 78.0, 100.0],
        )
        assert features is not None
        fallback = deterministic_verdict(features)
        self.assertFalse(fallback.short_allowed)

        model = fallback.__class__(
            **{
                **{
                    "regime": "strong_uptrend",
                    "confidence": 0.9,
                    "long_allowed": True,
                    "short_allowed": True,  # the model wants to short
                    "preferred_long_zone": "point_of_control",
                    "preferred_short_zone": "value_area_high",
                    "long_target": "value_area_high",
                    "short_target": "point_of_control",
                    "rationale": "test",
                    "source": "gemini",
                }
            }
        )
        caged = _reconcile(model, fallback)
        self.assertFalse(caged.short_allowed)
        self.assertTrue(caged.long_allowed)

    def test_disagreement_halves_the_confidence(self):
        up = deterministic_verdict(
            measure(
                session_bars=_session(1.5, count=40),
                reference=levels(poc=100, vah=110, val=90),
                developing=None,
                prior_pocs=[55.0, 78.0, 100.0],
            )
        )
        model = up.__class__(
            regime="strong_downtrend",
            confidence=1.0,
            long_allowed=True,
            short_allowed=True,
            preferred_long_zone="value_area_low",
            preferred_short_zone="value_area_high",
            long_target="point_of_control",
            short_target="point_of_control",
            rationale="test",
            source="gemini",
        )
        self.assertLess(REGIME_RANK[model.regime] * REGIME_RANK[up.regime], 0)
        self.assertAlmostEqual(_reconcile(model, up).confidence, 0.5)

    def test_malformed_responses_are_rejected_rather_than_guessed_at(self):
        self.assertIsNone(_parse({}))
        self.assertIsNone(_parse({"candidates": []}))
        self.assertIsNone(
            _parse({"candidates": [{"content": {"parts": [{"text": "not json"}]}}]})
        )
        self.assertIsNone(
            _parse({"candidates": [{"content": {"parts": [{"text": '{"regime": "up"}'}]}}]})
        )

    def test_unknown_enum_values_fall_back_to_the_safe_choice(self):
        payload = {
            "regime": "moon",
            "confidence": 5.0,
            "long_allowed": True,
            "short_allowed": False,
            "preferred_long_zone": "the_moon",
            "preferred_short_zone": "value_area_high",
            "long_target": "point_of_control",
            "short_target": "point_of_control",
            "rationale": "x",
        }
        import json

        parsed = _parse({"candidates": [{"content": {"parts": [{"text": json.dumps(payload)}]}}]})
        assert parsed is not None
        self.assertEqual(parsed["regime"], "balanced")
        self.assertEqual(parsed["preferred_long_zone"], "value_area_low")
        self.assertEqual(parsed["confidence"], 1.0)


if __name__ == "__main__":
    unittest.main()
