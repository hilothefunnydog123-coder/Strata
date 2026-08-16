from __future__ import annotations

import unittest

from strata_vp import PLANS, StrategyConfig, resample
from strata_vp.signals import Strategy
from tools.synth_data import generate

PLAN = PLANS["ny_vs_brief"]


def _run(config: StrategyConfig, *, days: int = 45, seed: int = 3):
    bars = resample(generate(days=days, seed=seed), 5)
    strategy = Strategy(config, PLAN)
    signals = []
    for bar in bars:
        produced = strategy.on_bar(bar)
        if produced is not None:
            signals.append(produced)
    return strategy, signals


class TestSignalInvariants(unittest.TestCase):
    """Property tests over a synthetic run. The data is fabricated so nothing
    here says the strategy is profitable, but every signal it emits has to be
    internally coherent, and these are the ways it could fail not to be."""

    @classmethod
    def setUpClass(cls):
        cls.config = StrategyConfig(stop_mode="tighter_of")
        cls.strategy, cls.signals = _run(cls.config)

    def test_the_run_produces_signals_at_all(self):
        self.assertGreater(len(self.signals), 10, "pipeline produced nothing to check")

    def test_stop_and_target_straddle_the_entry_correctly(self):
        for signal in self.signals:
            if signal.side == "long":
                self.assertLess(signal.stop, signal.entry, signal)
                self.assertGreater(signal.target, signal.entry, signal)
            else:
                self.assertGreater(signal.stop, signal.entry, signal)
                self.assertLess(signal.target, signal.entry, signal)

    def test_every_signal_clears_the_reward_to_risk_floor(self):
        for signal in self.signals:
            self.assertGreaterEqual(
                round(signal.reward_risk, 6), self.config.min_reward_risk, signal
            )

    def test_no_signal_risks_more_than_the_cap(self):
        for signal in self.signals:
            self.assertLessEqual(signal.risk_points, self.config.max_stop_points, signal)

    def test_signals_only_fire_inside_the_traded_session(self):
        for signal in self.signals:
            self.assertTrue(PLAN.trade.contains(signal.ts), signal.ts)

    def test_signals_respect_the_no_new_trades_window(self):
        for signal in self.signals:
            remaining = PLAN.trade.minutes_remaining(signal.ts)
            assert remaining is not None
            self.assertGreaterEqual(remaining, self.config.no_new_trades_before_close_min)

    def test_a_trigger_never_outlives_its_arm(self):
        for signal in self.signals:
            self.assertLessEqual(signal.armed_bars_ago, self.config.setup_valid_bars, signal)

    def test_point_of_control_entries_only_appear_in_trends(self):
        """The discretionary variant. Taking the point of control instead of
        the far side of value is only allowed when the regime layer is
        confident, and only in a trend that agrees with the direction."""
        for signal in self.signals:
            if signal.zone_name != "point_of_control":
                continue
            self.assertGreaterEqual(
                signal.verdict.confidence, self.config.min_trend_confidence, signal
            )
            expected = "strong_uptrend" if signal.side == "long" else "strong_downtrend"
            self.assertEqual(signal.verdict.regime, expected, signal)

    def test_the_session_signal_cap_holds(self):
        from collections import Counter

        per_day = Counter(PLAN.trade.anchor_date(signal.ts) for signal in self.signals)
        self.assertLessEqual(max(per_day.values()), self.config.max_signals_per_session)

    def test_a_fair_value_gap_is_attached_when_one_is_required(self):
        for signal in self.signals:
            self.assertIsNotNone(signal.fvg, signal)
            assert signal.fvg is not None
            self.assertEqual(
                signal.fvg.kind, "bullish" if signal.side == "long" else "bearish"
            )
            self.assertGreaterEqual(signal.fvg.size, self.config.min_fvg_points)

    def test_the_run_is_deterministic(self):
        _, again = _run(self.config)
        self.assertEqual(
            [signal.as_dict() for signal in self.signals],
            [signal.as_dict() for signal in again],
        )


class TestModes(unittest.TestCase):
    def test_the_literal_brief_and_the_reclaim_produce_different_trades(self):
        """`outside_value` is the brief as written and `value_reentry` waits
        for the level to be reclaimed. They are genuinely different strategies
        and the point of keeping both is that a backtest can settle it."""
        _, reentry = _run(StrategyConfig(stop_mode="tighter_of", entry_mode="value_reentry"))
        _, outside = _run(StrategyConfig(stop_mode="tighter_of", entry_mode="outside_value"))
        self.assertGreater(len(reentry), 0)
        self.assertGreater(len(outside), 0)
        self.assertNotEqual(
            [signal.ts for signal in reentry], [signal.ts for signal in outside]
        )

    def test_a_fixed_fifty_point_stop_cannot_reach_the_point_of_control(self):
        """The arithmetic problem in the brief, pinned as a test so it cannot
        be forgotten. The distance from the value area low to the point of
        control is normally a fraction of the value area width. Risking 50
        points to make that is well under one to one, so the reward to risk
        floor rejects every one of them and the strategy stands down rather
        than taking a trade it cannot win enough of."""
        _, fixed = _run(StrategyConfig(stop_mode="fixed", stop_points=50.0, min_reward_risk=1.2))
        _, structural = _run(StrategyConfig(stop_mode="gap", min_reward_risk=1.2))
        self.assertEqual(len(fixed), 0)
        self.assertGreater(len(structural), 0)

    def test_dropping_the_gap_requirement_loosens_the_strategy(self):
        """Compared with a fixed stop on both sides, because a structural stop
        is derived from the gap: turning the gap off would also turn the tight
        stop off, and the reward to risk floor would then reject almost
        everything for an unrelated reason."""
        # min_stop_atr off: the floor would push every stop past the 12 point
        # cap and both sides would come back empty for an unrelated reason.
        tight = dict(stop_mode="fixed", stop_points=12.0, max_stop_points=12.0,
                     min_stop_atr=0.0)
        _, with_gap = _run(StrategyConfig(require_fvg=True, **tight))
        _, without = _run(StrategyConfig(require_fvg=False, **tight))
        self.assertGreater(len(with_gap), 0)
        self.assertGreater(len(without), len(with_gap))

    def test_turning_off_the_gap_also_gives_up_the_structural_stop(self):
        """With no gap there is no structure to place a stop behind, so every
        signal falls back to the fixed distance. Asserted on the stop distance
        rather than on a trade count, because the count moves whenever an
        unrelated default does and then the test only says the numbers
        changed."""
        config = StrategyConfig(stop_mode="gap", require_fvg=False, stop_points=37.0,
                                max_stop_points=40.0, min_stop_atr=0.0)
        _, signals = _run(config)
        for signal in signals:
            self.assertAlmostEqual(signal.risk_points, 37.0, places=2, msg=signal)


class TestSessionState(unittest.TestCase):
    def test_state_is_cleared_between_sessions(self):
        config = StrategyConfig(stop_mode="tighter_of")
        bars = resample(generate(days=6, seed=11), 5)
        strategy = Strategy(config, PLAN)
        seen_out_of_session = False
        for bar in bars:
            strategy.on_bar(bar)
            if not PLAN.trade.contains(bar.ts):
                seen_out_of_session = True
                self.assertFalse(strategy.in_session)
                self.assertIsNone(strategy.reference)
                self.assertEqual(strategy.armed, {})
        self.assertTrue(seen_out_of_session)

    def test_the_reference_profile_is_the_previous_window(self):
        config = StrategyConfig()
        bars = resample(generate(days=8, seed=5), 5)
        strategy = Strategy(config, PLAN)
        checked = 0
        for bar in bars:
            strategy.on_bar(bar)
            if strategy.in_session and strategy.reference is not None and checked < 3:
                reference = strategy.reference
                self.assertLess(reference.val, reference.vah)
                self.assertLessEqual(reference.val, reference.poc)
                self.assertLessEqual(reference.poc, reference.vah)
                self.assertGreater(reference.total_volume, 0)
                checked += 1
        self.assertEqual(checked, 3)


if __name__ == "__main__":
    unittest.main()
