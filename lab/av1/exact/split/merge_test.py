#!/usr/bin/env python3
"""Every sample of 8–16 bits, unsigned and signed, split at every k of 0–8 by ingest.py's plan and
merged back by its merge, is itself (queue row 43 SPLITOK); and the optimized representation picks
row SPLITTIME's k at each depth 8–14 (row 72).

usage: merge_test.py   — exits 1 naming each wrong (bits, sign, k)
"""
import sys
from pathlib import Path
from types import SimpleNamespace

import numpy as np

sys.path.insert(0, str(Path(__file__).resolve().parents[4] / "ingest/coded-frames"))
import ingest  # noqa: E402


def cell(bits, signed, split):
    lo = -(1 << (bits - 1)) if signed else 0
    v = np.arange(lo, lo + (1 << bits), dtype=np.int32).reshape(1, -1, 1)
    s = SimpleNamespace(ch=1, hi=int(v.max()), offset=-lo, signed=signed, frame=lambda i: v)
    try:
        header, streams = ingest.plan(s, "optimized", split)
    except ingest.Refused as e:
        return f"refused: {e}"
    header["offset"] = s.offset
    pictures = [plane(0) for _, _, plane in streams]
    if any(p.min() < 0 or p.max() >= 1 << depth for p, (depth, _, _) in zip(pictures, streams)):
        return "a stream holds a value its depth cannot"
    back = ingest.merge(header, pictures) - header["offset"]
    return None if np.array_equal(back, v) else "merged back wrong"


def main():
    got = {(b, sg, k): cell(b, sg, k) for b in range(8, 17) for sg in (False, True) for k in range(9)}
    refused = [c for c, why in got.items() if why and why.startswith("refused") and c[0] - c[2] > 12]
    wrong = [(c, why) for c, why in got.items() if why and c not in refused]
    for b, k, want in ((17, 5, "over 16"), (16, 9, "not 0 to 8"), (15, None, "no default layout over 14 bits")):
        why = cell(b, False, k)
        if not (why or "").startswith("refused") or want not in why:
            wrong.append(((b, False, k), f"not refused by name ({why})"))
    for b, want in {8: 0, 9: 0, 10: 2, 11: 2, 12: 2, 13: 3, 14: 2}.items():
        lo = 1 << (b - 1)
        s = SimpleNamespace(ch=1, hi=(1 << b) - 1 - lo, offset=lo, signed=False, frame=lambda i: np.zeros((1, 1, 1), np.int32))
        if (picked := ingest.plan(s, "optimized")[0]["split"]) != want:
            wrong.append(((b, False, None), f"the optimized rule picks k = {picked}, row SPLITTIME's is {want}"))
    for (b, sg, k), why in wrong:
        print(f"{b}-bit {'signed' if sg else 'unsigned'} k={k}: {why}")
    print(f"writer's split and merge: {len(got) - len(refused) - len(wrong)}/{len(got) - len(refused)} cells exact, "
          f"{len(refused)} with a top over 12 bits refused by name, as are 17 bits, k = 9 and a default over 14 bits")
    sys.exit(1 if wrong else 0)


if __name__ == "__main__":
    main()
