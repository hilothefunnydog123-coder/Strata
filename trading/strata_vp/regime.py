"""Market state, measured before anybody is asked to judge it.

This module answers the question the strategy brief poses as discretion: is
this a huge uptrend, in which case price may never reach the value area low and
the point of control is the level that matters?

It answers it twice. Everything here is deterministic and cheap, and produces
both the feature set that gets handed to the model in gemini.py and a fallback
classification used when the model is unavailable, rate limited, slow, or
disagreed with by the guardrails. The deterministic answer is not a placeholder
waiting to be replaced by the model: it is the thing that must keep the system
running for free, and the model's job is to be better than it, measurably, on
the same inputs.

The features are all scale free. Distances are in average true range, slopes
are normalised, migrations are fractions of a value area width. A configuration
tuned on Nasdaq futures should not fall apart on gold.
"""

from __future__ import annotations

from dataclasses import asdict, dataclass
from typing import Literal, Sequence

from .bars import Bar, atr
from .pdarray import swings
from .profile import ProfileLevels

Regime = Literal[
    "strong_uptrend", "uptrend", "balanced", "downtrend", "strong_downtrend"
]

REGIMES: tuple[Regime, ...] = (
    "strong_downtrend",
    "downtrend",
    "balanced",
    "uptrend",
    "strong_uptrend",
)


@dataclass(frozen=True, slots=True)
class RegimeFeatures:
    price: float
    atr: float
    # Where we opened relative to the reference value area. Dalton's open type
    # is the single most informative thing about a session at 30 minutes in.
    open_type: str
    # Where price is now.
    position_vs_reference: str
    position_vs_developing: str
    # Distances, in ATR, positive meaning the level is above price.
    atr_to_reference_poc: float
    atr_to_reference_val: float
    atr_to_reference_vah: float
    atr_to_developing_poc: float
    # Point of control migration across the last few reference sessions,
    # expressed in value area widths per session. Consistently rising points of
    # control is what a trend looks like in profile terms.
    poc_migration: float
    # Close to close slope over the session so far, in ATR per 10 bars.
    slope: float
    # Structure count over the session.
    higher_lows: int
    lower_highs: int
    # Session range so far divided by the reference session's range. Above 1.0
    # means today is doing something the reference session did not.
    range_expansion: float
    bars_into_session: int

    def as_dict(self) -> dict[str, object]:
        out = asdict(self)
        for key, value in out.items():
            if isinstance(value, float):
                out[key] = round(value, 3)
        return out


def _safe_div(numerator: float, denominator: float, default: float = 0.0) -> float:
    return numerator / denominator if denominator else default


def measure(
    *,
    session_bars: Sequence[Bar],
    reference: ProfileLevels,
    developing: ProfileLevels | None,
    prior_pocs: Sequence[float] = (),
    warmup_atr: float = 0.0,
) -> RegimeFeatures | None:
    """Compute the feature set. None if the session has not produced enough
    bars to say anything, which is the correct answer for the first minutes
    after the open."""
    if not session_bars:
        return None

    price = session_bars[-1].close
    volatility = atr(session_bars, period=14) or warmup_atr
    if volatility <= 0:
        volatility = max(reference.value_area_width / 10.0, 1e-6)

    session_open = session_bars[0].open
    if session_open > reference.vah:
        open_type = "above_value"
    elif session_open < reference.val:
        open_type = "below_value"
    else:
        open_type = "inside_value"

    if len(prior_pocs) >= 2 and reference.value_area_width > 0:
        steps = [
            (later - earlier) / reference.value_area_width
            for earlier, later in zip(prior_pocs, prior_pocs[1:])
        ]
        migration = sum(steps) / len(steps)
    else:
        migration = 0.0

    closes = [bar.close for bar in session_bars]
    if len(closes) >= 2:
        span = min(len(closes) - 1, 30)
        slope = _safe_div(closes[-1] - closes[-1 - span], volatility) * (10.0 / span)
    else:
        slope = 0.0

    points = swings(session_bars, strength=2)
    higher_lows = sum(
        1 for a, b in zip(points.lows, points.lows[1:]) if b[1] > a[1]
    )
    lower_highs = sum(
        1 for a, b in zip(points.highs, points.highs[1:]) if b[1] < a[1]
    )

    session_range = max(bar.high for bar in session_bars) - min(
        bar.low for bar in session_bars
    )

    return RegimeFeatures(
        price=price,
        atr=volatility,
        open_type=open_type,
        position_vs_reference=reference.position_of(price),
        position_vs_developing=(
            developing.position_of(price) if developing else "unknown"
        ),
        atr_to_reference_poc=_safe_div(reference.poc - price, volatility),
        atr_to_reference_val=_safe_div(reference.val - price, volatility),
        atr_to_reference_vah=_safe_div(reference.vah - price, volatility),
        atr_to_developing_poc=(
            _safe_div(developing.poc - price, volatility) if developing else 0.0
        ),
        poc_migration=migration,
        slope=slope,
        higher_lows=higher_lows,
        lower_highs=lower_highs,
        range_expansion=_safe_div(session_range, reference.range, 1.0),
        bars_into_session=len(session_bars),
    )


def classify(features: RegimeFeatures) -> tuple[Regime, float]:
    """The free classifier. Returns a regime and a confidence in [0, 1].

    A weighted score rather than a decision tree, because the inputs disagree
    often and a tree turns one disagreement into a coin flip. The weights are
    deliberately round numbers: they were chosen to be readable and then left
    alone, since tuning them on the same data used to evaluate the strategy
    would be fitting the referee.
    """
    score = 0.0
    score += 2.0 * max(-1.5, min(1.5, features.poc_migration * 3.0))
    score += 1.5 * max(-1.5, min(1.5, features.slope))
    score += 0.75 * (1 if features.open_type == "above_value" else -1 if features.open_type == "below_value" else 0)
    score += 0.5 * max(-1.5, min(1.5, (features.higher_lows - features.lower_highs) / 2.0))
    if features.position_vs_reference == "above_value":
        score += 0.75
    elif features.position_vs_reference == "below_value":
        score -= 0.75
    if features.range_expansion > 1.3:
        score *= 1.15

    magnitude = min(abs(score) / 4.0, 1.0)
    if score >= 2.5:
        regime: Regime = "strong_uptrend"
    elif score >= 0.9:
        regime = "uptrend"
    elif score <= -2.5:
        regime = "strong_downtrend"
    elif score <= -0.9:
        regime = "downtrend"
    else:
        regime = "balanced"

    # Early in a session there is not enough evidence for a strong call
    # regardless of what the numbers say.
    if features.bars_into_session < 12 and regime in ("strong_uptrend", "strong_downtrend"):
        regime = "uptrend" if score > 0 else "downtrend"
        magnitude *= 0.7

    return regime, round(magnitude, 3)
