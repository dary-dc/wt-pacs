#!/usr/bin/env python3
"""Row GOPMEASURE's bytes (docs/av1/gop-protocol.md §3–4): a run of each series' slices coded in groups of G,
each group in an encoder run of its own and decoded alone through native dav1d, every frame merged as the client
does and checked against its checksum; HTJ2K, the served profile, on the same frames.

usage: gop.py BUILD WORK OUT.jsonl SET_DIR ... --encoder aom|svt|htj2k [--presets cpu0,good:6] [--groups 1,2,4]
              [--representation optimized|plain] [--altref] [--frames 16] [--keep SET,...] [--jobs 4]   — README.md here
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
sys.path.insert(0, str(HERE.parent / "item"))
sys.path.insert(0, str(HERE.parent / "breast"))
import breast  # noqa: E402
import ingest  # noqa: E402
import size  # noqa: E402


def run_of(s, frames):
    """The middle `frames` slices, in position order."""
    n = min(frames, s.n)
    a = (s.n - n) // 2
    return a, a + n


def aom_args(preset, representation, depth, layout, g, altref):
    args = [x for x in ingest.encoder_args(preset, representation, depth, layout) if x != "--kf-max-dist=0"]
    if g == 1:
        return args + ["--kf-max-dist=0"]
    return args + [f"--kf-min-dist={g}", f"--kf-max-dist={g}", f"--auto-alt-ref={int(altref)}"]


def encode_group(build, work, encoder, preset, representation, depth, layout, frames, g, altref):
    """One group of one stream, in an encoder run of its own: its temporal units."""
    y4m, ivf = work / "in.y4m", work / "out.ivf"
    if encoder == "aom":
        ingest.write_y4m(y4m, frames, depth, layout)
        cmd = [build / f"aom-{size.AOM}/bin/aomenc", "-q", "-o", ivf, f"--limit={len(frames)}",
               *aom_args(preset, representation, depth, layout, g, altref), y4m]
    else:
        if depth > 10:
            raise ValueError(f"SVT-AV1 codes at most 10 bits, this stream is {depth}")
        # SVT-AV1 has no 4:0:0: grey goes as 4:2:0 with mid-grey chroma.
        ingest.write_y4m(y4m, frames, depth, "420")
        cmd = [build / "svt/bin/SvtAv1EncApp", "-i", y4m, "-b", ivf, "--lossless", "1", "--preset", preset,
               "--input-depth", str(depth), "--lp", "1", "--keyint", str(max(g, 1)), "--irefresh-type", "2",
               "--scd", "0", "--enable-tf", str(int(altref))]
    subprocess.run(cmd, check=True, capture_output=True)
    return size.ivf_units(ivf)


def decode_group(build, work, units):
    """Every shown picture of one group through native dav1d, the group alone; [] when dav1d refuses it."""
    (work / "g.obu").write_bytes(b"".join(units))
    try:
        return size.decode_y4m(build, work / "g.obu", work / "g.y4m")
    except subprocess.CalledProcessError:
        return []


def exact_frames(s, header, first, pictures):
    """How many of a group's frames come back exact: pictures[j][k] is stream j's k-th picture, frame first + k."""
    count = len(pictures[0])
    if any(len(p) != count for p in pictures):
        return 0
    return sum(size.exact(s, first + k, ingest.merge(header, [p[k][..., :1].astype(np.int32) for p in pictures])[:s.h, :s.w])
               for k in range(count))


def av1_job(job):
    build, path, work_dir, frames, encoder, preset, representation, g, altref, keep = job
    s = size.Set(Path(path))
    a0, a1 = run_of(s, frames)
    header, streams = ingest.plan(s, representation)
    header["offset"] = s.offset
    row = dict(set=s.name, encoder=encoder, preset=preset, representation=representation, group=g,
               altref=altref, first=a0, frames=a1 - a0, split=header["split"], depth=header["depth"])
    units = [[] for _ in streams]
    exact = 0
    try:
        with tempfile.TemporaryDirectory() as tmp:
            work = Path(tmp)
            for a in range(a0, a1, g):
                b = min(a + g, a1)
                pictures = []
                for j, (depth, layout, plane) in enumerate(streams):
                    group = encode_group(build, work, encoder, preset, representation, depth, layout,
                                         [plane(i) for i in range(a, b)], g, altref)
                    units[j] += group
                    pictures.append(decode_group(build, work, group))
                exact += exact_frames(s, header, a, pictures)
    except (subprocess.CalledProcessError, ValueError) as e:
        said = e.stderr.decode()[-300:] if isinstance(e, subprocess.CalledProcessError) and e.stderr else str(e)
        return dict(row, exact=False, said=said)
    row.update(exact=exact == a1 - a0, exact_n=exact, streams=[sum(map(len, u)) for u in units],
               bytes=sum(len(x) for u in units for x in u), frame_bytes=[[len(x) for x in u] for u in units])
    if keep:
        cell = work_dir / "ivf" / f"{s.name}.{encoder}-{preset.replace(':', '')}.{representation}.g{g}{'-ar' if altref else ''}"
        cell.mkdir(parents=True, exist_ok=True)
        for j, u in enumerate(units):
            (cell / f"{j}.ivf").write_bytes(breast.ivf_file(u, s.w, s.h))
        row["cell"] = str(cell)
    return row


def htj2k_job(job):
    build, path, _, frames, *_ = job
    s = size.Set(Path(path))
    a0, a1 = run_of(s, frames)
    with tempfile.TemporaryDirectory() as tmp:
        try:
            coded = ingest.htj2k(build, s, Path(tmp), a0, a1)
        except ingest.Refused as e:
            return dict(set=s.name, encoder="htj2k", first=a0, frames=a1 - a0, exact=False, said=str(e))
    return dict(set=s.name, encoder="htj2k", first=a0, frames=a1 - a0, exact=True, exact_n=a1 - a0,
                bytes=sum(len(d) for _, d in coded), frame_bytes=[len(d) for _, d in coded])


def run_job(job):
    return htj2k_job(job) if job[4] == "htj2k" else av1_job(job)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("build", type=Path)
    ap.add_argument("work", type=Path)
    ap.add_argument("out", type=Path)
    ap.add_argument("sets", nargs="+", type=Path)
    ap.add_argument("--encoder", choices=["aom", "svt", "htj2k"], required=True)
    ap.add_argument("--presets", default="good:6")
    ap.add_argument("--groups", default="1,2,3,4,6,8,12,16")
    ap.add_argument("--representation", choices=["optimized", "plain"], default="optimized")
    ap.add_argument("--altref", action="store_true")
    ap.add_argument("--frames", type=int, default=16)
    ap.add_argument("--keep", default="", help="sets whose coded groups are kept as IVFs for the decode timing")
    ap.add_argument("--jobs", type=int, default=4)
    a = ap.parse_args()
    build, keep = a.build.resolve(), set(a.keep.split(","))
    presets = ["-"] if a.encoder == "htj2k" else a.presets.split(",")
    groups = [1] if a.encoder == "htj2k" else [int(g) for g in a.groups.split(",")]
    jobs = [(build, str(p), a.work, a.frames, a.encoder, preset, a.representation, g, a.altref, p.name in keep)
            for p in a.sets for preset in presets for g in groups]
    def cost(j):
        s = size.Set(Path(j[1]))
        return s.w * s.h * (8 if j[5] in ("cpu0", "0") else 1) * (2 if j[7] == 1 else 1)
    jobs.sort(key=cost, reverse=True)
    with open(a.out, "a") as fh, ProcessPoolExecutor(a.jobs) as pool:
        for row in pool.map(run_job, jobs):
            fh.write(json.dumps(row) + "\n")
            fh.flush()
            print(json.dumps({k: v for k, v in row.items() if k != "frame_bytes"}), flush=True)


if __name__ == "__main__":
    main()
