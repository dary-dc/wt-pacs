#!/usr/bin/env python3
"""The consistency summary's two judgements, on hand-made revisions and commit times."""
import os
import sys
import unittest

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

from consistency import seen, staleness_ms  # noqa: E402


class Seen(unittest.TestCase):
    def test_pairs_the_receiver_committed(self):
        """Before any update, after the first (study 0), and every adjacent pair are states the receiver committed."""
        self.assertIsNone(seen(None, None))
        self.assertEqual(seen(0, None), 0)
        self.assertEqual(seen(0, 1), 1)
        self.assertEqual(seen(2, 1), 2)
        self.assertEqual(seen(2, 3), 3)

    def test_pairs_never_committed_together(self):
        """A study revision two or more away from the paint's, or a paint revision with no study stamp, never existed."""
        self.assertIsNone(seen(0, 3))
        self.assertIsNone(seen(4, 1))
        self.assertIsNone(seen(None, 1))
        self.assertIsNone(seen(2, None))


class Staleness(unittest.TestCase):
    COMMITS = [10_000_000, 20_000_000, 30_000_000]

    def test_fresh_when_nothing_newer_had_committed(self):
        """A read of revision 1 that began before revision 2 committed, or a read of the last revision, is not stale."""
        self.assertEqual(staleness_ms(25_000_000, 1, self.COMMITS), 0.0)
        self.assertEqual(staleness_ms(99_000_000, 2, self.COMMITS), 0.0)

    def test_stale_from_the_first_newer_commit(self):
        """A read of revision 0 beginning at 35 ms is stale from revision 1's commit at 20 ms: 15 ms."""
        self.assertEqual(staleness_ms(35_000_000, 0, self.COMMITS), 15.0)
        self.assertEqual(staleness_ms(12_000_000, None, self.COMMITS), 2.0)


if __name__ == "__main__":
    unittest.main()
