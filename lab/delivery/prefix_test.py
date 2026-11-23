"""python3 lab/delivery/prefix_test.py — a prefix series' metadata (delivery-comparison.md §3)."""
import sys
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent))
from prefix import prefix_metadata

EXACT = {"frameCount": 20, "digests": {"algorithm": "xxh3-64", "frames": [f"{k:016x}" for k in range(20)]}}
VIEW = {"frameCount": 20, "codec": "av1", "lossy": {"q": 8, "g": 8, "depth": 10}, "exactSeries": "synth"}


class Prefix(unittest.TestCase):
    def test_cuts_count_and_digests(self):
        """The first n frames keep their own digests, in order; the series' other fields stay."""
        m = prefix_metadata(EXACT, 8)
        self.assertEqual((m["frameCount"], m["digests"]["frames"], m["digests"]["algorithm"]), (8, EXACT["digests"]["frames"][:8], "xxh3-64"))

    def test_view_names_its_exact_prefix(self):
        """A view's prefix points at its exact series' prefix of the same n."""
        self.assertEqual(prefix_metadata(VIEW, 16, "synth-p16")["exactSeries"], "synth-p16")

    def test_refuses_a_cut_group_and_a_long_prefix(self):
        """A prefix inside a group of pictures, or past the series' end, is refused."""
        for n in (4, 24):
            with self.assertRaises(SystemExit):
                prefix_metadata(VIEW, n)


if __name__ == "__main__":
    unittest.main()
