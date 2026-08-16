"""The exit ladder and the swing stop, which are the two things the chart of a
real trade changed about this system."""

from __future__ import annotations

import unittest

from strata_vp import PLANS, Backtest, Costs, PropFirmRules, StrategyConfig, resample
from strata_vp.backtest import Trade
from strata_vp.instruments import MNQ, lookup
from tools.synth_data import generate
from tests.helpers import bar, signal, utc

PLAN = PLANS["ny_vs_brief"]
MORNING = utc(2026, 6, 10, 15)  # 08:00 Pacific


def _engine(**overrides) -> Backtest:
    config = StrategyConfig(
        tick_size=MNQ.tick_size, point_value=MNQ.point_value, bin_size=MNQ.bin_size, **overrides
    )
    return Backtest(
        config,
        PLAN,
        PropFirmRules(),
        Costs(
            tick_size=MNQ.tick_size,
            point_value=MNQ.point_value,
            slippage_ticks=0.0,
            commission_per_contract=0.0,
        ),
    )


def _scaled_signal(**overrides):
    base = dict(side="long", entry=100.0, stop=90.0, target=110.0)
    base.update(overrides)
    sig = signal(MORNING, **base)
    return sig.__class__(
        **{
            **{field: getattr(sig, field) for field in sig.__slots__},
            "runner_target": 130.0,
            "partial_fraction": 0.5,
        }
    )


class TestInstruments(unittest.TestCase):
    def test_the_micro_nasdaq_is_two_dollars_a_point(self):
        self.assertAlmostEqual(MNQ.point_value, 2.0)
        self.assertAlmostEqual(MNQ.tick_size, 0.25)
        self.assertAlmostEqual(MNQ.tick_value, 0.50)
        self.assertAlmostEqual(MNQ.dollars(50.0), 100.0)

    def test_a_dated_contract_resolves_to_its_root(self):
        self.assertIs(lookup("MNQZ5"), MNQ)
        self.assertIs(lookup("mnqz2025"), MNQ)
        with self.assertRaises(KeyError):
            lookup("BTCUSD")

    def test_a_fifty_point_stop_is_ten_times_more_on_the_full_size_contract(self):
        self.assertAlmostEqual(lookup("NQ").dollars(50.0), 1000.0)
        self.assertAlmostEqual(lookup("MNQ").dollars(50.0), 100.0)


class TestScalingOut(unittest.TestCase):
    def test_half_comes_off_at_the_first_target_and_the_rest_runs(self):
        engine = _engine()
        trade = Trade(signal=_scaled_signal(), entered_at=MORNING, entry=100.0, contracts=4)
        # Reaches the point of control but not the far side of value.
        still_open = engine._manage(trade, bar(MORNING, 100, 112, 99, 111))
        self.assertFalse(still_open)
        self.assertTrue(trade.partial_taken)
        self.assertEqual(trade.remaining, 2)
        self.assertAlmostEqual(trade.pnl, 10 * 2 * MNQ.point_value)

    def test_the_runner_closes_at_the_second_target(self):
        engine = _engine()
        trade = Trade(signal=_scaled_signal(), entered_at=MORNING, entry=100.0, contracts=4)
        engine._manage(trade, bar(MORNING, 100, 112, 99, 111))
        closed = engine._manage(trade, bar(MORNING, 111, 131, 110, 130))
        self.assertTrue(closed)
        self.assertEqual(trade.reason, "runner")
        self.assertEqual(trade.remaining, 0)
        # Two at ten points, two at thirty.
        self.assertAlmostEqual(trade.pnl, (10 * 2 + 30 * 2) * MNQ.point_value)
        self.assertAlmostEqual(trade.r_multiple, 2.0)

    def test_the_stop_goes_to_breakeven_once_the_partial_is_taken(self):
        engine = _engine()
        trade = Trade(signal=_scaled_signal(), entered_at=MORNING, entry=100.0, contracts=4)
        engine._manage(trade, bar(MORNING, 100, 112, 99, 111))
        # Comes back to the entry. The original 90 stop is no longer in force.
        closed = engine._manage(trade, bar(MORNING, 111, 112, 99.5, 100))
        self.assertTrue(closed)
        self.assertEqual(trade.reason, "stop")
        self.assertAlmostEqual(trade.exit, 100.0)
        self.assertAlmostEqual(trade.pnl, 10 * 2 * MNQ.point_value)

    def test_one_contract_cannot_be_halved(self):
        """Most positions on a micro account are one contract. Scaling half of
        one is the most common way a backtest beats the account that ran it."""
        engine = _engine()
        trade = Trade(signal=_scaled_signal(), entered_at=MORNING, entry=100.0, contracts=1)
        closed = engine._manage(trade, bar(MORNING, 100, 112, 99, 111))
        self.assertTrue(closed)
        self.assertFalse(trade.partial_taken)
        self.assertEqual(trade.reason, "target")
        self.assertAlmostEqual(trade.pnl, 10 * 1 * MNQ.point_value)

    def test_a_stop_before_any_partial_loses_the_whole_position(self):
        engine = _engine()
        trade = Trade(signal=_scaled_signal(), entered_at=MORNING, entry=100.0, contracts=4)
        closed = engine._manage(trade, bar(MORNING, 100, 101, 89, 90))
        self.assertTrue(closed)
        self.assertAlmostEqual(trade.pnl, -10 * 4 * MNQ.point_value)
        self.assertAlmostEqual(trade.r_multiple, -1.0)

    def test_a_short_scales_the_same_way(self):
        engine = _engine()
        sig = _scaled_signal(side="short", entry=100.0, stop=110.0, target=90.0)
        sig = sig.__class__(
            **{**{f: getattr(sig, f) for f in sig.__slots__}, "runner_target": 70.0}
        )
        trade = Trade(signal=sig, entered_at=MORNING, entry=100.0, contracts=4)
        engine._manage(trade, bar(MORNING, 100, 101, 88, 89))
        self.assertTrue(trade.partial_taken)
        self.assertEqual(trade.remaining, 2)
        self.assertAlmostEqual(trade.pnl, 10 * 2 * MNQ.point_value)


class TestSwingStop(unittest.TestCase):
    @staticmethod
    def _signals(**overrides):
        config = StrategyConfig(
            tick_size=MNQ.tick_size, point_value=MNQ.point_value, bin_size=MNQ.bin_size,
            **overrides,
        )
        from strata_vp.signals import Strategy

        strategy = Strategy(config, PLAN)
        out = []
        for one in resample(generate(days=45, seed=3), 5):
            produced = strategy.on_bar(one)
            if produced is not None:
                out.append((produced, strategy))
        return [signal for signal, _ in out]

    def test_a_swing_stop_sits_beyond_the_session_extreme(self):
        """The stop from the chart: below the low that swept the level, not a
        few points under the entry. Anything tighter is inside the noise of the
        sweep it is fading."""
        for produced in self._signals(stop_mode="swing", swing_anchor="session"):
            if produced.side == "long":
                self.assertLess(produced.stop, produced.entry)
            else:
                self.assertGreater(produced.stop, produced.entry)

    def test_the_swing_stop_is_wider_than_the_gap_stop(self):
        swing = self._signals(stop_mode="swing")
        structure = self._signals(stop_mode="gap")
        self.assertGreater(len(swing), 0)
        self.assertGreater(len(structure), 0)
        average = lambda group: sum(s.risk_points for s in group) / len(group)  # noqa: E731
        self.assertGreater(average(swing), average(structure))

    def test_no_stop_exceeds_the_cap(self):
        for produced in self._signals(stop_mode="swing", max_stop_points=45.0):
            self.assertLessEqual(produced.risk_points, 45.0)

    def test_scaling_out_is_what_makes_a_swing_stop_affordable(self):
        """With the stop behind the sweep the point of control alone rarely
        pays 1.2 to 1, so almost every setup is rejected on geometry. The
        runner is what brings them back."""
        without = self._signals(stop_mode="swing", partial_fraction=0.0)
        with_runner = self._signals(stop_mode="swing", partial_fraction=0.5)
        self.assertGreater(len(with_runner), len(without))

    def test_the_blended_reward_is_between_the_two_targets(self):
        for produced in self._signals(stop_mode="swing", partial_fraction=0.5):
            if produced.runner_target is None:
                continue
            first = abs(produced.target - produced.entry)
            second = abs(produced.runner_target - produced.entry)
            self.assertGreater(second, first)
            self.assertGreater(produced.reward_points, first)
            self.assertLess(produced.reward_points, second)


class TestExcursionScope(unittest.TestCase):
    def test_a_shallow_approach_is_not_a_sweep(self):
        """The excursion test must not use the gap band slack. Counting price
        arriving ten points above the value area low as a sweep of it made
        every swing stop a couple of points wide."""
        from strata_vp.signals import Strategy

        config = StrategyConfig(
            tick_size=MNQ.tick_size, point_value=MNQ.point_value, bin_size=MNQ.bin_size,
            stop_mode="swing",
        )
        strategy = Strategy(config, PLAN)
        for one in resample(generate(days=20, seed=3), 5):
            produced = strategy.on_bar(one)
            if produced is None or produced.zone_name != "value_area_low":
                continue
            session_low = min(b.low for b in strategy.session_bars)
            self.assertLessEqual(session_low, produced.reference.val)


if __name__ == "__main__":
    unittest.main()
