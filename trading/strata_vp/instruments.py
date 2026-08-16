"""Contract specifications.

Small, but the numbers in it are load bearing. Position sizing, the reward to
risk test and every dollar figure in a backtest report are all derived from
tick size and point value, and getting the point value wrong by a factor of ten
is the kind of mistake that looks like a working system right up to the first
real fill.

Commissions are round turn per contract at a typical prop firm rate. Yours will
differ by a few tens of cents. Check them, because on a strategy taking two or
three trades a day on micros they are a real share of the edge.
"""

from __future__ import annotations

from dataclasses import dataclass


@dataclass(frozen=True, slots=True)
class Instrument:
    symbol: str
    name: str
    tick_size: float
    point_value: float
    commission_round_turn: float
    # A sane default profile row height. One point on the Nasdaq is four ticks,
    # which keeps the row count reasonable over an overnight range.
    bin_size: float
    exchange: str = "CME"

    @property
    def tick_value(self) -> float:
        return self.tick_size * self.point_value

    def ticks(self, points: float) -> float:
        return points / self.tick_size

    def dollars(self, points: float, contracts: int = 1) -> float:
        return points * self.point_value * contracts


MNQ = Instrument("MNQ", "Micro E-mini Nasdaq 100", 0.25, 2.0, 1.20, bin_size=1.0)
NQ = Instrument("NQ", "E-mini Nasdaq 100", 0.25, 20.0, 4.00, bin_size=1.0)
MES = Instrument("MES", "Micro E-mini S&P 500", 0.25, 5.0, 1.20, bin_size=0.25)
ES = Instrument("ES", "E-mini S&P 500", 0.25, 50.0, 4.00, bin_size=0.25)
MGC = Instrument("MGC", "Micro Gold", 0.10, 10.0, 1.20, bin_size=0.5, exchange="COMEX")
M2K = Instrument("M2K", "Micro Russell 2000", 0.10, 5.0, 1.20, bin_size=0.2)

BY_SYMBOL: dict[str, Instrument] = {
    instrument.symbol: instrument
    for instrument in (MNQ, NQ, MES, ES, MGC, M2K)
}


def lookup(symbol: str) -> Instrument:
    """Accepts a root or a dated contract: MNQ, MNQZ5, MNQZ2025 all resolve."""
    upper = symbol.upper().strip()
    if upper in BY_SYMBOL:
        return BY_SYMBOL[upper]
    for root in sorted(BY_SYMBOL, key=len, reverse=True):
        if upper.startswith(root):
            return BY_SYMBOL[root]
    raise KeyError(f"unknown instrument {symbol}; known roots {sorted(BY_SYMBOL)}")
