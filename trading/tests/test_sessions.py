from __future__ import annotations

import unittest
from datetime import time

from strata_vp.sessions import (
    ASIA,
    LONDON_PLUS_PREMARKET,
    NY_RTH,
    PACIFIC,
    PLANS,
    SessionWindow,
)
from tests.helpers import utc


class TestSessionWindows(unittest.TestCase):
    def test_new_york_open_tracks_daylight_saving(self):
        """The whole reason these are wall clock windows. 06:30 Pacific is
        13:30 UTC in June and 14:30 UTC in January, and a system that stored a
        fixed offset would run an hour off for half the year."""
        summer = NY_RTH.occurrence(utc(2026, 6, 10, 12).astimezone(PACIFIC).date())
        winter = NY_RTH.occurrence(utc(2026, 1, 14, 12).astimezone(PACIFIC).date())
        self.assertEqual(summer[0].hour, 13)
        self.assertEqual(summer[0].minute, 30)
        self.assertEqual(winter[0].hour, 14)
        self.assertEqual(winter[0].minute, 30)

    def test_contains_is_half_open(self):
        opening = NY_RTH.occurrence(utc(2026, 6, 10, 12).astimezone(PACIFIC).date())[0]
        closing = NY_RTH.occurrence(utc(2026, 6, 10, 12).astimezone(PACIFIC).date())[1]
        self.assertTrue(NY_RTH.contains(opening))
        self.assertFalse(NY_RTH.contains(closing))

    def test_window_that_crosses_midnight(self):
        self.assertTrue(ASIA.crosses_midnight)
        # 18:00 Pacific on a Wednesday belongs to Wednesday's Asia session,
        # and 00:30 Pacific on Thursday still belongs to it.
        evening = utc(2026, 6, 11, 1, 0)  # 18:00 Pacific Wednesday
        overnight = utc(2026, 6, 11, 7, 30)  # 00:30 Pacific Thursday
        self.assertTrue(ASIA.contains(evening))
        self.assertTrue(ASIA.contains(overnight))
        self.assertEqual(ASIA.anchor_date(evening), ASIA.anchor_date(overnight))

    def test_weekend_is_not_a_session(self):
        saturday = utc(2026, 6, 13, 17)  # 10:00 Pacific Saturday
        self.assertFalse(NY_RTH.contains(saturday))

    def test_minutes_remaining(self):
        ts = utc(2026, 6, 10, 19, 30)  # 12:30 Pacific, half an hour to the close
        self.assertAlmostEqual(NY_RTH.minutes_remaining(ts), 30.0)
        self.assertIsNone(NY_RTH.minutes_remaining(utc(2026, 6, 10, 23)))

    def test_last_completed_skips_the_weekend(self):
        monday_open = utc(2026, 6, 15, 13, 30)  # Monday 06:30 Pacific
        bounds = NY_RTH.last_completed(monday_open)
        assert bounds is not None
        # The previous New York session is Friday's, not Sunday's.
        self.assertEqual(bounds[0].astimezone(PACIFIC).date().weekday(), 4)

    def test_reference_is_anchored_to_the_session_open_not_to_now(self):
        """A reference profile that changed partway through the session would
        move every level underneath an open position."""
        plan = PLANS["ny_vs_brief"]
        early = plan.reference_bounds(utc(2026, 6, 10, 14, 0))  # 07:00 Pacific
        late = plan.reference_bounds(utc(2026, 6, 10, 19, 0))  # 12:00 Pacific
        self.assertEqual(early, late)
        assert early is not None
        self.assertEqual(early[0].astimezone(PACIFIC).time(), time(3, 0))
        self.assertEqual(early[1].astimezone(PACIFIC).time(), time(6, 30))

    def test_reference_outside_the_trading_session_is_none(self):
        plan = PLANS["ny_vs_brief"]
        self.assertIsNone(plan.reference_bounds(utc(2026, 6, 10, 23, 0)))

    def test_completed_occurrences_are_newest_first(self):
        found = LONDON_PLUS_PREMARKET.completed_occurrences(utc(2026, 6, 11, 13, 30), 3)
        self.assertEqual(len(found), 3)
        self.assertTrue(found[0][0] > found[1][0] > found[2][0])

    def test_stale_reference_returns_none_rather_than_reaching_back(self):
        holiday = SessionWindow("rare", time(6, 30), time(7, 0), weekdays=(0,))
        # Searching three days back from a Thursday cannot reach Monday.
        self.assertIsNone(holiday.last_completed(utc(2026, 6, 11, 20), search_days=2))


if __name__ == "__main__":
    unittest.main()
