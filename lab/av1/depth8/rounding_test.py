#!/usr/bin/env python3
import unittest

import numpy as np

import rounding


class View8(unittest.TestCase):
    def test_rounds_to_nearest_level(self):
        """Every 10-bit code lands within half an 8-bit step of itself, unbiased, with RMS step ÷ √12 (±1 %)."""
        y = np.arange(1024)
        e = rounding.view8(y, 10) - y
        self.assertLessEqual(np.abs(e).max(), rounding.STEP / 2 + 1e-9)
        self.assertLess(abs(e.mean()), 0.01)
        self.assertAlmostEqual(rounding.rounding_rms(10) / (rounding.STEP / np.sqrt(12)), 1, delta=0.01)

    def test_full_range(self):
        """256 levels, the ends kept: 0 reads back 0 and 1023 reads back 1023."""
        y = np.arange(1024)
        self.assertEqual(len(np.unique(rounding.view8(y, 10))), 256)
        self.assertEqual(rounding.view8(np.array([0, 1023]), 10).tolist(), [0, 1023])

    def test_twelve_bit_in_source_units(self):
        """On a 12-bit series a level reads back four times its 10-bit value, so its RMS is four times."""
        y = np.arange(1024)
        np.testing.assert_allclose(rounding.view8(y, 12), 4 * rounding.view8(y, 10))
        self.assertAlmostEqual(rounding.rounding_rms(12), 4 * rounding.rounding_rms(10))


class Plan(unittest.TestCase):
    series = {"sigma": [1.0, 1.0]}

    def cell(self, q, worst):
        return {"q": q, "frames": [{"view8": worst}, {"view8": worst / 2}]}

    def test_starts_at_todays_q(self):
        """With no cell yet, the plan is today's highest Q under 1.00 alone."""
        self.assertEqual(rounding.plan(self.series, [], 7), {7})

    def test_goes_down_while_failing(self):
        """A lowest Q that fails 1.00 adds the Q below it, even when it passes 1.03."""
        self.assertEqual(rounding.plan(self.series, [self.cell(7, 1.02)], 7), {6, 7, 8})

    def test_stops_when_bracketed(self):
        """A passing lowest Q and a highest Q over 1.03 add nothing."""
        self.assertEqual(rounding.plan(self.series, [self.cell(6, 0.99), self.cell(7, 1.04)], 7), {6, 7})

    def test_goes_up_while_passing_wide(self):
        """A highest Q at or under 1.03 adds the Q above it."""
        self.assertEqual(rounding.plan(self.series, [self.cell(6, 0.99), self.cell(7, 1.02)], 7), {6, 7, 8})


if __name__ == "__main__":
    unittest.main()
