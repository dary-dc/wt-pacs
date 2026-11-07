#!/usr/bin/env python3
"""RESIDEXACT's server side (docs/av1/residual-exact.md §2): per volume, form, Q and G, the VL view coded with
the profiles' aomenc_args, its units kept, decoded by native dav1d at one and four threads and by libaom's aomdec,
and every luma sample of every frame compared with native dav1d --threads=1, the decode the residual is made from.

usage: streams.py BUILD WORK OUT.jsonl SETDIR ... [--qs 4,8] [--groups 1,16] [--jobs 4] [--mutate]
       streams.py BUILD WORK --refs CELL      native dav1d's luma, one NNN.y a frame, for the browser
"""
import argparse
import hashlib
import json
import subprocess
import sys
from concurrent.futures import ProcessPoolExecutor
from pathlib import Path

import numpy as np

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE.parents[1]))
sys.path.insert(0, str(HERE.parents[3] / "ingest/coded-frames"))
import obu  # noqa: E402
from ingest import ivf_units  # noqa: E402
from size import Set  # noqa: E402

AOM = "3.15.1"


class Form:
    def __init__(self, name, depth, profile, fwd):
        self.name, self.depth, self.profile, self.fwd, self.mono = name, depth, profile, fwd, True


def forms(s):
    """As profiles/bytes.py forms() for grey ≤ 12 bits, without the window form."""
    b = max(1, int(s.hi + s.offset).bit_length())
    if b <= 10:
        return [Form(f"{b}bit", 8 if b <= 8 else 10, 0, lambda v: v)]
    k = b - 10
    return [Form(f"{b}bit", 12, 2, lambda v: v),
            Form("top10", 10, 0, lambda v: np.minimum((v + (1 << (k - 1))) >> k, 1023))]


def aomenc_args(form, q, g, n, altref=False):
    """profiles/bytes.py at origin/claude/av1-quality-profiles 1232918d, verbatim; same_args() checks it."""
    group = ["--kf-max-dist=0"] if g == 1 else [f"--kf-min-dist={g or n}", f"--kf-max-dist={g or n}"]
    colour = ["--monochrome", f"--profile={form.profile}", f"--bit-depth={form.depth}",
              f"--input-bit-depth={form.depth}"] if form.mono else \
        ["--bit-depth=8", "--profile=0", "--color-primaries=bt601", "--transfer-characteristics=bt601",
         "--matrix-coefficients=bt601"]
    return ["--ivf", "--good", "--cpu-used=6", "--threads=1", "--passes=1", "--tune=psnr", "--end-usage=q",
            f"--cq-level={q}", f"--min-q={q}", f"--max-q={q}", "--deltaq-mode=0", "--aq-mode=0",
            "--denoise-noise-level=0", *(["--lag-in-frames=19", "--auto-alt-ref=1"] if altref else
                                        ["--lag-in-frames=0", "--auto-alt-ref=0"]), *group, *colour]


def same_args(cells):
    """aomenc_args against the profiles branch's own function, read from git, on every cell this run codes."""
    import ast
    src = subprocess.run(["git", "-C", HERE, "show", "1232918d:lab/av1/profiles/bytes.py"], capture_output=True,
                         text=True, check=True).stdout
    fn = next(n for n in ast.parse(src).body if isinstance(n, ast.FunctionDef) and n.name == "aomenc_args")
    scope = {}
    exec(compile(ast.Module([fn], []), "profiles", "exec"), scope)
    return all(scope["aomenc_args"](f, q, g, n) == aomenc_args(f, q, g, n) for f, q, g, n in cells)


def write_y4m(s, form, path):
    tag = "420" + ("" if form.depth == 8 else f"p{form.depth}")
    dt = "u1" if form.depth == 8 else "<u2"
    neutral = np.full(((s.h + 1) // 2, (s.w + 1) // 2), 1 << (form.depth - 1), dt)
    with open(path, "wb") as fh:
        fh.write(f"YUV4MPEG2 W{s.w} H{s.h} F25:1 Ip A1:1 C{tag}\n".encode())
        for i in range(s.n):
            y = form.fwd(s.frame(i)[..., 0].astype(np.int32) + s.offset)
            fh.write(b"FRAME\n" + b"".join(np.ascontiguousarray(p, dt).tobytes() for p in (y, neutral, neutral)))


def run(cmd, env=None):
    r = subprocess.run([str(c) for c in cmd], capture_output=True, env=env)
    if r.returncode:
        raise RuntimeError(f"{cmd[0]}: {r.stderr.decode()[-400:]}")
    return r.stderr.decode()


def pinned(build):
    """The CLI links libdav1d dynamically: without this it loads whatever libdav1d the host has."""
    return {"LD_LIBRARY_PATH": str(build / "dav1d/lib")}


def versions(build):
    v = lambda env: subprocess.run([build / "dav1d/bin/dav1d", "--version"], capture_output=True, text=True,
                                   env=env).stderr.strip()
    return {"pinned": v(pinned(build)), "system": v({})}


def y4m_luma(path, s, depth):
    """Each picture's Y plane from a dav1d Y4M, lazily: 4:0:0 holds one plane, anything else three."""
    raw = np.memmap(path, "u1", "r")
    pos = bytes(raw[:256]).index(b"\n") + 1
    mono = b" Cmono" in bytes(raw[:pos])
    dt = np.dtype("u1" if depth == 8 else "<u2")
    ys = s.h * s.w * dt.itemsize
    size = ys + (0 if mono else 2 * ((s.h + 1) // 2) * ((s.w + 1) // 2) * dt.itemsize)
    for _ in range(s.n):
        pos += 6
        yield np.frombuffer(raw, dt, s.h * s.w, pos).reshape(s.h, s.w)
        pos += size


def raw_luma(path, s, depth):
    raw = np.memmap(path, "u1", "r")
    per = raw.size // s.n
    dt = "u1" if depth == 8 else "<u2"
    for i in range(s.n):
        yield np.frombuffer(raw, dt, s.h * s.w, i * per).reshape(s.h, s.w)


def compare(ref, got, mutate=None):
    """Every sample of every frame: mismatch count, the first eight (frame, y, x, got − ref), the largest |Δ|."""
    out = dict(frames=0, samples=0, differ=0, frames_differ=0, max_abs=0, first=[], sha=[])
    for i, (a, b) in enumerate(zip(ref, got)):
        if mutate and i == mutate[0]:
            b = b.copy()
            b[mutate[1], mutate[2]] ^= 1
        d = b.astype(np.int32) - a
        bad = np.flatnonzero(d)
        out["frames"] += 1
        out["samples"] += d.size
        out["sha"].append(hashlib.sha256(np.ascontiguousarray(b).tobytes()).hexdigest())
        if bad.size:
            out["differ"] += int(bad.size)
            out["frames_differ"] += 1
            out["max_abs"] = max(out["max_abs"], int(np.abs(d).max()))
            for p in bad[: 8 - len(out["first"])]:
                out["first"].append([i, int(p // d.shape[1]), int(p % d.shape[1]), int(d.flat[p])])
    return out


def cell(job):
    build, work, path, form_name, q, g, mutate = job
    s = Set(Path(path))
    form = next(f for f in forms(s) if f.name == form_name)
    d = Path(work) / f"{s.name}-{form.name}-q{q}-g{g}"
    d.mkdir(parents=True, exist_ok=True)
    y4m, ivf = d / "in.y4m", d / "out.ivf"
    write_y4m(s, form, y4m)
    args = aomenc_args(form, q, g, s.n)
    run([build / f"aom-{AOM}/bin/aomenc", "-o", ivf, f"--limit={s.n}", "--disable-warning-prompt", *args, y4m])
    y4m.unlink()
    units = ivf_units(ivf)
    for i, u in enumerate(units):
        (d / f"{i:03d}.obu").write_bytes(u)
    seqs = [obu.film_grain_params_present(obu.sequence_header(u)) for u in units if obu.sequence_header(u)]
    if any(h["film_grain"] for h in seqs):
        sys.exit(f"{d.name}: film_grain_params_present set — the residual needs it 0 (docs §1c)")
    dec = {}
    for name, cmd, env in (("dav1d-t1", ["--threads=1"], pinned(build)), ("dav1d-t4", ["--threads=4"], pinned(build)),
                           ("dav1d-system", ["--threads=1"], {})):
        dec[name] = d / f"{name}.y4m"
        run([build / "dav1d/bin/dav1d", "-q", *cmd, "-i", ivf, "-o", dec[name]], env)
    dec["aomdec"] = d / "aomdec.yuv"
    run([build / f"aom-{AOM}/bin/aomdec", "--rawvideo", "-o", dec["aomdec"], ivf])
    ref = lambda: y4m_luma(dec["dav1d-t1"], s, form.depth)
    row = dict(set=s.name, frames=s.n, width=s.w, height=s.h, form=form.name, depth=form.depth, q=q, g=g,
               args=args, dav1d=versions(build), units=[len(u) for u in units], keyframes=sum(1 for u in units if obu.sequence_header(u)),
               seq=seqs[0], film_grain_any=False,
               native=compare(ref(), ref()),
               against={"dav1d-t4": compare(ref(), y4m_luma(dec["dav1d-t4"], s, form.depth)),
                 "dav1d-system": compare(ref(), y4m_luma(dec["dav1d-system"], s, form.depth)),
                        "aomdec": compare(ref(), raw_luma(dec["aomdec"], s, form.depth),
                                          (s.n // 2, s.h // 3, s.w // 3) if mutate else None)})
    row["native"].pop("first")
    for f in dec.values():
        f.unlink()
    return row


def refs(build, cell_dir):
    """native dav1d --threads=1's luma, little-endian, one file a frame: what the browser compares against."""
    meta = json.loads((cell_dir / "cell.json").read_text())
    ivf = cell_dir / "out.ivf"
    y4m = cell_dir / "ref.y4m"
    run([build / "dav1d/bin/dav1d", "-q", "--threads=1", "-i", ivf, "-o", y4m], pinned(build))

    class S:
        n, h, w = len(meta["units"]), meta["height"], meta["width"]
    for i, y in enumerate(y4m_luma(y4m, S, meta["depth"])):
        if hashlib.sha256(np.ascontiguousarray(y).tobytes()).hexdigest() != meta["native"]["sha"][i]:
            sys.exit(f"{cell_dir.name} frame {i}: native dav1d differs from its own earlier decode")
        (cell_dir / f"{i:03d}.y").write_bytes(np.ascontiguousarray(y).tobytes())
    y4m.unlink()


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("build", type=Path)
    ap.add_argument("work", type=Path)
    ap.add_argument("out", type=Path, nargs="?")
    ap.add_argument("sets", type=Path, nargs="*")
    ap.add_argument("--qs", type=lambda v: [int(x) for x in v.split(",")], default=[4, 8])
    ap.add_argument("--groups", type=lambda v: [int(x) for x in v.split(",")], default=[1, 16])
    ap.add_argument("--jobs", type=int, default=4)
    ap.add_argument("--mutate", action="store_true", help="flip one aomdec sample: the comparison must see it")
    ap.add_argument("--refs")
    a = ap.parse_args()
    build, work = a.build.resolve(), a.work.resolve()
    if a.refs:
        return refs(build, work / a.refs)
    jobs = [(build, work, str(p.resolve()), f.name, q, g, a.mutate)
            for p in a.sets for f in forms(Set(p)) for q in a.qs for g in a.groups]
    cells = [(f, q, g, Set(p).n) for p in a.sets for f in forms(Set(p)) for q in a.qs for g in a.groups]
    print("aomenc_args identical to the profiles branch's:", same_args(cells), flush=True)
    with ProcessPoolExecutor(a.jobs) as pool, open(a.out, "a") as fh:
        for row in pool.map(cell, jobs):
            name = f"{row['set']}-{row['form']}-q{row['q']}-g{row['g']}"
            (work / name / "cell.json").write_text(json.dumps(row))
            fh.write(json.dumps(row) + "\n")
            fh.flush()
            print(name, sum(row["units"]), "B", *(f"{k} {v['differ']}/{v['samples']}" for k, v in row["against"].items()),
                  flush=True)


if __name__ == "__main__":
    main()
