"""Getting a signal in front of a person, because a person places the order.

There is no execution layer in this system and that is not a gap waiting to be
filled. Tradovate gates API access behind an add on and the firm decides
separately on top of that, so the account this runs for cannot place an
automated order at all. The system's output is therefore a trade ticket: side,
limit price, stop, two targets and a size, with enough context to see why, in a
form that can be typed into a DOM in fifteen seconds.

Two rules the sinks follow, both learned the boring way:

  A sink that fails must not stop the others or kill the run. A Discord
  outage is not a reason to lose the signal that was already computed, and it
  is certainly not a reason for the process watching the market to exit.

  The same signal is never sent twice. A restart, a replayed bar, or a
  reconnect that re-delivers the last few bars would otherwise fire the same
  alert again, and an alert you have learned to ignore is worse than none.
"""

from __future__ import annotations

import json
import logging
import urllib.error
import urllib.request
from dataclasses import dataclass, field
from datetime import datetime
from typing import Iterable, Protocol
from zoneinfo import ZoneInfo

from .instruments import Instrument
from .sessions import PACIFIC
from .signals import Signal

log = logging.getLogger("strata_vp.notify")


@dataclass(frozen=True, slots=True)
class Ticket:
    """Everything needed to place the trade by hand, and nothing else."""

    signal: Signal
    instrument: Instrument
    contracts: int
    tz: ZoneInfo = PACIFIC

    @property
    def key(self) -> str:
        return f"{self.signal.ts.isoformat()}|{self.signal.side}|{self.signal.entry}"

    @property
    def risk_dollars(self) -> float:
        return self.signal.risk_points * self.instrument.point_value * self.contracts

    @property
    def local_time(self) -> datetime:
        return self.signal.ts.astimezone(self.tz)

    def as_dict(self) -> dict[str, object]:
        signal = self.signal
        return {
            "time": signal.ts.isoformat(),
            "local": self.local_time.strftime("%Y-%m-%d %H:%M %Z"),
            "symbol": self.instrument.symbol,
            "side": signal.side,
            "contracts": self.contracts,
            "entry": signal.entry,
            "stop": signal.stop,
            "target": signal.target,
            "runner": signal.runner_target,
            "partial_fraction": signal.partial_fraction,
            "risk_points": round(signal.risk_points, 2),
            "risk_dollars": round(self.risk_dollars, 2),
            "reward_risk": round(signal.reward_risk, 2),
            "zone": signal.zone_name,
            "zone_price": round(signal.zone_price, 2),
            "regime": signal.verdict.regime,
            "verdict_source": signal.verdict.source,
            "rationale": signal.verdict.rationale,
            "reference": signal.reference.as_dict(),
            "fvg": signal.fvg.as_dict() if signal.fvg else None,
        }


def render_text(ticket: Ticket) -> str:
    """A ticket as a person reads it. Prices first, reasoning last, because at
    06:47 the only lines that matter are the ones being typed in."""
    signal = ticket.signal
    instrument = ticket.instrument
    arrow = "LONG" if signal.side == "long" else "SHORT"
    lines = [
        f"{arrow} {instrument.symbol} x{ticket.contracts}"
        f"   {ticket.local_time.strftime('%H:%M')} PT",
        f"  limit   {signal.entry:>10.2f}   (midpoint of the gap)",
        f"  stop    {signal.stop:>10.2f}   {signal.risk_points:.2f} pt"
        f"   ${ticket.risk_dollars:.0f}",
        f"  target  {signal.target:>10.2f}   point of control",
    ]
    if signal.runner_target is not None:
        share = int(round(signal.partial_fraction * 100))
        lines.append(
            f"  runner  {signal.runner_target:>10.2f}   "
            f"{share}% off at the target, stop to breakeven, rest here"
        )
    lines.append(f"  R:R     {signal.reward_risk:>10.2f}")
    reference = signal.reference
    lines.append(
        f"  levels  VAL {reference.val:.2f}  POC {reference.poc:.2f}  VAH {reference.vah:.2f}"
    )
    lines.append(f"  why     swept {signal.zone_name.replace('_', ' ')}, "
                 f"reclaimed, {signal.verdict.regime.replace('_', ' ')}")
    return "\n".join(lines)


class Sink(Protocol):
    def emit(self, ticket: Ticket) -> None: ...


@dataclass
class ConsoleSink:
    stream: object = None

    def emit(self, ticket: Ticket) -> None:
        text = render_text(ticket)
        if self.stream is None:
            print(text, flush=True)
        else:
            self.stream.write(text + "\n")
            flush = getattr(self.stream, "flush", None)
            if flush:
                flush()


@dataclass
class JsonlSink:
    """Append only, one JSON object per line, flushed per signal.

    This is the record. Every review of what the system did, and every
    comparison against what the backtest said it would do, reads this file, so
    it is written before anything that can fail over a network."""

    path: str

    def emit(self, ticket: Ticket) -> None:
        with open(self.path, "a", encoding="utf-8") as handle:
            handle.write(json.dumps(ticket.as_dict()) + "\n")


@dataclass
class WebhookSink:
    """Discord or Slack. Both take a JSON body with a text field on a URL you
    paste in, both are free, and neither needs an account key in the code."""

    url: str
    style: str = "discord"
    timeout_s: float = 8.0

    def emit(self, ticket: Ticket) -> None:
        text = render_text(ticket)
        if self.style == "discord":
            body = {"content": f"```\n{text}\n```"}
        elif self.style == "slack":
            body = {"text": f"```\n{text}\n```"}
        else:
            body = ticket.as_dict()
        _post_json(self.url, body, self.timeout_s)


@dataclass
class TelegramSink:
    token: str
    chat_id: str
    timeout_s: float = 8.0

    def emit(self, ticket: Ticket) -> None:
        _post_json(
            f"https://api.telegram.org/bot{self.token}/sendMessage",
            {
                "chat_id": self.chat_id,
                "text": f"<pre>{render_text(ticket)}</pre>",
                "parse_mode": "HTML",
            },
            self.timeout_s,
        )


def _post_json(url: str, body: dict, timeout_s: float) -> None:
    request = urllib.request.Request(
        url,
        data=json.dumps(body).encode("utf-8"),
        headers={"Content-Type": "application/json"},
        method="POST",
    )
    with urllib.request.urlopen(request, timeout=timeout_s) as response:
        response.read()


@dataclass
class Notifier:
    sinks: list[Sink] = field(default_factory=list)
    _seen: set[str] = field(default_factory=set, init=False)
    delivered: int = field(default=0, init=False)
    duplicates: int = field(default=0, init=False)
    failures: int = field(default=0, init=False)

    def emit(self, ticket: Ticket) -> bool:
        """False if this signal was already sent. Failures in one sink are
        logged and do not reach the others or the caller: the loop watching the
        market must not die because a webhook did."""
        if ticket.key in self._seen:
            self.duplicates += 1
            return False
        self._seen.add(ticket.key)
        for sink in self.sinks:
            try:
                sink.emit(ticket)
            except (urllib.error.URLError, TimeoutError, OSError, ValueError):
                self.failures += 1
                log.exception("sink %s failed", type(sink).__name__)
        self.delivered += 1
        return True

    def emit_all(self, tickets: Iterable[Ticket]) -> int:
        return sum(1 for ticket in tickets if self.emit(ticket))
