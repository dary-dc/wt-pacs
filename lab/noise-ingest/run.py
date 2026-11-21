#!/usr/bin/env python3
"""NOISE-INGEST-MEASURE's rounds: arms M1–M5 of docs/av1/noise-point.md §σ_min in the Rust ingest, Protocol, one
unit at a time in a Williams order, one row a unit appended to ROWS/round-N.jsonl.

usage: run.py DATA WORK ROWS [ROUND ...]     (DATA holds the fetched sets; default rounds 0–4)
"""
import json
import resource
import subprocess
import sys
import time
from pathlib import Path

HERE = Path(__file__).resolve().parent
ROOT = HERE.parents[1]
sys.path.insert(0, str(ROOT / "lab/scripts"))
sys.path.insert(0, str(ROOT / "lab/av1/metrics"))
from order import order  # noqa: E402
from cell import display_windows  # noqa: E402

SETS = ["dbts_a1", "dbts_b1", "dbts_c1"]
CUT = ["dbts_a1", "dbts_c1"]
BENCH = ROOT / "target/release/sigma-bench"
INGEST = ROOT / "target/release/from-parser"
PYTHON_SIGMA = "import json,sys; import noise_point as n; s,c,m=n.timed_sigma(sys.argv[1],sys.argv[2],1); " \
               "print(json.dumps(dict(sigma=s,cpu=c,mpx=m)))"


def prepare(data, work):
    series = {}
    for name in SETS:
        out = work / f"mirror-{name}"
        if not out.exists():
            subprocess.run([sys.executable, ROOT / "ingest/from-parser/mirror.py", data / name, out], check=True,
                           capture_output=True)
        series[name] = next((out / "PbPb").glob("*/*"))
        subprocess.run([sys.executable, HERE / "mask.py", data / name, work / f"{name}.mask"], check=True)
        meta = display_windows(ROOT / "lab/av1/data.json", name, data)
        (work / f"{name}.display.json").write_text(json.dumps(meta))
    return series


def child(cmd, cwd=None):
    """stdout, child CPU s (user + system) and wall s of one command run alone."""
    r0, t0 = resource.getrusage(resource.RUSAGE_CHILDREN), time.perf_counter()
    out = subprocess.run([str(c) for c in cmd], check=True, capture_output=True, text=True, cwd=cwd).stdout
    r1, wall = resource.getrusage(resource.RUSAGE_CHILDREN), time.perf_counter() - t0
    return out, (r1.ru_utime - r0.ru_utime) + (r1.ru_stime - r0.ru_stime), wall


def unit(arm, name, data, work, series):
    mask = ["--mask", work / f"{name}.mask"]
    if arm in ("M1", "M2", "M4"):
        flags = {"M1": mask, "M2": mask + ["--cut"], "M4": []}[arm]
        out, cpu, wall = child([BENCH, series[name], *flags])
        return dict(frames=[json.loads(line) for line in out.splitlines()], cpu=cpu, wall=wall)
    if arm == "M3":
        sbnd = work / f"{name}.sbnd"
        _, cpu, wall = child([INGEST, series[name], sbnd, "--jobs", "1"])
        size = sbnd.stat().st_size
        sbnd.unlink()
        return dict(cpu=cpu, wall=wall, bytes=size)
    out, cpu, wall = child([sys.executable, "-c", PYTHON_SIGMA, data / name, work], cwd=ROOT / "lab/av1/metrics")
    return dict(json.loads(out), process_cpu=cpu, wall=wall)


def main():
    data, work, rows = (Path(a).resolve() for a in sys.argv[1:4])
    rounds = [int(r) for r in sys.argv[4:]] or range(5)
    work.mkdir(parents=True, exist_ok=True)
    rows.mkdir(parents=True, exist_ok=True)
    series = prepare(data, work)
    units = [(a, s) for a in ("M1", "M2", "M3", "M4", "M5") for s in (CUT if a == "M2" else SETS)]
    for rnd in rounds:
        with open(rows / f"round-{rnd}.jsonl", "w") as f:
            for pos, (arm, name) in enumerate(order(units, rnd)):
                row = dict(round=rnd, position=pos, arm=arm, set=name, **unit(arm, name, data, work, series))
                f.write(json.dumps(row) + "\n")
                f.flush()
                print(rnd, pos, arm, name, f"{row.get('cpu', 0):.3f}", flush=True)


if __name__ == "__main__":
    main()
