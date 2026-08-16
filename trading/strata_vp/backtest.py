"""Event driven backtest over closed bars.

The parts that decide whether a backtest result means anything:

  No lookahead. A signal is produced on the close of bar i and the order does
  not become active until bar i + 1. A market order fills at that bar's open,
  not at the close of the bar that produced the signal. Getting this wrong is
  the single most common way a losing strategy shows a profitable curve.

  Pessimistic intrabar. When a bar's range contains both the stop and the
  target, the stop is taken. Without tick data there is no way to know the
  order, and assuming the good one turns a coin flip into a fabricated edge.

  Touch is not a fill, except for limits. A limit order is filled when price
  trades through it, which for a resting limit at a price the market visits is
  usually true and occasionally not. Slippage is applied to market and stop
  fills and not to limits, which is the honest version of the same asymmetry.

  Costs on. Commission and slippage default to something like a real futures
  account rather than zero.

The risk manager is inside the loop, not applied afterwards, so a run that
would have blown the account stops there rather than reporting the profit it
would have made if it had been allowed to continue.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from datetime import datetime
from typing import Iterable, Sequence

from .bars import Bar
from .gemini import GeminiJudge
from .risk import PropFirmRules, RiskManager
from .sessions import SessionPlan
from .signals import Signal, Strategy, StrategyConfig


@dataclass(frozen=True, slots=True)
class Costs:
    commission_per_contract: float = 1.20  # round turn on a micro at a prop firm
    slippage_ticks: float = 1.0
    tick_size: float = 0.25
    point_value: float = 2.0  # MNQ; the full size NQ is 20

    def slippage_points(self) -> float:
        return self.slippage_ticks * self.tick_size


@dataclass
class Trade:
    signal: Signal
    entered_at: datetime
    entry: float
    contracts: int
    exit_at: datetime | None = None
    exit: float | None = None
    reason: str = ""
    pnl: float = 0.0
    max_favourable: float = 0.0
    max_adverse: float = 0.0

    @property
    def side(self) -> str:
        return self.signal.side

    @property
    def r_multiple(self) -> float:
        risk = abs(self.entry - self.signal.stop)
        if risk <= 0 or self.exit is None:
            return 0.0
        points = (self.exit - self.entry) if self.side == "long" else (self.entry - self.exit)
        return points / risk

    def as_dict(self) -> dict[str, object]:
        return {
            "entered_at": self.entered_at.isoformat(),
            "exit_at": self.exit_at.isoformat() if self.exit_at else None,
            "side": self.side,
            "zone": self.signal.zone_name,
            "regime": self.signal.verdict.regime,
            "contracts": self.contracts,
            "entry": round(self.entry, 2),
            "stop": round(self.signal.stop, 2),
            "target": round(self.signal.target, 2),
            "exit": round(self.exit, 2) if self.exit is not None else None,
            "reason": self.reason,
            "pnl": round(self.pnl, 2),
            "r": round(self.r_multiple, 2),
        }


@dataclass
class Pending:
    signal: Signal
    bars_left: int
    contracts: int


@dataclass
class Result:
    trades: list[Trade] = field(default_factory=list)
    equity: list[tuple[datetime, float]] = field(default_factory=list)
    blocked: dict[str, int] = field(default_factory=dict)
    rejections: dict[str, int] = field(default_factory=dict)
    account: dict[str, object] = field(default_factory=dict)
    llm_calls: int = 0
    llm_failures: int = 0

    def stats(self) -> dict[str, object]:
        closed = [trade for trade in self.trades if trade.exit is not None]
        if not closed:
            return {"trades": 0}
        wins = [trade for trade in closed if trade.pnl > 0]
        losses = [trade for trade in closed if trade.pnl <= 0]
        gross_win = sum(trade.pnl for trade in wins)
        gross_loss = -sum(trade.pnl for trade in losses)
        rs = [trade.r_multiple for trade in closed]
        peak = -1e18
        drawdown = 0.0
        for _, value in self.equity:
            peak = max(peak, value)
            drawdown = max(drawdown, peak - value)
        return {
            "trades": len(closed),
            "wins": len(wins),
            "losses": len(losses),
            "win_rate": round(len(wins) / len(closed), 3),
            "net_pnl": round(sum(trade.pnl for trade in closed), 2),
            "profit_factor": round(gross_win / gross_loss, 2) if gross_loss > 0 else None,
            "expectancy_r": round(sum(rs) / len(rs), 3),
            "avg_win": round(gross_win / len(wins), 2) if wins else 0.0,
            "avg_loss": round(-gross_loss / len(losses), 2) if losses else 0.0,
            "max_drawdown": round(drawdown, 2),
            "longs": sum(1 for trade in closed if trade.side == "long"),
            "shorts": sum(1 for trade in closed if trade.side == "short"),
        }


class Backtest:
    def __init__(
        self,
        config: StrategyConfig,
        plan: SessionPlan,
        rules: PropFirmRules | None = None,
        costs: Costs | None = None,
        judge: GeminiJudge | None = None,
    ) -> None:
        self.config = config
        self.plan = plan
        self.rules = rules or PropFirmRules()
        self.costs = costs or Costs(
            tick_size=config.tick_size, point_value=config.point_value
        )
        self.judge = judge or GeminiJudge(enabled=False)
        self.strategy = Strategy(config, plan, self.judge)
        self.risk = RiskManager(self.rules)

    def run(self, bars: Iterable[Bar]) -> Result:
        result = Result()
        pending: Pending | None = None
        open_trade: Trade | None = None

        for bar in bars:
            self.risk.roll_day(bar.ts)

            # 1. An open position is managed before anything new is considered.
            if open_trade is not None:
                closed = self._manage(open_trade, bar)
                if closed:
                    self.risk.record(open_trade.pnl, bar.ts)
                    result.trades.append(open_trade)
                    result.equity.append((bar.ts, self.risk.state.balance))
                    open_trade = None
                else:
                    self.risk.mark(self._unrealised(open_trade, bar.close))

            # 2. A resting order from a previous bar may fill on this one.
            if open_trade is None and pending is not None:
                open_trade, pending = self._try_fill(pending, bar)
                if open_trade is not None:
                    # A stop or target inside the entry bar still counts.
                    if self._manage(open_trade, bar):
                        self.risk.record(open_trade.pnl, bar.ts)
                        result.trades.append(open_trade)
                        result.equity.append((bar.ts, self.risk.state.balance))
                        open_trade = None

            # 3. Only then does the strategy get to look at the bar.
            signal = self.strategy.on_bar(bar)
            if signal is None or open_trade is not None or pending is not None:
                continue

            decision = self.risk.evaluate(bar.ts, signal.risk_points, self.costs.point_value)
            if not decision.allowed:
                result.blocked[decision.reason] = result.blocked.get(decision.reason, 0) + 1
                continue
            pending = Pending(signal, signal.expires_after_bars, decision.contracts)

            if self.risk.failed:
                break

        # Anything still open at the end of the data is marked out, not ignored.
        if open_trade is not None and open_trade.exit is None:
            last = open_trade
            last.exit = last.signal.entry
            last.exit_at = last.entered_at
            last.reason = "unclosed at end of data"
            last.pnl = 0.0
            result.trades.append(last)

        for rejection in self.strategy.rejections:
            result.rejections[rejection.reason] = result.rejections.get(rejection.reason, 0) + 1
        result.account = self.risk.summary()
        result.llm_calls = self.judge.calls
        result.llm_failures = self.judge.failures
        return result

    # Fills and management --------------------------------------------------

    def _try_fill(self, pending: Pending, bar: Bar) -> tuple[Trade | None, Pending | None]:
        signal = pending.signal
        long = signal.side == "long"
        slip = self.costs.slippage_points()

        if signal.fill_mode == "market":
            entry = bar.open + slip if long else bar.open - slip
            return self._open(signal, bar, entry, pending.contracts), None

        touched = bar.low <= signal.entry if long else bar.high >= signal.entry
        if touched:
            # A resting limit is assumed to fill at its own price, never at the
            # better price a gap through it would really have given. Booking
            # the gap improvement is free money the backtest has not earned.
            return self._open(signal, bar, signal.entry, pending.contracts), None

        pending.bars_left -= 1
        if pending.bars_left <= 0:
            return None, None
        return None, pending

    def _open(self, signal: Signal, bar: Bar, entry: float, contracts: int) -> Trade:
        return Trade(
            signal=signal,
            entered_at=bar.ts,
            entry=entry,
            contracts=contracts,
        )

    def _unrealised(self, trade: Trade, price: float) -> float:
        points = (
            price - trade.entry if trade.side == "long" else trade.entry - price
        )
        return points * trade.contracts * self.costs.point_value

    def _manage(self, trade: Trade, bar: Bar) -> bool:
        long = trade.side == "long"
        stop = trade.signal.stop
        target = trade.signal.target
        risk = abs(trade.entry - stop)

        # Breakeven is decided on what the trade had banked BEFORE this bar.
        # Deciding it on this bar's own high would let a bar that ran a full R
        # and then reversed exit at breakeven, which is a fill we could not
        # have got: the stop was still at its original price when that low
        # printed.
        banked_before_this_bar = trade.max_favourable

        favourable = (bar.high - trade.entry) if long else (trade.entry - bar.low)
        adverse = (trade.entry - bar.low) if long else (bar.high - trade.entry)
        trade.max_favourable = max(trade.max_favourable, favourable)
        trade.max_adverse = max(trade.max_adverse, adverse)

        moved_to_breakeven = (
            self.config.breakeven_at_r > 0
            and risk > 0
            and banked_before_this_bar >= self.config.breakeven_at_r * risk
        )
        effective_stop = trade.entry if moved_to_breakeven else stop

        hit_stop = bar.low <= effective_stop if long else bar.high >= effective_stop
        hit_target = bar.high >= target if long else bar.low <= target

        if hit_stop:
            slip = 0.0 if moved_to_breakeven else self.costs.slippage_points()
            self._close(trade, bar, effective_stop - slip if long else effective_stop + slip, "stop")
            return True
        if hit_target:
            self._close(trade, bar, target, "target")
            return True

        # Session close. Prop accounts must be flat, and a position carried
        # past the close is a rule violation before it is a bad trade.
        remaining = self.plan.trade.minutes_remaining(bar.ts)
        if remaining is None or remaining <= 1:
            slip = self.costs.slippage_points()
            self._close(trade, bar, bar.close - slip if long else bar.close + slip, "session close")
            return True
        return False

    def _close(self, trade: Trade, bar: Bar, price: float, reason: str) -> None:
        trade.exit = price
        trade.exit_at = bar.ts
        trade.reason = reason
        points = (
            price - trade.entry if trade.side == "long" else trade.entry - price
        )
        gross = points * trade.contracts * self.costs.point_value
        trade.pnl = gross - trade.contracts * self.costs.commission_per_contract


def summarise(result: Result, *, top: int = 6) -> str:
    lines: list[str] = []
    stats = result.stats()
    lines.append("Performance")
    for key, value in stats.items():
        lines.append(f"  {key:<16} {value}")
    lines.append("")
    lines.append("Account")
    for key, value in result.account.items():
        lines.append(f"  {key:<20} {value}")
    if result.blocked:
        lines.append("")
        lines.append("Blocked by risk")
        for reason, count in sorted(result.blocked.items(), key=lambda kv: -kv[1])[:top]:
            lines.append(f"  {count:>5}  {reason}")
    if result.rejections:
        lines.append("")
        lines.append("Setups rejected by the strategy")
        for reason, count in sorted(result.rejections.items(), key=lambda kv: -kv[1])[:top]:
            lines.append(f"  {count:>5}  {reason}")
    if result.llm_calls or result.llm_failures:
        lines.append("")
        lines.append(f"Model calls {result.llm_calls}, failures {result.llm_failures}")
    return "\n".join(lines)
