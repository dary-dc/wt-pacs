#!/usr/bin/env python3
"""RESIDAPART's references and bytes, per encode.py output: each cell's residual as its HTJ2K decodes it
(source − native dav1d's preview + offset, hashed as the browser's OpenJPH returns it), each preview
keyframe's film_grain_params_present, and the bytes table.

usage: apart_truth.py BUILD OUT [FIRST]   writes OUT/truth.json — lab/av1/delivery/residual/README.md
"""
import hashlib
import importlib.util
import json
import sys
from pathlib import Path

import numpy as np

HERE = Path(__file__).resolve().parent
# Not `import encode`: encode.py itself imports the preview row's module of that name.
spec = importlib.util.spec_from_file_location("residual_encode", HERE / "encode.py")
encode = importlib.util.module_from_spec(spec)
spec.loader.exec_module(encode)
Set, coded, dav1d = encode.Set, encode.coded, encode.dav1d


def leb128(b, at):
    v = 0
    for i in range(8):
        v |= (b[at] & 127) << (7 * i)
        at += 1
        if not b[at - 1] & 128:
            break
    return v, at


def film_grain(unit):
    """film_grain_params_present of the unit's sequence header (AV1 §5.5.1), None without one."""
    at = 0
    while at < len(unit):
        h = unit[at]
        at += 1 + ((h >> 2) & 1)
        size, at = leb128(unit, at)
        if (h >> 3) & 15 == 1:
            return SeqBits(unit[at:at + size]).film_grain()
        at += size
    return None


class SeqBits:
    def __init__(self, obu):
        self.b, self.at = obu, 0

    def f(self, n):
        v = 0
        for _ in range(n):
            v = 2 * v + ((self.b[self.at >> 3] >> (7 - (self.at & 7))) & 1)
            self.at += 1
        return v

    def uvlc(self):
        z = 0
        while not self.f(1):
            z += 1
        return self.f(z) if z < 32 else 0

    def film_grain(self):
        f = self.f
        profile, _, reduced = f(3), f(1), f(1)
        if reduced:
            f(5)
        else:
            timing = f(1)
            model = 0
            if timing:
                f(64)
                if f(1):
                    self.uvlc()
                model = f(1)
            delay = 0
            if model:
                delay = f(5) + 1
                f(32 + 5 + 5)
            display = f(1)
            for _ in range(f(5) + 1):
                f(12)
                if f(5) > 7:
                    f(1)
                if model and f(1):
                    f(2 * delay + 1)
                if display and f(1):
                    f(4)
        wb, hb = f(4) + 1, f(4) + 1
        f(wb + hb)
        if not reduced and f(1):
            f(7)
        f(3)
        if not reduced:
            f(4)
            hint = f(1)
            if hint:
                f(2)
            screen = 2 if f(1) else f(1)
            if screen and not f(1):
                f(1)
            if hint:
                f(3)
        f(3)
        high = f(1)
        bits = (12 if f(1) else 10) if profile == 2 and high else 10 if high else 8
        mono = 0 if profile == 1 else f(1)
        cp, tc, mc = (f(8), f(8), f(8)) if f(1) else (2, 2, 2)
        if mono:
            f(1)
        else:
            sx, sy = 1, 1
            if cp == 1 and tc == 13 and mc == 0:
                sx = sy = 0
            else:
                f(1)
                if profile == 1:
                    sx = sy = 0
                elif profile == 2:
                    if bits == 12:
                        sx = f(1)
                        sy = f(1) if sx else 0
                    else:
                        sx, sy = 1, 0
                if sx and sy:
                    f(2)
            f(1)
        return f(1)


def residuals(build, s, cell, units, work):
    stream = work / "preview.obu"
    stream.write_bytes(b"".join(units))
    frames = dav1d(build, stream, work / "truth.y4m")
    encode.SHIFT = cell["preview_shift"]
    out = []
    for i, planes in enumerate(frames[:len(units)]):
        if hashlib.sha256(b"".join(np.ascontiguousarray(p).tobytes() for p in planes)).hexdigest() != cell["preview_hashes"][i]:
            sys.exit(f"{s.name} {cell['cell']} {i}: native preview differs from encode.py's")
        r = coded(s, i) - encode.prediction(s, planes) + cell["resid_offset"]
        out.append(hashlib.sha256(r.astype("<u2" if cell["resid_bits"] > 8 else "u1").tobytes()).hexdigest())
    return out


def main():
    build, out = Path(sys.argv[1]).resolve(), Path(sys.argv[2]).resolve()
    first = int(sys.argv[3]) if len(sys.argv) > 3 else 16
    manifest = json.loads((out / "manifest.json").read_text())
    data = HERE.parents[1] / "data"
    truth = {}
    print("set\tcell\tCRF\ts\tbits\tPSNR\tmax|Δ|\tfilm grain\tresid÷HTJ2K 16\tpreview÷HTJ2K 16\tresid÷HTJ2K all\tpreview÷HTJ2K all")
    for e in manifest:
        s, work = Set(data / e["name"]), out / f".{e['name']}-work"
        h16, hall = sum(e["htj2k"][:first]), sum(e["htj2k"])
        for c in e["cells"]:
            units = [(out / e["name"] / c["cell"] / f"{i:03d}.av1").read_bytes() for i in range(min(first, e["frames"]))]
            grain = [film_grain(u) for u in units[::c["group"]]]
            truth.setdefault(e["name"], {})[c["cell"]] = dict(residuals=residuals(build, s, c, units, work), film_grain=grain)
            r, p = c["resid_htj2k"], c["preview"]
            print(f"{e['name']}\t{c['cell']}\t{c['crf']}\t{c['preview_shift']}\t{c['preview_bits']}\t{c['psnr_mean']}\t{c['max_abs']}"
                  f"\t{sum(grain)}/{len(grain)}\t{sum(r[:first]) / h16:.4f}\t{sum(p[:first]) / h16:.4f}"
                  f"\t{sum(r) / hall:.4f}\t{sum(p) / hall:.4f}", flush=True)
    (out / "truth.json").write_text(json.dumps(truth))


if __name__ == "__main__":
    main()
