#!/usr/bin/env python3
"""The ladder, stages 0–1 of docs/decode/README.md §HTJ2K progressive protocol, pre-registered.

encode   every frame as the ingest writes it (ingest/coded-frames/ingest.py, OpenJPH 0.31.0), and again by the lab's
         per-frame writer from the other OpenJPH build: the two sha256 must be equal; then the witness digests of
         levels 1–5, reduced and full size (witness.py), into ladder.json. cut.mjs runs next.
check    OpenJPEG 2.5.4 on every prefix cut.mjs chose: `-r r` must give the reduced witness, no `-r` the full one.
metrics  bytes and quality per frame and level (README §Stage 1), into metrics.jsonl.

usage: ladder.py BUILD WORK SETDIR ... --phase encode|check|metrics [--jobs 4]
"""
import argparse
import hashlib
import json
import os
import subprocess
import sys
import tempfile
from concurrent.futures import ProcessPoolExecutor
from pathlib import Path

import numpy as np

HERE = Path(__file__).resolve().parent
ROOT = HERE.parents[1]
sys.path.insert(0, str(ROOT / "lab/av1"))
sys.path.insert(0, str(ROOT / "lab/av1/decode/per-frame"))
sys.path.insert(0, str(ROOT / "ingest/coded-frames"))
sys.path.insert(0, str(ROOT / "ingest/from-dicom"))
sys.path.insert(0, str(HERE))
from size import Set  # noqa: E402
from make_frames import htj2k as lab_htj2k  # noqa: E402
import ingest  # noqa: E402
import quality  # noqa: E402
from witness import picture  # noqa: E402

LEVELS = (1, 2, 3, 4, 5)
SCREEN = 1000


def level_fit(w, h):
    """The most reduced level whose long side still holds SCREEN pixels: §A frame at the level the screen needs."""
    r = 0
    while r < 5 and -(-max(w, h) // 2 ** (r + 1)) >= SCREEN:
        r += 1
    return r


def out_dtype(s):
    return ("i1" if s.signed else "u1") if s.stored <= 8 else ("<i2" if s.signed else "<u2")


def digest(px, s):
    return hashlib.sha256(np.ascontiguousarray(px.astype(out_dtype(s))).tobytes()).hexdigest()


def witnesses(job):
    path, i = job
    s = Set(Path(path))
    f = s.frame(i).astype(np.int64)
    colour = s.ch == 3
    return {r: {k: digest(picture(f, r, k, s.stored, s.signed, colour), s) for k in ("reduced", "full")} for r in LEVELS}


def lab_codestream(job):
    path, i = job
    s = Set(Path(path))
    with tempfile.TemporaryDirectory() as tmp:
        out = Path(tmp) / "out.j2c"
        lab_htj2k(s, i, Path(tmp), out)
        return hashlib.sha256(out.read_bytes()).hexdigest()


def encode(build, work, s, jobs):
    dst = work / s.name
    dst.mkdir(parents=True, exist_ok=True)
    frames = ingest.coded(build, s, s.n, "htj2k", jobs)
    for i, data in frames:
        (dst / f"{i:03d}.htj2k").write_bytes(data)
    with ProcessPoolExecutor(jobs) as pool:
        lab = list(pool.map(lab_codestream, [(str(s.path), i) for i in range(s.n)]))
        wit = list(pool.map(witnesses, [(str(s.path), i) for i in range(s.n)]))
    ours = [hashlib.sha256(d).hexdigest() for _, d in frames]
    differ = [i for i in range(s.n) if ours[i] != lab[i]]
    if differ:
        sys.exit(f"{s.name}: frames {differ} differ between the ingest's codestream and the lab writer's")
    entry = dict(name=s.name, frames=s.n, width=s.w, height=s.h, channels=s.ch, bits=s.stored, signed=s.signed,
                 levelFit=level_fit(s.w, s.h), levels=list(LEVELS), truth=s.truth, codestreams=ours,
                 witness={r: {k: [w[r][k] for w in wit] for k in ("reduced", "full")} for r in LEVELS})
    (dst / "ladder.json").write_text(json.dumps(entry))
    print(f"{s.name}: {s.n} × {s.w}×{s.h}×{s.ch}, {s.stored} bits, fit level {entry['levelFit']}, "
          f"{sum(len(d) for _, d in frames)} B, ingest = lab writer on every frame", flush=True)


def opj(build, data, args, tmp):
    j2c, raw = Path(tmp) / "in.j2c", Path(tmp) / "out.rawl"
    j2c.write_bytes(data)
    raw.unlink(missing_ok=True)
    subprocess.run([build / "openjpeg-native/bin/opj_decompress", "-i", j2c, "-o", raw, "-allow-partial", "-quiet", *args],
                   check=True, capture_output=True)
    return raw.read_bytes()


def check_frame(job):
    """OpenJPEG on frame i's prefixes: (r, r) by -r and (r, 0) by the whole partial codestream."""
    build, d, i, signed = job
    d = Path(d)
    set_, cut = json.loads((d / "ladder.json").read_text()), json.loads((d / "cuts.json").read_text())[i]
    cs = (d / f"{i:03d}.htj2k").read_bytes()
    bad = []
    with tempfile.TemporaryDirectory() as tmp:
        for r in set_["levels"]:
            prefix = cs[:cut["levels"][str(r)]["prefix"] - (os.environ.get("MUTATE") == "short")]
            for size, args in (("reduced", ["-r", str(r)]), ("full", [])):
                got = opj(Path(build), prefix, args, tmp)
                if set_["channels"] == 3:
                    k = 2 ** r if size == "reduced" else 1
                    h, w = -(-set_["height"] // k), -(-set_["width"] // k)
                    got = np.frombuffer(got, np.uint8).reshape(3, h, w).transpose(1, 2, 0).tobytes()
                if hashlib.sha256(got).hexdigest() != set_["witness"][str(r)][size][i]:
                    bad.append(f"{r}{size[0]}")
    return i, bad


def check(build, work, s, jobs):
    d = work / s.name
    with ProcessPoolExecutor(jobs) as pool:
        res = list(pool.map(check_frame, [(str(build), str(d), i, s.signed) for i in range(s.n)]))
    bad = [(i, b) for i, b in res if b]
    if not os.environ.get("MUTATE"):
        (d / "openjpeg.json").write_text(json.dumps({"frames": s.n, "failed": bad}))
    print(f"{s.name}: OpenJPEG on {s.n * len(LEVELS) * 2} prefix decodes, {sum(len(b) for _, b in bad)} differ "
          f"{bad[:4]}", flush=True)


def metrics(work, s, jobs, windows):
    d = work / s.name
    set_ = json.loads((d / "ladder.json").read_text())
    cuts = json.loads((d / "cuts.json").read_text())
    jobs_ = [(str(s.path), i, windows, cuts[i]) for i in range(s.n)]
    with ProcessPoolExecutor(jobs) as pool, open(d / "metrics.jsonl", "w") as fh:
        for rows in pool.map(quality.frame_rows, jobs_):
            for row in rows:
                fh.write(json.dumps(row) + "\n")
    print(f"{s.name}: metrics for {s.n} frames, fit level {set_['levelFit']}", flush=True)


def main():
    p = argparse.ArgumentParser()
    p.add_argument("build", type=Path)
    p.add_argument("work", type=Path)
    p.add_argument("sets", nargs="+", type=Path)
    p.add_argument("--phase", required=True, choices=("encode", "check", "metrics"))
    p.add_argument("--jobs", type=int, default=4)
    a = p.parse_args()
    for path in a.sets:
        s = Set(path.resolve())
        if a.phase == "encode":
            encode(a.build.resolve(), a.work, s, a.jobs)
        elif a.phase == "check":
            check(a.build.resolve(), a.work, s, a.jobs)
        else:
            metrics(a.work, s, a.jobs, quality.windows(s))


if __name__ == "__main__":
    main()
