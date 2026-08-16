"""The strategy.

Stated as a sentence: when price has been rejected from both the previous
session's value area and the current session's developing value area, wait for
a fair value gap, and take the rotation back toward the previous session's
point of control.

It is written in two stages, arm and trigger, because that is how the trade
actually works and collapsing them into one test breaks it. The profile
conditions describe a state that lasts for many bars. The fair value gap is an
event that happens on one. Requiring both on the same closed bar means only
catching the setups where the gap happened to form on the exact bar the
condition became true, which in testing was almost none of them, and the ones
it did catch were not a representative sample of anything.

So: the profile conditions arm a side, and the arm stays live for a fixed
number of bars. While a side is armed, any qualifying gap triggers it. This is
also what a person does. They decide the market is set up long, and then they
wait for their entry.

ARM, long. All four, on the same closed bar:

  1. Session and timing. Inside the traded session, past the warmup, far
     enough from the close that the target is reachable.
  2. Reference excursion. Price traded down to the zone taken from the
     previous session's profile within the last few bars. The zone is normally
     the value area low. In a session the regime layer calls a strong uptrend
     it becomes the point of control, which is the discretion the brief asks
     for: in a one directional session price often never reaches the far side
     of value.
  3. Developing excursion. Price also traded below the current session's
     developing value area low within the last few bars. This is the second
     half of "oversold on both profiles" and it is what stops the strategy
     buying a level that today's auction has already accepted as fair.
  4. Not already over. Price has not yet completed the rotation it would be
     buying. Once it is at the target the setup is a memory.

TRIGGER, long. While armed:

  5. A bullish fair value gap in the band between the zone and the current
     price, not already mostly filled.
  6. Geometry. The target far enough beyond the entry, relative to the stop,
     to clear the minimum reward to risk. This one rejects more setups than
     anything else and it is the reason the system is selective rather than
     busy.

One deliberate departure from the brief. The brief says to buy while oversold,
that is, while price is below both value area lows. That is a knife catch:
below value is a bearish state at least as often as a stretched one.
`entry_mode` therefore defaults to `value_reentry`, which waits for price to
reclaim the level after the excursion, which is the Dalton formulation: leave
value, fail to find acceptance, rotate. `outside_value` implements the brief
literally and is one config line away, so a backtest can settle it rather than
an argument.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from datetime import date, datetime
from typing import Literal, Sequence

from .bars import Bar, atr
from .gemini import GeminiJudge, Verdict
from .pdarray import FVG, FVGTracker
from .profile import ProfileLevels, VolumeProfile, build_profile
from .regime import RegimeFeatures, measure
from .sessions import SessionPlan

Side = Literal["long", "short"]


@dataclass(frozen=True, slots=True)
class StrategyConfig:
    # Instrument.
    tick_size: float = 0.25
    # Dollars per point per contract. The default is the micro Nasdaq, MNQ,
    # not the full size NQ at 20, and that is a considered choice rather than
    # a timid one. A 50 point stop is 1000 dollars on NQ, which is 40 percent
    # of a typical 50k account's entire trailing drawdown on a single trade.
    # The same stop on MNQ is 100 dollars, which is a position an account can
    # survive being wrong about four times in a row.
    point_value: float = 2.0
    bin_size: float = 1.0

    # Profile.
    value_area_pct: float = 0.70
    distribution: str = "uniform"
    reference_lookback_sessions: int = 4  # for point of control migration

    # Arming.
    entry_mode: Literal["value_reentry", "outside_value"] = "value_reentry"
    excursion_max_age_bars: int = 20
    setup_valid_bars: int = 12

    # Trigger.
    fill_mode: Literal["limit", "market"] = "limit"
    limit_valid_bars: int = 8
    require_fvg: bool = True
    min_fvg_points: float = 2.0
    fvg_max_age_bars: int = 40
    fvg_max_fill: float = 0.5
    zone_slack_points: float = 4.0
    zone_slack_atr: float = 0.75

    # Exits.
    stop_points: float = 50.0
    stop_mode: Literal["fixed", "structure", "tighter_of"] = "fixed"
    structure_buffer_points: float = 4.0
    max_stop_points: float = 60.0
    min_reward_risk: float = 1.2
    breakeven_at_r: float = 1.0  # move the stop to entry once this much is banked

    # Gating.
    min_bars_into_session: int = 15
    no_new_trades_before_close_min: float = 45.0
    max_signals_per_session: int = 3
    min_trend_confidence: float = 0.35  # to trade the point of control variant
    min_reference_volume: float = 0.0

    def slack(self, volatility: float) -> float:
        return max(self.zone_slack_points, self.zone_slack_atr * volatility)


@dataclass(frozen=True, slots=True)
class Signal:
    ts: datetime
    side: Side
    entry: float
    stop: float
    target: float
    zone_name: str
    zone_price: float
    fvg: FVG | None
    reference: ProfileLevels
    developing: ProfileLevels
    verdict: Verdict
    fill_mode: str
    expires_after_bars: int
    armed_bars_ago: int = 0

    @property
    def risk_points(self) -> float:
        return abs(self.entry - self.stop)

    @property
    def reward_points(self) -> float:
        return abs(self.target - self.entry)

    @property
    def reward_risk(self) -> float:
        return self.reward_points / self.risk_points if self.risk_points else 0.0

    def as_dict(self) -> dict[str, object]:
        return {
            "ts": self.ts.isoformat(),
            "side": self.side,
            "entry": round(self.entry, 2),
            "stop": round(self.stop, 2),
            "target": round(self.target, 2),
            "risk_points": round(self.risk_points, 2),
            "reward_risk": round(self.reward_risk, 2),
            "zone": self.zone_name,
            "zone_price": round(self.zone_price, 2),
            "regime": self.verdict.regime,
            "verdict_source": self.verdict.source,
            "armed_bars_ago": self.armed_bars_ago,
            "fvg": self.fvg.as_dict() if self.fvg else None,
            "reference": self.reference.as_dict(),
        }


@dataclass(slots=True)
class Armed:
    side: Side
    zone_name: str
    zone_price: float
    armed_index: int
    verdict: Verdict


@dataclass(slots=True)
class Rejection:
    ts: datetime
    side: Side
    reason: str


class Strategy:
    """Stateful over a session. Feed it every closed bar, in order.

    Holds its own history so it can rebuild the reference profile at each
    session open without the caller having to know which bars matter.
    """

    def __init__(
        self,
        config: StrategyConfig,
        plan: SessionPlan,
        judge: GeminiJudge | None = None,
        *,
        history_bars: int = 6000,
    ) -> None:
        self.config = config
        self.plan = plan
        self.judge = judge or GeminiJudge(enabled=False)
        self._history: list[Bar] = []
        self._history_cap = history_bars

        self._anchor: date | None = None
        self._session: list[Bar] = []
        self._developing = self._new_profile()
        self._tracker = self._new_tracker()
        self._reference: ProfileLevels | None = None
        self._prior_pocs: list[float] = []
        self._last_touch: dict[str, int] = {}
        self._armed: dict[str, Armed] = {}
        self._signals_this_session = 0

        self.rejections: list[Rejection] = []
        self.armings: list[Armed] = []
        self.last_features: RegimeFeatures | None = None
        self.last_verdict: Verdict | None = None

    # Session lifecycle -----------------------------------------------------

    def _new_profile(self) -> VolumeProfile:
        return VolumeProfile(
            bin_size=self.config.bin_size,
            value_area_pct=self.config.value_area_pct,
            distribution=self.config.distribution,
        )

    def _new_tracker(self) -> FVGTracker:
        return FVGTracker(
            min_size=self.config.min_fvg_points,
            max_age_bars=self.config.fvg_max_age_bars,
        )

    @property
    def in_session(self) -> bool:
        return self._anchor is not None

    @property
    def reference(self) -> ProfileLevels | None:
        return self._reference

    @property
    def developing(self) -> ProfileLevels | None:
        return self._developing.levels()

    @property
    def session_bars(self) -> Sequence[Bar]:
        return self._session

    @property
    def armed(self) -> dict[str, Armed]:
        return dict(self._armed)

    def _open_session(self, anchor: date, ts: datetime) -> None:
        self._anchor = anchor
        self._session = []
        self._developing = self._new_profile()
        self._tracker = self._new_tracker()
        self._last_touch = {}
        self._armed = {}
        self._signals_this_session = 0
        self._reference = self._build_reference(ts)
        self._prior_pocs = self._build_prior_pocs(ts)

    def _close_session(self) -> None:
        self._anchor = None
        self._session = []
        self._reference = None
        self._armed = {}

    def _bars_between(self, start: datetime, end: datetime) -> list[Bar]:
        return [bar for bar in self._history if start <= bar.ts < end]

    def _build_reference(self, ts: datetime) -> ProfileLevels | None:
        bounds = self.plan.reference_bounds(ts)
        if bounds is None:
            return None
        bars = self._bars_between(*bounds)
        if not bars:
            return None
        levels = build_profile(
            bars,
            bin_size=self.config.bin_size,
            value_area_pct=self.config.value_area_pct,
            distribution=self.config.distribution,
        )
        if levels and levels.total_volume < self.config.min_reference_volume:
            return None
        return levels

    def _build_prior_pocs(self, ts: datetime) -> list[float]:
        """Points of control of the last few reference sessions, oldest first.
        The regime layer reads the migration of these as the trend."""
        trading = self.plan.trade.bounds_for(ts)
        if trading is None:
            return []
        occurrences = self.plan.reference.completed_occurrences(
            trading[0], self.config.reference_lookback_sessions
        )
        pocs: list[float] = []
        for start, end in reversed(occurrences):
            bars = self._bars_between(start, end)
            if not bars:
                continue
            levels = build_profile(
                bars,
                bin_size=self.config.bin_size,
                value_area_pct=self.config.value_area_pct,
                distribution=self.config.distribution,
            )
            if levels:
                pocs.append(levels.poc)
        return pocs

    # The loop --------------------------------------------------------------

    def on_bar(self, bar: Bar) -> Signal | None:
        self._history.append(bar)
        if len(self._history) > self._history_cap:
            del self._history[: len(self._history) - self._history_cap]

        anchor = self.plan.trade.anchor_date(bar.ts)
        if anchor is None:
            if self._anchor is not None:
                self._close_session()
            return None
        if anchor != self._anchor:
            self._open_session(anchor, bar.ts)

        self._session.append(bar)
        self._developing.add_bar(bar)
        self._tracker.on_bar(bar)
        self._record_touches(bar)

        return self._evaluate(bar)

    def _record_touches(self, bar: Bar) -> None:
        index = len(self._session) - 1
        volatility = atr(self._session) or self.config.tick_size * 4
        slack = self.config.slack(volatility)
        reference = self._reference
        if reference is not None:
            if bar.low <= reference.val + slack:
                self._last_touch["ref_val"] = index
            if bar.low <= reference.poc + slack:
                self._last_touch["ref_poc_from_above"] = index
            if bar.high >= reference.vah - slack:
                self._last_touch["ref_vah"] = index
            if bar.high >= reference.poc - slack:
                self._last_touch["ref_poc_from_below"] = index
        developing = self._developing.levels()
        if developing is not None:
            if bar.low <= developing.val:
                self._last_touch["dev_val"] = index
            if bar.high >= developing.vah:
                self._last_touch["dev_vah"] = index

    def _recent(self, key: str) -> bool:
        index = self._last_touch.get(key)
        if index is None:
            return False
        return (len(self._session) - 1 - index) <= self.config.excursion_max_age_bars

    def _reject(self, bar: Bar, side: Side, reason: str) -> None:
        self.rejections.append(Rejection(bar.ts, side, reason))

    def _evaluate(self, bar: Bar) -> Signal | None:
        config = self.config
        reference = self._reference
        developing = self._developing.levels()

        if reference is None or developing is None:
            return None

        self._expire_arms(bar, reference)

        if len(self._session) < config.min_bars_into_session:
            return None
        if self._signals_this_session >= config.max_signals_per_session:
            return None
        remaining = self.plan.trade.minutes_remaining(bar.ts)
        if remaining is not None and remaining < config.no_new_trades_before_close_min:
            return None

        volatility = atr(self._session) or config.tick_size * 4

        # An armed side is triggered before anything new is armed, so that a
        # gap forming on this bar is used by the setup that was waiting for it
        # rather than by a fresh arm created on the same bar.
        for side in ("long", "short"):
            setup = self._armed.get(side)
            if setup is None:
                continue
            signal = self._trigger(bar, setup, reference, developing, volatility)
            if signal is not None:
                del self._armed[side]
                self._signals_this_session += 1
                return signal

        long_possible = self._recent("dev_val") and (
            self._recent("ref_val") or self._recent("ref_poc_from_above")
        )
        short_possible = self._recent("dev_vah") and (
            self._recent("ref_vah") or self._recent("ref_poc_from_below")
        )
        if not long_possible and not short_possible:
            return None

        features = measure(
            session_bars=self._session,
            reference=reference,
            developing=developing,
            prior_pocs=self._prior_pocs,
            warmup_atr=volatility,
        )
        if features is None:
            return None
        self.last_features = features

        verdict = self.judge.judge(
            features, cache_key=f"{self._anchor}:{len(self._session) // 5}"
        )
        self.last_verdict = verdict

        for side, possible in (("long", long_possible), ("short", short_possible)):
            if possible and side not in self._armed:
                self._try_arm(bar, side, reference, verdict, volatility)
        return None

    # Arming ----------------------------------------------------------------

    def _try_arm(
        self,
        bar: Bar,
        side: Side,
        reference: ProfileLevels,
        verdict: Verdict,
        volatility: float,
    ) -> None:
        config = self.config
        long = side == "long"

        if not verdict.allows(side):
            self._reject(bar, side, f"regime {verdict.regime} vetoes {side}")
            return

        zone_name = verdict.zone_for(side)
        if zone_name == "none":
            self._reject(bar, side, "no entry zone offered")
            return
        if zone_name == "point_of_control":
            if verdict.confidence < config.min_trend_confidence:
                self._reject(bar, side, "point of control entry needs more confidence")
                return
            zone_price = reference.poc
            touch_key = "ref_poc_from_above" if long else "ref_poc_from_below"
        else:
            zone_price = reference.val if long else reference.vah
            touch_key = "ref_val" if long else "ref_vah"

        if not self._recent(touch_key):
            self._reject(bar, side, f"no recent excursion to {zone_name}")
            return

        slack = config.slack(volatility)
        if config.entry_mode == "outside_value":
            outside = bar.close <= zone_price + slack if long else bar.close >= zone_price - slack
            if not outside:
                self._reject(bar, side, "not outside value")
                return
        else:
            reclaimed = bar.close > zone_price if long else bar.close < zone_price
            if not reclaimed:
                self._reject(bar, side, "level not reclaimed yet")
                return

        if self._rotation_complete(side, zone_name, bar.close, reference):
            self._reject(bar, side, "rotation already complete")
            return

        setup = Armed(
            side=side,
            zone_name=zone_name,
            zone_price=zone_price,
            armed_index=len(self._session) - 1,
            verdict=verdict,
        )
        self._armed[side] = setup
        self.armings.append(setup)

    def _rotation_complete(
        self, side: Side, zone_name: str, price: float, reference: ProfileLevels
    ) -> bool:
        """The trade is the rotation from the zone to the target. Once price is
        already there, buying it is buying the end of the move that was the
        setup."""
        if side == "long":
            ceiling = reference.vah if zone_name == "point_of_control" else reference.poc
            return price >= ceiling
        floor = reference.val if zone_name == "point_of_control" else reference.poc
        return price <= floor

    def _expire_arms(self, bar: Bar, reference: ProfileLevels) -> None:
        index = len(self._session) - 1
        for side in list(self._armed):
            setup = self._armed[side]
            if index - setup.armed_index > self.config.setup_valid_bars:
                self._reject(bar, setup.side, "setup expired before a trigger")
                del self._armed[side]
            elif self._rotation_complete(setup.side, setup.zone_name, bar.close, reference):
                self._reject(bar, setup.side, "rotation completed while armed")
                del self._armed[side]

    # Triggering ------------------------------------------------------------

    def _trigger(
        self,
        bar: Bar,
        setup: Armed,
        reference: ProfileLevels,
        developing: ProfileLevels,
        volatility: float,
    ) -> Signal | None:
        config = self.config
        side = setup.side
        long = side == "long"
        slack = config.slack(volatility)

        gap: FVG | None = None
        if config.require_fvg:
            band_low, band_high = self._gap_band(side, setup.zone_price, slack, bar.close)
            gap = self._tracker.best_in_zone(
                "bullish" if long else "bearish",
                band_low,
                band_high,
                max_fill=config.fvg_max_fill,
            )
            if gap is None:
                return None

        if config.fill_mode == "limit" and gap is not None:
            entry = gap.unfilled_entry()
            # A limit that is already through is not a limit, it is a worse
            # market order. Fall back rather than book a fill we could not get.
            if (long and entry > bar.close) or (not long and entry < bar.close):
                entry = bar.close
        else:
            entry = bar.close

        target = self._target_price(side, setup.verdict, reference, entry)
        if target is None:
            self._reject(bar, side, "no target beyond entry")
            return None

        stop = self._stop_price(side, entry, gap)
        risk = abs(entry - stop)
        if risk <= 0:
            self._reject(bar, side, "degenerate stop")
            return None
        if risk > config.max_stop_points:
            self._reject(bar, side, f"stop {risk:.0f} points over the cap")
            return None

        reward_risk = abs(target - entry) / risk
        if reward_risk < config.min_reward_risk:
            self._reject(bar, side, "reward to risk below the floor")
            return None

        return Signal(
            ts=bar.ts,
            side=side,
            entry=_round_to_tick(entry, config.tick_size),
            stop=_round_to_tick(stop, config.tick_size),
            target=_round_to_tick(target, config.tick_size),
            zone_name=setup.zone_name,
            zone_price=setup.zone_price,
            fvg=gap,
            reference=reference,
            developing=developing,
            verdict=setup.verdict,
            fill_mode=config.fill_mode,
            expires_after_bars=config.limit_valid_bars,
            armed_bars_ago=len(self._session) - 1 - setup.armed_index,
        )

    def _gap_band(
        self, side: Side, zone_price: float, slack: float, close: float
    ) -> tuple[float, float]:
        """Where a valid trigger gap may sit.

        Symmetric around the level when the entry is taken outside value,
        because there the level itself is the entry. Stretched to the current
        price on a reclaim, because there the impulse that reclaimed the level
        is what leaves the gap, and that gap sits above the level by however
        far the impulse ran. Searching only next to the level would find the
        gap on a slow reclaim and miss it on a fast one, which is backwards.

        Nothing is lost by the wider band. A gap far from the level produces an
        entry far from the level, and the reward to risk test rejects it a few
        lines later because the point of control is no longer far enough away.
        """
        if self.config.entry_mode == "outside_value":
            return zone_price - slack, zone_price + slack
        if side == "long":
            return zone_price - slack, max(close, zone_price + slack)
        return min(close, zone_price - slack), zone_price + slack

    def _target_price(
        self, side: Side, verdict: Verdict, reference: ProfileLevels, entry: float
    ) -> float | None:
        long = side == "long"
        named = verdict.target_for(side)
        if named == "point_of_control":
            candidates = [reference.poc, reference.vah if long else reference.val]
        elif named == "value_area_high":
            candidates = [reference.vah, reference.poc]
        elif named == "value_area_low":
            candidates = [reference.val, reference.poc]
        else:
            candidates = [reference.poc]
        for price in candidates:
            if (long and price > entry) or (not long and price < entry):
                return price
        return None

    def _stop_price(self, side: Side, entry: float, gap: FVG | None) -> float:
        config = self.config
        long = side == "long"
        fixed = entry - config.stop_points if long else entry + config.stop_points
        if config.stop_mode == "fixed" or gap is None:
            return fixed
        buffer = config.structure_buffer_points
        structural = gap.distal - buffer if long else gap.distal + buffer
        if config.stop_mode == "structure":
            return structural
        # tighter_of: whichever sits closer to the entry.
        return max(fixed, structural) if long else min(fixed, structural)


def _round_to_tick(price: float, tick: float) -> float:
    if tick <= 0:
        return price
    return round(round(price / tick) * tick, 10)
