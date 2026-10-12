#!/usr/bin/env python3
"""The Rust ingest against the Python one on synthetic sets, and the mirror's names against the contract.

usage: same_test.py   — needs lab/.av1-build (ingest/coded-frames/README.md), OpenJPH, and
                        `cargo build --release -p from-parser -p pack-series`
"""
import hashlib
import json
import sys
import tempfile
from pathlib import Path

import numpy as np

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE))
import mirror  # noqa: E402
import same  # noqa: E402

BUILD = same.ROOT / "lab/.av1-build"

# name: channels, bits stored, min, max — each a layout the HTJ2K path codes apart
SETS = {
    "g8": (1, 8, 0, 255),
    "s8": (1, 8, -128, 127),
    "g12": (1, 12, 0, 4095),
    "s12": (1, 12, -2048, 2047),
    "g16": (1, 16, 0, 65535),
    "c8": (3, 8, 0, 255),
}


def fetched(root, name, ch, bits, lo, hi, n=3, w=40, h=24):
    """A set as lab/av1/fetch_data.py writes one: NNN.raw, NNN.sha256, metadata.json."""
    d = root / name
    d.mkdir()
    rng = np.random.default_rng(bits * 10 + ch)
    dtype = ("i1" if lo < 0 else "u1") if bits <= 8 else ("<i2" if lo < 0 else "<u2")
    for i in range(n):
        px = rng.integers(lo, hi + 1, (h, w, ch))
        px.flat[0], px.flat[1] = lo, hi
        raw = px.astype(dtype).tobytes()
        (d / f"{i:03d}.raw").write_bytes(raw)
        (d / f"{i:03d}.sha256").write_text(hashlib.sha256(raw).hexdigest())
    meta = dict(frameCount=n, width=w, height=h, channels=ch, bitsStored=bits, signed=lo < 0, min=lo, max=hi,
                photometric="RGB" if ch == 3 else "MONOCHROME2")
    (d / "metadata.json").write_text(json.dumps(meta))
    return d


def test_uid_coding():
    """A UID's characters are coded three to two, a remainder of one or two as the contract says."""
    assert mirror.coded("1.2") == "TO"
    assert mirror.coded("1") == "S0"
    assert mirror.coded("12") == "U0"
    assert mirror.coded("1.2.3\0") == "TOMG"


def test_group_record():
    """A record is the key length, the tag big-endian, VR, a zero charset index, then the value length little-endian."""
    assert mirror.group([(0x0028, 0x0010, "US", b"\x00\x02")]) == b"\x08\x00\x28\x00\x10US\x00\x00\x02\x00\x00\x00\x00\x02"


def test_both_ingests_write_the_same_bundles():
    """Every layout: the Python and Rust ingests write byte-identical .sbnd files at --jobs 1, 2 and 4."""
    with tempfile.TemporaryDirectory() as tmp:
        tmp = Path(tmp)
        for name, spec in SETS.items():
            ok, line = same.same(BUILD, fetched(tmp, name, *spec), tmp / "work")
            assert ok and "byte-identical" in line, line


if __name__ == "__main__":
    failed = 0
    for name, fn in [(k, v) for k, v in globals().items() if k.startswith("test_")]:
        try:
            fn()
            print(f"ok   {name}: {fn.__doc__.splitlines()[0]}")
        except AssertionError as e:
            failed += 1
            print(f"FAIL {name}: {e}")
    print(f"{'ok' if not failed else 'FAILED'}: both ingests, {failed} failing")
    sys.exit(1 if failed else 0)
