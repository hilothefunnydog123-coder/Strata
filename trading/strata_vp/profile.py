"""Volume profile: point of control, value area high, value area low.

Two honest limitations, stated here because they set the accuracy ceiling of
everything above:

  1. Free data gives us bars, not ticks. A bar tells us that some volume traded
     somewhere between its low and its high, not where. We have to model the
     distribution. `uniform` spreads a bar's volume evenly across its range,
     which is what TradingView's own bar based profile does, and is the right
     default. `typical` concentrates it around (high + low + close) / 3, which
     is closer to reality on wide bars and further from any published number.
     The narrower the bars, the smaller this choice matters, which is why the
     profile is built from 1 minute bars even when signals run on 5 minute
     bars.

  2. The value area is a 70 percent volume band, not a statistical interval.
     The algorithm here is the standard one: start at the point of control,
     then repeatedly add whichever pair of rows, above or below, holds more
     volume, until 70 percent of the session's volume is inside. Implementations
     that add one row at a time produce a slightly different band. This one
     matches the CME method and therefore matches most charts.

The profile is incremental. `add_bar` is O(rows touched by the bar) and
`levels()` is O(rows in the profile), so a developing profile can be brought up
to date on every closed bar for an entire session without the cost showing up.
"""

from __future__ import annotations

import math
from dataclasses import dataclass
from typing import Iterable, Sequence

from .bars import Bar


@dataclass(frozen=True, slots=True)
class ProfileLevels:
    poc: float
    vah: float
    val: float
    total_volume: float
    bin_size: float
    profile_low: float
    profile_high: float
    row_count: int

    @property
    def value_area_width(self) -> float:
        return self.vah - self.val

    @property
    def range(self) -> float:
        return self.profile_high - self.profile_low

    def position_of(self, price: float) -> str:
        """Where a price sits relative to the value area."""
        if price > self.vah:
            return "above_value"
        if price < self.val:
            return "below_value"
        return "inside_value"

    def as_dict(self) -> dict[str, float | int | str]:
        return {
            "poc": round(self.poc, 4),
            "vah": round(self.vah, 4),
            "val": round(self.val, 4),
            "value_area_width": round(self.value_area_width, 4),
            "profile_low": round(self.profile_low, 4),
            "profile_high": round(self.profile_high, 4),
            "total_volume": round(self.total_volume, 2),
            "rows": self.row_count,
        }


class VolumeProfile:
    """A price histogram of volume, plus the levels derived from it."""

    def __init__(
        self,
        *,
        bin_size: float = 1.0,
        value_area_pct: float = 0.70,
        distribution: str = "uniform",
    ) -> None:
        if bin_size <= 0:
            raise ValueError("bin_size must be positive")
        if not 0.0 < value_area_pct <= 1.0:
            raise ValueError("value_area_pct must be in (0, 1]")
        if distribution not in ("uniform", "typical"):
            raise ValueError("distribution must be 'uniform' or 'typical'")
        self.bin_size = float(bin_size)
        self.value_area_pct = float(value_area_pct)
        self.distribution = distribution
        self._rows: dict[int, float] = {}
        self._total: float = 0.0
        self._bar_count: int = 0

    # Row index arithmetic. A row covers [index * bin_size, (index + 1) * bin_size).
    def _index(self, price: float) -> int:
        return math.floor(price / self.bin_size)

    def _row_low(self, index: int) -> float:
        return index * self.bin_size

    def _row_center(self, index: int) -> float:
        return (index + 0.5) * self.bin_size

    @property
    def total_volume(self) -> float:
        return self._total

    @property
    def bar_count(self) -> int:
        return self._bar_count

    def add_bar(self, bar: Bar) -> None:
        volume = bar.volume
        self._bar_count += 1
        if volume <= 0:
            return
        low_index = self._index(bar.low)
        high_index = self._index(bar.high)

        if low_index == high_index or bar.high <= bar.low:
            self._rows[low_index] = self._rows.get(low_index, 0.0) + volume
            self._total += volume
            return

        span = bar.high - bar.low
        weights: dict[int, float] = {}
        for index in range(low_index, high_index + 1):
            row_low = self._row_low(index)
            row_high = row_low + self.bin_size
            overlap = min(bar.high, row_high) - max(bar.low, row_low)
            if overlap <= 0:
                continue
            weights[index] = overlap / span

        if self.distribution == "typical":
            # Triangular kernel peaking at the typical price and falling to
            # zero at the bar's extremes, applied on top of the overlap
            # weights so that a row only half covered by the bar still counts
            # half.
            peak = bar.typical
            half = max(peak - bar.low, bar.high - peak, self.bin_size / 2.0)
            for index in list(weights):
                distance = abs(self._row_center(index) - peak)
                weights[index] *= max(0.0, 1.0 - distance / half) + 1e-9

        scale = sum(weights.values())
        if scale <= 0:
            self._rows[low_index] = self._rows.get(low_index, 0.0) + volume
            self._total += volume
            return
        for index, weight in weights.items():
            self._rows[index] = self._rows.get(index, 0.0) + volume * weight / scale
        self._total += volume

    def add_bars(self, bars: Iterable[Bar]) -> "VolumeProfile":
        for bar in bars:
            self.add_bar(bar)
        return self

    def rows(self) -> list[tuple[float, float]]:
        """(row low price, volume) for every row with volume, low to high."""
        return [(self._row_low(index), self._rows[index]) for index in sorted(self._rows)]

    def levels(self) -> ProfileLevels | None:
        """None until the profile holds volume. Callers must handle that: at
        the first bar of a session the developing profile does not exist yet,
        and inventing a level there is how a system trades its own warmup."""
        if not self._rows or self._total <= 0:
            return None

        indices = sorted(self._rows)
        low_index, high_index = indices[0], indices[-1]
        counts = [self._rows.get(index, 0.0) for index in range(low_index, high_index + 1)]

        poc_offset = self._poc_offset(counts, low_index)
        lo, hi = self._value_area(counts, poc_offset, self._total * self.value_area_pct)

        return ProfileLevels(
            poc=self._row_center(low_index + poc_offset),
            vah=self._row_low(low_index + hi) + self.bin_size,
            val=self._row_low(low_index + lo),
            total_volume=self._total,
            bin_size=self.bin_size,
            profile_low=self._row_low(low_index),
            profile_high=self._row_low(high_index) + self.bin_size,
            row_count=len(counts),
        )

    def _poc_offset(self, counts: Sequence[float], low_index: int) -> int:
        """Index of the highest volume row, ties broken toward the volume
        weighted mean price. An untied tie break matters more than it sounds:
        on a thin overnight session several rows often hold identical volume,
        and picking the first one silently biases every point of control in the
        system downward."""
        peak = max(counts)
        candidates = [offset for offset, value in enumerate(counts) if value == peak]
        if len(candidates) == 1:
            return candidates[0]
        vwap = sum(
            self._row_center(low_index + offset) * value for offset, value in enumerate(counts)
        ) / self._total
        return min(candidates, key=lambda offset: abs(self._row_center(low_index + offset) - vwap))

    @staticmethod
    def _value_area(counts: Sequence[float], poc_offset: int, target: float) -> tuple[int, int]:
        lo = hi = poc_offset
        inside = counts[poc_offset]
        n = len(counts)
        while inside < target:
            can_up = hi < n - 1
            can_down = lo > 0
            if not can_up and not can_down:
                break
            up_step = min(2, n - 1 - hi) if can_up else 0
            down_step = min(2, lo) if can_down else 0
            up_volume = sum(counts[hi + 1 : hi + 1 + up_step]) if up_step else -1.0
            down_volume = sum(counts[lo - down_step : lo]) if down_step else -1.0
            if up_step and up_volume >= down_volume:
                inside += up_volume
                hi += up_step
            elif down_step:
                inside += down_volume
                lo -= down_step
            else:
                break
        return lo, hi


def build_profile(
    bars: Sequence[Bar],
    *,
    bin_size: float = 1.0,
    value_area_pct: float = 0.70,
    distribution: str = "uniform",
) -> ProfileLevels | None:
    profile = VolumeProfile(
        bin_size=bin_size, value_area_pct=value_area_pct, distribution=distribution
    )
    profile.add_bars(bars)
    return profile.levels()
