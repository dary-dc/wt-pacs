#!/usr/bin/env python3
"""Row 261's campaign: the tile ring set up without `COOP_TASKRUN` (C1) against the ring as it ships (C0, and C0′ a
second process of it), cold tiles at depth 4 alone and beside eight warm fills of 4.8 MB frames on the same server —
docs/adr/disk-access.md §9, *261 RINGCOOP*, has the arms, the cells and the rule.

    ring_coop_ab.py make    WORK           a series per tile size: its tile frames, then the fills' 4.8 MB frames
    ring_coop_ab.py time    WORK ROUNDS    one JSON line a run into WORK/ring_coop.jsonl
    ring_coop_ab.py summary JSONL

WORK/bin/c0 is the default release build of series-server, WORK/bin/c1 the same with `--features lab-ring-no-coop`.
Environment: STRIDE (bytes between tile asks, past `read_ahead_kb` on the day), FILL_GAP_US (each fill's pause a
frame, to hold the server below 80 % busy), FILL_FRAMES, FILL_LEAD_S, ASKS, SERVER_CPUS, CLIENT_CPUS.
"""
import json
import math
import os
import random
import re
import socket
import statistics
import struct
import subprocess
import sys
import time
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / "lab/scripts"))
sys.path.insert(0, str(Path(__file__).resolve().parent))
from order import order  # noqa: E402
from frame_cache_ab import host  # noqa: E402

SERVER_AB = ROOT / "target/release/server_ab"
PACK_SERIES = ROOT / "target/release/pack-series"
SERVER_CPUS = os.environ.get("SERVER_CPUS", "0-1")
CLIENT_CPUS = os.environ.get("CLIENT_CPUS", "2-3")
TILES = {"t16k": 16384, "t250k": 250000}
CONDS = ["alone", "beside"]
ARMS = {"C0": "c0", "C0p": "c0", "C1": "c1"}
ASKS, DEPTH = int(os.environ.get("ASKS", 256)), 4
STRIDE = int(os.environ.get("STRIDE", 500000))
FILL_BYTES, FILL_SESSIONS = 4_800_000, 8
FILL_FRAMES = int(os.environ.get("FILL_FRAMES", 24))
FILL_GAP_US = int(os.environ.get("FILL_GAP_US", 0))
FILL_LEAD_S = float(os.environ.get("FILL_LEAD_S", 0.5))
MIN_MISS, BUSY_CAP = 0.95, 0.80
SETTINGS = {
    "C0": "series-server default release build: the tile ring with COOP_TASKRUN, as it ships",
    "C0p": "C0's binary, a second process (A/A)",
    "C1": "C0's source with --features lab-ring-no-coop: the tile ring with no setup flag; the server prints ring_coop=off",
}


def step(name):
    return math.ceil(STRIDE / TILES[name])


def tile_frames(name):
    return ASKS * step(name)


def coded(work, name):
    return work / "coded" / name


def sbnd(work, name):
    return work / "sbnd" / f"{name}.sbnd"


def make(work):
    rng = random.Random(261)
    for name, size in TILES.items():
        d = coded(work, name)
        d.mkdir(parents=True, exist_ok=True)
        sizes = [size] * tile_frames(name) + [FILL_BYTES] * FILL_FRAMES
        for i, n in enumerate(sizes):
            (d / f"{i:03d}.htj2k").write_bytes(rng.randbytes(n))
        (d / "metadata.json").write_text(json.dumps({"frameCount": len(sizes), "synthetic": "random bytes"}))
        out = sbnd(work, name)
        out.parent.mkdir(parents=True, exist_ok=True)
        subprocess.run([PACK_SERIES, "--metadata", d / "metadata.json", "--frames", d, "--output", out], check=True)
        print(name, len(sizes), "frames", out.stat().st_size, "B", flush=True)
    os.sync()


def evict_tiles(work, name):
    """Every byte before the first fill frame (header, index, metadata, tile frames); the fills' frames stay warm."""
    fd = os.open(sbnd(work, name), os.O_RDONLY)
    try:
        head = os.pread(fd, 16, 0)
        assert head[:4] == b"SBND"
        first_fill, _ = struct.unpack("<QI", os.pread(fd, 12, 16 + 12 * tile_frames(name)))
        os.posix_fadvise(fd, 0, first_fill, os.POSIX_FADV_DONTNEED)
    finally:
        os.close(fd)


class Server:
    def __init__(self, work, name, arm):
        sock = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
        sock.bind(("127.0.0.1", 0))
        self.port = sock.getsockname()[1]
        sock.close()
        self.log_path = work / f"server_{name}_{arm}.log"
        self.log = open(self.log_path, "w")
        self.proc = subprocess.Popen(
            ["taskset", "-c", SERVER_CPUS, work / "bin" / ARMS[arm], "--port", str(self.port),
             "--series", sbnd(work, name), "--bind", "127.0.0.1", "--cert-pem", ROOT / "server/dev-cert/cert.pem",
             "--key-pem", ROOT / "server/dev-cert/key.pem"],
            stdout=self.log, stderr=subprocess.STDOUT, env={**os.environ, "NO_COLOR": "1"})
        for _ in range(400):
            text = self.log_path.read_text()
            if "telemetry=" in text:
                info = dict(l.split("=", 1) for l in text.splitlines() if "=" in l and " " not in l.split("=", 1)[0])
                break
            time.sleep(0.025)
        else:
            raise RuntimeError(f"server did not start: {self.log_path.read_text()[-500:]}")
        if info.get("read_ring") != "available" or info.get("read_fast_path") != "preadv2":
            raise RuntimeError(f"{arm}: no ring on this host ({info.get('read_ring')}, {info.get('read_fast_path')})")
        if (info.get("ring_coop") == "off") != (arm == "C1"):
            raise RuntimeError(f"{arm}: WORK/bin/{ARMS[arm]} is the wrong build (ring_coop={info.get('ring_coop')})")
        self.cpus = len(os.sched_getaffinity(self.proc.pid))

    def session_lines(self, since):
        with open(self.log_path, "rb") as f:
            f.seek(since)
            text = re.sub(r"\x1b\[[0-9;]*[A-Za-z]", "", f.read().decode(errors="replace"))
        return [dict(re.findall(r"(\w+)=([^\s]+)", l)) for l in text.splitlines() if "session reads" in l]

    def stop(self):
        self.proc.terminate()
        self.proc.wait()
        self.log.close()


def driver(work, name, server, label, arm, mode, *extra):
    return ["taskset", "-c", CLIENT_CPUS, SERVER_AB, "--url", f"https://127.0.0.1:{server.port}/",
            "--server-pid", str(server.proc.pid), "--mode", mode, "--label", label, "--variant", arm,
            "--coded", coded(work, name), "--no-header", *map(str, extra)]


def run(work, name, server, cond, label, arm):
    evict_tiles(work, name)
    since = server.log_path.stat().st_size
    fills = None
    if cond == "beside":
        fills = subprocess.Popen(
            driver(work, name, server, label, arm, "fill", "--sessions", FILL_SESSIONS, "--start", tile_frames(name),
                   "--asks", FILL_FRAMES, "--frames", tile_frames(name) + FILL_FRAMES, "--gap-us", FILL_GAP_US, "--temp", "warm"),
            stdout=subprocess.DEVNULL, stderr=subprocess.PIPE, text=True)
        time.sleep(FILL_LEAD_S)
    tile = subprocess.run(
        driver(work, name, server, label, arm, "on-demand", "--depth", DEPTH, "--asks", ASKS, "--sessions", 1,
               "--frames", tile_frames(name), "--step", step(name), "--temp", "cold"),
        capture_output=True, text=True)
    overlapped = fills is None or fills.poll() is None
    if fills and fills.wait():
        raise RuntimeError(f"{label} {arm}: fills failed: {fills.stderr.read()[-500:]}")
    if tile.returncode:
        raise RuntimeError(f"{label} {arm}: tiles failed: {tile.stderr[-500:]}")
    want = 1 + (FILL_SESSIONS if fills else 0)
    for _ in range(200):
        lines = server.session_lines(since)
        if len(lines) >= want:
            break
        time.sleep(0.05)
    tiles = [l for l in lines if l.get("tile_misses", "0") != "0" or l.get("tile_hits", "0") != "0"]
    fill_lines = [l for l in lines if l.get("fill_hits", "0") != "0" or l.get("fill_misses", "0") != "0"]
    if len(tiles) != 1 or len(fill_lines) != want - 1:
        raise RuntimeError(f"{label} {arm}: {len(tiles)} tile and {len(fill_lines)} fill session lines")
    t = tiles[0]
    miss = float(t["miss_rate"])
    if miss < MIN_MISS or t["ring"] != "true":
        raise RuntimeError(f"{label} {arm}: miss_rate={miss} ring={t['ring']}: the cell is not a cold ring cell; "
                           "raise STRIDE")
    c = tile.stdout.split("\t")
    wall_ns, cpu_ns_per_ask = int(c[9]), int(c[11])
    fill_reads = sum(int(l["fill_hits"]) + int(l["fill_misses"]) for l in fill_lines)
    return dict(p50_ns=int(c[6]), p99_ns=int(c[8]), wall_ns=wall_ns, cpu_ns_per_ask=cpu_ns_per_ask,
                busy=cpu_ns_per_ask * ASKS / (wall_ns * server.cpus), miss_rate=miss, in_flight=int(t["in_flight"]),
                fills_overlapped=overlapped,
                fill_miss_rate=sum(int(l["fill_misses"]) for l in fill_lines) / fill_reads if fill_reads else None)


def time_rounds(work, rounds):
    out = work / "ring_coop.jsonl"
    with open(out, "a") as f:
        f.write(json.dumps(dict(host={**host(work), "server_cpus": SERVER_CPUS, "client_cpus": CLIENT_CPUS},
                                settings=SETTINGS, asks=ASKS, depth=DEPTH, stride=STRIDE, fill_frames=FILL_FRAMES,
                                fill_gap_us=FILL_GAP_US, fill_lead_s=FILL_LEAD_S)) + "\n")
        servers = {}
        try:
            for name in TILES:
                sbnd(work, name).read_bytes()
                for arm in ARMS:
                    servers[name, arm] = Server(work, name, arm)
            for r in range(rounds):
                for name in TILES:
                    for cond in CONDS:
                        arms = list(ARMS)
                        for arm in order(arms, r):
                            row = run(work, name, servers[name, arm], cond, f"{name}_{cond}_r{r}", arm)
                            f.write(json.dumps(dict(round=r, tile=name, cond=cond, arm=arm, order=order(arms, r),
                                                    **row)) + "\n")
                            f.flush()
                print(f"round {r} done", time.strftime("%H:%M:%S"), flush=True)
        finally:
            for s in servers.values():
                s.stop()


def summary(path):
    rows = [json.loads(l) for l in open(path)]
    head = [r for r in rows if "host" in r]
    if head:
        print(json.dumps({k: v for k, v in head[-1].items() if k != "settings"}))
    by = {}
    for r in rows:
        if "arm" in r:
            by.setdefault((r["tile"], r["cond"]), {}).setdefault(r["arm"], {})[r["round"]] = r
    print(f"{'cell':14}{'metric':>15}{'n':>4}{'C0':>10}{'C1/C0':>8}{'agree':>7}{'res':>7}  verdict      busy C0/C1  overlap")
    calls = {}
    for (tile, cond), arms in sorted(by.items()):
        c0, aa, c1 = arms["C0"], arms["C0p"], arms["C1"]
        rounds = sorted(set(c0) & set(aa) & set(c1))
        busy = {a: statistics.median(arms[a][rd]["busy"] for rd in rounds) for a in ("C0", "C1")}
        saturated = max(busy.values()) >= BUSY_CAP
        overlap = sum(arms[a][rd]["fills_overlapped"] for a in arms for rd in rounds)
        for metric in ("p50_ns", "p99_ns", "cpu_ns_per_ask"):
            dev = sorted(abs(aa[rd][metric] / c0[rd][metric] - 1) for rd in rounds)
            res = dev[min(len(dev) - 1, int(0.9 * len(dev)))]
            ratio = [c1[rd][metric] / c0[rd][metric] for rd in rounds]
            med = statistics.median(ratio)
            lower = sum(x < 1 for x in ratio)
            agree = max(lower, len(ratio) - lower)
            beyond = abs(med - 1) > res and agree >= math.ceil(0.8 * len(ratio))
            verdict = ("better" if med < 1 else "worse") if beyond else "tie"
            verdict += " (saturated)" if saturated else ""
            calls[tile, cond, metric] = verdict
            print(f"{tile + ' ' + cond:14}{metric:>15}{len(rounds):>4}{statistics.median(c0[rd][metric] for rd in rounds):>10.0f}"
                  f"{med:>8.3f}{agree:>4}/{len(ratio):<2}{res * 100:>6.1f}%  {verdict:12}"
                  f"{busy['C0'] * 100:>5.0f}/{busy['C1'] * 100:<4.0f}%{overlap:>4}/{len(rounds) * 3}")
    beside = [calls[t, "beside", "p99_ns"] for t in TILES if (t, "beside", "p99_ns") in calls]
    harm = any(v.startswith("worse") for (_, _, m), v in calls.items() if m in ("p50_ns", "cpu_ns_per_ask"))
    if not beside or any("saturated" in v for v in beside):
        print("rule: void, a beside cell is missing or saturated the server; raise FILL_GAP_US")
    else:
        adopted = all(v == "better" for v in beside) and not harm
        print("rule: C1", "adopted, if the park test passes on it" if adopted else "not adopted",
              "(p99 better beyond the resolution in every beside cell; p50 and CPU worse nowhere)")


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
