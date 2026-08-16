"""Prop firm account rules, enforced locally before the firm enforces them.

Most funded accounts are not lost to a bad strategy. They are lost to a
trailing drawdown that the trader was measuring differently from the firm.
This module exists to measure it the way the firm does, and to refuse trades
before the account is closed rather than explain afterwards why it was.

Three rules do almost all of the damage:

  trailing drawdown. The account's maximum loss is measured from its highest
  ever balance, and at most firms that peak moves on unrealised profit, tick by
  tick, not on closed trades. A position that goes 40 points your way and comes
  back has permanently raised the bar you have to clear. `trailing_basis`
  models both conventions because they are genuinely different accounts.

  daily loss limit. Usually measured from the balance at the daily reset, not
  from the session start, and usually including open profit. Hitting it fails
  the account at some firms and locks the day at others. We stop at a fraction
  of it, `daily_soft_stop_pct`, because one more trade is exactly how the last
  fraction gets spent.

  consistency. Many firms will not pay out if a single day is more than some
  share of total profit. It cannot fail the account, so it is tracked and
  reported rather than enforced, but it changes when to stop for the day and
  it is invisible until payout if nobody counts it.

Sizing is the intersection of three budgets: a fixed fraction of the account, a
fraction of what is left of the daily loss limit, and a fraction of what is
left of the trailing drawdown. The smallest wins. Near a limit this returns
zero contracts, which is the correct size.
"""

from __future__ import annotations

import math
from dataclasses import dataclass, field
from datetime import date, datetime, time
from typing import Literal
from zoneinfo import ZoneInfo

from .sessions import PACIFIC

TrailingBasis = Literal["intraday_peak", "closed_balance", "none"]


@dataclass(frozen=True, slots=True)
class PropFirmRules:
    """Defaults are a common 50k evaluation. Check them against your firm."""

    account_size: float = 50_000.0
    profit_target: float = 3_000.0
    max_daily_loss: float = 1_200.0
    trailing_drawdown: float = 2_500.0
    trailing_basis: TrailingBasis = "intraday_peak"
    # Some firms stop trailing once the peak is account_size + trailing_drawdown
    # plus a buffer. Set to None if the drawdown trails forever.
    trailing_stops_at_profit: float | None = 2_600.0
    max_contracts: int = 5
    consistency_pct: float = 0.30
    # Local guardrails, tighter than the firm's by design.
    daily_soft_stop_pct: float = 0.70
    risk_per_trade_pct: float = 0.01
    daily_budget_fraction: float = 0.5
    drawdown_budget_fraction: float = 0.25
    max_trades_per_day: int = 4
    max_consecutive_losses: int = 2
    stop_after_daily_target: float | None = 900.0
    flat_by: time = time(12, 55)
    tz: ZoneInfo = PACIFIC


@dataclass
class AccountState:
    balance: float
    peak: float
    day: date | None = None
    day_start_balance: float = 0.0
    day_pnl: float = 0.0
    trades_today: int = 0
    consecutive_losses: int = 0
    daily_pnls: dict[date, float] = field(default_factory=dict)
    locked_reason: str | None = None


@dataclass
class Decision:
    allowed: bool
    contracts: int
    reason: str


class RiskManager:
    def __init__(self, rules: PropFirmRules) -> None:
        self.rules = rules
        self.state = AccountState(
            balance=rules.account_size,
            peak=rules.account_size,
            day_start_balance=rules.account_size,
        )

    # Accounting ------------------------------------------------------------

    @property
    def trailing_floor(self) -> float:
        """The balance below which the account is dead."""
        rules = self.rules
        if rules.trailing_basis == "none":
            return rules.account_size - rules.trailing_drawdown
        peak = self.state.peak
        if rules.trailing_stops_at_profit is not None:
            peak = min(peak, rules.account_size + rules.trailing_stops_at_profit)
        return peak - rules.trailing_drawdown

    @property
    def daily_floor(self) -> float:
        return self.state.day_start_balance - self.rules.max_daily_loss

    @property
    def drawdown_room(self) -> float:
        return max(0.0, self.state.balance - self.trailing_floor)

    @property
    def daily_room(self) -> float:
        return max(0.0, self.state.balance - self.daily_floor)

    @property
    def passed(self) -> bool:
        return self.state.balance - self.rules.account_size >= self.rules.profit_target

    @property
    def failed(self) -> bool:
        return self.state.locked_reason == "account_failed"

    def roll_day(self, ts: datetime) -> None:
        day = ts.astimezone(self.rules.tz).date()
        if self.state.day == day:
            return
        self.state.day = day
        self.state.day_start_balance = self.state.balance
        self.state.day_pnl = 0.0
        self.state.trades_today = 0
        self.state.consecutive_losses = 0
        if self.state.locked_reason not in ("account_failed",):
            self.state.locked_reason = None

    def mark(self, unrealised: float) -> None:
        """Update the peak from open profit. Only called when the firm trails
        on intraday equity, which is the harsher and more common case."""
        if self.rules.trailing_basis != "intraday_peak":
            return
        equity = self.state.balance + unrealised
        if equity > self.state.peak:
            self.state.peak = equity
        if equity <= self.trailing_floor:
            self.state.locked_reason = "account_failed"

    def record(self, pnl: float, ts: datetime) -> None:
        self.roll_day(ts)
        self.state.balance += pnl
        self.state.day_pnl += pnl
        self.state.trades_today += 1
        day = self.state.day
        if day is not None:
            self.state.daily_pnls[day] = self.state.daily_pnls.get(day, 0.0) + pnl
        if pnl < 0:
            self.state.consecutive_losses += 1
        else:
            self.state.consecutive_losses = 0
        if self.rules.trailing_basis == "closed_balance" and self.state.balance > self.state.peak:
            self.state.peak = self.state.balance
        if self.state.balance <= self.trailing_floor:
            self.state.locked_reason = "account_failed"
        elif self.state.balance <= self.daily_floor:
            self.state.locked_reason = "daily_loss_limit"

    # Permission ------------------------------------------------------------

    def evaluate(self, ts: datetime, stop_points: float, point_value: float) -> Decision:
        rules = self.rules
        self.roll_day(ts)

        if self.state.locked_reason == "account_failed":
            return Decision(False, 0, "account failed")
        if self.state.locked_reason is not None:
            return Decision(False, 0, self.state.locked_reason)
        if self.passed:
            return Decision(False, 0, "profit target reached")

        local = ts.astimezone(rules.tz)
        if local.time() >= rules.flat_by:
            return Decision(False, 0, "past flat by time")
        if self.state.trades_today >= rules.max_trades_per_day:
            return Decision(False, 0, "max trades for the day")
        if self.state.consecutive_losses >= rules.max_consecutive_losses:
            return Decision(False, 0, "consecutive loss limit")
        if self.state.day_pnl <= -rules.max_daily_loss * rules.daily_soft_stop_pct:
            return Decision(False, 0, "daily soft stop")
        if (
            rules.stop_after_daily_target is not None
            and self.state.day_pnl >= rules.stop_after_daily_target
        ):
            return Decision(False, 0, "daily target reached")

        contracts = self.size(stop_points, point_value)
        if contracts < 1:
            return Decision(False, 0, "risk budget below one contract")
        return Decision(True, contracts, "ok")

    def size(self, stop_points: float, point_value: float) -> int:
        rules = self.rules
        if stop_points <= 0 or point_value <= 0:
            return 0
        risk_per_contract = stop_points * point_value
        budgets = (
            rules.account_size * rules.risk_per_trade_pct,
            self.daily_room * rules.daily_budget_fraction,
            self.drawdown_room * rules.drawdown_budget_fraction,
        )
        allowed = min(budgets)
        return max(0, min(rules.max_contracts, int(math.floor(allowed / risk_per_contract))))

    # Reporting -------------------------------------------------------------

    def consistency_breach(self) -> tuple[bool, float]:
        """(breached, best day as a share of total profit)."""
        profit = self.state.balance - self.rules.account_size
        if profit <= 0 or not self.state.daily_pnls:
            return False, 0.0
        best = max(self.state.daily_pnls.values())
        if best <= 0:
            return False, 0.0
        share = best / profit
        return share > self.rules.consistency_pct, share

    def summary(self) -> dict[str, object]:
        breached, share = self.consistency_breach()
        return {
            "balance": round(self.state.balance, 2),
            "profit": round(self.state.balance - self.rules.account_size, 2),
            "peak": round(self.state.peak, 2),
            "trailing_floor": round(self.trailing_floor, 2),
            "drawdown_room": round(self.drawdown_room, 2),
            "passed": self.passed,
            "failed": self.failed,
            "locked_reason": self.state.locked_reason,
            "trading_days": len(self.state.daily_pnls),
            "best_day_share": round(share, 3),
            "consistency_breach": breached,
        }
