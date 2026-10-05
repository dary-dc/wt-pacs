#!/usr/bin/env python3
"""ENCX's checks, each broken on purpose on cells encx.py already made: every mutation must lose frames.

usage: mutate.py BUILD WORK SET_DIR ...   — the cells of an encx.py run at the same FRAMES
"""
import sys
from pathlib import Path

import numpy as np

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE.parent))
sys.path.insert(0, str(HERE.parent / "llsize"))
import encx  # noqa: E402
import llsize  # noqa: E402
import size  # noqa: E402


def stream_exact(build, work, s, pl, coder):
    n = llsize.frames(s)
    _, _, take = encx.plane(s, pl)
    got = encx.decode_stream(build, work, s, pl, coder, n)
    return sum(np.array_equal(got[i], take(i)) for i in range(n))


def main():
    build, work, *sets = sys.argv[1:]
    build, work = Path(build).resolve(), Path(work).resolve()
    failed = 0
    for path in sets:
        s = size.Set(Path(path))
        n = llsize.frames(s)
        p, v = ("rct" if s.ch == 3 else ""), encx.best(s)
        coding = [(f"{p}top2", f"av1:{v}"), (f"{p}low2", "deflate")]
        cases = {"as built": lambda: None}

        def shift():
            merge = encx.merge
            encx.merge = lambda s, planes, parts: merge(s, [planes[0] << 1, planes[1]], parts)
            return lambda: setattr(encx, "merge", merge)

        def unpack():
            orig = encx.unpack
            encx.unpack = lambda raw, k, shape: orig(raw, k, shape)[..., ::-1] if shape[2] == 3 else orig(raw, k, shape).T.reshape(shape)
            return lambda: setattr(encx, "unpack", orig)

        def truth():
            saved = list(s.truth)
            s.truth[0] = "0" * 64
            return lambda: setattr(s, "truth", saved)

        def inverse():
            orig = encx.rct_back
            encx.rct_back = lambda q: orig(q + np.array([1, 0, 0]))
            return lambda: setattr(encx, "rct_back", orig)

        cases.update(shift=shift, unpack=unpack, truth=truth)
        if s.ch == 3:
            cases["rct inverse"] = inverse
        for name, mutate in cases.items():
            undo = mutate()
            size_set = size.Set
            size.Set = lambda _p, s=s: s
            try:
                merged = encx.check_coding(build, work, path, coding)
                low = stream_exact(build, work, s, f"{p}low2", "deflate")
            finally:
                size.Set = size_set
                if undo:
                    undo()
            want = n if name == "as built" else None
            caught = merged == want if want else merged < n
            failed += not caught
            print(f"{s.name}\t{name}\tmerged {merged}/{n}\tlow stream {low}/{n}\t{'ok' if caught else 'NOT CAUGHT'}", flush=True)
    sys.exit(failed)


if __name__ == "__main__":
    main()
