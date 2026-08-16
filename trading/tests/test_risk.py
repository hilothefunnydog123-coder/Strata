from __future__ import annotations

import unittest

from strata_vp.risk import PropFirmRules, RiskManager
from tests.helpers import utc

MORNING = utc(2026, 6, 10, 14)  # 07:00 Pacific, inside the New York session


def manager(**overrides) -> RiskManager:
    defaults = dict(
        account_size=50_000.0,
        max_daily_loss=1_200.0,
        trailing_drawdown=2_500.0,
        max_trades_per_day=10,
        max_consecutive_losses=10,
        stop_after_daily_target=None,
    )
    defaults.update(overrides)
    return RiskManager(PropFirmRules(**defaults))


class TestTrailingDrawdown(unittest.TestCase):
    def test_floor_starts_below_the_account(self):
        risk = manager()
        self.assertAlmostEqual(risk.trailing_floor, 47_500.0)

    def test_unrealised_profit_permanently_raises_the_floor(self):
        """The rule that fails most funded accounts. A trade that goes 40
        points your way and comes back has moved the floor up even though the
        balance never changed."""
        risk = manager()
        risk.mark(800.0)
        self.assertAlmostEqual(risk.state.peak, 50_800.0)
        risk.mark(0.0)
        self.assertAlmostEqual(risk.trailing_floor, 48_300.0)

    def test_closed_balance_accounts_do_not_trail_on_open_profit(self):
        risk = manager(trailing_basis="closed_balance")
        risk.mark(800.0)
        self.assertAlmostEqual(risk.trailing_floor, 47_500.0)

    def test_floor_stops_trailing_once_the_buffer_is_cleared(self):
        risk = manager(trailing_stops_at_profit=2_600.0)
        risk.mark(5_000.0)
        # The peak is capped at account plus 2600, so the floor settles at
        # account plus 100 rather than following price up forever.
        self.assertAlmostEqual(risk.trailing_floor, 50_100.0)

    def test_breaching_the_floor_fails_the_account(self):
        risk = manager()
        risk.record(-2_600.0, MORNING)
        self.assertTrue(risk.failed)
        self.assertFalse(risk.evaluate(MORNING, 50.0, 20.0).allowed)


class TestDailyLimits(unittest.TestCase):
    def test_soft_stop_fires_before_the_firm_limit(self):
        risk = manager(daily_soft_stop_pct=0.70)
        risk.record(-900.0, MORNING)  # 75 percent of a 1200 limit
        decision = risk.evaluate(MORNING, 50.0, 20.0)
        self.assertFalse(decision.allowed)
        self.assertEqual(decision.reason, "daily soft stop")

    def test_a_new_day_resets_the_daily_counters(self):
        risk = manager(daily_soft_stop_pct=0.70)
        risk.record(-900.0, MORNING)
        tomorrow = utc(2026, 6, 11, 14)
        self.assertTrue(risk.evaluate(tomorrow, 10.0, 20.0).allowed)
        self.assertEqual(risk.state.trades_today, 0)

    def test_trade_count_and_loss_streak_stop_the_day(self):
        risk = manager(max_trades_per_day=2)
        risk.record(50.0, MORNING)
        risk.record(50.0, MORNING)
        self.assertEqual(risk.evaluate(MORNING, 50.0, 20.0).reason, "max trades for the day")

        streak = manager(max_consecutive_losses=2)
        streak.record(-100.0, MORNING)
        streak.record(-100.0, MORNING)
        self.assertEqual(streak.evaluate(MORNING, 50.0, 20.0).reason, "consecutive loss limit")

    def test_no_new_trades_after_the_flat_by_time(self):
        risk = manager()
        afternoon = utc(2026, 6, 10, 20, 30)  # 13:30 Pacific
        self.assertEqual(risk.evaluate(afternoon, 50.0, 20.0).reason, "past flat by time")


class TestSizing(unittest.TestCase):
    def test_size_is_the_smallest_of_the_three_budgets(self):
        risk = manager(risk_per_trade_pct=0.01, max_contracts=10)
        # One percent of 50k is 500. A 50 point stop on a 20 dollar point is
        # 1000 per contract, so nothing fits.
        self.assertEqual(risk.size(50.0, 20.0), 0)
        # A 10 point stop is 200 per contract, so two fit.
        self.assertEqual(risk.size(10.0, 20.0), 2)

    def test_contract_cap_applies(self):
        risk = manager(risk_per_trade_pct=0.10, max_contracts=3)
        self.assertEqual(risk.size(10.0, 20.0), 3)

    def test_size_shrinks_as_the_drawdown_room_shrinks(self):
        risk = manager(risk_per_trade_pct=0.10, max_contracts=50)
        full = risk.size(10.0, 20.0)
        risk.record(-2_000.0, MORNING)
        self.assertLess(risk.size(10.0, 20.0), full)

    def test_zero_size_blocks_the_trade(self):
        risk = manager(risk_per_trade_pct=0.0001)
        decision = risk.evaluate(MORNING, 50.0, 20.0)
        self.assertFalse(decision.allowed)
        self.assertEqual(decision.reason, "risk budget below one contract")


class TestReporting(unittest.TestCase):
    def test_consistency_breach_is_reported_not_enforced(self):
        risk = manager(consistency_pct=0.30)
        risk.record(1_000.0, utc(2026, 6, 10, 14))
        risk.record(200.0, utc(2026, 6, 11, 14))
        breached, share = risk.consistency_breach()
        self.assertTrue(breached)
        self.assertAlmostEqual(share, 1_000.0 / 1_200.0, places=3)
        # It does not stop trading, because the firm does not fail you for it.
        self.assertTrue(risk.evaluate(utc(2026, 6, 12, 14), 10.0, 20.0).allowed)

    def test_profit_target_stops_trading(self):
        risk = manager(profit_target=1_000.0)
        risk.record(1_100.0, MORNING)
        self.assertTrue(risk.passed)
        self.assertEqual(risk.evaluate(MORNING, 10.0, 20.0).reason, "profit target reached")


if __name__ == "__main__":
    unittest.main()
