#!/usr/bin/env python3
"""Every frame of each set in each quality-layer shape: bytes per layer, the files check.mjs decodes, and OpenJPEG 2.5.4
on the layered bytes themselves. layers/README.md.

usage: run.py WORK SETDIR ... [--every K] [--p 1,2,3,4,5,6,7] [--jobs 4]
Writes WORK/<set>/<frame>/... and WORK/<set>/rows.jsonl; check.mjs WORK/<set> runs next.
"""
import argparse
import hashlib
import json
import subprocess
import sys
import tempfile
from concurrent.futures import ProcessPoolExecutor
from pathlib import Path

import numpy as np

HERE = Path(__file__).resolve().parent
ROOT = HERE.parents[2]
sys.path.insert(0, str(ROOT / "lab/av1"))
sys.path.insert(0, str(HERE))
import shapes as S  # noqa: E402
from size import Set  # noqa: E402

BUILD = ROOT / "lab/.openjph-build"
COMPRESS = BUILD / "native/src/apps/ojph_compress/ojph_compress"
OPJ = BUILD / "opj/bin/opj_decompress"
ARGS = ["-num_decomps", "5", "-block_size", "{64,64}", "-prog_order", "RPCL", "-reversible", "true"]


def digest(px, bits):
    return hashlib.sha256(np.ascontiguousarray(px.astype("<u2" if bits > 8 else "u1")).tobytes()).hexdigest()


def opj(path, tmp):
    """OpenJPEG 2.5.4's decode of a layered codestream or prefix, or its refusal."""
    out = Path(tmp) / "opj.pgm"
    out.unlink(missing_ok=True)
    r = subprocess.run([OPJ, "-i", path, "-o", out, "-allow-partial"], capture_output=True, text=True)
    if r.returncode or not out.exists():
        return None, (r.stdout + r.stderr).strip().splitlines()[-1:]
    return S.read_pgm(out).astype(np.int64), []


def frame(job):
    setdir, i, work, ps = job
    s = Set(Path(setdir))
    dst = Path(work) / s.name / f"{i:03d}"
    dst.mkdir(parents=True, exist_ok=True)
    maxval = (1 << s.stored) - 1
    px = s.frame(i).astype(np.int64)[..., 0] + ((1 << (s.stored - 1)) if s.signed else 0)
    rows, items = [], []
    with tempfile.TemporaryDirectory() as tmp:
        src, ref = Path(tmp) / "in.pgm", Path(tmp) / "ref.j2c"
        src.write_bytes(b"P5\n%d %d\n%d\n" % (s.w, s.h, maxval) + px.astype(">u2" if maxval > 255 else "u1").tobytes())
        subprocess.run([COMPRESS, "-i", src, "-o", ref, *ARGS], check=True, capture_output=True)
        today = ref.read_bytes()
        hdr = S.Header(today)
        mine = S.assemble(hdr, S.coded(hdr, px, "today"), 1, 2)[0]
        if mine != today:
            raise SystemExit(f"{s.name} {i}: the writer's one-layer codestream is not ojph_compress's")
        source = digest(px, s.stored)
        for shape, p in [("oneset", None)] + [("twosets", p) for p in ps]:
            name = shape if p is None else f"{shape}{p}"
            plans = S.coded(hdr, px, shape, p)
            cs, sizes = S.assemble(hdr, plans, 2, 0)
            pre = S.prefix(cs, sizes, 1)
            (dst / f"{name}.j2c").write_bytes(cs)
            (dst / f"{name}.l1.j2c").write_bytes(S.single(pre, hdr, 2))
            (dst / f"{name}.l2.j2c").write_bytes(S.single(cs, hdr, 2))
            l1 = S.expected(hdr, px, plans, 1)
            want1 = digest(l1, s.stored)
            items += [{"file": f"{dst.name}/{name}.j2c", "want": "refused"},
                      {"file": f"{dst.name}/{name}.l1.j2c", "want": want1},
                      {"file": f"{dst.name}/{name}.l2.j2c", "want": source}]
            # Mutants, each of which check.mjs must see fail: the middle byte of layer 2's tile-part flipped; the
            # layer-1 prefix one byte short; for two sets, the second set read without its S_skip.
            bad = bytearray(cs)
            bad[sum(sizes[:2]) + sizes[2] // 2] ^= 0xA5
            mutants = {"flip": (bytes(bad), source), "short": (pre[:-3] + S.EOC, want1)}
            if shape == "twosets":
                mutants["skip"] = (cs, source)
            for m, (data, want) in mutants.items():
                f = dst / f"{name}.{m}.j2c"
                try:
                    one = S.single(data, hdr, 2, honour_skip=m != "skip")
                except Exception:  # noqa: BLE001  a parse that fails is a caught mutant too
                    one = b""
                f.write_bytes(one)
                items.append({"file": f"{dst.name}/{f.name}", "want": want, "mutant": m})
            (Path(tmp) / "pre.j2c").write_bytes(pre)
            g1, e1 = opj(Path(tmp) / "pre.j2c", tmp)
            g2, e2 = opj(dst / f"{name}.j2c", tmp)
            blocks = [b for row in plans for blks, _, _ in row for b in blks if any(b.layers)]
            split = sum(1 for b in blocks if b.layers[0] and b.layers[1])
            err = (l1 - px).astype(np.float64)
            peak = float(maxval)
            mse = float(np.mean(err * err))
            rows.append({
                "set": s.name, "frame": i, "shape": name, "today": len(today), "header": sizes[0],
                "layer1": sizes[1], "layer2": sizes[2], "total": len(cs),
                "blocks": len(blocks), "split": split,
                "psnr1": None if mse == 0 else round(10 * np.log10(peak * peak / mse), 3),
                "maxabs1": int(np.abs(err).max()),
                "opj_l1": None if g1 is None else digest(g1, s.stored) == want1, "opj_l1_error": e1,
                "opj_full": None if g2 is None else digest(g2, s.stored) == source, "opj_full_error": e2,
            })
    (dst / "items.json").write_text(json.dumps(items))
    return rows


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("work")
    ap.add_argument("sets", nargs="+")
    ap.add_argument("--every", type=int, default=1)
    ap.add_argument("--p", default="1,2,3,4,5,6,7")
    ap.add_argument("--jobs", type=int, default=4)
    a = ap.parse_args()
    ps = [int(x) for x in a.p.split(",") if x]
    for setdir in a.sets:
        s = Set(Path(setdir))
        jobs = [(setdir, i, a.work, ps) for i in range(0, s.n, a.every)]
        with ProcessPoolExecutor(a.jobs) as pool:
            rows = [r for part in pool.map(frame, jobs) for r in part]
        out = Path(a.work) / s.name / "rows.jsonl"
        out.write_text("".join(json.dumps(r) + "\n" for r in rows))
        print(f"{s.name}: {len(jobs)} frames, {len(rows)} codings -> {out}")


if __name__ == "__main__":
    main()
