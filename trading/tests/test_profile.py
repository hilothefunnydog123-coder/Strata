from __future__ import annotations

import unittest

from strata_vp.profile import VolumeProfile, build_profile
from tests.helpers import bar, flat_bar, utc


class TestVolumeProfile(unittest.TestCase):
    def test_empty_profile_has_no_levels(self):
        self.assertIsNone(VolumeProfile().levels())

    def test_zero_volume_bars_produce_no_levels(self):
        profile = VolumeProfile()
        profile.add_bar(bar(utc(2026, 6, 10, 14), 100, 101, 99, 100, v=0.0))
        self.assertIsNone(profile.levels())

    def test_known_histogram_gives_known_levels(self):
        """Five single price bars with volumes 5, 20, 50, 30, 5 across rows
        98 to 102. The value area algorithm adds two rows at a time from the
        point of control toward whichever side holds more volume, so the first
        expansion takes rows 101 and 102 (35) rather than 99 and 98 (25), and
        the 70 percent threshold is crossed there."""
        profile = VolumeProfile(bin_size=1.0)
        start = utc(2026, 6, 10, 14)
        for offset, (price, volume) in enumerate(
            [(98.5, 5), (99.5, 20), (100.5, 50), (101.5, 30), (102.5, 5)]
        ):
            profile.add_bar(flat_bar(start.replace(minute=offset), price, volume))

        result = profile.levels()
        assert result is not None
        self.assertAlmostEqual(result.poc, 100.5)
        self.assertAlmostEqual(result.val, 100.0)
        self.assertAlmostEqual(result.vah, 103.0)
        self.assertAlmostEqual(result.total_volume, 110.0)

    def test_value_area_covers_at_least_the_requested_share(self):
        profile = VolumeProfile(bin_size=1.0, value_area_pct=0.70)
        start = utc(2026, 6, 10, 14)
        # A rough bell so the value area has to expand several times.
        volumes = [2, 6, 14, 30, 55, 80, 55, 30, 14, 6, 2]
        for offset, volume in enumerate(volumes):
            profile.add_bar(flat_bar(start.replace(minute=offset), 100.5 + offset, volume))

        result = profile.levels()
        assert result is not None
        inside = sum(
            volume
            for price, volume in profile.rows()
            if result.val <= price + 0.5 <= result.vah
        )
        self.assertGreaterEqual(inside / result.total_volume, 0.70)
        self.assertLessEqual(result.val, result.poc)
        self.assertLessEqual(result.poc, result.vah)

    def test_uniform_distribution_splits_by_overlap(self):
        profile = VolumeProfile(bin_size=1.0, distribution="uniform")
        profile.add_bar(bar(utc(2026, 6, 10, 14), 100, 102, 100, 101, v=300))
        rows = dict(profile.rows())
        # The bar spans [100, 102), touching rows 100 and 101 equally. Row 102
        # has zero width overlap and must not receive volume.
        self.assertAlmostEqual(rows[100.0], 150.0)
        self.assertAlmostEqual(rows[101.0], 150.0)
        self.assertNotIn(102.0, rows)
        self.assertAlmostEqual(profile.total_volume, 300.0)

    def test_typical_distribution_concentrates_near_the_typical_price(self):
        uniform = VolumeProfile(bin_size=1.0, distribution="uniform")
        typical = VolumeProfile(bin_size=1.0, distribution="typical")
        wide = bar(utc(2026, 6, 10, 14), 100, 110, 100, 101, v=1000)
        uniform.add_bar(wide)
        typical.add_bar(wide)
        # Typical price is (110 + 100 + 101) / 3, just above 103.
        self.assertGreater(dict(typical.rows())[103.0], dict(uniform.rows())[103.0])
        self.assertAlmostEqual(typical.total_volume, uniform.total_volume)

    def test_point_of_control_tie_breaks_toward_the_mean(self):
        profile = VolumeProfile(bin_size=1.0)
        start = utc(2026, 6, 10, 14)
        # Two rows tie at 100, with the bulk of the rest of the volume high.
        for offset, (price, volume) in enumerate(
            [(90.5, 100), (99.5, 40), (100.5, 100), (101.5, 40)]
        ):
            profile.add_bar(flat_bar(start.replace(minute=offset), price, volume))
        result = profile.levels()
        assert result is not None
        # The volume weighted mean sits between the two tied rows but closer to
        # 100.5, so that is the one to pick.
        self.assertAlmostEqual(result.poc, 100.5)

    def test_incremental_equals_batch(self):
        start = utc(2026, 6, 10, 14)
        bars = [
            bar(start.replace(minute=index), 100 + index, 102 + index, 99 + index, 101 + index, v=50 + index)
            for index in range(30)
        ]
        batch = build_profile(bars, bin_size=1.0)
        incremental = VolumeProfile(bin_size=1.0)
        for one in bars:
            incremental.add_bar(one)
        assert batch is not None
        self.assertEqual(batch, incremental.levels())

    def test_bin_size_must_be_positive(self):
        with self.assertRaises(ValueError):
            VolumeProfile(bin_size=0.0)


if __name__ == "__main__":
    unittest.main()
