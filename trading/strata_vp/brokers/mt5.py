"""MetaTrader 5 adapter: the free execution path.

Why this one. Every other route to a funded account either costs money or
cannot be automated at all:

  TradingView cannot send a webhook on the free plan. Alerts that call a URL
  are a paid feature, so TradingView can be the chart and the research tool
  but it cannot be the trigger without a subscription.

  Rithmic and CQG require an API licence and, at most firms, approval.

  Tradovate's API is available but several firms gate it behind an add on.

  ProjectX, which several futures firms now bundle, has a REST and websocket
  API included with the account at no extra cost. It is the better option if
  your firm is on it, and it is a straight port of this file's interface.

  MetaTrader 5 ships a Python package that is free, official, and talks to a
  terminal you are already allowed to run. Almost every forex and CFD prop
  firm supports it. That makes it the default here.

Two constraints worth knowing before building on it. The package is Windows
only, because it attaches to a running MT5 terminal process. And the terminal
must have algorithmic trading enabled in its own settings, which some firms
disable on their servers, so check before paying an evaluation fee.

This file is written against the documented API and is not exercised by the
test suite in this repository, because there is no terminal to attach to here.
Run it against a demo account before a funded one.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from datetime import datetime, timezone
from typing import Any

from .base import Broker, BracketOrder, Position, Side


def _import_mt5() -> Any:
    try:
        import MetaTrader5  # type: ignore[import-not-found]
    except ImportError as error:  # pragma: no cover
        raise RuntimeError(
            "MetaTrader5 is not installed. It is Windows only: pip install MetaTrader5, "
            "then start the terminal and enable algorithmic trading."
        ) from error
    return MetaTrader5


@dataclass
class MT5Broker(Broker):
    symbol_map: dict[str, str] = field(default_factory=dict)
    magic: int = 20260816
    deviation_points: int = 10
    _mt5: Any = field(default=None, init=False)

    def connect(self, *, login: int | None = None, password: str | None = None, server: str | None = None) -> None:
        mt5 = _import_mt5()
        ok = mt5.initialize() if login is None else mt5.initialize(login=login, password=password, server=server)
        if not ok:
            raise RuntimeError(f"MT5 initialize failed: {mt5.last_error()}")
        self._mt5 = mt5

    def shutdown(self) -> None:
        if self._mt5 is not None:
            self._mt5.shutdown()
            self._mt5 = None

    def _require(self) -> Any:
        if self._mt5 is None:
            raise RuntimeError("call connect() first")
        return self._mt5

    def _symbol(self, symbol: str) -> str:
        return self.symbol_map.get(symbol, symbol)

    def position(self, symbol: str) -> Position:
        mt5 = self._require()
        name = self._symbol(symbol)
        positions = mt5.positions_get(symbol=name) or ()
        net = 0
        weighted = 0.0
        unrealised = 0.0
        for entry in positions:
            signed = entry.volume if entry.type == mt5.POSITION_TYPE_BUY else -entry.volume
            net += signed
            weighted += entry.price_open * signed
            unrealised += entry.profit
        if net == 0:
            return Position(symbol, None, 0, 0.0, unrealised)
        side: Side = "long" if net > 0 else "short"
        return Position(symbol, side, int(abs(net)), weighted / net, unrealised)

    def submit(self, order: BracketOrder) -> str:
        """One request carrying entry, stop loss and take profit.

        MT5 attaches sl and tp to the position itself rather than as separate
        orders, which is the behaviour we want: the protective stop exists at
        the server the instant the entry fills, with no second round trip that
        could fail.
        """
        mt5 = self._require()
        name = self._symbol(order.symbol)
        info = mt5.symbol_info(name)
        if info is None:
            raise RuntimeError(f"unknown symbol {name}")
        if not info.visible:
            mt5.symbol_select(name, True)

        long = order.side == "long"
        if order.entry is None:
            action = mt5.TRADE_ACTION_DEAL
            order_type = mt5.ORDER_TYPE_BUY if long else mt5.ORDER_TYPE_SELL
            tick = mt5.symbol_info_tick(name)
            price = tick.ask if long else tick.bid
        else:
            action = mt5.TRADE_ACTION_PENDING
            order_type = mt5.ORDER_TYPE_BUY_LIMIT if long else mt5.ORDER_TYPE_SELL_LIMIT
            price = order.entry

        request = {
            "action": action,
            "symbol": name,
            "volume": float(order.contracts),
            "type": order_type,
            "price": price,
            "sl": order.stop,
            "tp": order.target,
            "deviation": self.deviation_points,
            "magic": self.magic,
            "comment": order.tag[:31],
            "type_time": mt5.ORDER_TIME_DAY,
            "type_filling": mt5.ORDER_FILLING_IOC,
        }
        result = mt5.order_send(request)
        if result is None or result.retcode != mt5.TRADE_RETCODE_DONE:
            raise RuntimeError(f"order rejected: {result.comment if result else mt5.last_error()}")
        return str(result.order)

    def cancel(self, order_id: str) -> None:
        mt5 = self._require()
        result = mt5.order_send({"action": mt5.TRADE_ACTION_REMOVE, "order": int(order_id)})
        if result is not None and result.retcode not in (
            mt5.TRADE_RETCODE_DONE,
            mt5.TRADE_RETCODE_INVALID_ORDER,
        ):
            raise RuntimeError(f"cancel rejected: {result.comment}")

    def flatten(self, symbol: str) -> None:
        """Reads the position from the server rather than from anything this
        object believes, which is the point of the method."""
        mt5 = self._require()
        name = self._symbol(symbol)
        for order in mt5.orders_get(symbol=name) or ():
            mt5.order_send({"action": mt5.TRADE_ACTION_REMOVE, "order": order.ticket})
        for entry in mt5.positions_get(symbol=name) or ():
            closing = mt5.ORDER_TYPE_SELL if entry.type == mt5.POSITION_TYPE_BUY else mt5.ORDER_TYPE_BUY
            tick = mt5.symbol_info_tick(name)
            price = tick.bid if closing == mt5.ORDER_TYPE_SELL else tick.ask
            mt5.order_send(
                {
                    "action": mt5.TRADE_ACTION_DEAL,
                    "symbol": name,
                    "volume": entry.volume,
                    "type": closing,
                    "position": entry.ticket,
                    "price": price,
                    "deviation": self.deviation_points,
                    "magic": self.magic,
                    "comment": "flatten",
                    "type_filling": mt5.ORDER_FILLING_IOC,
                }
            )

    def bars(self, symbol: str, minutes: int, count: int) -> list:
        """Recent closed bars, newest last, as strata_vp Bar objects."""
        from ..bars import Bar

        mt5 = self._require()
        timeframes = {1: mt5.TIMEFRAME_M1, 5: mt5.TIMEFRAME_M5, 15: mt5.TIMEFRAME_M15}
        if minutes not in timeframes:
            raise ValueError(f"unsupported timeframe {minutes}")
        rows = mt5.copy_rates_from_pos(self._symbol(symbol), timeframes[minutes], 0, count)
        if rows is None:
            raise RuntimeError(f"no data for {symbol}: {mt5.last_error()}")
        out = []
        for row in rows:
            out.append(
                Bar(
                    ts=datetime.fromtimestamp(int(row["time"]), tz=timezone.utc),
                    open=float(row["open"]),
                    high=float(row["high"]),
                    low=float(row["low"]),
                    close=float(row["close"]),
                    # tick_volume is the only volume most retail feeds carry.
                    # It correlates well enough with traded volume for a
                    # profile, but it is not the same number, and a profile
                    # built from it will not match a CME volume profile.
                    volume=float(row["real_volume"] or row["tick_volume"]),
                )
            )
        return out[:-1]  # drop the forming bar
