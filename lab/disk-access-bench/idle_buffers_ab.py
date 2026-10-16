#!/usr/bin/env python3
"""Row 255's campaign: does a reader that holds a buffer only while it holds a frame (R1) cut what idle sessions
keep, at no CPU cost? docs/adr/disk-access.md §9, *Idle sessions' buffers (row 255)*, has the arms and the rule.

    idle_buffers_ab.py make    WORK          each cell's .sbnd from WORK/coded/SET/htj2k
    idle_buffers_ab.py time    WORK ROUNDS   one JSON line a run into WORK/idle_buffers.jsonl
    idle_buffers_ab.py summary JSONL

WORK/bin/r0 is the release build of series-server at the base commit, WORK/bin/r1 at row 255's.
"""
import json
import math
import os
import socket
import statistics
import subprocess
import sys
import time
from pathlib import Path

from frame_cache_ab import CLIENT_CPUS, PACK_SERIES, ROOT, SERVER_AB, SERVER_CPUS, coded, host, order, sbnd

SETS = ["ct_lidc", "dbt12_ea1141", "ffdm_d"]
SESSIONS, DEPTH, TILES, FILL = 64, 4, 16, 32
MMAP = {"MALLOC_MMAP_THRESHOLD_": "1048576"}
ARMS = {"R0": ("r0", {}), "R0p": ("r0", {}), "R1": ("r1", {}), "R0m": ("r0", MMAP), "R1m": ("r1", MMAP)}
SETTINGS = {
    "R0": "series-server release build of the base: a tile slot or a fill refills its buffer from the pool on hand-off",
    "R0p": "R0's binary, a second process (A/A)",
    "R1": "the base with row 255's read_path.rs: a reader holds a buffer only while it holds a frame",
    "R0m": "R0 under MALLOC_MMAP_THRESHOLD_=1048576 (§8)",
    "R1m": "R1 under MALLOC_MMAP_THRESHOLD_=1048576 (§8)",
}
METRICS = ["rss_idle_kib", "rss_peak_kib", "cpu_ns_per_frame"]


def make(work):
    for name in SETS:
        out = sbnd(work, name)
        out.parent.mkdir(parents=True, exist_ok=True)
        f = coded(work, name)
        subprocess.run([PACK_SERIES, "--metadata", f / "metadata.json", "--frames", f, "--output", out], check=True)
        print(name, out.stat().st_size, flush=True)


def run(work, name, arm, rnd):
    """One fresh server, so the RSS is this run's alone; None and the client's error when the run fails."""
    binary, env = ARMS[arm]
    sock = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
    sock.bind(("127.0.0.1", 0))
    port = sock.getsockname()[1]
    sock.close()
    log_path = work / "server.log"
    with open(log_path, "w") as log:
        proc = subprocess.Popen(
            ["taskset", "-c", SERVER_CPUS, work / "bin" / binary, "--port", str(port), "--series", sbnd(work, name),
             "--bind", "127.0.0.1", "--cert-pem", ROOT / "server/dev-cert/cert.pem",
             "--key-pem", ROOT / "server/dev-cert/key.pem"],
            stdout=log, stderr=subprocess.STDOUT, env={**os.environ, "NO_COLOR": "1", **env})
        try:
            for _ in range(400):
                if "telemetry=" in log_path.read_text():
                    break
                time.sleep(0.025)
            else:
                raise RuntimeError(f"server did not start: {log_path.read_text()[-500:]}")
            frames = json.loads((coded(work, name) / "metadata.json").read_text())["frameCount"]
            r = subprocess.run(
                ["taskset", "-c", CLIENT_CPUS, SERVER_AB, "--url", f"https://127.0.0.1:{port}/",
                 "--server-pid", str(proc.pid), "--mode", "idle", "--sessions", str(SESSIONS), "--depth", str(DEPTH),
                 "--asks", str(TILES), "--fill", str(FILL), "--frames", str(frames), "--coded", coded(work, name),
                 "--label", f"r{rnd}", "--variant", arm, "--no-header"],
                capture_output=True, text=True)
        finally:
            proc.terminate()
            proc.wait()
    if r.returncode:
        return None, next((l for l in r.stderr.splitlines() if l.startswith("Error")), f"exit {r.returncode}")
    c = r.stdout.split("\t")
    if int(c[2]) != SESSIONS:
        return None, f"{c[2]} of {SESSIONS} sessions open when the RSS was read"
    return dict(frames=int(c[3]), cpu_ns_per_frame=int(c[4]), rss_start_kib=int(c[5]), rss_peak_kib=int(c[6]),
                rss_idle_kib=int(c[7])), None


def time_rounds(work, rounds):
    with open(work / "idle_buffers.jsonl", "a") as f:
        f.write(json.dumps(dict(host=host(work), settings=SETTINGS)) + "\n")
        for name in SETS:
            sbnd(work, name).read_bytes()
        for r in range(rounds):
            for name in SETS:
                arms = order(ARMS, r)
                for arm in arms:
                    row, err = run(work, name, arm, r)
                    f.write(json.dumps(dict(round=r, set=name, arm=arm, order=arms, error=err, **(row or {}))) + "\n")
                    f.flush()
            print(f"round {r} done", time.strftime("%H:%M:%S"), flush=True)


def verdict(rows, arm, metric):
    """The arm's median ratio to R0, its rounds lower, and whether it lies beyond the A/A resolution: the p90 of
    |R0′/R0 − 1|, with ≥ 80 % of rounds agreeing in sign."""
    r0, aa, a = (rows.get(x, {}) for x in ("R0", "R0p", arm))
    res = sorted(abs(aa[k][metric] / r0[k][metric] - 1) for k in aa if k in r0)
    res = res[min(len(res) - 1, int(0.9 * len(res)))] if res else math.nan
    ratios = [a[k][metric] / r0[k][metric] for k in a if k in r0]
    if not ratios:
        return math.nan, 0, 0, res, False
    med, lower = statistics.median(ratios), sum(x < 1 for x in ratios)
    beyond = abs(med - 1) > res and max(lower, len(ratios) - lower) >= 0.8 * len(ratios)
    return med, lower, len(ratios), res, beyond


def summary(path):
    lines = [json.loads(l) for l in open(path)]
    heads = [l for l in lines if "host" in l]
    if heads:
        print(json.dumps(heads[-1]["host"]))
    by = {}
    for l in lines:
        if "arm" in l and not l.get("error"):
            by.setdefault(l["set"], {}).setdefault(l["arm"], {})[l["round"]] = l
    print(f"{'set':14}{'metric':18}{'arm':>5}{'n':>4}{'median':>12}{'ratio':>8}{'lower':>7}{'res':>7}  beyond")
    lands = {"R1": [0, False], "R1m": [0, False]}
    for name in SETS:
        rows = by.get(name, {})
        for metric in METRICS:
            for arm in ARMS:
                if arm not in rows:
                    continue
                med, lower, n, res, beyond = verdict(rows, arm, metric)
                value = statistics.median(x[metric] for x in rows[arm].values())
                print(f"{name:14}{metric:18}{arm:>5}{len(rows[arm]):>4}{value:>12.0f}{med:>8.3f}{lower:>4}/{n:<2}"
                      f"{res * 100:>6.1f}%  {'yes' if beyond else ''}")
                if arm in lands and beyond:
                    if metric == "rss_idle_kib" and med < 1:
                        lands[arm][0] += 1
                    if metric == "cpu_ns_per_frame" and med > 1:
                        lands[arm][1] = True
    for arm, (cells, worse) in lands.items():
        print(f"{arm}: idle RSS below R0's beyond the resolution in {cells}/{len(SETS)} cells; "
              f"CPU worse beyond it in {'some cell' if worse else 'none'}")


def main():
    cmd, arg = sys.argv[1], Path(sys.argv[2])
    if cmd == "make":
        make(arg)
    elif cmd == "time":
        time_rounds(arg, int(sys.argv[3]))
    elif cmd == "summary":
        summary(arg)
    else:
        sys.exit(__doc__)


if __name__ == "__main__":
    main()
