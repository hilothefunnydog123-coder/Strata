"""The live loop.

Deliberately boring. Every decision was already made in signals.py and risk.py,
and this file's only jobs are to poll for closed bars, hand them over, and turn
a Signal into a bracket order.

The parts that are not boring, and are the parts that fail at 6:31 in the
morning:

  Only closed bars. A forming bar's high and low move, so a signal computed on
  one can appear and disappear several times before the bar closes. The loop
  tracks the last timestamp it has processed and ignores anything not strictly
  newer.

  Warmup before trading. The reference profile needs the whole previous
  session, so the loop loads history before the first live bar and refuses to
  trade until it has it. A system that starts flat at the open and builds the
  reference from what it has seen so far will trade against a profile made of
  twenty minutes of data.

  The flatten timer is not a signal. It runs off the wall clock, independently
  of whether any bar arrived, because the failure that matters is the feed
  going quiet while a position is open.

  Reconcile from the broker. `position()` is the truth. Local belief about
  what is open is only ever a cache, and it is re checked every cycle.
"""

from __future__ import annotations

import logging
import time
from dataclasses import dataclass, field
from datetime import datetime, timezone
from typing import Callable, Protocol, Sequence

from .bars import Bar
from .brokers.base import Broker, BracketOrder
from .gemini import GeminiJudge
from .risk import PropFirmRules, RiskManager
from .sessions import SessionPlan
from .signals import Signal, Strategy, StrategyConfig

log = logging.getLogger("strata_vp.live")


class BarSource(Protocol):
    def __call__(self, symbol: str, minutes: int, count: int) -> Sequence[Bar]: ...


@dataclass
class LiveTrader:
    symbol: str
    strategy: Strategy
    risk: RiskManager
    broker: Broker
    fetch_bars: BarSource
    timeframe_minutes: int = 5
    warmup_bars: int = 1500
    poll_seconds: float = 5.0
    dry_run: bool = True
    _last_bar_ts: datetime | None = field(default=None, init=False)
    _order_id: str | None = field(default=None, init=False)

    def warmup(self) -> int:
        """Replay history through the strategy so the reference profile and the
        session state are real before the first live decision."""
        history = list(self.fetch_bars(self.symbol, self.timeframe_minutes, self.warmup_bars))
        for bar in history:
            self.strategy.on_bar(bar)
            self._last_bar_ts = bar.ts
        log.info("warmed up on %d bars, last %s", len(history), self._last_bar_ts)
        return len(history)

    def run_forever(self, *, should_stop: Callable[[], bool] | None = None) -> None:
        self.warmup()
        while not (should_stop and should_stop()):
            try:
                self.step()
            except Exception:  # noqa: BLE001 - a loop that dies is worse
                log.exception("cycle failed, flattening and continuing")
                self.panic_flatten()
            time.sleep(self.poll_seconds)

    def step(self, now: datetime | None = None) -> Signal | None:
        now = now or datetime.now(timezone.utc)
        self._enforce_flat_by(now)

        recent = self.fetch_bars(self.symbol, self.timeframe_minutes, 5)
        fresh = [bar for bar in recent if self._last_bar_ts is None or bar.ts > self._last_bar_ts]
        if not fresh:
            return None

        signal: Signal | None = None
        for bar in fresh:
            self._last_bar_ts = bar.ts
            produced = self.strategy.on_bar(bar)
            if produced is not None:
                signal = produced

        position = self.broker.position(self.symbol)
        if position.side is not None:
            self.risk.mark(position.unrealised)
            return None
        if signal is None:
            return None
        if self._order_id is not None:
            # A working entry from a previous bar. One at a time.
            return None

        decision = self.risk.evaluate(signal.ts, signal.risk_points, self.strategy.config.point_value)
        if not decision.allowed:
            log.info("signal suppressed: %s", decision.reason)
            return None

        order = BracketOrder(
            symbol=self.symbol,
            side=signal.side,
            contracts=decision.contracts,
            entry=signal.entry if signal.fill_mode == "limit" else None,
            stop=signal.stop,
            target=signal.target,
            tag=f"vp-{signal.zone_name}-{signal.verdict.regime}",
        )
        if self.dry_run:
            log.info("DRY RUN would submit %s", order)
            return signal
        self._order_id = self.broker.submit(order)
        log.info("submitted %s as %s", order, self._order_id)
        return signal

    def _enforce_flat_by(self, now: datetime) -> None:
        rules = self.risk.rules
        local = now.astimezone(rules.tz)
        if local.time() < rules.flat_by:
            return
        position = self.broker.position(self.symbol)
        if position.side is not None or self._order_id is not None:
            log.warning("flat by %s reached, flattening", rules.flat_by)
            self.panic_flatten()

    def panic_flatten(self) -> None:
        try:
            self.broker.flatten(self.symbol)
        finally:
            self._order_id = None


def build(
    symbol: str,
    plan: SessionPlan,
    config: StrategyConfig,
    rules: PropFirmRules,
    broker: Broker,
    fetch_bars: BarSource,
    *,
    use_gemini: bool = True,
    dry_run: bool = True,
) -> LiveTrader:
    judge = GeminiJudge(enabled=use_gemini or None)
    return LiveTrader(
        symbol=symbol,
        strategy=Strategy(config, plan, judge),
        risk=RiskManager(rules),
        broker=broker,
        fetch_bars=fetch_bars,
        dry_run=dry_run,
    )
