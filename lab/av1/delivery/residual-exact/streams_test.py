#!/usr/bin/env python3
"""streams.py's checks, each shown to fire. usage: streams_test.py BUILD WORK"""
import subprocess
import sys
from pathlib import Path

import numpy as np

sys.path.insert(0, str(Path(__file__).resolve().parent))
import obu  # noqa: E402
import streams  # noqa: E402


def test_compare_counts_one_flip():
    """compare() reports a single flipped sample: count 1, its frame and position, |Δ| 1 — and nothing when equal."""
    rng = np.random.default_rng(1)
    ref = [rng.integers(0, 4096, (7, 9), dtype=np.uint16) for _ in range(3)]
    same = streams.compare(iter(ref), iter([a.copy() for a in ref]))
    flip = streams.compare(iter(ref), iter([a.copy() for a in ref]), (1, 4, 6))
    assert (same["differ"], same["max_abs"], same["first"]) == (0, 0, [])
    assert (flip["differ"], flip["frames_differ"], flip["max_abs"]) == (1, 1, 1)
    assert flip["first"][0][:3] == [1, 4, 6] and same["sha"][1] != flip["sha"][1]


def test_grain_is_read(build, work):
    """The film-grain flag reads 0 from aomenc_args' stream and 1 from the same stream with denoising on."""
    class S:
        n, h, w, offset, hi = 2, 64, 64, 0, 1023

        def frame(self, i):
            return np.random.default_rng(i).integers(0, 1024, (64, 64, 1))
    s = S()
    form = streams.forms(s)[0]
    work.mkdir(parents=True, exist_ok=True)
    y4m = work / "g.y4m"
    streams.write_y4m(s, form, y4m)
    flags = []
    for extra in ([], ["--denoise-noise-level=25"]):
        ivf = work / "g.ivf"
        subprocess.run([build / "aom-3.15.1/bin/aomenc", "-o", ivf, "--limit=2", "--disable-warning-prompt",
                        *streams.aomenc_args(form, 8, 1, 2), *extra, y4m], check=True, capture_output=True)
        u = streams.ivf_units(ivf)[0]
        flags.append(obu.film_grain_params_present(obu.sequence_header(u))["film_grain"])
    assert flags == [0, 1], flags


if __name__ == "__main__":
    test_compare_counts_one_flip()
    test_grain_is_read(Path(sys.argv[1]).resolve(), Path(sys.argv[2]).resolve())
    print("streams_test: 2/2")
