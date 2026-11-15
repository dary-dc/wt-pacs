"""Tests of the 220-level form, its counters, C2's reconstruction and the plans (hw-inverted.md §8, mutants n1–n5).

HARNESS=<checkout of claude/av1-noise-ratio> python -m unittest lab/decode/mobile/hw-inverted/measure_test.py
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
measure.CELL = CELL


def form(name, b, h=6, w=8):
    return next(f for f in CELL.forms(SimpleNamespace(b=b, ch=1, h=h, w=w), []) if f.name == name)


class FormTest(unittest.TestCase):
    def test_codes_run_16_to_235_and_round_to_the_rms_of_i1(self):
        """Over every source value the codes are the 220 levels 16 … 235 and the round trip has I1's RMS (n1, n2)."""
        for b, rms in ((10, 1.363), (12, 5.401)):
            v = np.arange(1 << b, dtype=np.int32)[None, :, None]
            f = form(measure.FORM, b, 1, 1 << b)
            codes = f.fwd(v)[0]
            self.assertEqual((int(codes.min()), int(codes.max()), len(np.unique(codes))), (16, 235, 220))
            err = f.back([codes.astype(np.uint8)])[..., 0] - v[..., 0]
            self.assertAlmostEqual(float(np.sqrt(np.mean(err ** 2))), rms, delta=0.001)

    def test_back_reads_uint8_codes_without_wrapping(self):
        """Decoded codes under 16 map below 0 instead of wrapping, so an undershoot is an error, not a jump (A2)."""
        self.assertEqual(int(measure.back220(np.array([10], np.uint8), 12)[0]), round(-6 * 4095 / 219))

    def test_chroma_is_neutral(self):
        """inv220-420 writes both chroma planes 128 at half size (n3)."""
        planes = form(measure.FORM, 12).fwd(np.zeros((6, 8, 1), np.int32))
        self.assertEqual(len(planes), 3)
        self.assertTrue(all((p == 128).all() and p.shape == (3, 4) for p in planes[1:]))

    def test_cut8_is_depth8s_code8(self):
        """cut8 is DEPTH8-MEASURE's rounded 8-bit cut, read back as c · 2^k (the A/A cells)."""
        v = np.arange(4096, dtype=np.int32)[None, :, None]
        f = form("cut8", 12, 1, 4096)
        self.assertTrue(np.array_equal(f.fwd(v)[0], np.minimum((v[..., 0] + 8) >> 4, 255)))
        self.assertLessEqual(int(np.abs(f.back(f.fwd(v)) - v)[0, :4080].max()), 8)

    def test_arguments(self):
        """inv220-420 and picture B are 8-bit profile 0 without --monochrome or colour tags (A2)."""
        for name in (measure.FORM, measure.RESIDUAL):
            args = CELL.aomenc_args(CELL.Form(name, 8, 0, False, None, None), 4, 1, 10)
            self.assertNotIn("--monochrome", args)
            self.assertEqual(args[-3:], ["--profile=0", "--bit-depth=8", "--input-bit-depth=8"])
            self.assertFalse([a for a in args if "bt601" in a or "range" in a])


class CounterTest(unittest.TestCase):
    def test_range_counter_reads_luma(self):
        """A frame built to overshoot: luma 10 and 240 among in-range codes, chroma 128, is counted twice (n4)."""
        luma = np.full((6, 8), 100, np.uint8)
        luma[0, 0], luma[5, 7] = 10, 240
        measure.reset()
        form(measure.FORM, 12).back([luma, np.full((3, 4), 128, np.uint8), np.full((3, 4), 128, np.uint8)])
        measure.count([np.full((6, 8), 100, np.uint8)] + [np.full((3, 4), 128, np.uint8)] * 2)
        self.assertEqual({k: measure.seen[k] for k in ("luma_out", "frames_out", "luma_min", "luma_max")},
                         dict(luma_out=2, frames_out=1, luma_min=10, luma_max=240))
        self.assertEqual(measure.seen["chroma_off"], 0)

    def test_chroma_counter(self):
        """Any decoded chroma sample other than 128 is counted, in either plane (I5)."""
        cr = np.full((3, 4), 128, np.uint8)
        cr[1, 1] = 0
        measure.reset()
        measure.count([np.full((6, 8), 100, np.uint8), np.full((3, 4), 127, np.uint8), cr])
        self.assertEqual(measure.seen["chroma_off"], 13)


class SecondPictureTest(unittest.TestCase):
    def test_lossless_b_reconstructs_the_source_where_it_did_not_clamp(self):
        """With r_B = b, shown is the source on every unclamped sample, and the clamped ones are counted (n5)."""
        rng = np.random.default_rng(0)
        v = rng.integers(0, 4096, (64, 64))
        ra = np.clip(measure.code220(v, 12) + rng.integers(-8, 9, v.shape), 0, 255).astype(np.uint8)
        b, clamped = measure.residual(v, ra, 12)
        raw = v - measure.back220(ra, 12) + 126
        inside = (raw >= 16) & (raw <= 235)
        self.assertEqual(clamped, int(np.count_nonzero(~inside)))
        self.assertGreater(clamped, 0)
        self.assertTrue(np.array_equal(measure.shown(ra, b.astype(np.uint8), 12)[inside], v[inside]))


class PlanTest(unittest.TestCase):
    def cells(self, worst):
        return [dict(form=measure.FORM, q=q, frames=[dict(err_noise_band=w)]) for q, w in worst.items()]

    def test_initial_runs_from_the_independent_q_to_the_wider_removal_q_plus_1(self):
        """A3: dbt12_c's table row, 2–6 at 1.00 and 3–7 at 1.03, starts at Q 2 … 8."""
        p = {"bar1.00": {"inv220_independent_removal": [2, 6]}, "bar1.03": {"inv220_independent_removal": [3, 7]}}
        self.assertEqual(measure.initial(p), set(range(2, 9)))

    def test_bracket(self):
        """The next Q while the top passes 1.03; the Q below while the lowest fails 1.00, never under 1."""
        self.assertEqual(measure.bracket({2, 3}, self.cells({2: 0.9, 3: 1.02}), [1.0]), {2, 3, 4})
        self.assertEqual(measure.bracket({2, 3}, self.cells({2: 0.9, 3: 1.05}), [1.0]), {2, 3})
        self.assertEqual(measure.bracket({3, 4}, self.cells({3: 1.01, 4: 1.2}), [1.0]), {2, 3, 4})
        self.assertEqual(measure.bracket({1}, self.cells({1: 1.05}), [1.0]), {1})

    def test_b_schedule(self):
        """A4: Q 1, 4, 8, … until 1.03 fails, then every Q above the highest multiple passing 1.00."""
        self.assertEqual(measure.next_b({}), 1)
        self.assertEqual(measure.next_b({1: 0.5}), 4)
        self.assertEqual(measure.next_b({1: 0.5, 4: 0.6}), 8)
        got = {1: 0.5, 4: 0.6, 8: 0.99, 12: 1.04}
        self.assertEqual(measure.next_b(got), 9)
        self.assertEqual(measure.next_b({**got, 9: 0.99, 10: 1.0, 11: 1.01}), None)
        self.assertEqual(measure.next_b({1: 1.1}), None)


if __name__ == "__main__":
    unittest.main()
