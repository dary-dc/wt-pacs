#!/usr/bin/env python3
"""gop.py's exactness check catches one sample of one frame flipped and a group's frames reordered, and passes the
same run unmutated (docs/av1/gop-protocol.md §4's mutation).

usage: mutate.py BUILD SET_DIR   — exits 1 when a mutation passes or the unmutated run is not exact
"""
import sys
import tempfile
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
import gop  # noqa: E402


def flip_one(pictures):
    if pictures:
        pictures[-1] = pictures[-1].copy()
        pictures[-1][0, 0, 0] ^= 1
    return pictures


MUTATIONS = {"none": lambda p: p, "one sample of one frame flipped": flip_one, "a group's frames reordered": lambda p: p[::-1]}


def main():
    build, set_dir = Path(sys.argv[1]).resolve(), sys.argv[2]
    real = gop.decode_group
    wrong = 0
    for name, mutation in MUTATIONS.items():
        gop.decode_group = lambda *a, m=mutation: m(real(*a))
        with tempfile.TemporaryDirectory() as tmp:
            row = gop.av1_job((build, set_dir, Path(tmp), 4, "aom", "good:6", "optimized", 4, False, False))
        gop.decode_group = real
        caught = not row["exact"]
        wrong += caught == (name == "none")
        print(f"{name}: {row['exact_n']}/{row['frames']} exact, {'caught' if caught else 'passed'}")
    sys.exit(1 if wrong else 0)


if __name__ == "__main__":
    main()
