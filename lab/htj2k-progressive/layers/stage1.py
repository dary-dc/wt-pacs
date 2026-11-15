#!/usr/bin/env python3
"""Stage 1 for the quality shapes: every frame of a set coded as `oneset` and `twosets1`..`7`, the layered codestream
kept for stage0.mjs, layer 1's bytes and its picture's quality against the source at full size and display scale,
and OpenJPEG 2.5.4 on the layer-1 prefix. layers/README.md §Quality layers, measured.

usage: stage1.py WORK SETDIR ... [--every K] [--jobs 4]
Writes WORK/<set>/<frame>/<shape>.j2c, WORK/<set>/items.json and WORK/<set>/stage1.jsonl.
"""
import argparse
import json
import subprocess
import sys
import tempfile
from concurrent.futures import ProcessPoolExecutor
from pathlib import Path

import numpy as np

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE.parent))
import quality  # noqa: E402
import shapes as S  # noqa: E402
from run import ARGS, COMPRESS, digest, opj  # noqa: E402
from size import Set  # noqa: E402

SHAPES = [("oneset", None)] + [("twosets", p) for p in range(1, 8)]


def frame(job):
    setdir, i, work, display = job
    s = Set(Path(setdir))
    dst = Path(work) / s.name / f"{i:03d}"
    dst.mkdir(parents=True, exist_ok=True)
    maxval = (1 << s.stored) - 1
    offset = (1 << (s.stored - 1)) if s.signed else 0
    f = s.frame(i).astype(np.int64)
    px = f[..., 0] + offset
    shape = quality.display_shape(s.h, s.w)
    exact_d = quality.resample(f, shape)
    rows, items = [], []
    with tempfile.TemporaryDirectory() as tmp:
        src, ref = Path(tmp) / "in.pgm", Path(tmp) / "ref.j2c"
        src.write_bytes(b"P5\n%d %d\n%d\n" % (s.w, s.h, maxval) + px.astype(">u2" if maxval > 255 else "u1").tobytes())
        subprocess.run([COMPRESS, "-i", src, "-o", ref, *ARGS], check=True, capture_output=True)
        today = ref.read_bytes()
        hdr = S.Header(today)
        if S.assemble(hdr, S.coded(hdr, px, "today"), 1, 2)[0] != today:
            raise SystemExit(f"{s.name} {i}: the writer's one-layer codestream is not ojph_compress's")
        (dst / "today.j2c").write_bytes(today)
        source = digest(px, s.stored)
        for kind, p in SHAPES:
            name = kind if p is None else f"{kind}{p}"
            plans = S.coded(hdr, px, kind, p)
            cs, sizes = S.assemble(hdr, plans, 2, 0)
            (dst / f"{name}.j2c").write_bytes(cs)
            l1 = S.expected(hdr, px, plans, 1)
            want1 = digest(l1, s.stored)
            pre = Path(tmp) / "pre.j2c"
            pre.write_bytes(S.prefix(cs, sizes, 1))
            g1, _ = opj(pre, tmp)
            pic = (l1 - offset)[..., None]
            items.append({"file": f"{dst.name}/{name}.j2c", "shape": name, "header": sizes[0], "layer1": sizes[1],
                          "want1": want1, "source": source})
            rows.append({"set": s.name, "frame": i, "shape": name, "today": len(today), "header": sizes[0],
                         "layer1": sizes[1], "layer2": sizes[2], "total": len(cs),
                         "opjLayer1": g1 is not None and digest(g1, s.stored) == want1,
                         "full": quality.compare(f, pic, display, maxval),
                         "fullDisplay": quality.compare(exact_d, quality.resample(pic, shape), display, maxval)})
    return rows, items


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("work")
    ap.add_argument("sets", nargs="+")
    ap.add_argument("--every", type=int, default=1)
    ap.add_argument("--jobs", type=int, default=4)
    a = ap.parse_args()
    for setdir in a.sets:
        s = Set(Path(setdir))
        if s.ch != 1:
            print(f"{s.name}: {s.ch} channels; the writer is grey only, not built")
            continue
        display = quality.windows(s)
        jobs = [(setdir, i, a.work, display) for i in range(0, s.n, a.every)]
        out = Path(a.work) / s.name
        out.mkdir(parents=True, exist_ok=True)
        rows, items = [], []
        with ProcessPoolExecutor(a.jobs) as pool:
            for r, it in pool.map(frame, jobs):
                rows += r
                items += it
        (out / "stage1.jsonl").write_text("".join(json.dumps(r) + "\n" for r in rows))
        (out / "items.json").write_text(json.dumps(items))
        print(f"{s.name}: {len(jobs)} frames, {len(rows)} codings -> {out}/stage1.jsonl", flush=True)


if __name__ == "__main__":
    main()
