#!/usr/bin/env python3
"""The scalable preview as a tool, stage 1: every shape of docs/av1/README.md §The scalable preview as a tool (5) coded on whole
DBT volumes, every exact frame and every base checked, bytes and base quality against the source.

Predicted: svc_encoder_rtc (shape.py's encoder) codes base and lossless top in one stream — on a 12-bit volume once
whole (12 bits) and once split (v >> 2 at 10 bits, the low bits as the shipped payload codes them). Alone: the
predicted coding's base-layer stream beside the shipped payload (split-rule/make_frames.py --preset allintra:7 --k 2).

usage: shapes.py BUILD SHIPPED WORK OUT.tsv SET_DIR ... [--shapes NAME,NAME]   — lab/av1/delivery/scalable/tool/README.md
"""
import struct
import sys
from concurrent.futures import ProcessPoolExecutor
from pathlib import Path

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE.parent / "shape"))
import shape  # noqa: E402

KEY = 8
BASE_Q = (20, 40, 60)
MIDDLE_Q = (10, 20, 30)


def predicted():
    """(name, layering mode, spatial layers, scale factors, per-layer quantizers, keyframe interval, base factor)."""
    out = []
    for q in BASE_Q:
        out += [(f"two-quarter-q{q}", 5, 2, "1/4,1/1", f"{q},0", KEY, 4),
                (f"two-half-q{q}", 5, 2, None, f"{q},0", KEY, 2),
                (f"three-q{q}", 6, 3, None, f"{q},{q // 2},0", KEY, 4)]
    out += [(f"three-full-m{m}", 6, 3, "1/4,1/1,1/1", f"40,{m},0", KEY, 4) for m in MIDDLE_Q]
    return out + [("two-quarter-q40-one-key", 5, 2, "1/4,1/1", "40,0", shape.WHOLE, 4)]


def payload_parts(path):
    """A shipped one-frame split payload's (top unit, low unit): payload-format.md's 16-byte header, the frame's length,
    then the frame as u32le top length, top, low."""
    raw = path.read_bytes()
    n = struct.unpack_from("<I", raw, 20)[0]
    return raw[24:24 + n], raw[24 + n:]


def write_ivf(path, units):
    """One IVF frame a temporal unit, as the decode bench reads them."""
    head = b"DKIF" + struct.pack("<HH4sHHIIII", 0, 32, b"AV01", 0, 0, 25, 1, len(units), 0)
    path.write_bytes(head + b"".join(struct.pack("<IQ", len(u), i) + u for i, u in enumerate(units)))


def shipped_low(build, s, shipped, cell):
    """The shipped payload's low units, decoded; its top and low streams written for the decode bench."""
    parts = [payload_parts(shipped / s.name / f"{i:03d}.k2.av1") for i in range(s.n)]
    write_ivf(cell / "shipped-top.ivf", [top for top, _ in parts])
    write_ivf(cell / "low.ivf", [low for _, low in parts])
    (cell / "low.obu").write_bytes(b"".join(low for _, low in parts))
    return shape.dav1d(build, cell / "low.obu", cell / "dec.y4m"), sum(len(low) for _, low in parts)


def codings(s):
    """Each coding of the scalable stream: (name, plane, coded bits, low bits apart)."""
    whole = shape.Plane(s)
    whole.shift, whole.av1_bits = 0, whole.bits
    out = [("whole", whole)]
    if whole.bits == 12:
        split = shape.Plane(s)
        split.shift, split.av1_bits = 2, 10
        out.append(("split", split))
    return out


def run_set(build, shipped, work, path, only=None):
    s = shape.svc.load(Path(path))
    cell = work / s.name
    cell.mkdir(parents=True, exist_ok=True)
    htj2k = sum((shipped / s.name / f"{i:03d}.htj2k").stat().st_size for i in range(s.n))
    shipped_bytes = sum((shipped / s.name / f"{i:03d}.k2.av1").stat().st_size for i in range(s.n))
    low, low_bytes = shipped_low(build, s, shipped, cell)
    rows = []
    for coding, p in codings(s)[-1:] if only else codings(s):
        y4m = cell / f"{coding}.y4m"
        shape.write_y4m(p, y4m, p.top, p.av1_bits, s.ch)
        for name, mode, sl, scale, layer_q, key, factor in predicted():
            if only and name not in only:
                continue
            ivf = cell / f"{coding}-{name}.ivf"
            shape.encode(build, y4m, ivf, p.av1_bits, s.ch, mode, sl, 1, scale, layer_q, key)
            top_stream = Path(f"{ivf}_{sl - 1}.av1")
            top = shape.dav1d(build, top_stream, cell / "dec.y4m")
            split_low = low if p.shift else None
            base_stream = Path(f"{ivf}_0.av1")
            base = shape.dav1d(build, base_stream, cell / "dec.y4m")
            psnr, max_d = shape.base_quality(p, base, factor, range(s.n))
            row = dict(set=s.name, coding=coding, shape=name, frames=s.n, htj2k_bytes=htj2k, shipped_bytes=shipped_bytes,
                       top_exact=shape.exact_frames(p, top, split_low) if len(top) == s.n else f"{len(top)} frames",
                       total_bytes=top_stream.stat().st_size + (low_bytes if p.shift else 0),
                       base_bytes=base_stream.stat().st_size, base_frames=len(base),
                       base_size=f"{base[0][0].shape[1]}x{base[0][0].shape[0]}", base_psnr_db=psnr, base_max_abs_diff=max_d)
            if name.startswith("three-full"):
                middle_stream = Path(f"{ivf}_1.av1")
                middle = shape.dav1d(build, middle_stream, cell / "dec.y4m")
                row["middle_psnr_db"], row["middle_max_abs_diff"] = shape.base_quality(p, middle, 1, range(s.n))
            rows.append(row)
            print("\t".join(f"{k}={v}" for k, v in row.items()), flush=True)
            for f in Path(cell).glob(f"{ivf.name}_*.av1"):
                if f not in (top_stream, base_stream) and not (name.startswith("three-full") and f.name.endswith("_1.av1")):
                    f.unlink()
            ivf.unlink()
        y4m.unlink()
    (cell / "dec.y4m").unlink()
    return rows


KEYS = ["set", "coding", "shape", "frames", "top_exact", "htj2k_bytes", "shipped_bytes", "total_bytes", "base_bytes",
        "base_frames", "base_size", "base_psnr_db", "base_max_abs_diff", "middle_psnr_db", "middle_max_abs_diff"]


def main():
    args = sys.argv[1:]
    only = args.pop(args.index("--shapes") + 1).split(",") if "--shapes" in args else None
    if only:
        args.remove("--shapes")
    build, shipped, work, out, *sets = args
    build, shipped, work = Path(build).resolve(), Path(shipped).resolve(), Path(work).resolve()
    with ProcessPoolExecutor(len(sets)) as pool:
        results = list(pool.map(run_set, *zip(*[(build, shipped, work, d, only) for d in sets])))
    with open(out, "w") as fh:
        fh.write("\t".join(KEYS) + "\n")
        for rows in results:
            for row in rows:
                fh.write("\t".join(str(row.get(k, "")) for k in KEYS) + "\n")


if __name__ == "__main__":
    main()
