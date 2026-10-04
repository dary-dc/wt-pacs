#!/usr/bin/env python3
"""ENCX's bytes: where lossless coding can still be cut. Each set's samples are cut into planes (the
whole, the top v >> k, the low v & (2^k - 1); on RGB the reversible colour transform and its top and
low), each plane is coded by one coder (libaom with an encoder variant, HTJ2K, the bits packed raw, or
packed and deflated), and a coding is a set of plane streams merged back.

Every stream is decoded and matched with the plane it was made from, frame by frame; every coding is
then decoded again from its stored bytes, merged, and matched with the checksum written when the series
was fetched. An inexact stream or coding is reported and its bytes not used.

usage: encx.py BUILD WORK OUT.json SET_DIR ...   [STAGE=bytes|tools JOBS=4 FRAMES=8 PIXELS=8000000]  — README.md here
"""
import json
import os
import subprocess
import sys
import tempfile
import zlib
from concurrent.futures import ProcessPoolExecutor
from pathlib import Path

import numpy as np

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE.parent))
sys.path.insert(0, str(HERE.parent / "llsize"))
import llsize  # noqa: E402
import size  # noqa: E402

llsize.PIXELS = int(os.environ.get("PIXELS", llsize.PIXELS))

# Row 28's best encoder variant per set.
BEST = {"ct_lidc": "sb64", "dbtproj_ge": "sb64", "dbtproj_holo": "sb64"}
FLAGS = {
    "sb64": ["--sb-size=64"],
    "screen": ["--tune-content=screen"],
    "inter": ["--kf-min-dist=1000", "--kf-max-dist=1000", "--auto-alt-ref=0"],
    "nointrabc": ["--enable-intrabc=0"],
    "nopalette": ["--enable-palette=0"],
}
TOOLS = ["filter-intra", "intra-edge-filter", "smooth-intra", "paeth-intra", "cfl-intra", "palette",
         "intrabc", "angle-delta", "directional-intra"]
for t in TOOLS:
    FLAGS["no-" + t] = [f"--enable-{t}=0"]


def best(s):
    return BEST.get(s.name, "screen+sb64")


def aom_flags(variant):
    return [f for part in variant.split("+") if part for f in FLAGS[part]] if variant != "aom" else []


def bits_of(s):
    return int(s.hi + s.offset).bit_length()


def plane(s, name):
    """name → (bits, channels, frame i → int32 h×w×c)."""
    v = lambda i: s.frame(i).astype(np.int32) + s.offset  # noqa: E731
    if s.ch == 3:
        rgb = v
        v = lambda i: rct(rgb(i))  # noqa: E731
    base = bits_of(s) + (1 if s.ch == 3 else 0)
    stem = name.removeprefix("rct")
    if stem in ("", "direct"):
        return base, s.ch, v
    k = int(stem[3:])
    if stem.startswith("top"):
        return base - k, s.ch, lambda i: v(i) >> k
    return k, s.ch, lambda i: v(i) & ((1 << k) - 1)


def rct(px):
    r, g, b = (px[..., c] for c in range(3))
    return np.stack([(r + 2 * g + b) >> 2, b - g + 256, r - g + 256], -1)


def rct_back(p):
    y, cb, cr = p[..., 0], p[..., 1] - 256, p[..., 2] - 256
    g = y - ((cb + cr) >> 2)
    return np.stack([cr + g, g, cb + g], -1)


def pack(px, k):
    """k bits a sample, MSB first, samples in raster order (channels interleaved)."""
    bits = (px.reshape(-1, 1).astype(np.uint16) >> np.arange(k - 1, -1, -1, dtype=np.uint16)) & 1
    return np.packbits(bits.astype(np.uint8).reshape(-1)).tobytes()


def unpack(raw, k, shape):
    n = int(np.prod(shape))
    bits = np.unpackbits(np.frombuffer(raw, np.uint8))[:n * k].reshape(n, k).astype(np.int32)
    return (bits << np.arange(k - 1, -1, -1)).sum(1).reshape(shape)


def deflate(raw):
    c = zlib.compressobj(9, zlib.DEFLATED, -15, 9)
    return c.compress(raw) + c.flush()


def inflate(raw):
    return zlib.decompress(raw, -15)


def j2k_args(ch):
    return ["-num_decomps", "5", "-block_size", "{64,64}", "-prog_order", "RPCL", "-reversible", "true"] + \
        (["-colour_trans", "false"] if ch == 3 else [])


def write_pnm(path, px, bits):
    h, w, ch = px.shape
    maxval = (1 << bits) - 1
    with open(path, "wb") as fh:
        fh.write(b"%s\n%d %d\n%d\n" % (b"P5" if ch == 1 else b"P6", w, h, maxval))
        fh.write(px.astype(">u2" if maxval > 255 else "u1").tobytes())


def ojph(cmd):
    subprocess.run([size.OJPH / "bin" / cmd[0], *cmd[1:]], check=True, capture_output=True,
                   env={"LD_LIBRARY_PATH": str(size.OJPH / "lib")})


def cell_dir(work, s, pl, coder):
    return work / s.name / f"{pl}.{coder}"


def encode_stream(build, work, s, pl, coder, n):
    """Codes plane pl of the first n frames; returns per-frame unit files under the cell."""
    bits, ch, take = plane(s, pl)
    cell = cell_dir(work, s, pl, coder)
    cell.mkdir(parents=True, exist_ok=True)
    if coder.startswith("av1"):
        variant = coder.split(":", 1)[1]
        y4m, ivf = cell / "in.y4m", cell / "out.ivf"
        llsize.write_y4m(y4m, n, llsize.container(bits), ch, s.h, s.w, take)
        llsize.AOM[variant] = aom_flags(variant)
        try:
            llsize.encode(build, variant, y4m, ivf, n, llsize.container(bits), ch)
        except subprocess.CalledProcessError as e:
            return dict(error="not encodable: " + e.stderr.decode()[-80:].strip())
        y4m.unlink()
        units = size.ivf_units(ivf)
        ivf.unlink()
        for i, u in enumerate(units):
            (cell / f"{i:03d}.unit").write_bytes(u)
        return {}
    for i in range(n):
        px = take(i)
        if coder == "j2k":
            pnm = cell / ("in.pgm" if ch == 1 else "in.ppm")
            write_pnm(pnm, px, bits)
            ojph(["ojph_compress", "-i", pnm, "-o", cell / f"{i:03d}.j2c", *j2k_args(ch)])
            (cell / f"{i:03d}.j2c").rename(cell / f"{i:03d}.unit")
            pnm.unlink()
        elif coder == "raw":
            (cell / f"{i:03d}.unit").write_bytes(pack(px, bits))
        elif coder == "deflate":
            (cell / f"{i:03d}.unit").write_bytes(deflate(pack(px, bits)))
        elif coder == "deflate-u":
            (cell / f"{i:03d}.unit").write_bytes(deflate(px.astype(np.uint8).tobytes()))
    return {}


def decode_stream(build, work, s, pl, coder, n):
    """The stream's planes back from its stored units: [int32 h×w×c] × n."""
    bits, ch, _ = plane(s, pl)
    cell = cell_dir(work, s, pl, coder)
    units = [(cell / f"{i:03d}.unit").read_bytes() for i in range(n)]
    shape = (s.h, s.w, ch)
    with tempfile.TemporaryDirectory(dir=work) as tmp:
        return decode_units(build, Path(tmp), coder, units, bits, shape)


def decode_units(build, tmp, coder, units, bits, shape):
    h, w, ch = shape
    if coder.startswith("av1"):
        (tmp / "all.obu").write_bytes(b"".join(units))
        got = llsize.decoded(build, tmp / "all.obu", tmp / "dec.y4m")
        return [g[:h, :w].astype(np.int32).reshape(shape) for g in got]
    out = []
    for u in units:
        if coder == "j2k":
            (tmp / "u.j2c").write_bytes(u)
            back = tmp / ("back.pgm" if ch == 1 else "back.ppm")
            ojph(["ojph_expand", "-i", tmp / "u.j2c", "-o", back])
            out.append(size.read_pnm(back).astype(np.int32).reshape(shape))
        elif coder == "raw":
            out.append(unpack(u, bits, shape))
        elif coder == "deflate":
            out.append(unpack(inflate(u), bits, shape))
        elif coder == "deflate-u":
            out.append(np.frombuffer(inflate(u), np.uint8).astype(np.int32).reshape(shape))
    return out


def stream_job(build, work, path, pl, coder):
    s = size.Set(Path(path))
    n = llsize.frames(s)
    row = dict(set=s.name, plane=pl, coder=coder, frames=n)
    meta = cell_dir(work, s, pl, coder) / "row.json"
    if meta.exists():
        return json.loads(meta.read_text())
    err = encode_stream(build, work, s, pl, coder, n)
    if err:
        return {**row, **err}
    _, _, take = plane(s, pl)
    got = decode_stream(build, work, s, pl, coder, n)
    row["exact"] = sum(len(got) == n and np.array_equal(got[i], take(i)) for i in range(n))
    if coder.startswith("av1") and "inter" not in coder:
        cell = cell_dir(work, s, pl, coder)
        (cell / "last.obu").write_bytes((cell / f"{n - 1:03d}.unit").read_bytes())
        alone = llsize.decoded(build, cell / "last.obu", cell / "dec.y4m")[0]
        row["last_alone"] = bool(np.array_equal(alone[:s.h, :s.w].astype(np.int32).reshape(take(0).shape), take(n - 1)))
    row["bytes"] = [(cell_dir(work, s, pl, coder) / f"{i:03d}.unit").stat().st_size for i in range(n)]
    meta.write_text(json.dumps(row))
    return row


def merge(s, planes, parts):
    """parts: [(plane name)] in coding order; samples back as coded values (h×w×c, offset kept)."""
    total = 0
    for name, px in zip(parts, planes):
        stem = name.removeprefix("rct")
        k = int(stem[3:]) if stem.startswith("top") else 0
        total = total + (px << k)
    return rct_back(total) if s.ch == 3 else total


def check_coding(build, work, path, parts):
    """parts: [(plane, coder)]. Every frame decoded from stored bytes, merged, against the truth."""
    s = size.Set(Path(path))
    n = llsize.frames(s)
    decoded = [decode_stream(build, work, s, pl, coder, n) for pl, coder in parts]
    return sum(size.exact(s, i, merge(s, [d[i] for d in decoded], [p for p, _ in parts])) for i in range(n))


def low_split(s):
    """The k = 2 split's top and low plane names, and k's range for the set."""
    b = bits_of(s) + (1 if s.ch == 3 else 0)
    return [k for k in (1, 2, 3) if 6 <= b - k <= 12]


def codings(s, stage):
    """name → [(plane, coder)]."""
    v = best(s)
    p = "rct" if s.ch == 3 else ""
    out = {}
    if stage == "bytes":
        out["htj2k.direct"] = [(p or "direct", "j2k")]
        for k in low_split(s):
            top, low = f"{p}top{k}", f"{p}low{k}"
            out[f"htj2k.low{k}"] = [(top, "j2k"), (low, "j2k")]
            for lc in ("raw", "deflate", "deflate-u"):
                out[f"htj2k.low{k}+{lc}"] = [(top, "j2k"), (low, lc)]
                out[f"av1.low{k}+{lc}"] = [(top, f"av1:{v}"), (low, lc)]
            out[f"av1.low{k}"] = [(top, f"av1:{v}"), (low, f"av1:{v}")]
        if s.ch == 3 or bits_of(s) <= 12:
            out["av1.direct"] = [(p or "direct", f"av1:{v}")]
        if llsize.frames(s) >= 6:
            top, low = f"{p}top2", f"{p}low2"
            out["av1.low2.top-inter"] = [(top, f"av1:{v}+inter"), (low, f"av1:{v}")]
            out["av1.low2.low-inter"] = [(top, f"av1:{v}"), (low, f"av1:{v}+inter")]
            out["av1.low2.both-inter"] = [(top, f"av1:{v}+inter"), (low, f"av1:{v}+inter")]
            if s.ch == 3 or bits_of(s) <= 12:
                out["av1.direct.inter"] = [(p or "direct", f"av1:{v}+inter")]
    else:
        top, low = f"{p}top2", f"{p}low2"
        plain = v.replace("screen+", "")
        out["av1.low2.low-screen"] = [(top, f"av1:{plain}"), (low, "av1:screen+sb64")]
        out["av1.low2.low-screen-nointrabc"] = [(top, f"av1:{plain}"), (low, "av1:screen+sb64+nointrabc")]
        out["av1.low2.low-screen-nopalette"] = [(top, f"av1:{plain}"), (low, "av1:screen+sb64+nopalette")]
        out["av1.low2"] = [(top, f"av1:{v}"), (low, f"av1:{v}")]
        out[f"av1.low2.plain-{plain}"] = [(top, f"av1:{plain}"), (low, f"av1:{plain}")]
        for t in TOOLS:
            if t == "cfl-intra" and s.ch == 1:
                continue
            out[f"av1.low2.no-{t}"] = [(top, f"av1:{v}+no-{t}"), (low, f"av1:{v}+no-{t}")]
    return out


def main():
    build, work, out, *sets = sys.argv[1:]
    build, work = Path(build).resolve(), Path(work).resolve()
    stage = os.environ.get("STAGE", "bytes")
    work.mkdir(parents=True, exist_ok=True)
    plan = {path: codings(size.Set(Path(path)), stage) for path in sets}
    streams = sorted({(path, pl, c) for path, cs in plan.items() for parts in cs.values() for pl, c in parts},
                     key=lambda j: (-("av1" in j[2]), -size.Set(Path(j[0])).w * size.Set(Path(j[0])).h))
    rows = {}
    with ProcessPoolExecutor(int(os.environ.get("JOBS", 4))) as pool:
        for job, row in zip(streams, pool.map(stream_job, *zip(*[(build, work, *j) for j in streams]))):
            rows[job] = row
            print(json.dumps(row)[:200], flush=True)
        checks = [(path, name, parts) for path, cs in plan.items() for name, parts in cs.items()
                  if all(rows[(path, pl, c)].get("exact") == rows[(path, pl, c)]["frames"] for pl, c in parts)]
        exact = pool.map(check_coding, *zip(*[(build, work, path, parts) for path, _, parts in checks]))
        merged = {(path, name): e for (path, name, _), e in zip(checks, exact)}
    result = []
    for path, cs in plan.items():
        s = size.Set(Path(path))
        ht = llsize.htj2k(s, work / s.name)
        for name, parts in cs.items():
            st = [rows[(path, pl, c)] for pl, c in parts]
            n = st[0]["frames"]
            ok = merged.get((path, name))
            per = [sum(r["bytes"][i] for r in st) for i in range(n)] if ok == n else None
            result.append(dict(set=s.name, coding=name, parts=parts, frames=n, exact=ok,
                               bytes=per, total=sum(per) if per else None,
                               ratio=round(sum(per) / ht["bytes"], 4) if per else None,
                               streams={f"{pl}.{c}": r.get("bytes") and sum(r["bytes"]) for (pl, c), r in zip(parts, st)},
                               htj2k=ht["bytes"], htj2k_exact=ht["exact"]))
            print(f"{s.name}\t{name}\t{result[-1]['ratio']}\texact {ok}/{n}", flush=True)
    Path(out).write_text(json.dumps(result, indent=1))


if __name__ == "__main__":
    main()
