from __future__ import annotations

import json
import logging
import tempfile
import unittest
import urllib.error
from pathlib import Path

from strata_vp import PLANS, PropFirmRules, RiskManager, Strategy, StrategyConfig, resample
from strata_vp.instruments import MNQ
from strata_vp.notify import (
    ConsoleSink,
    JsonlSink,
    Notifier,
    Ticket,
    WebhookSink,
    render_text,
)
from strata_vp.runner import SignalRunner, replay
from tools.synth_data import generate
from tests.helpers import signal, utc

# The notifier logs a traceback for every sink failure, which is correct in
# production and noise in a test that causes them on purpose.
logging.getLogger("strata_vp.notify").setLevel(logging.CRITICAL)

PLAN = PLANS["ny_vs_brief"]
MORNING = utc(2026, 6, 10, 15)  # 08:00 Pacific


def _ticket(contracts: int = 2) -> Ticket:
    return Ticket(
        signal=signal(MORNING, side="long", entry=20000.0, stop=19985.0, target=20030.0),
        instrument=MNQ,
        contracts=contracts,
    )


class Recording:
    def __init__(self) -> None:
        self.tickets: list[Ticket] = []

    def emit(self, ticket: Ticket) -> None:
        self.tickets.append(ticket)


class Exploding:
    def emit(self, ticket: Ticket) -> None:
        raise urllib.error.URLError("no network")


class TestTicket(unittest.TestCase):
    def test_risk_is_reported_in_dollars_for_the_instrument(self):
        ticket = _ticket(contracts=3)
        # 15 points, three micros at two dollars a point.
        self.assertAlmostEqual(ticket.risk_dollars, 15.0 * 2.0 * 3)

    def test_the_time_is_shown_in_the_trading_timezone(self):
        self.assertEqual(_ticket().local_time.strftime("%H:%M"), "08:00")

    def test_the_text_carries_every_price_needed_to_place_it(self):
        text = render_text(_ticket())
        for expected in ("LONG", "MNQ", "20000.00", "19985.00", "20030.00", "R:R"):
            self.assertIn(expected, text)

    def test_the_json_round_trips(self):
        payload = json.loads(json.dumps(_ticket().as_dict()))
        self.assertEqual(payload["side"], "long")
        self.assertEqual(payload["symbol"], "MNQ")
        self.assertEqual(payload["contracts"], 2)
        self.assertIn("reference", payload)


class TestNotifier(unittest.TestCase):
    def test_a_signal_is_never_sent_twice(self):
        """A restart or a reconnect that redelivers the last few bars would
        otherwise fire the same alert again, and an alert you have learned to
        ignore is worse than no alert."""
        sink = Recording()
        notifier = Notifier([sink])
        self.assertTrue(notifier.emit(_ticket()))
        self.assertFalse(notifier.emit(_ticket()))
        self.assertEqual(len(sink.tickets), 1)
        self.assertEqual(notifier.duplicates, 1)

    def test_one_sink_failing_does_not_stop_the_others(self):
        good = Recording()
        notifier = Notifier([Exploding(), good, Exploding()])
        self.assertTrue(notifier.emit(_ticket()))
        self.assertEqual(len(good.tickets), 1)
        self.assertEqual(notifier.failures, 2)
        self.assertEqual(notifier.delivered, 1)

    def test_a_failing_sink_never_raises_at_the_caller(self):
        notifier = Notifier([Exploding()])
        self.assertTrue(notifier.emit(_ticket()))  # must not raise

    def test_the_jsonl_sink_appends_one_object_per_line(self):
        with tempfile.TemporaryDirectory() as folder:
            path = Path(folder) / "signals.jsonl"
            notifier = Notifier([JsonlSink(str(path))])
            notifier.emit(_ticket())
            notifier.emit(
                Ticket(
                    signal=signal(utc(2026, 6, 10, 16), side="short", entry=20050.0,
                                  stop=20065.0, target=20020.0),
                    instrument=MNQ,
                    contracts=1,
                )
            )
            lines = path.read_text(encoding="utf-8").strip().split("\n")
            self.assertEqual(len(lines), 2)
            self.assertEqual(json.loads(lines[0])["side"], "long")
            self.assertEqual(json.loads(lines[1])["side"], "short")

    def test_the_console_sink_writes_the_rendered_ticket(self):
        import io

        buffer = io.StringIO()
        ConsoleSink(buffer).emit(_ticket())
        self.assertIn("LONG MNQ", buffer.getvalue())

    def test_the_discord_body_wraps_the_ticket_in_a_code_block(self):
        captured: dict = {}

        sink = WebhookSink("https://example.invalid/hook")
        original = sink.emit

        def fake_post(url, body, timeout):
            captured["url"] = url
            captured["body"] = body

        import strata_vp.notify as notify

        real = notify._post_json
        notify._post_json = fake_post
        try:
            original(_ticket())
        finally:
            notify._post_json = real
        self.assertEqual(captured["url"], "https://example.invalid/hook")
        self.assertTrue(captured["body"]["content"].startswith("```"))
        self.assertIn("LONG MNQ", captured["body"]["content"])


class TestReplay(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.bars = resample(generate(days=20, seed=3), 5)

    def _replay(self, **overrides):
        config = StrategyConfig(
            tick_size=MNQ.tick_size, point_value=MNQ.point_value, bin_size=MNQ.bin_size,
            **overrides,
        )
        sink = Recording()
        tickets = replay(
            self.bars,
            Strategy(config, PLAN),
            RiskManager(PropFirmRules()),
            Notifier([sink]),
            MNQ,
        )
        return tickets, sink

    def test_a_replay_produces_tickets(self):
        tickets, sink = self._replay()
        self.assertGreater(len(tickets), 3)
        self.assertEqual(len(sink.tickets), len(tickets))

    def test_every_ticket_is_sized_within_the_contract_cap(self):
        tickets, _ = self._replay()
        cap = PropFirmRules().max_contracts
        for ticket in tickets:
            self.assertGreaterEqual(ticket.contracts, 1)
            self.assertLessEqual(ticket.contracts, cap)

    def test_every_ticket_is_placeable(self):
        """Prices in the right order, on the tick, with a target beyond the
        entry. A ticket that cannot be typed into a DOM is not a signal."""
        tickets, _ = self._replay()
        for ticket in tickets:
            produced = ticket.signal
            if produced.side == "long":
                self.assertLess(produced.stop, produced.entry)
                self.assertGreater(produced.target, produced.entry)
                if produced.runner_target is not None:
                    self.assertGreater(produced.runner_target, produced.target)
            else:
                self.assertGreater(produced.stop, produced.entry)
                self.assertLess(produced.target, produced.entry)
                if produced.runner_target is not None:
                    self.assertLess(produced.runner_target, produced.target)
            for price in (produced.entry, produced.stop, produced.target):
                self.assertAlmostEqual(price / MNQ.tick_size, round(price / MNQ.tick_size), 6)

    def test_the_entry_is_the_middle_of_the_gap(self):
        tickets, _ = self._replay()
        for ticket in tickets:
            gap = ticket.signal.fvg
            assert gap is not None
            self.assertAlmostEqual(ticket.signal.entry, gap.midpoint, delta=MNQ.tick_size)

    def test_the_stop_sits_ten_points_past_the_gap(self):
        tickets, _ = self._replay(gap_stop_buffer_points=10.0)
        for ticket in tickets:
            gap = ticket.signal.fvg
            assert gap is not None
            expected = gap.distal - 10.0 if ticket.signal.side == "long" else gap.distal + 10.0
            self.assertAlmostEqual(ticket.signal.stop, expected, delta=MNQ.tick_size)


class TestRunner(unittest.TestCase):
    def _runner(self, bars):
        config = StrategyConfig(
            tick_size=MNQ.tick_size, point_value=MNQ.point_value, bin_size=MNQ.bin_size
        )
        served: list[list] = [list(bars)]

        def source(count: int):
            return served[0][-count:] if count else []

        sink = Recording()
        runner = SignalRunner(
            strategy=Strategy(config, PLAN),
            risk=RiskManager(PropFirmRules()),
            notifier=Notifier([sink]),
            instrument=MNQ,
            fetch_bars=source,
        )
        return runner, served, sink

    def test_warmup_replays_history_without_sending_anything(self):
        """Those are yesterday's setups. Sending them on startup is noise at
        best and a trade at a level that no longer exists at worst."""
        bars = resample(generate(days=8, seed=3), 5)
        runner, _served, sink = self._runner(bars)
        replayed = runner.warmup()
        self.assertEqual(replayed, min(runner.warmup_bars, len(bars)))
        self.assertGreater(replayed, 0)
        self.assertEqual(sink.tickets, [])
        self.assertTrue(runner.warmed_up)

    def test_a_bar_already_seen_is_ignored(self):
        bars = resample(generate(days=8, seed=3), 5)
        runner, served, _sink = self._runner(bars)
        runner.warmup()
        self.assertEqual(runner.step(), [])  # the source returns the same bars
        self.assertEqual(runner.step(), [])

    def test_the_account_still_gates_signals(self):
        bars = resample(generate(days=20, seed=3), 5)
        runner, _served, _sink = self._runner(bars)
        runner.risk.state.locked_reason = "account_failed"
        runner.warmup()
        produced = signal(MORNING, side="long", entry=20000.0, stop=19985.0, target=20030.0)
        self.assertIsNone(runner.ticket_for(produced, MORNING))
        self.assertIn("account failed", runner.suppressed)

    def test_status_reports_enough_to_debug_a_quiet_morning(self):
        bars = resample(generate(days=8, seed=3), 5)
        runner, _served, _sink = self._runner(bars)
        runner.warmup()
        status = runner.status()
        for key in ("warmed_up", "last_bar", "in_session", "armed", "sent", "account"):
            self.assertIn(key, status)


if __name__ == "__main__":
    unittest.main()
