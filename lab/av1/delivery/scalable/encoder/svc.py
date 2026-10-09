#!/usr/bin/env python3
"""libaom's real-time scalable encoder, lossless: every layer's frames against the encoder's input.

Ground truth is the checksum written when each input frame was made (roundtrip.py's synthetic
frames, fetch_data.sh's series), never a decoder's output. svc_encoder_rtc writes one stream per
operating point (a layer and every layer below it); each is decoded alone with dav1d and each
decoded frame matched to its input frame by the IVF timestamp. A downscaled spatial layer is a
picture the encoder made, with no checksum outside it, so only full-size layers are compared.

usage: svc.py BUILD WORK OUT.tsv SET_DIR ...   — lab/av1/delivery/scalable/encoder/README.md has the cells.
"""
import struct
import subprocess
import sys
from pathlib import Path

import numpy as np

sys.path.insert(0, str(Path(__file__).resolve().parents[3]))
import size  # noqa: E402

# (name, layering mode, spatial, temporal, scale factors or None for the example's 1/2, 1/4)
LAYOUTS = [
    ("L1T1", 0, 1, 1, None),
    ("L1T3", 2, 1, 3, None),
    ("L2T1", 5, 2, 1, None),
    ("L3T3", 9, 3, 3, None),
    ("L2T1-full", 5, 2, 1, "1/1,1/1"),
    ("L3T3-full", 9, 3, 3, "1/1,1/1,1/1"),
]
SPEEDS = (7, 10)
KBPS = 600_000  # per layer: far above any lossless frame, so rate control never drops one


def load(path):
    s = size.Set(path)
    if s.pnms:
        s.av1_bits = s.stored  # a synthetic set is coded at the depth it was made for
    return s


def write_y4m(s, path):
    """size.write_y4m's planes, padded by edge replicas to even sizes (the example refuses odd ones);
    grey keeps its neutral chroma, which the stock example codes and the patched one drops."""
    tag = ("444" if s.ch == 3 else "420") + ("" if s.av1_bits == 8 else f"p{s.av1_bits}")
    dt = "u1" if s.av1_bits == 8 else "<u2"
    h, w = s.h + s.h % 2, s.w + s.w % 2
    neutral = np.full((h // 2, w // 2), 1 << (s.av1_bits - 1), dt)
    with open(path, "wb") as fh:
        fh.write(f"YUV4MPEG2 W{w} H{h} F25:1 Ip A1:1 C{tag}\n".encode())
        for i in range(s.n):
            px = (s.frame(i).astype(np.int32) + s.offset).astype(dt)
            px = np.pad(px, ((0, h - s.h), (0, w - s.w), (0, 0)), mode="edge")
            planes = [px[..., 1], px[..., 2], px[..., 0]] if s.ch == 3 else [px[..., 0], neutral, neutral]
            fh.write(b"FRAME\n" + b"".join(np.ascontiguousarray(p).tobytes() for p in planes))


def read_y4m(path):
    """dav1d's Y4M as a list of frames, each a list of planes."""
    raw = path.read_bytes()
    head, rest = raw.split(b"\n", 1)
    f = {t[:1]: t[1:].decode() for t in head.split()[1:]}
    w, h, c = int(f[b"W"]), int(f[b"H"]), f.get(b"C", "420jpeg")
    bpp = 2 if c[-2:] in ("10", "12") else 1
    dims = [(h, w)] if c.startswith("mono") else \
        [(h, w)] * 3 if c.startswith("444") else [(h, w)] + [((h + 1) // 2, (w + 1) // 2)] * 2
    frames, pos = [], 0
    while pos < len(rest):
        pos = rest.index(b"\n", pos) + 1
        planes = []
        for ph, pw in dims:
            n = ph * pw * bpp
            planes.append(np.frombuffer(rest[pos:pos + n], "<u2" if bpp == 2 else "u1").reshape(ph, pw))
            pos += n
        frames.append(planes)
    return frames


def compare(s, i, planes):
    """(exact, wrong samples, max |Δ|) of one decoded frame against input frame i."""
    px = np.stack([planes[2], planes[0], planes[1]], -1) if s.ch == 3 else planes[0][..., None]
    px = px[:s.h, :s.w].astype(np.int32)
    neutral = 1 << (s.av1_bits - 1)
    chroma_wrong = sum(int((p != neutral).sum()) for p in planes[1:]) if s.ch == 1 else 0
    if size.exact(s, i, px) and not chroma_wrong:
        return True, 0, 0
    diff = np.abs(px - (s.frame(i).astype(np.int32) + s.offset))
    return False, int((diff > 0).sum()) + chroma_wrong, int(diff.max())


def encode_cmd(build, encoder, s, layout, speed, y4m, out):
    _, mode, sl, tl, scale = layout
    exe = build / ("aom-3.15.1-b" if encoder == "stock" else "aom-3.15.1-svc-b") / "svc_encoder_rtc"
    cmd = [str(exe), "-o", str(out), "-lm", str(mode), "-sl", str(sl), "-tl", str(tl),
           "-b", str(KBPS * sl), "-bl", ",".join([str(KBPS)] * (sl * tl)),
           "--min-q=0", "--max-q=0", "-k", "100000", "-sp", str(speed), "-d", str(s.av1_bits)]
    cmd += ["-r", scale] if scale else []
    if encoder == "patched":
        cmd += [f"--profile={2 if s.av1_bits == 12 else s.ch // 3}"]
        cmd += ["--monochrome"] if s.ch == 1 else []
    return cmd + [str(y4m)]


def ivf_pts(path):
    raw, pos, pts = path.read_bytes(), 32, []
    while pos < len(raw):
        n, stamp = struct.unpack_from("<IQ", raw, pos)
        pts.append(stamp)
        pos += 12 + n
    return pts


def run_cell(build, work, encoder, s, layout, speed):
    lname, _, sl, tl, scale = layout
    cell = work / "cells" / f"{encoder}.{s.name}.{lname}.sp{speed}"
    cell.mkdir(parents=True, exist_ok=True)
    y4m = work / f"{s.name}.y4m"
    if not y4m.exists():
        write_y4m(s, y4m)
    out = cell / "out.ivf"
    cmd = encode_cmd(build, encoder, s, layout, speed, y4m, out)
    (cell / "cmd").write_text(" ".join(cmd) + "\n")
    enc = subprocess.run(cmd, capture_output=True, text=True)
    base = dict(encoder=encoder, set=s.name, layout=lname, speed=speed)
    if enc.returncode:
        lines = [l for l in (enc.stdout + enc.stderr).splitlines() if l.strip()]
        err = next((l for l in lines if l.startswith(("Error", "Failed", "Option"))), lines[-1])
        return [dict(base, layer="-", verdict="not encodable: " + err.strip())]
    rows = []
    for si in range(sl):
        for ti in range(tl):
            stream = Path(f"{out}_{si * tl + ti}.av1")
            pts = ivf_pts(stream)
            # A full-size operating point outputs every spatial layer; a scaled one only its top.
            want = pts if scale else sorted(set(pts))
            dec = cell / "dec.y4m"
            r = subprocess.run([str(build / "dav1d/bin/dav1d"), "-q", "-i", str(stream), "-o", str(dec),
                                "--alllayers", "1" if scale else "0"], capture_output=True, text=True,
                               env={"LD_LIBRARY_PATH": str(build / "dav1d/lib")})
            row = dict(base, layer=f"S{si}T{ti}", bytes=stream.stat().st_size)
            if r.returncode:
                rows.append(dict(row, verdict="decode failed: " + r.stderr.strip()[-120:]))
                continue
            decoded = read_y4m(dec)
            row.update(decoded=len(decoded), expected=len(want))
            if sorted(set(pts)) != list(range(0, s.n, 1 << (tl - 1 - ti))):
                rows.append(dict(row, verdict="INEXACT: frames missing from the layer"))
                continue
            if not scale and si < sl - 1:
                rows.append(dict(row, verdict="scaled, no truth"))
                continue
            exact = wrong = max_d = 0
            for planes, i in zip(decoded, want):
                ok, w, d = compare(s, i, planes)
                exact, wrong, max_d = exact + ok, wrong + w, max(max_d, d)
            whole = exact == len(want) == len(decoded)
            rows.append(dict(row, exact=exact, wrong_samples=wrong, max_abs_diff=max_d,
                             verdict="exact" if whole else "INEXACT"))
    return rows


KEYS = ["encoder", "set", "layout", "speed", "layer", "bytes", "decoded", "expected", "exact",
        "wrong_samples", "max_abs_diff", "verdict"]


def main():
    build, work, out, *sets = sys.argv[1:]
    build, work = Path(build), Path(work)
    with open(out, "w") as fh:
        fh.write("\t".join(KEYS) + "\n")
        for path in sets:
            s = load(Path(path))
            for encoder in ("stock", "patched"):
                for layout in LAYOUTS:
                    for speed in SPEEDS:
                        for r in run_cell(build, work, encoder, s, layout, speed):
                            line = "\t".join(str(r.get(k, "")) for k in KEYS)
                            fh.write(line + "\n")
                            fh.flush()
                            print(line, flush=True)


if __name__ == "__main__":
    main()
