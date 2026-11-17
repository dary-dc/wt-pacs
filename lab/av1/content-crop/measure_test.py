#!/usr/bin/env python3
import unittest

import numpy as np

import measure


class Box(unittest.TestCase):
    def test_box_is_end_exclusive_and_spans_every_content_sample(self):
        """The box holds every non-background sample, its ends one past the last, so no content is cut."""
        m = np.zeros((20, 30), bool)
        m[3, 4] = m[10, 25] = True
        self.assertEqual(measure.box_of(m), [3, 4, 11, 26])
        self.assertIsNone(measure.box_of(np.zeros((4, 4), bool)))

    def test_safe_box_widens_by_the_margin_aligns_outward_and_stays_in_the_matrix(self):
        """The safe box contains the box plus 8 a side, its sides on multiples of 8, never past the matrix."""
        self.assertEqual(measure.safe([20, 17, 40, 50], 100, 100), [8, 8, 48, 64])
        self.assertEqual(measure.safe([3, 2, 95, 99], 97, 101), [0, 0, 97, 101])

    def test_background_is_the_border_mode_not_the_frame_minimum(self):
        """A frame whose border is mostly 7, one border sample and content 0, has background 7, not 0."""
        f = np.full((10, 10), 7, np.uint16)
        f[4:6, 4:6] = f[0, 0] = 0
        self.assertEqual(measure.background([f])[0], 7)

    def test_level_is_by_size_width_and_height(self):
        """A box under level 4's sample count but wider than its 6144 needs level 5."""
        self.assertEqual(measure.level([0, 0, 3328, 2560]), "5.x")
        self.assertEqual(measure.level([0, 0, 1700, 1300]), "4.x")
        self.assertEqual(measure.level([0, 0, 300, 6200]), "5.x")


if __name__ == "__main__":
    unittest.main()
