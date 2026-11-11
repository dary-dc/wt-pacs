"""Stage 3's strip series, checked from its entries alone: each strip's bands joined in order decode by OpenJPH to its
truth, whole and at each fit level (bands 0..2−ℓ, EOC appended). lab/htj2k-tiles/improve/README.md

    stage3_check.py BUILD SERIES_DIR [--mutate band-order|entry-index|truth]
"""
import argparse
import hashlib
import json
import tempfile
from pathlib import Path

import numpy as np

from offline import decode_ojph

EOC = b"\xff\xd9"


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("build", type=Path)
    ap.add_argument("series", type=Path)
    ap.add_argument("--mutate", choices=("band-order", "entry-index", "truth"))
    a = ap.parse_args()
    meta = json.loads((a.series / "frames.json").read_text())
    n, t_count, b_count = meta["N"], meta["T"], meta["B"]

    def entry(b, f, t):
        e = b * n * t_count + f * t_count + t
        if a.mutate == "entry-index":
            e = f * b_count * t_count + b * t_count + t
        return (a.series / f"{e:03d}.htj2k").read_bytes()

    exact = total = 0
    with tempfile.TemporaryDirectory() as tmp:
        for f, row in enumerate(meta["frames"]):
            for lv, want in row["truth"].items():
                lv = int(lv)
                bands = list(range(b_count - lv))
                if a.mutate == "band-order":
                    bands.reverse()
                strips = []
                for t in range(t_count):
                    cs = b"".join(entry(b, f, t) for b in bands)
                    try:
                        strips.append(decode_ojph(a.build, cs if lv == 0 else cs + EOC, lv, Path(tmp)))
                    except Exception:
                        strips = None
                        break
                got = strips and hashlib.sha256(np.concatenate(strips).astype("<u2").tobytes()).hexdigest()
                total += 1
                exact += (got == want) != (a.mutate == "truth")
    print(f"{meta['volume']}: {exact}/{total} pictures exact{f' under {a.mutate}' if a.mutate else ''}")
    raise SystemExit(exact != total)


if __name__ == "__main__":
    main()
