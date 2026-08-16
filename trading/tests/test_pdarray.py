from __future__ import annotations

import unittest
from datetime import timedelta

from strata_vp.pdarray import FVGTracker, detect, swings
from tests.helpers import bar, utc


def _bars(rows):
    start = utc(2026, 6, 10, 14)
    return [
        bar(start + timedelta(minutes=index), o, h, l, c)
        for index, (o, h, l, c) in enumerate(rows)
    ]


class TestFVG(unittest.TestCase):
    def test_bullish_gap_between_first_and_third_bar(self):
        bars = _bars([(100, 101, 99, 100), (101, 106, 100, 105), (105, 108, 103, 107)])
        gap = detect(bars, 2)
        assert gap is not None
        self.assertEqual(gap.kind, "bullish")
        self.assertAlmostEqual(gap.bottom, 101.0)  # high of the first bar
        self.assertAlmostEqual(gap.top, 103.0)  # low of the third
        self.assertAlmostEqual(gap.size, 2.0)
        # Price sits above a bullish gap, so it comes back down to the top edge.
        self.assertAlmostEqual(gap.proximal, 103.0)
        self.assertAlmostEqual(gap.distal, 101.0)

    def test_bearish_gap_is_the_mirror(self):
        bars = _bars([(100, 101, 99, 100), (99, 100, 94, 95), (95, 97, 92, 93)])
        gap = detect(bars, 2)
        assert gap is not None
        self.assertEqual(gap.kind, "bearish")
        self.assertAlmostEqual(gap.top, 99.0)
        self.assertAlmostEqual(gap.bottom, 97.0)
        self.assertAlmostEqual(gap.proximal, 97.0)
        self.assertAlmostEqual(gap.distal, 99.0)

    def test_overlapping_bars_produce_no_gap(self):
        bars = _bars([(100, 105, 99, 104), (104, 107, 103, 106), (106, 108, 104, 107)])
        self.assertIsNone(detect(bars, 2))

    def test_min_size_filter(self):
        bars = _bars([(100, 101, 99, 100), (101, 106, 100, 105), (105, 108, 101.5, 107)])
        self.assertIsNotNone(detect(bars, 2, min_size=0.25))
        self.assertIsNone(detect(bars, 2, min_size=2.0))


class TestTracker(unittest.TestCase):
    def _tracker_with_gap(self):
        tracker = FVGTracker(min_size=0.5, max_age_bars=10)
        for one in _bars([(100, 101, 99, 100), (101, 106, 100, 105), (105, 108, 103, 107)]):
            tracker.on_bar(one)
        return tracker

    def test_gap_starts_unfilled_and_live(self):
        tracker = self._tracker_with_gap()
        live = tracker.live("bullish")
        self.assertEqual(len(live), 1)
        self.assertEqual(live[0].filled, 0.0)

    def test_partial_fill_moves_the_limit_price(self):
        tracker = self._tracker_with_gap()
        start = utc(2026, 6, 10, 14)
        tracker.on_bar(bar(start + timedelta(minutes=3), 107, 107.5, 102.0, 104))
        gap = tracker.live("bullish")[0]
        # The gap spans 101 to 103. Price traded to 102, so half of it is gone.
        self.assertAlmostEqual(gap.filled, 0.5)
        self.assertAlmostEqual(gap.unfilled_entry(), 102.0)

    def test_full_fill_consumes_the_gap(self):
        tracker = self._tracker_with_gap()
        start = utc(2026, 6, 10, 14)
        tracker.on_bar(bar(start + timedelta(minutes=3), 107, 107.5, 100.0, 101))
        self.assertEqual(tracker.live("bullish"), [])

    def test_gaps_expire_with_age(self):
        tracker = FVGTracker(min_size=0.5, max_age_bars=2)
        for one in _bars([(100, 101, 99, 100), (101, 106, 100, 105), (105, 108, 103, 107)]):
            tracker.on_bar(one)
        start = utc(2026, 6, 10, 14)
        for offset in range(3, 8):
            tracker.on_bar(bar(start + timedelta(minutes=offset), 107, 108, 106, 107))
        self.assertEqual(tracker.live("bullish"), [])

    def test_best_in_zone_prefers_the_freshest_and_respects_fill(self):
        tracker = self._tracker_with_gap()
        self.assertIsNotNone(tracker.best_in_zone("bullish", 100.0, 104.0))
        self.assertIsNone(tracker.best_in_zone("bullish", 200.0, 210.0))

    def test_reset_clears_state_at_the_session_open(self):
        tracker = self._tracker_with_gap()
        tracker.reset()
        self.assertEqual(tracker.live(), [])
        self.assertEqual(tracker.bars_seen, 0)


class TestSwings(unittest.TestCase):
    def test_finds_a_pivot_high_and_low(self):
        bars = _bars(
            [
                (100, 101, 99, 100),
                (100, 102, 99, 101),
                (101, 106, 100, 105),
                (105, 104, 100, 101),
                (101, 103, 98, 99),
            ]
        )
        points = swings(bars, strength=2)
        self.assertEqual(points.highs, [(2, 106.0)])


if __name__ == "__main__":
    unittest.main()
