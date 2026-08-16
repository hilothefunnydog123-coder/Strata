"""A paper broker that fills against the bar stream.

Used two ways. As a dry run target for live.py, so the full live path including
order construction and the flatten timer can be exercised without money. And
as an assertion of the Broker contract, since a test can drive it deterministic
bar by bar and check that a bracket really is atomic.

The fill model is the same pessimistic one the backtest uses, and the two are
tested against each other, because a paper result that disagrees with the
backtest means one of them is lying and you want to know which before the
account is funded.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from datetime import datetime

from ..bars import Bar
from .base import Broker, BracketOrder, Fill, Position, Side


@dataclass
class _Working:
    order: BracketOrder
    order_id: str
    filled: bool = False
    entry_price: float = 0.0


@dataclass
class PaperBroker(Broker):
    tick_size: float = 0.25
    point_value: float = 20.0
    slippage_ticks: float = 1.0
    commission_per_contract: float = 2.50
    balance: float = 50_000.0
    fills: list[Fill] = field(default_factory=list)
    closed_pnl: list[tuple[datetime, float, str]] = field(default_factory=list)
    _orders: dict[str, _Working] = field(default_factory=dict)
    _next_id: int = 1
    _last_price: float = 0.0

    @property
    def _slip(self) -> float:
        return self.slippage_ticks * self.tick_size

    def position(self, symbol: str) -> Position:
        for working in self._orders.values():
            if working.filled and working.order.symbol == symbol:
                order = working.order
                sign = 1 if order.side == "long" else -1
                unrealised = (
                    (self._last_price - working.entry_price)
                    * sign
                    * order.contracts
                    * self.point_value
                )
                return Position(symbol, order.side, order.contracts, working.entry_price, unrealised)
        return Position(symbol, None, 0, 0.0, 0.0)

    def submit(self, order: BracketOrder) -> str:
        if order.stop == order.target:
            raise ValueError("bracket with equal stop and target")
        if order.side == "long" and not order.stop < order.target:
            raise ValueError("long bracket needs stop below target")
        if order.side == "short" and not order.stop > order.target:
            raise ValueError("short bracket needs stop above target")
        order_id = f"paper-{self._next_id}"
        self._next_id += 1
        self._orders[order_id] = _Working(order=order, order_id=order_id)
        return order_id

    def cancel(self, order_id: str) -> None:
        working = self._orders.get(order_id)
        if working is not None and not working.filled:
            del self._orders[order_id]

    def flatten(self, symbol: str) -> None:
        for order_id in list(self._orders):
            working = self._orders[order_id]
            if working.order.symbol != symbol:
                continue
            if working.filled:
                self._book(working, self._last_price, datetime.now().astimezone(), "flatten")
            del self._orders[order_id]

    def on_bar(self, bar: Bar) -> None:
        """Advance the clock. Entries fill first, then exits, and when a bar
        contains both the stop and the target the stop wins."""
        self._last_price = bar.close
        for order_id in list(self._orders):
            working = self._orders.get(order_id)
            if working is None:
                continue
            order = working.order
            long = order.side == "long"

            if not working.filled:
                if order.entry is None:
                    working.entry_price = bar.open + self._slip if long else bar.open - self._slip
                    working.filled = True
                elif (long and bar.low <= order.entry) or (not long and bar.high >= order.entry):
                    working.entry_price = order.entry
                    working.filled = True
                if working.filled:
                    self.fills.append(
                        Fill(order.tag, order.symbol, order.side, order.contracts, working.entry_price, bar.ts)
                    )
                else:
                    continue

            hit_stop = bar.low <= order.stop if long else bar.high >= order.stop
            hit_target = bar.high >= order.target if long else bar.low <= order.target
            if hit_stop:
                price = order.stop - self._slip if long else order.stop + self._slip
                self._book(working, price, bar.ts, "stop")
                del self._orders[order_id]
            elif hit_target:
                self._book(working, order.target, bar.ts, "target")
                del self._orders[order_id]

    def _book(self, working: _Working, price: float, at: datetime, reason: str) -> None:
        order = working.order
        sign = 1 if order.side == "long" else -1
        points = (price - working.entry_price) * sign
        pnl = points * order.contracts * self.point_value
        pnl -= order.contracts * self.commission_per_contract
        self.balance += pnl
        self.closed_pnl.append((at, pnl, reason))
