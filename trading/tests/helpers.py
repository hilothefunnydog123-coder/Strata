"""Fixtures shared by the tests."""

from __future__ import annotations

from datetime import datetime, timedelta, timezone

from strata_vp.bars import Bar
from strata_vp.gemini import Verdict
from strata_vp.pdarray import FVG
from strata_vp.profile import ProfileLevels
from strata_vp.signals import Signal


def utc(year: int, month: int, day: int, hour: int, minute: int = 0) -> datetime:
    return datetime(year, month, day, hour, minute, tzinfo=timezone.utc)


def bar(ts: datetime, o: float, h: float, l: float, c: float, v: float = 100.0) -> Bar:
    return Bar(ts=ts, open=o, high=h, low=l, close=c, volume=v)


def flat_bar(ts: datetime, price: float, volume: float) -> Bar:
    """A bar that traded at exactly one price, so a profile built from it has
    no distribution ambiguity to model."""
    return Bar(ts=ts, open=price, high=price, low=price, close=price, volume=volume)


def series(start: datetime, prices: list[float], *, minutes: int = 1, volume: float = 100.0) -> list[Bar]:
    return [
        flat_bar(start + timedelta(minutes=minutes * index), price, volume)
        for index, price in enumerate(prices)
    ]


def levels(poc: float = 100.0, vah: float = 110.0, val: float = 90.0) -> ProfileLevels:
    return ProfileLevels(
        poc=poc,
        vah=vah,
        val=val,
        total_volume=10_000.0,
        bin_size=1.0,
        profile_low=val - 10,
        profile_high=vah + 10,
        row_count=40,
    )


def verdict(regime: str = "balanced") -> Verdict:
    return Verdict(
        regime=regime,  # type: ignore[arg-type]
        confidence=0.5,
        long_allowed=True,
        short_allowed=True,
        preferred_long_zone="value_area_low",
        preferred_short_zone="value_area_high",
        long_target="point_of_control",
        short_target="point_of_control",
        rationale="fixture",
    )


def signal(
    ts: datetime,
    *,
    side: str = "long",
    entry: float = 100.0,
    stop: float = 50.0,
    target: float = 200.0,
    fill_mode: str = "market",
) -> Signal:
    gap = FVG("bullish" if side == "long" else "bearish", 3, ts, top=entry + 2, bottom=entry - 2)
    return Signal(
        ts=ts,
        side=side,  # type: ignore[arg-type]
        entry=entry,
        stop=stop,
        target=target,
        zone_name="value_area_low",
        zone_price=entry,
        fvg=gap,
        reference=levels(),
        developing=levels(),
        verdict=verdict(),
        fill_mode=fill_mode,
        expires_after_bars=8,
    )
