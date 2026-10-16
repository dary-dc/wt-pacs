#!/usr/bin/env python3
"""Row 259's campaign: tile names past the slots advised (T1, `--advise-tile-names`) against the server as it
ships (T0, T0′), interleaved — docs/adr/disk-access.md §9, *Next round for the readers (row 251)*, has the
arms, the cells and the rule.

    tile_advice_ab.py make      WORK          the 16 KiB and 250 kB series, random bytes a frame
    tile_advice_ab.py calibrate WORK          the smallest stride whose cold asks miss ≥ 95 %, into WORK/steps.json
    tile_advice_ab.py time      WORK ROUNDS   one JSON line a run into WORK/tile_advice.jsonl
    tile_advice_ab.py summary   JSONL

Cold without eviction: every run serves its own fresh `writer_bench direct` copy, written past the page cache.
Binaries from target/release: series-server, server_ab (disk-access-bench), writer_bench (container-bench),
pack-series.
"""
import json
import os
import platform
import random
import socket
import statistics
import subprocess
import sys
import time
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / "lab/scripts"))
from order import order  # noqa: E402

BIN = ROOT / "target/release"
SERVER, SERVER_AB, WRITER_BENCH, PACK_SERIES = (BIN / b for b in ["series-server", "server_ab", "writer_bench", "pack-series"])
SERVER_CPUS, CLIENT_CPUS = "0-1", "2-3"
SIZES = {"tiles16k": 16384, "tiles250k": 250000}
STEPS = {"tiles16k": [2, 8, 16, 32], "tiles250k": [1, 2, 4]}
ASKS = {1: 128, 16: 32}
BURST = 16
FRAMES = {name: max(ASKS[s] * s for s in ASKS) * max(STEPS[name]) for name in SIZES}
ARMS = {"T0": [], "T0p": [], "T1": ["--advise-tile-names"]}
SETTINGS = {
    "T0": "series-server release build, default flags",
    "T0p": "T0's binary, a second process on its own copy (A/A)",
    "T1": "T0's binary with --advise-tile-names: one WILLNEED per tile name past the slots, once while it waits",
}


def cells(steps):
    """(series, depth, step, sessions): strided at both sizes and depths 8 and 4 (the control), and the sweep."""
    out = [(name, depth, steps[name], s) for name in SIZES for depth in (8, 4) for s in ASKS]
    return out + [("tiles250k", 8, 1, s) for s in ASKS]


def coded(work, name):
    return work / "coded" / name


def base(work, name):
    return work / "sbnd" / f"{name}.sbnd"


def sh(cmd):
    return subprocess.run([str(c) for c in cmd], check=True, capture_output=True, text=True).stdout


def make(work):
    rng = random.Random(259)
    for name, size in SIZES.items():
        d = coded(work, name)
        d.mkdir(parents=True, exist_ok=True)
        for i in range(FRAMES[name]):
            (d / f"{i:03d}.htj2k").write_bytes(rng.randbytes(size))
        (d / "metadata.json").write_text(json.dumps({"frameCount": FRAMES[name], "synthetic": "random bytes"}))
        base(work, name).parent.mkdir(parents=True, exist_ok=True)
        sh([PACK_SERIES, "--metadata", d / "metadata.json", "--frames", d, "--output", base(work, name)])
        print(name, FRAMES[name], base(work, name).stat().st_size, flush=True)


def fresh(work, name, arm):
    p = work / "copies" / f"{name}-{arm}.sbnd"
    p.parent.mkdir(parents=True, exist_ok=True)
    sh([WRITER_BENCH, "direct", "--src", base(work, name), "--out", p])
    return p, json.loads(sh([WRITER_BENCH, "resident", "--file", p]))["resident"]


class Server:
    def __init__(self, work, series, arm):
        sock = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
        sock.bind(("127.0.0.1", 0))
        self.port = sock.getsockname()[1]
        sock.close()
        self.log_path = work / "server.log"
        self.log = open(self.log_path, "w")
        self.proc = subprocess.Popen(
            ["taskset", "-c", SERVER_CPUS, SERVER, "--port", str(self.port), "--series", series, "--bind", "127.0.0.1",
             "--cert-pem", ROOT / "server/dev-cert/cert.pem", "--key-pem", ROOT / "server/dev-cert/key.pem", *ARMS[arm]],
            stdout=self.log, stderr=subprocess.STDOUT,
            env={**os.environ, "NO_COLOR": "1", "RUST_LOG": "series_server=info"})
        for _ in range(400):
            if "telemetry=" in self.log_path.read_text():
                break
            time.sleep(0.025)
        else:
            raise RuntimeError(f"server did not start: {self.log_path.read_text()[-500:]}")
        if ("--advise-tile-names" in self.log_path.read_text()) != (arm == "T1"):
            raise RuntimeError(f"{arm}: the server's lab flag is not the arm's")

    def session_lines(self, sessions):
        for _ in range(200):
            lines = [l for l in self.log_path.read_text().splitlines() if "session reads" in l]
            if len(lines) >= sessions:
                return [dict(kv.split("=", 1) for kv in l.split() if "=" in kv) for l in lines]
            time.sleep(0.05)
        raise RuntimeError(f"{len(lines)} of {sessions} session lines")

    def stop(self):
        self.proc.terminate()
        self.proc.wait()
        self.log.close()


def run(work, name, depth, step, sessions, arm, label):
    """One run on its own cold copy: burst wall, CPU per ask and the session lines' misses and in_flight."""
    series, cached = fresh(work, name, arm)
    s = Server(work, series, arm)
    try:
        cmd = ["taskset", "-c", CLIENT_CPUS, SERVER_AB, "--url", f"https://127.0.0.1:{s.port}/",
               "--server-pid", s.proc.pid, "--mode", "on-demand", "--depth", depth, "--asks", ASKS[sessions],
               "--sessions", sessions, "--frames", FRAMES[name], "--step", step, "--disjoint", "--burst", BURST,
               "--coded", coded(work, name), "--label", label, "--variant", arm, "--no-header"]
        r = subprocess.run([str(c) for c in cmd], capture_output=True, text=True)
        if r.returncode:
            sys.exit(f"{label} {arm}: {r.stderr[-800:]}")
        c = r.stdout.split("\t")
        lines = s.session_lines(sessions)
    finally:
        s.stop()
        series.unlink()
    misses = sum(int(l["tile_misses"]) for l in lines)
    asks = sum(int(l["tile_misses"]) + int(l["tile_hits"]) for l in lines)
    return dict(burst_p50_ns=int(c[6]), burst_p90_ns=int(c[7]), cpu_ns_per_ask=int(c[11]), asks=asks, misses=misses,
                miss_rate=misses / max(asks, 1), in_flight=max(int(l["in_flight"]) for l in lines),
                named=max(int(l["named"]) for l in lines), cached_after_copy=cached)


def calibrate(work):
    steps = {}
    for name in SIZES:
        for step in STEPS[name]:
            row = run(work, name, 1, step, 1, "T0", "calibrate")
            print(name, step, f"miss_rate={row['miss_rate']:.3f}", flush=True)
            if row["miss_rate"] >= 0.95:
                steps[name] = step
                break
        else:
            sys.exit(f"{name}: no stride in {STEPS[name]} misses 95 %; widen STEPS and make again")
    (work / "steps.json").write_text(json.dumps(steps))
    print(json.dumps(steps))


def host(work):
    st = os.stat(work)
    bdi = Path(f"/sys/class/bdi/{os.major(st.st_dev)}:{os.minor(st.st_dev)}/read_ahead_kb")
    src = sh(["findmnt", "-n", "-o", "SOURCE,FSTYPE", "--target", work]).split()
    return dict(kernel=platform.release(), source=src[0], fs=src[1],
                bdi_read_ahead_kb=bdi.read_text().strip() if bdi.exists() else None,
                thp=Path("/sys/kernel/mm/transparent_hugepage/enabled").read_text().strip(),
                glibc=" ".join(platform.libc_ver()), cpus=os.cpu_count(), mem_kib=os.sysconf("SC_PHYS_PAGES") * os.sysconf("SC_PAGE_SIZE") // 1024,
                server_cpus=SERVER_CPUS, client_cpus=CLIENT_CPUS)


def time_rounds(work, rounds):
    steps = json.loads((work / "steps.json").read_text())
    with open(work / "tile_advice.jsonl", "a") as f:
        f.write(json.dumps(dict(host=host(work), settings=SETTINGS, steps=steps, frames=FRAMES)) + "\n")
        for r in range(rounds):
            for name, depth, step, sessions in cells(steps):
                for arm in order(list(ARMS), r):
                    row = run(work, name, depth, step, sessions, arm, f"r{r}")
                    f.write(json.dumps(dict(round=r, set=name, depth=depth, step=step, sessions=sessions, arm=arm,
                                            order=order(list(ARMS), r), **row)) + "\n")
                    f.flush()
            print(f"round {r} done", time.strftime("%H:%M:%S"), flush=True)


def summary(path):
    """Per cell and metric: T1 ×T0 (median over rounds), the A/A resolution and the rounds agreeing in sign."""
    rows = [json.loads(l) for l in open(path)]
    head = [r for r in rows if "host" in r]
    if head:
        print(json.dumps(head[-1]))
    by = {}
    for r in (r for r in rows if "arm" in r):
        by.setdefault((r["set"], r["depth"], r["step"], r["sessions"]), {}).setdefault(r["arm"], {})[r["round"]] = r
    void = False
    print(f"{'cell':28}{'metric':16}{'T0':>12}{'T1×T0':>8}{'res':>7}{'agree':>7}  verdict")
    for (name, depth, step, sessions), arms in sorted(by.items()):
        t0 = arms["T0"]
        for m in ["burst_p50_ns", "cpu_ns_per_ask", "misses", "in_flight"]:
            common = [rd for rd in t0 if rd in arms.get("T0p", {}) and rd in arms.get("T1", {}) and t0[rd][m]]
            if not common:
                continue
            aa = sorted(abs(arms["T0p"][rd][m] / t0[rd][m] - 1) for rd in common)
            res = aa[min(len(aa) - 1, int(0.9 * len(aa)))]
            ratios = [arms["T1"][rd][m] / t0[rd][m] for rd in common]
            med = statistics.median(ratios)
            agree = max(sum(x < 1 for x in ratios), sum(x > 1 for x in ratios)) / len(ratios)
            beyond = abs(med - 1) > res and agree >= 0.8
            verdict = ("better" if med < 1 else "worse") if beyond else "tie"
            void |= depth == 4 and beyond
            cell = f"{name} d{depth} s{step} x{sessions}"
            print(f"{cell:28}{m:16}{statistics.median(t0[rd][m] for rd in common):>12.0f}{med:>8.3f}"
                  f"{res * 100:>6.1f}%{agree * 100:>6.0f}%  {verdict}")
    if void:
        print("VOID: a depth-4 control cell parted from T0 beyond the resolution")


def main():
    cmd, arg = sys.argv[1], Path(sys.argv[2])
    if cmd == "make":
        make(arg)
    elif cmd == "calibrate":
        calibrate(arg)
    elif cmd == "time":
        time_rounds(arg, int(sys.argv[3]))
    elif cmd == "summary":
        summary(arg)
    else:
        sys.exit(__doc__)


if __name__ == "__main__":
    main()
