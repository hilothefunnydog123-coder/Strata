"""Session windows in Pacific wall clock time.

The strategy is defined in terms of sessions, so this module has to be right
before anything above it can be. Two things it gets right that a naive
implementation gets wrong:

  1. Daylight saving. The windows are wall clock times in America/Los_Angeles,
     which is what "6:30 PST" means in practice when someone says it in July.
     Storing them as fixed UTC offsets would drift the New York open by an hour
     twice a year and quietly ruin every profile for a week.

  2. Windows that cross midnight. The Asia session starts the evening before
     the day it belongs to, so an occurrence is anchored to its start date and
     may end on the following calendar date.

The default windows are the ones in the strategy brief. They are configuration,
not constants, because the brief's "Asia plus London" window of 03:00 to 06:30
Pacific is really London plus the New York pre market: true Asia trades from
about 17:00 Pacific the previous day. Both are provided. Which one is the
better reference profile is a question for the backtest, not for this file.
"""

from __future__ import annotations

from dataclasses import dataclass
from datetime import date, datetime, time, timedelta, timezone
from typing import Iterator, Sequence
from zoneinfo import ZoneInfo

PACIFIC = ZoneInfo("America/Los_Angeles")


@dataclass(frozen=True, slots=True)
class SessionWindow:
    """A recurring wall clock window, half open: start inclusive, end exclusive."""

    name: str
    start: time
    end: time
    tz: ZoneInfo = PACIFIC
    weekdays: tuple[int, ...] = (0, 1, 2, 3, 4)  # Monday is 0

    @property
    def crosses_midnight(self) -> bool:
        return self.end <= self.start

    def occurrence(self, anchor: date) -> tuple[datetime, datetime]:
        """The window anchored to its start date, returned in UTC."""
        start_local = datetime.combine(anchor, self.start, tzinfo=self.tz)
        end_date = anchor + timedelta(days=1) if self.crosses_midnight else anchor
        end_local = datetime.combine(end_date, self.end, tzinfo=self.tz)
        return start_local.astimezone(timezone.utc), end_local.astimezone(timezone.utc)

    def anchor_date(self, ts: datetime) -> date | None:
        """The start date of the occurrence containing `ts`, or None."""
        local = ts.astimezone(self.tz)
        candidates = [local.date()]
        if self.crosses_midnight:
            candidates.append(local.date() - timedelta(days=1))
        for anchor in candidates:
            if anchor.weekday() not in self.weekdays:
                continue
            start, end = self.occurrence(anchor)
            if start <= ts < end:
                return anchor
        return None

    def contains(self, ts: datetime) -> bool:
        return self.anchor_date(ts) is not None

    def bounds_for(self, ts: datetime) -> tuple[datetime, datetime] | None:
        anchor = self.anchor_date(ts)
        return None if anchor is None else self.occurrence(anchor)

    def minutes_remaining(self, ts: datetime) -> float | None:
        bounds = self.bounds_for(ts)
        if bounds is None:
            return None
        return (bounds[1] - ts).total_seconds() / 60.0

    def last_completed(self, before: datetime, *, search_days: int = 10) -> tuple[datetime, datetime] | None:
        """The most recent occurrence that had already ended at `before`.

        `search_days` covers a long weekend plus a holiday. Returning None
        rather than reaching further back is deliberate: a reference profile
        from eight sessions ago is not a reference profile, and the caller
        should stand down instead of trading against a stale one.
        """
        local_date = before.astimezone(self.tz).date()
        for offset in range(0, search_days + 1):
            anchor = local_date - timedelta(days=offset)
            if anchor.weekday() not in self.weekdays:
                continue
            start, end = self.occurrence(anchor)
            if end <= before:
                return start, end
        return None

    def completed_occurrences(
        self, before: datetime, count: int, *, search_days: int = 20
    ) -> list[tuple[datetime, datetime]]:
        """The last `count` completed occurrences, most recent first."""
        found: list[tuple[datetime, datetime]] = []
        local_date = before.astimezone(self.tz).date()
        for offset in range(0, search_days + 1):
            if len(found) >= count:
                break
            anchor = local_date - timedelta(days=offset)
            if anchor.weekday() not in self.weekdays:
                continue
            start, end = self.occurrence(anchor)
            if end <= before:
                found.append((start, end))
        return found


@dataclass(frozen=True, slots=True)
class SessionPlan:
    """A session we trade, plus the window whose profile we trade it against."""

    trade: SessionWindow
    reference: SessionWindow

    def reference_bounds(self, ts: datetime) -> tuple[datetime, datetime] | None:
        """The reference window to use while trading at `ts`.

        Anchored to the trading session's open rather than to `ts` itself, so
        the reference profile does not change underneath the strategy partway
        through a session.
        """
        trading = self.trade.bounds_for(ts)
        if trading is None:
            return None
        return self.reference.last_completed(trading[0])


# The windows from the strategy brief, in Pacific wall clock time.
NY_RTH = SessionWindow("ny_rth", time(6, 30), time(13, 0))
LONDON_PLUS_PREMARKET = SessionWindow("london_premarket", time(3, 0), time(6, 30))
ASIA = SessionWindow("asia", time(17, 0), time(1, 0), weekdays=(6, 0, 1, 2, 3))
LONDON = SessionWindow("london", time(0, 0), time(6, 30))
ASIA_PLUS_LONDON = SessionWindow("asia_london", time(17, 0), time(6, 30), weekdays=(6, 0, 1, 2, 3))
GLOBEX_OVERNIGHT = SessionWindow("globex", time(15, 0), time(6, 30), weekdays=(6, 0, 1, 2, 3))

PLANS: dict[str, SessionPlan] = {
    # The brief as written: trade New York against 03:00 to 06:30 Pacific.
    "ny_vs_brief": SessionPlan(NY_RTH, LONDON_PLUS_PREMARKET),
    # The same idea with the overnight session it was probably meant to name.
    "ny_vs_overnight": SessionPlan(NY_RTH, ASIA_PLUS_LONDON),
    # Trade the overnight against the New York cash session that preceded it.
    "london_vs_ny": SessionPlan(LONDON, NY_RTH),
    "asia_vs_ny": SessionPlan(ASIA, NY_RTH),
}


def session_bars(bars: Sequence, start: datetime, end: datetime) -> list:
    """Bars whose open timestamp falls inside [start, end)."""
    return [bar for bar in bars if start <= bar.ts < end]


def iter_session_days(
    window: SessionWindow, first: datetime, last: datetime
) -> Iterator[tuple[datetime, datetime]]:
    anchor = first.astimezone(window.tz).date()
    stop = last.astimezone(window.tz).date()
    while anchor <= stop:
        if anchor.weekday() in window.weekdays:
            yield window.occurrence(anchor)
        anchor += timedelta(days=1)
