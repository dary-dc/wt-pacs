#!/usr/bin/env python3
"""Where today's ingest CPU goes, by stage: one set through ingest.py's own code path in this process, its
functions wrapped to charge their CPU to a stage, encoders charged by their children's rusage.

Stages: read (a frame's samples), hash (SHA-256 against the source, XXH3-64 digests), temp (the encoder's input
written, its output read back, and ingest.py's own conversion between), spawn (this process's share of fork, exec
and wait), start (the encoder's process start and exit, from a no-op run of the same binary), encode (the encoder's
CPU less its start), check (the in-process decode and merge), write (the outputs). Each run also times the CLI
end to end, so the stages' sum can be read against it.

usage: [FRAMES=8] [FIRST_ROUND=0] profile.py BUILD OUT.jsonl ROUNDS SET:CODEC:PRESET ...   — lab/av1/exact/ingest-profile/README.md
"""
import functools
import json
import os
import resource
import subprocess
import sys
import tempfile
import time
from collections import defaultdict
from pathlib import Path

HERE = Path(__file__).resolve().parent
ROOT = HERE.parents[3]
sys.path.insert(0, str(ROOT / "ingest/coded-frames"))
sys.path.insert(0, str(ROOT / "lab/av1"))
sys.path.insert(0, str(ROOT / "lab/scripts"))
import ingest  # noqa: E402
import size  # noqa: E402
from order import order  # noqa: E402

FRAMES = int(os.environ.get("FRAMES", 8))
FIRST = int(os.environ.get("FIRST_ROUND", 0))
MUTATE = os.environ.get("MUTATE")  # check: one sample +1 in every decode (refused); burn: 50 ms of CPU added to every read
ACC, STACK = defaultdict(float), []


def children():
    r = resource.getrusage(resource.RUSAGE_CHILDREN)
    return r.ru_utime + r.ru_stime


def charged(stage, f):
    """f's own CPU to `stage`, less what wrapped calls inside it charge elsewhere."""
    @functools.wraps(f)
    def g(*a, **k):
        STACK.append(0.0)
        t0 = time.process_time()
        try:
            return f(*a, **k)
        finally:
            spent = time.process_time() - t0
            inner = STACK.pop()
            ACC[stage] += spent - inner
            ACC[f"{stage}_calls"] += 1
            if STACK:
                STACK[-1] += spent
    return g


RUN = subprocess.run


def run(cmd, *a, **k):
    c0 = children()
    STACK.append(0.0)
    t0 = time.process_time()
    try:
        return RUN(cmd, *a, **k)
    finally:
        spent = time.process_time() - t0
        STACK.pop()
        ACC["spawn"] += spent
        ACC["child"] += children() - c0
        ACC["execs"] += 1
        if STACK:
            STACK[-1] += spent


def burn(f):
    def g(*a, **k):
        t0 = time.process_time()
        while time.process_time() - t0 < 0.05:
            pass
        return f(*a, **k)
    return g


def wrap():
    size.Set.frame = charged("read", burn(size.Set.frame) if MUTATE == "burn" else size.Set.frame)
    
    ingest.exact = charged("hash", ingest.exact)
    ingest.frame_digest = charged("hash", ingest.frame_digest)
    decoded = ingest.decoded
    if MUTATE == "check":
        def decoded(*a, _f=ingest.decoded):
            px, shape = _f(*a)
            px.flat[px.size // 2] += 1
            return px, shape
    ingest.decoded = charged("check", decoded)
    ingest.merge = charged("check", ingest.merge)
    ingest.write_y4m = charged("temp", ingest.write_y4m)
    ingest.ivf_units = charged("temp", ingest.ivf_units)
    for c in ingest.CODECS:
        ingest.CODECS[c] = charged("temp", ingest.CODECS[c])
    subprocess.run = run


def start_cost(build, codec):
    """CPU of one no-op run of the encoder binary: its process start and exit."""
    cmd = ([build / f"aom-{ingest.AOM}/bin/aomenc", "--help"] if codec == "av1"
           else [ingest.OJPH / "bin/ojph_compress"])
    env = {"LD_LIBRARY_PATH": str(ingest.OJPH / "lib")}
    c0 = children()
    for _ in range(20):
        RUN(cmd, capture_output=True, env=env)
    return (children() - c0) / 20


def profile(build, set_dir, codec, preset, out_dir):
    """One set through chunk()'s path at one job, then main()'s writes; seconds of CPU a stage."""
    ACC.clear()
    s = size.Set(set_dir)
    n = min(FRAMES, s.n)
    with tempfile.TemporaryDirectory() as tmp:
        payloads = ingest.CODECS[codec](build, s, Path(tmp), 0, n, "optimized", None, preset, "400")
    t0 = time.process_time()
    out_dir.mkdir(parents=True, exist_ok=True)
    for i, data in payloads:
        (out_dir / f"{i:03d}.{codec}").write_bytes(data)
    meta = json.loads((set_dir / "metadata.json").read_text())
    STACK.append(0.0)
    meta.update(frameCount=n, digests=ingest.digests(s, n, codec))
    inner = STACK.pop()
    (out_dir / "metadata.json").write_text(json.dumps(meta, indent=1) + "\n")
    ACC["write"] += time.process_time() - t0 - inner
    return n, dict(ACC)


def end_to_end(build, set_dir, codec, preset, out_dir):
    c0 = children()
    RUN([sys.executable, ROOT / "ingest/coded-frames/ingest.py", build, set_dir, out_dir, "--codec", codec,
         "--preset", preset, "--frames", str(FRAMES), "--jobs", "1"], check=True, capture_output=True)
    return children() - c0


def main():
    build, out, rounds = Path(sys.argv[1]).resolve(), Path(sys.argv[2]), int(sys.argv[3])
    cells = [tuple(c.split(":", 2)) for c in sys.argv[4:]]
    units = [(c, arm) for c in cells for arm in ("stages", "cli")]
    data = ROOT / "lab/av1/data"
    starts = {c: start_cost(build, c) for c in {cell[1] for cell in cells}}
    ingest.pinned(build)
    ingest.native(build)
    wrap()
    for rnd in range(FIRST, FIRST + rounds):
        for (name, codec, preset), arm in order(units, rnd):
            with tempfile.TemporaryDirectory() as tmp:
                row = dict(round=rnd, set=name, codec=codec, preset=preset, arm=arm, start=starts[codec],
                           python=sys.version.split()[0], aom=ingest.AOM, frames=FRAMES)
                if arm == "stages":
                    try:
                        row["n"], row["cpu"] = profile(build, data / name, codec, preset, Path(tmp))
                    except ingest.Refused as e:
                        row["refused"] = str(e)
                else:
                    row["cpu_total"] = end_to_end(build, data / name, codec, preset, Path(tmp))
            with open(out, "a") as fh:
                fh.write(json.dumps(row) + "\n")
            print(rnd, name, codec, arm, row.get("refused", "ok"), flush=True)


if __name__ == "__main__":
    main()
