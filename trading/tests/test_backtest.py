from __future__ import annotations

import unittest
from datetime import timedelta

from strata_vp import PLANS, Backtest, Costs, PropFirmRules, StrategyConfig, resample
from strata_vp.backtest import Pending, Trade
from strata_vp.brokers.base import BracketOrder
from strata_vp.brokers.paper import PaperBroker
from tools.synth_data import generate
from tests.helpers import bar, signal, utc

PLAN = PLANS["ny_vs_brief"]
MORNING = utc(2026, 6, 10, 15)  # 08:00 Pacific, well inside the session


def _backtest(**overrides) -> Backtest:
    config = StrategyConfig(stop_mode="tighter_of", **overrides)
    return Backtest(
        config,
        PLAN,
        PropFirmRules(),
        Costs(tick_size=0.25, point_value=2.0, slippage_ticks=1.0, commission_per_contract=1.20),
    )


class TestFillMechanics(unittest.TestCase):
    def test_a_stop_inside_the_entry_bar_beats_the_target(self):
        """No tick data means no way to know which came first inside a bar.
        Assuming the good one is how a losing strategy shows a profitable
        curve, so the bad one is assumed instead, always."""
        engine = _backtest()
        sig = signal(MORNING, side="long", entry=100.0, stop=90.0, target=110.0)
        trade = Trade(signal=sig, entered_at=MORNING, entry=100.0, contracts=1)
        wide = bar(MORNING, 100, 115, 85, 105)
        self.assertTrue(engine._manage(trade, wide))
        self.assertEqual(trade.reason, "stop")

    def test_the_mirror_for_a_short(self):
        engine = _backtest()
        sig = signal(MORNING, side="short", entry=100.0, stop=110.0, target=90.0)
        trade = Trade(signal=sig, entered_at=MORNING, entry=100.0, contracts=1)
        self.assertTrue(engine._manage(trade, bar(MORNING, 100, 115, 85, 95)))
        self.assertEqual(trade.reason, "stop")

    def test_slippage_is_paid_on_a_stop_and_not_on_a_target(self):
        engine = _backtest()
        sig = signal(MORNING, side="long", entry=100.0, stop=90.0, target=110.0)
        stopped = Trade(signal=sig, entered_at=MORNING, entry=100.0, contracts=1)
        engine._manage(stopped, bar(MORNING, 100, 101, 89, 90))
        self.assertAlmostEqual(stopped.exit, 89.75)  # a tick worse than the stop

        filled = Trade(signal=sig, entered_at=MORNING, entry=100.0, contracts=1)
        engine._manage(filled, bar(MORNING, 100, 111, 99.5, 110))
        self.assertAlmostEqual(filled.exit, 110.0)  # the limit gets its price

    def test_commission_is_charged_per_contract(self):
        engine = _backtest()
        sig = signal(MORNING, side="long", entry=100.0, stop=90.0, target=110.0)
        trade = Trade(signal=sig, entered_at=MORNING, entry=100.0, contracts=3)
        engine._manage(trade, bar(MORNING, 100, 111, 99.5, 110))
        # 10 points, 3 contracts, 2 dollars a point, less 1.20 a contract.
        self.assertAlmostEqual(trade.pnl, 10 * 3 * 2.0 - 3 * 1.20)

    def test_a_position_is_closed_at_the_session_close(self):
        engine = _backtest()
        late = utc(2026, 6, 10, 19, 59)  # 12:59 Pacific, one minute left
        sig = signal(late, side="long", entry=100.0, stop=90.0, target=200.0)
        trade = Trade(signal=sig, entered_at=late, entry=100.0, contracts=1)
        self.assertTrue(engine._manage(trade, bar(late, 100, 101, 99, 100.5)))
        self.assertEqual(trade.reason, "session close")

    def test_a_limit_never_books_the_gap_improvement(self):
        engine = _backtest()
        sig = signal(MORNING, side="long", entry=100.0, stop=90.0, target=110.0, fill_mode="limit")
        gapped = bar(MORNING, 95, 96, 94, 95)  # opened well through the limit
        trade, rest = engine._try_fill(Pending(sig, 8, 1), gapped)
        assert trade is not None
        self.assertIsNone(rest)
        self.assertAlmostEqual(trade.entry, 100.0)

    def test_an_unfilled_limit_expires(self):
        engine = _backtest()
        sig = signal(MORNING, side="long", entry=100.0, stop=90.0, target=110.0, fill_mode="limit")
        pending = Pending(sig, 2, 1)
        away = bar(MORNING, 105, 106, 104, 105)
        trade, pending = engine._try_fill(pending, away)
        self.assertIsNone(trade)
        assert pending is not None
        trade, pending = engine._try_fill(pending, away)
        self.assertIsNone(trade)
        self.assertIsNone(pending)

    def test_a_market_order_pays_slippage_at_the_next_open(self):
        engine = _backtest()
        sig = signal(MORNING, side="long", entry=100.0, stop=90.0, target=110.0, fill_mode="market")
        trade, _ = engine._try_fill(Pending(sig, 8, 1), bar(MORNING, 101, 102, 100, 101))
        assert trade is not None
        self.assertAlmostEqual(trade.entry, 101.25)


class TestFullRun(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.bars = resample(generate(days=45, seed=3), 5)
        cls.result = _backtest().run(cls.bars)

    def test_it_trades(self):
        self.assertGreater(len(self.result.trades), 5)

    def test_no_trade_is_entered_on_the_bar_that_produced_its_signal(self):
        """The lookahead test. A signal is computed on the close of a bar and
        the order cannot be active until the next one."""
        for trade in self.result.trades:
            self.assertGreater(trade.entered_at, trade.signal.ts, trade.as_dict())

    def test_exits_never_precede_entries(self):
        for trade in self.result.trades:
            assert trade.exit_at is not None
            self.assertGreaterEqual(trade.exit_at, trade.entered_at)

    def test_only_one_position_at_a_time(self):
        ordered = sorted(self.result.trades, key=lambda trade: trade.entered_at)
        for earlier, later in zip(ordered, ordered[1:]):
            assert earlier.exit_at is not None
            self.assertGreaterEqual(later.entered_at, earlier.exit_at)

    def test_position_size_never_exceeds_the_contract_cap(self):
        cap = PropFirmRules().max_contracts
        for trade in self.result.trades:
            self.assertLessEqual(trade.contracts, cap)

    def test_stats_are_internally_consistent(self):
        stats = self.result.stats()
        self.assertEqual(stats["trades"], stats["wins"] + stats["losses"])
        self.assertEqual(stats["trades"], stats["longs"] + stats["shorts"])

    def test_the_run_is_reproducible(self):
        again = _backtest().run(self.bars)
        self.assertEqual(self.result.stats(), again.stats())

    def test_no_model_calls_without_a_key(self):
        self.assertEqual(self.result.llm_calls, 0)


class TestRiskStopsTheRun(unittest.TestCase):
    def test_a_punishing_drawdown_stops_the_system_before_it_breaches(self):
        """The behaviour that matters is not that the engine notices the
        account has failed. It is that it stops sizing trades as the room runs
        out, so the failure does not happen."""
        engine = Backtest(
            StrategyConfig(stop_mode="tighter_of"),
            PLAN,
            PropFirmRules(
                trailing_drawdown=100.0,
                max_daily_loss=100.0,
                drawdown_budget_fraction=1.0,
                daily_budget_fraction=1.0,
                risk_per_trade_pct=1.0,
                max_trades_per_day=99,
                max_consecutive_losses=99,
                stop_after_daily_target=None,
            ),
            Costs(tick_size=0.25, point_value=2.0),
        )
        result = engine.run(resample(generate(days=45, seed=3), 5))
        self.assertFalse(engine.risk.failed)
        self.assertGreaterEqual(result.account["drawdown_room"], 0.0)
        self.assertIn("risk budget below one contract", result.blocked)

    def test_a_failed_account_takes_no_further_trades(self):
        engine = _backtest()
        engine.risk.state.locked_reason = "account_failed"
        result = engine.run(resample(generate(days=45, seed=3), 5))
        self.assertEqual(result.trades, [])
        self.assertIn("account failed", result.blocked)

    def test_blocked_reasons_are_reported(self):
        engine = Backtest(
            StrategyConfig(stop_mode="tighter_of"),
            PLAN,
            PropFirmRules(max_trades_per_day=1),
            Costs(tick_size=0.25, point_value=2.0),
        )
        result = engine.run(resample(generate(days=45, seed=3), 5))
        self.assertIn("max trades for the day", result.blocked)


class TestPaperBroker(unittest.TestCase):
    def test_an_inverted_bracket_is_refused(self):
        broker = PaperBroker()
        with self.assertRaises(ValueError):
            broker.submit(BracketOrder("MNQ", "long", 1, entry=100.0, stop=110.0, target=90.0))
        with self.assertRaises(ValueError):
            broker.submit(BracketOrder("MNQ", "short", 1, entry=100.0, stop=90.0, target=110.0))

    def test_a_bracket_fills_and_then_exits(self):
        broker = PaperBroker(point_value=2.0, commission_per_contract=1.0, slippage_ticks=0.0)
        broker.submit(BracketOrder("MNQ", "long", 2, entry=100.0, stop=90.0, target=110.0))
        broker.on_bar(bar(MORNING, 101, 102, 99, 100))  # trades through the limit
        self.assertEqual(broker.position("MNQ").side, "long")
        broker.on_bar(bar(MORNING + timedelta(minutes=5), 100, 111, 100, 110))
        self.assertIsNone(broker.position("MNQ").side)
        self.assertAlmostEqual(broker.balance, 50_000 + 10 * 2 * 2.0 - 2 * 1.0)

    def test_the_paper_broker_takes_the_stop_when_a_bar_holds_both(self):
        broker = PaperBroker(point_value=2.0, commission_per_contract=0.0, slippage_ticks=0.0)
        broker.submit(BracketOrder("MNQ", "long", 1, entry=None, stop=90.0, target=110.0))
        broker.on_bar(bar(MORNING, 100, 115, 85, 105))
        self.assertLess(broker.balance, 50_000)

    def test_flatten_closes_everything(self):
        broker = PaperBroker(point_value=2.0, slippage_ticks=0.0)
        broker.submit(BracketOrder("MNQ", "long", 1, entry=None, stop=90.0, target=110.0))
        broker.on_bar(bar(MORNING, 100, 101, 99, 100))
        broker.flatten("MNQ")
        self.assertIsNone(broker.position("MNQ").side)


if __name__ == "__main__":
    unittest.main()
