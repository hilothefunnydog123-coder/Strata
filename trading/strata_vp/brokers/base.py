"""The broker seam.

Four methods is the whole surface the strategy needs. Keeping it this small is
what makes the choice of prop firm a configuration decision rather than a
rewrite, which matters because the firm you pass an evaluation with is often
not the firm you end up funded at.

Every implementation must satisfy two invariants that the paper broker asserts
and a live one has to be checked against by hand:

  A bracket is atomic. The stop goes to the exchange with the entry, not after
  a confirmation round trip. A fill without a resting stop is the state that
  turns a 50 point loss into a failed account when the connection drops.

  Flatten works when nothing else does. `flatten` must not depend on knowing
  the current position from local state, because local state is exactly what
  is wrong when it is needed.
"""

from __future__ import annotations

from abc import ABC, abstractmethod
from dataclasses import dataclass
from datetime import datetime
from typing import Literal

Side = Literal["long", "short"]


@dataclass(frozen=True, slots=True)
class Position:
    symbol: str
    side: Side | None
    contracts: int
    average_price: float
    unrealised: float


@dataclass(frozen=True, slots=True)
class BracketOrder:
    symbol: str
    side: Side
    contracts: int
    entry: float | None  # None means market
    stop: float
    target: float
    tag: str = ""


@dataclass(frozen=True, slots=True)
class Fill:
    order_tag: str
    symbol: str
    side: Side
    contracts: int
    price: float
    at: datetime


class Broker(ABC):
    @abstractmethod
    def position(self, symbol: str) -> Position:
        """Truth from the broker, not from local bookkeeping."""

    @abstractmethod
    def submit(self, order: BracketOrder) -> str:
        """Place entry, stop and target as one bracket. Returns an order id."""

    @abstractmethod
    def cancel(self, order_id: str) -> None:
        """Cancel a working order. Must be safe to call on a filled order."""

    @abstractmethod
    def flatten(self, symbol: str) -> None:
        """Close any position and cancel any working order for the symbol."""
