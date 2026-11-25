#!/usr/bin/env python3
"""A fetched set's in-window table, one byte a stored value (1 if in-window), from `cell.display`'s first table as
`cell.series_row` builds its mask: docs/av1/noise-point.md §σ_min in the Rust ingest, Protocol.

usage: mask.py SET_DIR OUT
"""
import sys
from pathlib import Path

import numpy as np

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / "lab/av1/metrics"))
from cell import Middle, display, display_windows  # noqa: E402


def table(set_dir):
    s = Middle(set_dir, 0)
    assert s.offset == 0, "signed sources: the bench reads unsigned only"
    codes = display(display_windows(ROOT / "lab/av1/data.json", set_dir.name, set_dir.parent), (1 << s.b) - 1)[0]
    return ((codes > 0) & (codes < 255)).astype(np.uint8)


if __name__ == "__main__":
    Path(sys.argv[2]).write_bytes(table(Path(sys.argv[1])).tobytes())
