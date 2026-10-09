#!/usr/bin/env python3
"""Row BREAST's bytes: each breast-family series as payloads in every layout, at cpu0 and its shipped preset,
against HTJ2K on the same frames; then intra against inter by group on the slice series and the cine.

Every payload is written by ingest/coded-frames/ingest.py, which writes nothing unless native dav1d decodes it back
to its source. Inter codes the optimized representation's streams a group at a time (--auto-alt-ref=0),
decodes each group alone through native dav1d, merges as the client does and checks every frame.

usage: breast.py BUILD WORK OUT.jsonl bytes|inter SET_DIR ... [--frames N] [--jobs N]   — README.md here
"""
import argparse
import json
import re
import subprocess
import sys
import tempfile
from concurrent.futures import ProcessPoolExecutor
from pathlib import Path

import numpy as np

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE.parents[1]))
sys.path.insert(0, str(HERE.parents[3] / "ingest/coded-frames"))
import ingest  # noqa: E402
import size  # noqa: E402

# Row 14's speed order of the candidates, fastest first; the shipped preset is the first within 2 % of cpu0.
CANDIDATES = ("allintra:7", "allintra:6", "good:6", "allintra:5")
GROUPS = (1, 8, 16)
INTER_PRESETS = ("cpu0", "good:6")


def bits(s):
    return max(1, int(s.hi + s.offset).bit_length())


def layouts(s):
    """name → ingest.py's arguments: plain, optimized (the k = 2 split over 8 bits) and, over 8 bits, row 44's variants
    d12 (k = b − 12), k3 and w10 (k = b − 10) where each is a k of its own; RGB plain and RCT."""
    if s.ch == 3:
        return {"plain": ["--representation", "plain"], "rct": ["--representation", "optimized"]}
    out = {"plain": ["--representation", "plain"], "opt": ["--representation", "optimized"]}
    b = bits(s)
    if b > 8:
        taken = {2}
        for name, k in (("d12", max(0, b - 12)), ("k3", 3), ("w10", max(0, b - 10))):
            if k not in taken:
                taken.add(k)
                out[name] = ["--representation", "optimized", "--split", str(k)]
    return out


def payloads(build, s, items_dir, layout, preset, n):
    out = items_dir / s.name / f"{layout}.{preset.replace(':', '')}"
    r = subprocess.run([sys.executable, HERE.parents[3] / "ingest/coded-frames/ingest.py", build, s.path, out, *layouts(s)[layout],
                        "--preset", preset, "--frames", str(n), "--jobs", "1"], capture_output=True, text=True)
    if r.returncode:
        return dict(set=s.name, layout=layout, preset=preset, frames=n, exact=False, said=r.stderr.strip()[-300:])
    total = sum(p.stat().st_size for p in out.glob("*.av1"))
    return dict(set=s.name, layout=layout, preset=preset, frames=n, exact=True, bytes=total)


def htj2k(s, n, work):
    env = {"LD_LIBRARY_PATH": str(size.OJPH / "lib")}
    ext = "pgm" if s.ch == 1 else "ppm"
    src, out, back = work / f"in.{ext}", work / "f.j2c", work / f"back.{ext}"
    total, exact = 0, 0
    for i in range(n):
        shift = size.pnm(s, i, src)
        subprocess.run([size.OJPH / "bin/ojph_compress", "-i", src, "-o", out, "-num_decomps", "5", "-block_size",
                        "{64,64}", "-prog_order", "RPCL", "-reversible", "true"], check=True, capture_output=True, env=env)
        subprocess.run([size.OJPH / "bin/ojph_expand", "-i", out, "-o", back], check=True, capture_output=True, env=env)
        exact += size.exact(s, i, size.read_pnm(back).astype(np.int32) - shift + s.offset)
        total += out.stat().st_size
    return dict(set=s.name, layout="htj2k", preset="-", frames=n, exact=exact == n, bytes=total)


def bytes_job(job):
    build, path, items_dir, n, layout = job
    s = size.Set(Path(path))
    if layout == "htj2k":
        with tempfile.TemporaryDirectory() as tmp:
            return [htj2k(s, n, Path(tmp))]
    rows = [payloads(build, s, items_dir, layout, "cpu0", n)]
    if s.name in SHIPPED_CPU0:
        return rows
    for preset in CANDIDATES:
        row = payloads(build, s, items_dir, layout, preset, n)
        rows.append(row)
        if row["exact"] and rows[0]["exact"] and row["bytes"] <= 1.02 * rows[0]["bytes"]:
            row["shipped"] = True
            break
    return rows


# RGB ultrasound ships at cpu0 (payload-format.md): every faster preset cost row 14's ultrasound ≥ 3.2 %.
SHIPPED_CPU0 = {"usb_cine_rgb"}


def decode_all(build, obu, work):
    """Every picture of a group through native dav1d, as h×w×c int arrays in coded planes."""
    src, out = work / "g.obu", work / "g.y4m"
    src.write_bytes(obu)
    subprocess.run([build / "dav1d/bin/dav1d", "-q", "-i", src, "-o", out, "--demuxer", "section5"],
                   check=True, capture_output=True, env={"LD_LIBRARY_PATH": str(build / "dav1d/lib")})
    raw = out.read_bytes()
    head, rest = raw.split(b"\n", 1)
    tags = {t[:1]: t[1:].decode() for t in head.split()[1:]}
    m = re.fullmatch(r"(mono|444)p?(10|12)?", tags[b"C"])
    w, h, planes = int(tags[b"W"]), int(tags[b"H"]), 1 if m[1] == "mono" else 3
    dt = "u1" if not m[2] else "<u2"
    size_ = h * w * planes * np.dtype(dt).itemsize
    pics = []
    for chunk in rest.split(b"FRAME\n")[1:]:
        px = np.frombuffer(chunk[:size_], dt).reshape(planes, h, w)
        pics.append(np.moveaxis(px, 0, -1).astype(np.int32))
    return pics


def inter_job(job):
    """One set, one preset, one group length: the optimized streams coded group by group, every frame checked."""
    build, path, ivf_dir, n, preset, g = job
    s = size.Set(Path(path))
    header, streams = ingest.plan(s, "optimized")
    header["offset"] = s.offset
    rep = "rct" if s.ch == 3 else (f"low{header['split']}" if header["split"] else "direct")
    cell = ivf_dir / f"{s.name}.{rep}.g{g}-{preset.replace(':', '')}"
    cell.mkdir(parents=True, exist_ok=True)
    exact, total = 0, 0
    with tempfile.TemporaryDirectory() as tmp:
        work = Path(tmp)
        units = [[] for _ in streams]
        for a in range(0, n, g):
            b = min(a + g, n)
            pictures = []
            for j, (depth, layout, plane) in enumerate(streams):
                y4m, ivf = work / f"{j}.y4m", work / f"{j}.ivf"
                ingest.write_y4m(y4m, [plane(i) for i in range(a, b)], depth, layout)
                args = [x for x in ingest.encoder_args(preset, "optimized", depth, layout) if x != "--kf-max-dist=0"]
                if g > 1:
                    args += [f"--kf-min-dist={g}", f"--kf-max-dist={g}", "--auto-alt-ref=0"]
                else:
                    args += ["--kf-max-dist=0"]
                subprocess.run([build / f"aom-{size.AOM}/bin/aomenc", "-q", "-o", ivf, f"--limit={b - a}", *args, y4m],
                               check=True, capture_output=True)
                group = size.ivf_units(ivf)
                units[j] += group
                pictures.append(decode_all(build, b"".join(group), work) if len(group) == b - a else [])
            for k, i in enumerate(range(a, b)):
                if all(len(p) == b - a for p in pictures):
                    merged = ingest.merge(header, [p[k] for p in pictures])[:s.h, :s.w]
                    exact += size.exact(s, i, merged)
        for j, us in enumerate(units):
            (cell / f"{j}.ivf").write_bytes(ivf_file(us, s.w, s.h))
            total += sum(len(u) for u in us)
    return [dict(set=s.name, layout=rep, preset=preset, group=g, frames=n, exact=exact == n, exact_n=exact,
                 bytes=total, cell=str(cell))]


def ivf_file(units, w, h):
    """An IVF the lab's dav1d-WASM timing reads (client/decode/wasm/dav1d/dav1d.mjs ivfFrames)."""
    head = b"DKIF" + (0).to_bytes(2, "little") + (32).to_bytes(2, "little") + b"AV01" + w.to_bytes(2, "little") \
        + h.to_bytes(2, "little") + (25).to_bytes(4, "little") + (1).to_bytes(4, "little") \
        + len(units).to_bytes(4, "little") + bytes(4)
    return head + b"".join(len(u).to_bytes(4, "little") + i.to_bytes(8, "little") + u for i, u in enumerate(units))


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("build", type=Path)
    ap.add_argument("work", type=Path)
    ap.add_argument("out", type=Path)
    ap.add_argument("what", choices=["bytes", "inter"])
    ap.add_argument("sets", nargs="+", type=Path)
    ap.add_argument("--frames", type=int, default=8)
    ap.add_argument("--jobs", type=int, default=4)
    ap.add_argument("--layouts", help="only these, e.g. opt,htj2k: a cell re-run alone (cpu0 on a 13.6 M-sample frame takes 4.2 GB)")
    a = ap.parse_args()
    build = a.build.resolve()
    jobs = []
    for path in a.sets:
        s = size.Set(path)
        n = min(a.frames, s.n)
        if a.what == "bytes":
            jobs += [(build, str(path), a.work / "payloads", n, layout) for layout in ["htj2k", *layouts(s)]
                     if not a.layouts or layout in a.layouts.split(",")]
        else:
            jobs += [(build, str(path), a.work / "ivf", n, layout, "-") for layout in ["htj2k"]]
            jobs += [(build, str(path), a.work / "ivf", n, p, g) for p in INTER_PRESETS for g in GROUPS]
    jobs.sort(key=lambda j: -size.Set(Path(j[1])).w * size.Set(Path(j[1])).h)
    with open(a.out, "a") as fh, ProcessPoolExecutor(a.jobs) as pool:
        for rows in pool.map(run_job, [(a.what, j) for j in jobs]):
            for row in rows:
                fh.write(json.dumps(row) + "\n")
                fh.flush()
                print(json.dumps(row), flush=True)


def run_job(arg):
    what, job = arg
    if what == "bytes" or job[4] == "htj2k":
        return bytes_job(job[:5])
    return inter_job(job)


if __name__ == "__main__":
    main()
