#!/usr/bin/env python3
"""The band an arm is judged against B in."""
import os
import sys
import unittest

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

from summary import verdict  # noqa: E402


class Band(unittest.TestCase):
    def test_the_widest_of_the_three_floors(self):
        """B' 10 ms from B widens the band to 10; with B and B' equal it is 3 % of B, or 2 ms below 67 ms."""
        self.assertEqual(verdict(209, 200, 210), (9, 10, "tie"))
        self.assertEqual(verdict(207, 200, 200), (7, 6.0, "slower"))
        self.assertEqual(verdict(48.5, 50, 50), (-1.5, 2.0, "tie"))
        self.assertEqual(verdict(47, 50, 50), (-3, 2.0, "faster"))


if __name__ == "__main__":
    unittest.main()
