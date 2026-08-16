"""Synthetic bars, so the system can be exercised with no data subscription.

This is a test fixture and a demo, not a market simulator, and results from it
say nothing about whether the strategy makes money. What it is good for is
proving the machinery runs end to end: that sessions roll, that profiles build,
that value areas form somewhere sane, that gaps appear and get filled, and that
the risk manager stops the account when it should.

The generator is built to produce the shapes the strategy looks for rather than
a pure random walk, because a pure random walk produces almost no fair value
gaps at one minute resolution and the pipeline would never be exercised:

  An Ornstein Uhlenbeck pull toward a slowly drifting fair value, which is what
  makes a bell shaped profile with a real point of control instead of a flat
  histogram.

  A per day regime. Trend days move the fair value steadily and get a wider
  value area. Balanced days pin it.

  Occasional impulse minutes, which is where three bar imbalances come from.

Seeded, so a given seed always produces the same series and a test that passes
today passes tomorrow.
"""

from __future__ import annotations

import argparse
import math
import random
import sys
from datetime import datetime, time, timedelta, timezone
from pathlib import Path
from zoneinfo import ZoneInfo

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from strata_vp.bars import Bar, write_csv  # noqa: E402

PACIFIC = ZoneInfo("America/Los_Angeles")

# Volatility and volume by Pacific hour, roughly the shape of a futures day.
_SESSION_PROFILE: list[tuple[time, time, float, float]] = [
    (time(0, 0), time(3, 0), 0.55, 0.35),  # late Asia
    (time(3, 0), time(6, 30), 0.85, 0.70),  # London and the pre market
    (time(6, 30), time(8, 0), 1.60, 1.60),  # the New York open
    (time(8, 0), time(11, 0), 1.00, 0.90),  # midday
    (time(11, 0), time(13, 0), 1.20, 1.10),  # the close
    (time(13, 0), time(17, 0), 0.35, 0.20),  # the gap between sessions
    (time(17, 0), time(23, 59), 0.60, 0.40),  # Asia
]


def _session_factors(local: datetime) -> tuple[float, float]:
    current = local.time()
    for start, end, volatility, volume in _SESSION_PROFILE:
        if start <= current < end:
            return volatility, volume
    return 0.4, 0.25


def generate(
    *,
    days: int = 12,
    start_price: float = 20_000.0,
    seed: int = 7,
    tick: float = 0.25,
    minute_sigma: float = 3.0,
    end_date: datetime | None = None,
) -> list[Bar]:
    rng = random.Random(seed)
    end = (end_date or datetime(2026, 6, 12, tzinfo=timezone.utc)).astimezone(PACIFIC)
    first_day = (end - timedelta(days=days)).date()

    price = start_price
    fair_value = start_price
    bars: list[Bar] = []

    day = first_day
    while day <= end.date():
        if day.weekday() > 4:
            day += timedelta(days=1)
            continue

        # One regime per day. Roughly a third of days trend, which is about
        # right and is also what makes the point of control migration feature
        # in regime.py have anything to read.
        roll = rng.random()
        if roll < 0.18:
            drift_per_minute = rng.uniform(0.010, 0.022) * minute_sigma
        elif roll < 0.36:
            drift_per_minute = -rng.uniform(0.010, 0.022) * minute_sigma
        else:
            drift_per_minute = rng.gauss(0.0, 0.002) * minute_sigma
        reversion = 0.02 if abs(drift_per_minute) < 0.01 * minute_sigma else 0.006

        cursor = datetime.combine(day, time(0, 0), tzinfo=PACIFIC)
        end_of_day = cursor + timedelta(days=1)
        while cursor < end_of_day:
            volatility_factor, volume_factor = _session_factors(cursor)
            fair_value += drift_per_minute
            sigma = minute_sigma * volatility_factor

            pull = (fair_value - price) * reversion
            step = rng.gauss(0.0, sigma) + pull

            # Impulse minutes: rare, large, and the source of every fair value
            # gap in the series.
            if rng.random() < 0.004 * volatility_factor:
                step += math.copysign(rng.uniform(4.0, 11.0) * minute_sigma, drift_per_minute or step)

            open_price = price
            close_price = price + step
            wick = abs(rng.gauss(0.0, sigma * 0.6))
            high = max(open_price, close_price) + wick * rng.random()
            low = min(open_price, close_price) - wick * rng.random()

            volume = max(
                1.0,
                rng.gauss(600.0 * volume_factor, 180.0 * volume_factor)
                * (1.0 + abs(step) / (sigma * 4.0)),
            )

            bars.append(
                Bar(
                    ts=cursor.astimezone(timezone.utc),
                    open=_snap(open_price, tick),
                    high=_snap(high, tick),
                    low=_snap(low, tick),
                    close=_snap(close_price, tick),
                    volume=round(volume, 1),
                )
            )
            price = close_price
            cursor += timedelta(minutes=1)
        day += timedelta(days=1)

    return bars


def _snap(price: float, tick: float) -> float:
    return round(round(price / tick) * tick, 4)


def main() -> None:
    parser = argparse.ArgumentParser(description="Generate synthetic 1 minute bars.")
    parser.add_argument("--days", type=int, default=12)
    parser.add_argument("--seed", type=int, default=7)
    parser.add_argument("--price", type=float, default=20_000.0)
    parser.add_argument("--out", default="synthetic_1m.csv")
    args = parser.parse_args()

    bars = generate(days=args.days, seed=args.seed, start_price=args.price)
    write_csv(args.out, bars)
    print(f"wrote {len(bars)} bars to {args.out}")


if __name__ == "__main__":
    main()
