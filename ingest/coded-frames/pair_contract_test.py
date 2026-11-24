#!/usr/bin/env python3
"""The product ingest's half of the optimal-quality pair, as docs/reviews/ingest-oq.md §7 writes it, against ingest.py:
T2, the value matrix (§5's proposed column), and T3, the pair's invariants (§4). A claim that fails on today's code
for the reason the review states is a known gap: it prints as one and keeps the gate green; once it holds, the test
fails until its mark is removed. Nothing here is a fix.

usage: python3 ingest/coded-frames/pair_contract_test.py BUILD   — BUILD as ingest/tools.sh makes it
"""
import json
import os
import struct
import subprocess
import sys
from pathlib import Path

import numpy as np

HERE = Path(__file__).resolve().parent
ROOT = HERE.parents[1]
sys.path.insert(0, str(HERE))
import ingest  # noqa: E402

N, H, W = 9, 48, 64
CUT = "docs/reviews/ingest-oq.md §5: unsigned D 11–16 is always the cut on the product path; today the cut is the caller's option"
SIGNED = "docs/reviews/ingest-oq.md §5: signed over 10 bits after the offset has no product form; today it is coded at 12 bits"
WRITER = "docs/reviews/ingest-oq.md §1, §4: ingest.py writes no optimal-quality metadata; only the lab's ingest_coded.py does"
failures, gaps = [], []


def check(ok, claim, gap=None):
    if gap and ok:
        failures.append(claim)
        print(f"FAIL gap closed: {claim} — remove its known-gap mark")
    elif gap:
        gaps.append(claim)
        print(f"KNOWN GAP {claim} — {gap}")
    elif not ok:
        failures.append(claim)
        print(f"FAIL {claim}")


class Series:
    """N frames of a drifting pattern with a little noise over the whole range of `bits`, grey or RGB: the shape
    ingest.coded() reads (dicom_series.DicomSeries)."""

    def __init__(self, bits, signed=False, ch=1, seed=0):
        y, x = np.mgrid[:H, :W]
        rng = np.random.default_rng(bits * 4 + signed * 2 + seed)
        top = (1 << bits) - 1
        frames = []
        for i in range(N):
            px = top * (0.5 + 0.3 * np.sin((x + 2 * i + seed) / 7) * np.cos(y / 9)) + rng.normal(0, top / 400, (H, W))
            px = np.clip(np.rint(px), 0, top).astype(np.int64)
            px[0, :2] = 0, top
            frames.append(np.repeat(px[..., None], ch, 2) - (1 << (bits - 1) if signed else 0))
        self.dtype = np.dtype(f"{'i' if signed else 'u'}{1 if bits <= 8 else 2 if bits <= 16 else 4}")
        self.frames = [f.astype(self.dtype) for f in frames]
        self.n, self.h, self.w, self.ch = N, H, W, ch
        self.stored, self.signed = bits, signed
        self.lo, self.hi = int(min(f.min() for f in frames)), int(max(f.max() for f in frames))
        self.offset = -self.lo if self.lo < 0 else 0

    def frame(self, i):
        return self.frames[i]


def coded(build, s, q, g):
    """The product's call: optimal quality at Q and G, the form chosen by the series' depth alone."""
    try:
        return ingest.coded(build, s, s.n, "av1", 2, lossy=(q, g)), None
    except ingest.Refused as e:
        return None, str(e)


def header_and_unit(payload):
    """A one-frame payload's header (bits, depth, split, flags, offset, n) and its unit: ingest.payload's layout."""
    _, bits, depth, split, flags, offset, n = struct.unpack_from("<BBBBB3xII", payload)
    (length,) = struct.unpack_from("<I", payload, 16)
    return (bits, depth, split, flags, offset, n), payload[16 + 4 * n:16 + 4 * n + length]


def shown(build, units, s):
    try:
        return ingest.decoded(build, "av1", b"".join(units), s.h * s.w)
    except ingest.Refused:
        return None, None


def undecodable(build, unit, s):
    """A unit that must not decode alone, with dav1d's complaint about it kept off stderr."""
    err = os.dup(2)
    os.dup2(os.open(os.devnull, os.O_WRONLY), 2)
    try:
        return shown(build, [unit], s)[0] is None
    finally:
        os.dup2(err, 2)


def value_cell(build, name, s, q, g, gap=None):
    """Coded; every header the stated form; every frame decodes from its group's keyframe on, and not alone, at the
    stated depth, and at Q 8 or under close to the codes it was coded from."""
    cut = not s.signed and s.stored > ingest.CUT_DEPTH
    depth = ingest.CUT_DEPTH if cut else ingest.container(int(s.hi + s.offset).bit_length())
    bits = ingest.CUT_DEPTH if cut else int(s.hi + s.offset).bit_length()
    want = (bits, depth, 0, ingest.FLAG_SIGNED if s.signed else 0, 0 if cut else s.offset, 1)
    payloads, why = coded(build, s, q, g)
    if payloads is None:
        check(False, f"{name}: coded ({why})", gap)
        return
    check([i for i, _ in payloads] == list(range(s.n)), f"{name}: one payload a frame, in order")
    parts = [header_and_unit(p) for _, p in payloads]
    heads = {h for h, _ in parts}
    check(heads == {want}, f"{name}: every header is (bits, depth, split, flags, offset, units) {want}, got {sorted(heads)}", gap)
    worst = 0.0
    for i in range(s.n):
        k = ingest.keyframe(i, g)
        px, shape = shown(build, [u for _, u in parts[k:i + 1]], s)
        if px is None or shape.bits != depth:
            check(False, f"{name}: frame {i} decodes from its keyframe {k} on at {depth} bits"
                         f" (got {None if shape is None else shape.bits})", gap)
            return
        v = s.frame(i).astype(np.int64)
        codes = ingest.depth_cut(v, s.stored) if cut else v + s.offset
        worst = max(worst, float(np.sqrt(np.mean((px[..., 0].astype(float) - codes[..., 0]) ** 2))))
        if i != k:
            check(undecodable(build, parts[i][1], s), f"{name}: frame {i} does not decode without its keyframe {k}")
    check(q > 8 or worst <= ((1 << depth) - 1) / 100, f"{name}: at Q 8 or under, every frame within 1 % of its codes' range, RMS (worst {worst:.2f})", gap)


def refused(build, name, s, q, g, says, gap=None):
    payloads, why = coded(build, s, q, g)
    check(payloads is None and says in (why or ""), f"{name}: refused by name ({says!r}), nothing coded (got {why!r})", gap)


def value_matrix(build):
    """T2. Q 1, 8 and 63; G 1, 7, n and n + 1; unsigned D 8, 9, 10, 11, 12 and 16; signed 8 and 10 bits; refused by
    name: Q 0, RGB, signed over 10 and anything over 16."""
    for q in (1, 8, 63):
        value_cell(build, f"Q {q}, G 7, D 10", Series(10), q, 7)
    for g in (1, 7, N, N + 1):
        value_cell(build, f"Q 8, G {g}, D 8", Series(8), 8, g)
    for d in (9, 11, 12, 16):
        value_cell(build, f"Q 8, G 7, D {d}", Series(d), 8, 7, CUT if d > 10 else None)
    for d in (8, 10):
        value_cell(build, f"Q 8, G 7, signed D {d}", Series(d, signed=True), 8, 7)
    refused(build, "Q 0", Series(10), 0, 1, "Q is 1 to 63")
    refused(build, "RGB", Series(8, ch=3), 8, 1, "grey only")
    refused(build, "signed D 12", Series(12, signed=True), 8, 1, "signed", SIGNED)
    refused(build, "D 17", Series(17), 8, 1, "17")


PAIR = """
import { checkPair, pairOf } from %s;
const [optimal, exact, other] = JSON.parse(process.argv[1]);
const why = (f) => { try { f(); return null; } catch (e) { return e.message; } };
console.log(JSON.stringify({ pair: why(() => checkPair(optimal, exact)), other: why(() => checkPair(optimal, other)),
  exactSeries: why(() => pairOf(optimal)) ?? pairOf(optimal).id }));
"""


def pair_invariants():
    """T3. ingest.py writes both metadata files from one display dictionary with one sourceFingerprint, and the
    client's checkPair accepts the pair and refuses another source's exact series."""
    s, other = Series(12), Series(12, seed=1)
    display = {"width": W, "height": H, "channels": 1, "bitsAllocated": 16, "bitsStored": 12, "highBit": 11,
               "signed": False, "photometric": "MONOCHROME2", "modality": "MG", "frameTimeMs": 40.0,
               "rescale": {"slope": 1.0, "intercept": 0.0}, "window": {"center": [2048.0], "width": [4096.0]}}
    write = getattr(ingest, "pair_metadata", None)
    check(write is not None, "ingest.pair_metadata(s, display, (q, g), exact_series) writes the pair's two metadata files", WRITER)
    if write is None:
        print("SKIPPED the pair's invariants: no writer to hold them against")
        return
    exact, optimal = write(s, display, (8, 4), "exact-1")
    other_exact, _ = write(other, display, (8, 4), "exact-2")
    for k, v in display.items():
        check(exact.get(k) == v and optimal.get(k) == v, f"the pair: {k} is the display dictionary's in both")
    check(exact.get("codec", "htj2k") == "htj2k" and exact.get("digests", {}).get("algorithm") == "xxh3-64",
          "the exact series is HTJ2K with its xxh3-64 frame digests")
    check(optimal.get("codec") == "av1" and optimal.get("lossy") == dict(q=8, g=4, depth=10, bitsStored=12)
          and optimal.get("exactSeries") == "exact-1" and "digests" not in optimal,
          f"the optimal-quality series: av1, lossy Q 8 G 4 cut from 12 bits, its exact series named, no digests (got {optimal.get('lossy')})")
    check(optimal.get("sourceFingerprint") == exact.get("sourceFingerprint") == ingest.source_fingerprint(s, s.n),
          "one sourceFingerprint, over the exact series' frame digests")
    script = PAIR % json.dumps((ROOT / "client/viewer/pair.js").as_uri())
    r = subprocess.run(["node", "--input-type=module", "-e", script, json.dumps([optimal, exact, other_exact])],
                       capture_output=True, text=True)
    got = json.loads(r.stdout) if r.returncode == 0 else {}
    check(got.get("pair") is None and got.get("exactSeries") == "exact-1", f"checkPair accepts the pair as written ({got or r.stderr})")
    check("not shown to be of this source" in (got.get("other") or ""), f"checkPair refuses another source's exact series ({got.get('other')})")


def main():
    build = Path(sys.argv[1]).resolve()
    value_matrix(build)
    pair_invariants()
    print(f"the pair's contract: {len(failures)} claims fail, {len(gaps)} known gaps")
    sys.exit(1 if failures else 0)


if __name__ == "__main__":
    main()
