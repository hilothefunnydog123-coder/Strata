"""Bars: the one input the whole system runs on.

Everything downstream (volume profiles, fair value gaps, signals, risk) is a
pure function of a stream of these. Keeping the input type this small is what
lets the same code run a backtest over a CSV, a paper session over synthetic
data, and a live session over a broker feed without branching.

Timestamps are the bar's OPEN time and are always timezone aware UTC. Local
session boundaries are resolved in sessions.py, which is the only module that
knows about wall clock time.
"""

from __future__ import annotations

import csv
from dataclasses import dataclass
from datetime import datetime, timedelta, timezone
from typing import Iterable, Iterator, Sequence


@dataclass(frozen=True, slots=True)
class Bar:
    ts: datetime
    open: float
    high: float
    low: float
    close: float
    volume: float

    def __post_init__(self) -> None:
        if self.ts.tzinfo is None:
            raise ValueError("Bar.ts must be timezone aware")
        if self.high < self.low:
            raise ValueError(f"bar at {self.ts}: high {self.high} below low {self.low}")

    @property
    def typical(self) -> float:
        """Average of high, low and close. The usual proxy for where the
        volume in a bar actually traded when tick data is not available."""
        return (self.high + self.low + self.close) / 3.0

    @property
    def range(self) -> float:
        return self.high - self.low


def _parse_ts(raw: str) -> datetime:
    raw = raw.strip()
    if raw.isdigit():
        value = int(raw)
        # Seconds, milliseconds or microseconds since the epoch.
        if value > 10**14:
            value //= 1000000
        elif value > 10**11:
            value //= 1000
        return datetime.fromtimestamp(value, tz=timezone.utc)
    if raw.endswith("Z"):
        raw = raw[:-1] + "+00:00"
    parsed = datetime.fromisoformat(raw)
    if parsed.tzinfo is None:
        parsed = parsed.replace(tzinfo=timezone.utc)
    return parsed.astimezone(timezone.utc)


def load_csv(
    path: str,
    *,
    ts_field: str = "time",
    open_field: str = "open",
    high_field: str = "high",
    low_field: str = "low",
    close_field: str = "close",
    volume_field: str = "volume",
) -> list[Bar]:
    """Read bars from a CSV with a header row.

    Written around what TradingView's "Export chart data" actually produces,
    which is not quite what the defaults above say. It writes `Volume` with a
    capital V, sometimes ships a `Volume MA` column alongside it, and adds a
    column for every indicator on the chart at the time of export. So header
    matching is case insensitive and extra columns are ignored rather than
    being an error.

    A file with no volume column is rejected rather than defaulted to zero: a
    volume profile built from zero volume is a range chart wearing a costume,
    and silently producing one would be worse than failing here. Same for a
    file whose volume column is entirely zero, which is what a chart exported
    from an index rather than a futures contract looks like.
    """
    wanted = {
        "ts": ts_field,
        "open": open_field,
        "high": high_field,
        "low": low_field,
        "close": close_field,
        "volume": volume_field,
    }
    bars: list[Bar] = []
    with open(path, newline="", encoding="utf-8-sig") as handle:
        reader = csv.DictReader(handle)
        if reader.fieldnames is None:
            raise ValueError(f"{path}: no header row")

        lookup = {name.strip().lower(): name for name in reader.fieldnames}
        resolved: dict[str, str] = {}
        for key, name in wanted.items():
            actual = lookup.get(name.strip().lower())
            if actual is None:
                raise ValueError(
                    f"{path}: no column matching '{name}'. "
                    f"Found: {reader.fieldnames}. "
                    "A TradingView export should have time, open, high, low, close "
                    "and Volume; if Volume is missing the chart was an index or a "
                    "spread rather than a contract."
                )
            resolved[key] = actual

        for number, row in enumerate(reader, start=2):
            try:
                bars.append(
                    Bar(
                        ts=_parse_ts(row[resolved["ts"]]),
                        open=float(row[resolved["open"]]),
                        high=float(row[resolved["high"]]),
                        low=float(row[resolved["low"]]),
                        close=float(row[resolved["close"]]),
                        volume=float(row[resolved["volume"]] or 0.0),
                    )
                )
            except (TypeError, ValueError) as error:
                # A blank row at the end of an export is common and harmless.
                if not any((row.get(name) or "").strip() for name in resolved.values()):
                    continue
                raise ValueError(f"{path}: line {number}: {error}") from error

    bars.sort(key=lambda bar: bar.ts)
    if bars and sum(bar.volume for bar in bars) <= 0:
        raise ValueError(
            f"{path}: every bar has zero volume, cannot build a profile. "
            "Export a futures contract such as MNQ1! rather than an index."
        )
    return bars


def write_csv(path: str, bars: Sequence[Bar]) -> None:
    with open(path, "w", newline="", encoding="utf-8") as handle:
        writer = csv.writer(handle)
        writer.writerow(["time", "open", "high", "low", "close", "volume"])
        for bar in bars:
            writer.writerow(
                [
                    bar.ts.astimezone(timezone.utc).isoformat().replace("+00:00", "Z"),
                    f"{bar.open:.4f}",
                    f"{bar.high:.4f}",
                    f"{bar.low:.4f}",
                    f"{bar.close:.4f}",
                    f"{bar.volume:.2f}",
                ]
            )


def resample(bars: Iterable[Bar], minutes: int) -> list[Bar]:
    """Aggregate to a coarser timeframe, aligned to the wall clock hour.

    Used to run the signal logic on 5 minute bars while the profile is still
    built from 1 minute bars, which is the accuracy tradeoff described in
    profile.py.
    """
    if minutes <= 0:
        raise ValueError("minutes must be positive")
    step = timedelta(minutes=minutes)
    out: list[Bar] = []
    bucket_start: datetime | None = None
    o = h = l = c = 0.0
    v = 0.0
    for bar in bars:
        aligned = bar.ts.replace(second=0, microsecond=0)
        aligned -= timedelta(minutes=aligned.minute % minutes)
        if bucket_start is None or aligned != bucket_start:
            if bucket_start is not None:
                out.append(Bar(bucket_start, o, h, l, c, v))
            bucket_start = aligned
            o, h, l, c, v = bar.open, bar.high, bar.low, bar.close, bar.volume
        else:
            h = max(h, bar.high)
            l = min(l, bar.low)
            c = bar.close
            v += bar.volume
    if bucket_start is not None:
        out.append(Bar(bucket_start, o, h, l, c, v))
    return out


def atr(bars: Sequence[Bar], period: int = 14) -> float:
    """Wilder style average true range over the last `period` bars.

    Used to express distances in units of current volatility so the same
    configuration behaves the same way on a quiet day and a violent one.
    """
    if len(bars) < 2:
        return 0.0
    window = bars[-(period + 1) :]
    trs: list[float] = []
    for prev, cur in zip(window, window[1:]):
        trs.append(
            max(
                cur.high - cur.low,
                abs(cur.high - prev.close),
                abs(cur.low - prev.close),
            )
        )
    if not trs:
        return 0.0
    return sum(trs) / len(trs)


def iter_closed(bars: Iterable[Bar]) -> Iterator[Bar]:
    """Identity today, a seam tomorrow.

    Live feeds emit a forming bar repeatedly before it closes. Every decision
    in this system is taken on closed bars only, and this is where a live
    adapter filters the forming one out.
    """
    yield from bars
