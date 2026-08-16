"""Fair value gaps, tracked from formation to consumption.

A fair value gap is a three bar imbalance. Bullish: the low of the third bar
sits above the high of the first, so there is a band of price that only traded
through in one direction. Bearish is the mirror.

The reason the tracker exists rather than a bare detector is that the entry in
this strategy is a retrace into a gap, not the gap itself. That means a gap has
a life: it forms, it is untouched, price trades into part of it, and eventually
it is consumed. Only the untouched or lightly touched part is a valid entry, so
the fill fraction has to be maintained on every bar after formation.

Naming, since the two edges get confused constantly: `proximal` is the edge
price reaches first when it comes back (the top of a bullish gap, since price
is above it) and `distal` is the far side. A structural stop goes beyond the
distal edge.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from datetime import datetime
from typing import Iterable, Literal, Sequence

from .bars import Bar

Side = Literal["bullish", "bearish"]


@dataclass(slots=True)
class FVG:
    kind: Side
    formed_index: int
    formed_at: datetime
    top: float
    bottom: float
    filled: float = 0.0
    consumed_at: datetime | None = None

    @property
    def size(self) -> float:
        return self.top - self.bottom

    @property
    def proximal(self) -> float:
        return self.top if self.kind == "bullish" else self.bottom

    @property
    def distal(self) -> float:
        return self.bottom if self.kind == "bullish" else self.top

    @property
    def midpoint(self) -> float:
        return (self.top + self.bottom) / 2.0

    @property
    def alive(self) -> bool:
        return self.consumed_at is None

    def contains(self, price: float, *, tolerance: float = 0.0) -> bool:
        return self.bottom - tolerance <= price <= self.top + tolerance

    def overlaps(self, low: float, high: float) -> bool:
        return not (high < self.bottom or low > self.top)

    def unfilled_entry(self) -> float:
        """Where a limit order should sit: the proximal edge, pulled back to
        the deepest untouched price if part of the gap is already gone."""
        if self.size <= 0:
            return self.proximal
        consumed = self.size * min(self.filled, 1.0)
        if self.kind == "bullish":
            return self.top - consumed
        return self.bottom + consumed

    def as_dict(self) -> dict[str, object]:
        return {
            "kind": self.kind,
            "formed_at": self.formed_at.isoformat(),
            "top": round(self.top, 4),
            "bottom": round(self.bottom, 4),
            "size": round(self.size, 4),
            "filled": round(self.filled, 3),
        }


def detect(bars: Sequence[Bar], index: int, *, min_size: float = 0.0) -> FVG | None:
    """The gap completed by the bar at `index`, if there is one."""
    if index < 2:
        return None
    first, _middle, third = bars[index - 2], bars[index - 1], bars[index]
    if third.low > first.high:
        gap = FVG("bullish", index, third.ts, top=third.low, bottom=first.high)
    elif third.high < first.low:
        gap = FVG("bearish", index, third.ts, top=first.low, bottom=third.high)
    else:
        return None
    return gap if gap.size >= min_size else None


class FVGTracker:
    """Maintains the set of live gaps as bars arrive.

    Feed it every closed bar in order. It detects new gaps and ages existing
    ones. `live(kind)` returns the ones still worth trading, newest first,
    which is the order that matters: the most recent unmitigated gap is the one
    price is most likely to respect.
    """

    def __init__(
        self,
        *,
        min_size: float = 0.0,
        max_age_bars: int = 60,
        consumed_at_fill: float = 0.9,
    ) -> None:
        self.min_size = min_size
        self.max_age_bars = max_age_bars
        self.consumed_at_fill = consumed_at_fill
        self._bars: list[Bar] = []
        self._gaps: list[FVG] = []

    @property
    def bars_seen(self) -> int:
        return len(self._bars)

    def reset(self) -> None:
        """Called at each session open. Gaps from the overnight session are
        real, but this strategy grades setups against the current session's
        developing profile, and carrying stale gaps across the open produced
        the worst drawdowns in testing."""
        self._bars.clear()
        self._gaps.clear()

    def on_bar(self, bar: Bar) -> FVG | None:
        self._bars.append(bar)
        index = len(self._bars) - 1
        self._age(bar, index)
        new = detect(self._bars, index, min_size=self.min_size)
        if new is not None:
            self._gaps.append(new)
        return new

    def on_bars(self, bars: Iterable[Bar]) -> None:
        for bar in bars:
            self.on_bar(bar)

    def _age(self, bar: Bar, index: int) -> None:
        for gap in self._gaps:
            if not gap.alive:
                continue
            if index - gap.formed_index > self.max_age_bars:
                gap.consumed_at = bar.ts
                continue
            if gap.size <= 0:
                gap.consumed_at = bar.ts
                continue
            if gap.kind == "bullish":
                penetration = gap.top - bar.low
            else:
                penetration = bar.high - gap.bottom
            fraction = max(0.0, min(1.0, penetration / gap.size))
            gap.filled = max(gap.filled, fraction)
            if gap.filled >= self.consumed_at_fill:
                gap.consumed_at = bar.ts

    def live(self, kind: Side | None = None) -> list[FVG]:
        gaps = [gap for gap in self._gaps if gap.alive and (kind is None or gap.kind == kind)]
        gaps.sort(key=lambda gap: gap.formed_index, reverse=True)
        return gaps

    def all_gaps(self) -> list[FVG]:
        return list(self._gaps)

    def best_in_zone(
        self, kind: Side, zone_low: float, zone_high: float, *, max_fill: float = 0.5
    ) -> FVG | None:
        """The freshest live gap of `kind` that overlaps the zone and is not
        already mostly used up."""
        for gap in self.live(kind):
            if gap.filled > max_fill:
                continue
            if gap.overlaps(zone_low, zone_high):
                return gap
        return None


@dataclass(slots=True)
class SwingPoints:
    """Fractal swing highs and lows, used for structural stops and for the
    higher high / higher low count the regime layer reports."""

    highs: list[tuple[int, float]] = field(default_factory=list)
    lows: list[tuple[int, float]] = field(default_factory=list)


def swings(bars: Sequence[Bar], *, strength: int = 2) -> SwingPoints:
    points = SwingPoints()
    for index in range(strength, len(bars) - strength):
        window = bars[index - strength : index + strength + 1]
        pivot = bars[index]
        if all(pivot.high >= other.high for other in window) and any(
            pivot.high > other.high for other in window
        ):
            points.highs.append((index, pivot.high))
        if all(pivot.low <= other.low for other in window) and any(
            pivot.low < other.low for other in window
        ):
            points.lows.append((index, pivot.low))
    return points
