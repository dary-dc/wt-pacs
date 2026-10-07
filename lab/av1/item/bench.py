#!/usr/bin/env python3
"""ingest.py against the ingest it replaced (row 52): the same bytes, its wall and CPU time a study, and the
check's share. OLD is a checkout of the replaced revision (lab/av1/item/README.md §One pipeline).

usage: bench.py same  BUILD OLD OUT PRESET SET_DIR ...         every output file's SHA-256, old against new
       bench.py time  BUILD OLD OUT ROUNDS SPEC ...             SPEC = SET_DIR:codec:preset, arms interleaved
       bench.py check BUILD OLD OUT ROUNDS SET_DIR ...          a frame's check, subprocess against in-process
"""
import hashlib
import json
import resource
import subprocess
import sys
import time
from pathlib import Path

import numpy as np

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE))
sys.path.insert(0, str(HERE.parents[1] / "scripts"))
import ingest  # noqa: E402
from order import order  # noqa: E402

PY = sys.executable
WORKERS = (1, 2, 4)
# Today's HTJ2K ingest: speed/make_frames.py's htj2k(), one frame after another, as every lab row calls it.
OLD_HTJ2K = """import sys; from pathlib import Path; sys.path.insert(0, sys.argv[1])
import make_frames as m; s = m.Set(Path(sys.argv[2])); out = Path(sys.argv[3]); out.mkdir(parents=True)
for i in range(s.n): m.htj2k(s, i, out, out / f"{i:03d}.htj2k")
for p in out.glob("in.*"): p.unlink()
for p in out.glob("back.*"): p.unlink()
"""


def command(build, old, src, out, codec, impl, preset, jobs, rep="optimized"):
    if impl == "old" and codec == "htj2k":
        return [PY, "-c", OLD_HTJ2K, str(old / "lab/av1/speed"), str(src), str(out)]
    script = (old if impl == "old" else HERE.parents[2]) / "lab/av1/item/ingest.py"
    codec_args = [] if impl == "old" else ["--codec", codec]
    return [PY, script, build, src, out, *codec_args, "--representation", rep, "--preset", preset, "--jobs", str(jobs)]


def digests(out, codec):
    return {p.name: hashlib.sha256(p.read_bytes()).hexdigest() for p in sorted(out.glob(f"*.{codec}"))}


def run(cmd):
    """Wall and CPU seconds (user + system, every descendant waited for) of one command."""
    before = resource.getrusage(resource.RUSAGE_CHILDREN)
    t0 = time.perf_counter()
    subprocess.run(cmd, check=True, capture_output=True)
    wall = time.perf_counter() - t0
    after = resource.getrusage(resource.RUSAGE_CHILDREN)
    return wall, after.ru_utime - before.ru_utime + after.ru_stime - before.ru_stime


def same(build, old, out, preset, sets):
    bad = 0
    for src in sets:
        s = ingest.size.Set(src)
        cells = [("htj2k", "plain")] + [("av1", r) for r in ("plain", "optimized")]
        for codec, rep in cells:
            got = {}
            for impl in ("old", "new"):
                dst = out / f"{src.name}.{codec}.{rep}.{impl}"
                subprocess.run(["rm", "-rf", dst])
                r = subprocess.run(command(build, old, src, dst, codec, impl, preset, 4, rep), capture_output=True, text=True)
                got[impl] = digests(dst, codec) if r.returncode == 0 else r.stderr.strip()[-200:]
            wrote = isinstance(got["new"], dict)
            ok = got["old"] == got["new"] and (not wrote or len(got["new"]) == s.n)
            bad += not ok
            said = f"{len(got['new'])} files" if wrote else f"both refuse: {got['new']}"
            print(f"{src.name}\t{codec}\t{rep}\t{preset}\t{said}\t{'identical' if ok else 'DIFFERENT'}", flush=True)
    print(f"{bad} cells differ")
    return bad


def timing(build, old, out, rounds, specs):
    rows = []
    for spec in specs:
        src, codec, preset = spec.split(":", 2)
        src = Path(src)
        arms = [("new", w) for w in WORKERS] + ([("old", 1)] if codec == "htj2k" else [("old", w) for w in WORKERS])
        want = None
        for rnd in range(rounds):
            for impl, w in order(arms, rnd):
                dst = out / f"{src.name}.{codec}.{impl}{w}"
                subprocess.run(["rm", "-rf", dst])
                wall, cpu = run(command(build, old, src, dst, codec, impl, preset, w))
                got = digests(dst, codec)
                want = want or got
                rows.append(dict(set=src.name, codec=codec, preset=preset, impl=impl, workers=w, round=rnd,
                                 wall=round(wall, 3), cpu=round(cpu, 3), same=got == want))
                print(json.dumps(rows[-1]), flush=True)
    (out / "time.json").write_text(json.dumps(rows, indent=1))
    return sum(not r["same"] for r in rows)


def check(build, old, out, rounds, sets):
    """Per frame, the check alone on the bytes ingest wrote: today's subprocess against in-process."""
    sys.path.insert(0, str(old / "lab/av1/item"))
    import importlib.util
    spec = importlib.util.spec_from_file_location("old_ingest", old / "lab/av1/item/ingest.py")
    old_ingest = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(old_ingest)
    work = out / "check-work"
    work.mkdir(parents=True, exist_ok=True)
    env = {"LD_LIBRARY_PATH": str(ingest.size.OJPH / "lib")}
    rows = []
    for src in sets:
        s = ingest.size.Set(src)
        for codec in ("htj2k", "av1"):
            dst = out / f"{src.name}.{codec}.check"
            subprocess.run(["rm", "-rf", dst])
            subprocess.run(command(build, old, src, dst, codec, "new", "allintra:7", 4), check=True, capture_output=True)
            frames = [p.read_bytes() for p in sorted(dst.glob(f"*.{codec}"))]

            def subprocess_check(i, data):
                if codec == "av1":
                    return old_ingest.decode(build, unit(data), work)[0]
                back = work / ("b.pgm" if s.ch == 1 else "b.ppm")
                (work / "f.j2c").write_bytes(data)
                subprocess.run([ingest.size.OJPH / "bin/ojph_expand", "-i", work / "f.j2c", "-o", back],
                               check=True, capture_output=True, env=env)
                return ingest.size.read_pnm(back)

            def native_check(i, data):
                return ingest.decoded(build, codec, data if codec == "htj2k" else unit(data), s.h * s.w * s.ch)[0]

            arms = {"subprocess": subprocess_check, "in-process": native_check}
            for rnd in range(rounds):
                for arm in order(arms, rnd):
                    t0 = time.perf_counter()
                    for i, data in enumerate(frames):
                        arms[arm](i, data)
                    rows.append(dict(set=src.name, codec=codec, arm=arm, round=rnd, frames=len(frames),
                                     ms_frame=round(1e3 * (time.perf_counter() - t0) / len(frames), 2)))
                    print(json.dumps(rows[-1]), flush=True)
    (out / "check.json").write_text(json.dumps(rows, indent=1))
    return 0


def unit(item):
    """An item's first stream unit (docs/av1/item-format.md): enough for the check's timing."""
    n = int.from_bytes(item[12:16], "little")
    length = int.from_bytes(item[16:20], "little")
    body = item[16 + 4 * n:16 + 4 * n + length]
    if item[3]:
        top = int.from_bytes(body[:4], "little")
        return body[4:4 + top]
    return body


def main():
    mode, build, old, out, *rest = sys.argv[1:]
    build, old, out = Path(build).resolve(), Path(old).resolve(), Path(out).resolve()
    out.mkdir(parents=True, exist_ok=True)
    if mode == "same":
        sys.exit(same(build, old, out, rest[0], [Path(p) for p in rest[1:]]) != 0)
    if mode == "time":
        sys.exit(timing(build, old, out, int(rest[0]), rest[1:]) != 0)
    sys.exit(check(build, old, out, int(rest[0]), [Path(p) for p in rest[1:]]))


if __name__ == "__main__":
    main()
