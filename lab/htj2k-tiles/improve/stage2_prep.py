"""Stage 2's inputs: per volume, the first frames as today's codestream and I2's three strips in I1's profile, with
each ask's byte ranges and every picture's truth (the witness's sha256). lab/htj2k-tiles/improve/README.md

    stage2_prep.py BUILD DATA OUT VOLUME... [--frames 8]
"""
import argparse
import hashlib
import json
import subprocess
import tempfile
from pathlib import Path

import numpy as np

from offline import (PHONE, SIDEWAYS, TODAY, decode_ojph, decompositions, encode, level_of, prefix_end, profile,
                     reduced, strip_rows, tile_parts)


def digest(px):
    return hashlib.sha256(px.astype("<u2").tobytes()).hexdigest()


def smallest_prefix(build, cs, level, want, work):
    """Today's codestream has no TLM: the shortest prefix, EOC appended, whose level decodes to `want`;
    checked one byte short after, since the search is sound only where a longer prefix never loses the level."""
    def exact(n):
        try:
            return np.array_equal(decode_ojph(build, cs[:n] + b"\xff\xd9", level, work), want)
        except subprocess.CalledProcessError:
            return False
    lo, hi = 2, len(cs) - 2
    while lo < hi:
        mid = (lo + hi) // 2
        lo, hi = (lo, mid) if exact(mid) else (mid + 1, hi)
    if not exact(lo) or exact(lo - 1):
        raise ValueError(f"no sound prefix at level {level}")
    return lo


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("build", type=Path)
    ap.add_argument("data", type=Path)
    ap.add_argument("out", type=Path)
    ap.add_argument("volumes", nargs="+")
    ap.add_argument("--frames", type=int, default=8)
    a = ap.parse_args()
    for vol in a.volumes:
        meta = json.loads((a.data / vol / "metadata.json").read_text())
        w, h, bits = meta["width"], meta["height"], meta["bitsStored"]
        top, nl = (1 << bits) - 1, decompositions(w, h)
        levels = sorted({level_of(w, h, PHONE), level_of(w, h, SIDEWAYS)})
        out = a.out / vol
        out.mkdir(parents=True, exist_ok=True)
        rows = []
        with tempfile.TemporaryDirectory() as tmp:
            work = Path(tmp)
            for i in range(a.frames):
                samples = np.frombuffer((a.data / vol / f"{i:03d}.raw").read_bytes(), "<u2").reshape(h, w)
                samples = samples.astype(np.int64)
                today = encode(a.build, samples, bits, TODAY, work)
                (out / f"{i:03d}.whole.j2c").write_bytes(today)
                row = {"frame": i, "whole": len(today), "truth": {0: {"whole": digest(samples), "strips": digest(samples)}},
                       "whole_prefix": {}, "strips": []}
                for k, (r0, r1) in enumerate(strip_rows(h, nl)):
                    cs = encode(a.build, samples[r0:r1], bits, profile(nl), work)
                    (out / f"{i:03d}.s{k}.j2c").write_bytes(cs)
                    header, tlm, _ = tile_parts(cs)
                    part = samples[r0:r1]
                    row["strips"].append({"bytes": len(cs),
                                          "prefix": {lv: prefix_end(header, tlm, nl, lv) for lv in range(nl + 1)},
                                          "truth": {lv: digest(np.clip(reduced(part, lv), 0, top))
                                                    for lv in range(nl + 1)}})
                for lv in levels:
                    whole_want = np.clip(reduced(samples, lv), 0, top)
                    strips_want = np.concatenate([np.clip(reduced(samples[r0:r1], lv), 0, top)
                                                  for r0, r1 in strip_rows(h, nl)])
                    row["truth"][lv] = {"whole": digest(whole_want), "strips": digest(strips_want)}
                    if lv:
                        row["whole_prefix"][lv] = smallest_prefix(a.build, today, lv, whole_want, work)
                rows.append(row)
                print(vol, i, flush=True)
        (out / "frames.json").write_text(json.dumps({
            "volume": vol, "C": w, "R": h, "bits": bits, "NL": nl,
            "fit": {"phone": level_of(w, h, PHONE), "sideways": level_of(w, h, SIDEWAYS)}, "frames": rows}))


if __name__ == "__main__":
    main()
