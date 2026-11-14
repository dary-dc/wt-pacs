"""Tests of the 8-bit cut's forms and of the plan's bracketing (docs/av1/depth-cut-8.md §7, mutants m1–m4).

HARNESS=<checkout of claude/av1-noise-ratio> python -m unittest lab/av1/depth8/measure_test.py
"""
import os
import sys
import unittest
from pathlib import Path
from types import SimpleNamespace

import numpy as np

sys.path.insert(0, str(Path(__file__).resolve().parent))
import measure  # noqa: E402

CELL = measure.load_harness(os.environ["HARNESS"])


def series(b, h=6, w=8):
    return SimpleNamespace(b=b, ch=1, h=h, w=w)


def form(name, b):
    return next(f for f in CELL.forms(series(b), []) if f.name == name)


class CutTest(unittest.TestCase):
    def test_cut8_rounds_to_the_rms_of_section_2(self):
        """Over every 12-bit value the cut's error has §2's RMS 4.61 within 3 % and a mean of +0.5 at most (m1, m2)."""
        for b, rms in ((12, 4.61), (10, 1.12)):
            v = np.arange(1 << b, dtype=np.int32)[None, :, None]
            f = form("cut8", b)
            err = f.back(f.fwd(v))[..., 0] - v[..., 0]
            body = err[0, : (1 << b) - (1 << (b - 9))]
            self.assertAlmostEqual(float(np.std(body)), rms, delta=0.03 * rms)
            self.assertLessEqual(abs(float(np.mean(body))), 0.5)

    def test_measures_are_taken_on_codes_times_2_to_the_k(self):
        """back(fwd(v)) is within 2^(k−1) of v, so the measures are at the source depth (m4)."""
        v = np.arange(4096, dtype=np.int32)[None, :4080, None]
        f = form("cut8", 12)
        self.assertLessEqual(int(np.abs(f.back(f.fwd(v)) - v).max()), 8)

    def test_420_chroma_is_neutral_and_counted(self):
        """cut8-420 writes chroma 128 everywhere, and its back counts any decoded chroma sample that is not (m3)."""
        f = form("cut8-420", 12)
        planes = f.fwd(np.zeros((6, 8, 1), np.int32))
        self.assertEqual(len(planes), 3)
        self.assertTrue(all((p == 128).all() and p.shape == (3, 4) for p in planes[1:]))
        measure.chroma_off[0] = 0
        v = planes[2].astype(np.uint8)
        v[0, 0] = 0
        f.back([planes[0].astype(np.uint8), np.full((3, 4), 127, np.uint8), v])
        self.assertEqual(measure.chroma_off[0], 13)

    def test_today_cut10_is_the_payload_formats_depth_cut(self):
        """The harness's top10 is payload-format.md §Depth cut's c = min((v + 2^(D−11)) >> (D−10), 1023) (amendment A2)."""
        v = np.arange(4096, dtype=np.int32)[None, :, None]
        self.assertTrue(np.array_equal(form("top10", 12).fwd(v)[0], np.minimum((v[..., 0] + 2) >> 2, 1023)))

    def test_420_arguments(self):
        """cut8-420 is coded 8-bit profile 0 without --monochrome or another series' colour tags; cut8 is monochrome."""
        args = CELL.aomenc_args(form("cut8-420", 12), 4, 1, 10)
        self.assertNotIn("--monochrome", args)
        self.assertEqual(args[-3:], ["--profile=0", "--bit-depth=8", "--input-bit-depth=8"])
        self.assertFalse([a for a in args if "bt601" in a])
        self.assertIn("--monochrome", CELL.aomenc_args(form("cut8", 12), 4, 1, 10))


class PlanTest(unittest.TestCase):
    def cells(self, worst):
        return [dict(form="cut8", q=q, frames=[dict(err_noise_band=w)]) for q, w in worst.items()]

    def test_bracket_extends_until_the_wide_bar_fails(self):
        """A plan whose top Q still passes 1.03 gains the next Q; one whose top fails gains nothing."""
        plan = {"cut8": {2, 3}}
        self.assertEqual(measure.bracket(plan, self.cells({2: 0.9, 3: 1.02}), [1.0])["cut8"], {2, 3, 4})
        self.assertEqual(measure.bracket({"cut8": {2, 3}}, self.cells({2: 0.9, 3: 1.05}), [1.0])["cut8"], {2, 3})

    def test_bracket_extends_down_when_the_lowest_fails(self):
        """A plan whose lowest Q fails 1.00 gains the Q below it, never below 1."""
        self.assertEqual(measure.bracket({"cut8": {3, 4}}, self.cells({3: 1.01, 4: 1.2}), [1.0])["cut8"], {2, 3, 4})
        self.assertEqual(measure.bracket({"cut8": {1}}, self.cells({1: 1.05}), [1.0])["cut8"], {1})

    def test_order_is_q_ascending_then_cut8_today_420(self):
        """The protocol's fixed order: per volume the Qs ascending, each Q's forms cut8, today's form, cut8-420."""
        got = measure.order({"cut8-420": {2}, "top10": {2, 3}, "cut8": {2, 3}})
        self.assertEqual(got, [(2, "cut8"), (2, "top10"), (2, "cut8-420"), (3, "cut8"), (3, "top10")])


if __name__ == "__main__":
    unittest.main()
