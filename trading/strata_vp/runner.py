"""The loop that watches the market and hands out tickets.

No broker, no orders. It reads closed bars, asks the strategy, sizes the trade
against the account rules, and sends the ticket wherever the notifier points.
The person places it.

That is a smaller job than a live trading loop but the same three things still
have to be right, and they are the three that go wrong at 06:31 in the morning:

  Only closed bars. A forming bar's high and low move, so a signal computed on
  one can appear and disappear several times before it closes. The loop keeps
  the last timestamp it has processed and ignores anything not strictly newer.

  Warmup before signalling. The reference profile needs the whole previous
  session. A loop that starts flat at the open and builds the reference from
  what it has seen so far is trading against twenty minutes of data wearing a
  profile's clothes. It refuses to signal until it has the history.

  The account is still tracked. There is no position to manage, but the daily
  loss limit, the trailing drawdown and the trade count all still bind, and a
  ticket the account cannot take should not be sent. Fills have to be reported
  back with `record_fill` for that to stay honest, since nothing else can see
  what was actually done.
"""

from __future__ import annotations

import logging
import time
from dataclasses import dataclass, field
from datetime import datetime, timezone
from typing import Callable, Protocol, Sequence

from .bars import Bar
from .instruments import Instrument
from .notify import Notifier, Ticket
from .risk import RiskManager
from .signals import Signal, Strategy

log = logging.getLogger("strata_vp.runner")


class BarSource(Protocol):
    """Closed bars, oldest first. Where they come from is not this module's
    problem: a broker feed, a vendor API, a file being appended to, or a
    replay. The strategy only requires that they are closed and in order."""

    def __call__(self, count: int) -> Sequence[Bar]: ...


@dataclass
class SignalRunner:
    strategy: Strategy
    risk: RiskManager
    notifier: Notifier
    instrument: Instrument
    fetch_bars: BarSource
    warmup_bars: int = 1500
    poll_seconds: float = 5.0
    _last_bar_ts: datetime | None = field(default=None, init=False)
    warmed_up: bool = field(default=False, init=False)
    suppressed: dict[str, int] = field(default_factory=dict, init=False)

    def warmup(self) -> int:
        """Replay history so the reference profile is real before the first
        signal. Anything produced during the replay is discarded: those are
        yesterday's setups and sending them would be noise at best."""
        history = list(self.fetch_bars(self.warmup_bars))
        for bar in history:
            self.strategy.on_bar(bar)
            self._last_bar_ts = bar.ts
        self.warmed_up = True
        log.info("warmed up on %d bars, last %s", len(history), self._last_bar_ts)
        return len(history)

    def run_forever(self, *, should_stop: Callable[[], bool] | None = None) -> None:
        if not self.warmed_up:
            self.warmup()
        while not (should_stop and should_stop()):
            try:
                self.step()
            except Exception:  # noqa: BLE001 - a loop that dies misses the day
                log.exception("cycle failed, continuing")
            time.sleep(self.poll_seconds)

    def step(self, now: datetime | None = None) -> list[Ticket]:
        """One poll. Returns the tickets sent, which is normally none."""
        if not self.warmed_up:
            self.warmup()
        recent = self.fetch_bars(5)
        fresh = [
            bar for bar in recent if self._last_bar_ts is None or bar.ts > self._last_bar_ts
        ]
        sent: list[Ticket] = []
        for bar in fresh:
            self._last_bar_ts = bar.ts
            signal = self.strategy.on_bar(bar)
            if signal is None:
                continue
            ticket = self.ticket_for(signal, now or bar.ts)
            if ticket is not None and self.notifier.emit(ticket):
                sent.append(ticket)
        return sent

    def ticket_for(self, signal: Signal, at: datetime) -> Ticket | None:
        decision = self.risk.evaluate(at, signal.risk_points, self.instrument.point_value)
        if not decision.allowed:
            self.suppressed[decision.reason] = self.suppressed.get(decision.reason, 0) + 1
            log.info("signal suppressed: %s", decision.reason)
            return None
        return Ticket(signal=signal, instrument=self.instrument, contracts=decision.contracts)

    def record_fill(self, pnl: float, at: datetime | None = None) -> None:
        """Tell the runner what actually happened.

        Nothing here can see the account, so the daily loss limit and the
        trailing drawdown are only as accurate as what gets reported back. A
        runner that is never told about a loss will keep sizing as though the
        day is flat, which is the one way this module can do damage."""
        self.risk.record(pnl, at or datetime.now(timezone.utc))

    def status(self) -> dict[str, object]:
        return {
            "warmed_up": self.warmed_up,
            "last_bar": self._last_bar_ts.isoformat() if self._last_bar_ts else None,
            "in_session": self.strategy.in_session,
            "armed": sorted(self.strategy.armed),
            "reference": (
                self.strategy.reference.as_dict() if self.strategy.reference else None
            ),
            "sent": self.notifier.delivered,
            "suppressed": dict(self.suppressed),
            "account": self.risk.summary(),
        }


def replay(
    bars: Sequence[Bar],
    strategy: Strategy,
    risk: RiskManager,
    notifier: Notifier,
    instrument: Instrument,
) -> list[Ticket]:
    """Run the strategy over a file and emit every ticket it would have sent.

    This is how the signal side gets checked without a live feed: export bars
    from the chart, replay them, and compare the tickets against what the
    chart shows. It shares the sizing and the account rules with the live path
    so the two cannot drift.
    """
    runner = SignalRunner(
        strategy=strategy,
        risk=risk,
        notifier=notifier,
        instrument=instrument,
        fetch_bars=lambda count: [],
    )
    runner.warmed_up = True
    sent: list[Ticket] = []
    for bar in bars:
        signal = strategy.on_bar(bar)
        if signal is None:
            continue
        ticket = runner.ticket_for(signal, bar.ts)
        if ticket is not None and notifier.emit(ticket):
            sent.append(ticket)
    return sent
