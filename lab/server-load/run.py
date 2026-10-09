#!/usr/bin/env python3
"""N concurrent fills of one series against the real server, HTJ2K and AV1, interleaved — queue row 81
(SERVERLOAD); README.md here says how to run it, docs/transport/transport-conclusions.md §4 LOAD what it found.

    run.py --series htj2k=DIR,htj2k --series av1=DIR,av1 --rounds 10 --out rows.jsonl
    run.py --summary --out rows.jsonl
"""
import argparse
import itertools
import json
import os
import statistics
import subprocess
import sys
import time

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", ".."))
sys.path.insert(0, os.path.join(ROOT, "lab", "scripts"))
from order import order  # noqa: E402

SERVER_CPUS, CLIENT_CPUS = "0", "1,2,3"
BIN = os.path.join(ROOT, "target", "release")


PORT = 4600


def start_server(codec, items, port):
    sbnd = os.path.join(items, f"{codec}.sbnd")
    proc = subprocess.Popen(
        ["taskset", "-c", SERVER_CPUS, f"{BIN}/series-server", "--port", str(port), "--bind", "0.0.0.0",
         "--series", sbnd, "--cert-pem", f"{ROOT}/server/dev-cert/cert.pem",
         "--key-pem", f"{ROOT}/server/dev-cert/key.pem"],
        stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    time.sleep(0.5)
    if proc.poll() is not None:
        sys.exit(f"server for {codec} exited")
    return proc


def fill_load(port, items, ext, n, rate, pid, mutate=False):
    cmd = ["taskset", "-c", CLIENT_CPUS, f"{BIN}/fill_load", "--url", f"https://127.0.0.1:{port}/",
           "--items", items, "--ext", ext, "--sessions", str(n), "--read-bps", str(rate),
           "--server-pid", str(pid)] + (["--mutate"] if mutate else [])
    try:
        return subprocess.run(cmd, capture_output=True, text=True, timeout=600)
    except subprocess.TimeoutExpired:
        return subprocess.CompletedProcess(cmd, 1, "", "no result in 600 s")


def run(args):
    """A fresh server for every cell, warmed by one unrecorded fill, so its memory is the cell's own."""
    series = dict(s.split("=", 1) for s in args.series)
    sessions = [int(n) for n in args.sessions.split(",")]
    rates = [int(r) for r in args.rates.split(",")]
    cells = list(itertools.product(series, rates, sessions))
    with open(args.out, "a") as out:
        for rnd in range(args.first_round, args.first_round + args.rounds):
            prev = None
            for pos, (codec, rate, n) in enumerate(order(cells, rnd)):
                items, ext = series[codec].split(",")
                server = start_server(codec, items, PORT)
                try:
                    warm = fill_load(PORT, items, ext, 1, 0, server.pid)
                    res = fill_load(PORT, items, ext, n, rate, server.pid, args.mutate)
                finally:
                    server.terminate()
                    server.wait()
                unit = f"{codec}/{rate}/{n}"
                row = {"round": rnd, "pos": pos, "unit": unit, "prev": prev, "codec": codec, "rate": rate}
                if warm.returncode == 0 and res.returncode == 0:
                    row.update(json.loads(res.stdout.strip().splitlines()[-1]))
                else:
                    row.update(sessions=n, error=(warm.stderr + res.stderr).strip()[-300:])
                out.write(json.dumps(row) + "\n")
                out.flush()
                print(rnd, pos, unit, row.get("exact"), "/", row.get("frames"),
                      f"{statistics.median(row['fill_ms']):.0f} ms, {row['rcvbuf_drops']} drops"
                      if "fill_ms" in row else row["error"], flush=True)
                prev = unit


def summary(args):
    rows = [json.loads(line) for line in open(args.out)]
    bad = [r for r in rows if "error" in r or r["exact"] != r["frames"]]
    ok = [r for r in rows if r not in bad]
    print(f"{len(ok)} runs, {sum(r['exact'] for r in ok)}/{sum(r['frames'] for r in ok)} frames exact; "
          f"{len(bad)} runs failed or inexact")
    key = lambda r: (r["codec"], r["rate"], r["sessions"])  # noqa: E731
    groups = {}
    for r in ok:
        groups.setdefault(key(r), []).append(r)
    print("codec rate_MBps N n | fill_ms p50 [min-max of run p50] | worst session p50 | ×N=1 | "
          "server cores | server ms/MB | client cores | host busy | server RSS MB over warm | rcvbuf drops")
    base = {}
    for k in sorted(groups):
        g = groups[k]
        p50 = [statistics.median(r["fill_ms"]) for r in g]
        worst = [max(r["fill_ms"]) for r in g]
        med = statistics.median(p50)
        if k[2] == 1:
            base[k[:2]] = med
        mb = [r["bytes"] / 1e6 for r in g]
        print(f"{k[0]:5} {k[1] / 1e6:5.2f} {k[2]:3} {len(g):2} | {med:8.0f} [{min(p50):.0f}-{max(p50):.0f}] | "
              f"{statistics.median(worst):8.0f} | {med / base.get(k[:2], med):5.2f} | "
              f"{statistics.median(r['server_cpu_s'] / r['wall_s'] for r in g):5.2f} | "
              f"{statistics.median(r['server_cpu_s'] * 1e3 / m for r, m in zip(g, mb)):5.2f} | "
              f"{statistics.median(r['client_cpu_s'] / r['wall_s'] for r in g):5.2f} | "
              f"{statistics.median(r['host_busy'] for r in g):4.2f} | "
              f"{statistics.median(r['server_rss_kb_peak'] - r['server_rss_kb_before'] for r in g) / 1024:6.1f} | "
              f"{statistics.median(r.get('rcvbuf_drops', 0) for r in g):7.0f}")


if __name__ == "__main__":
    p = argparse.ArgumentParser()
    p.add_argument("--series", action="append", default=[], help="codec=ITEMS_DIR,EXT; ITEMS_DIR/<codec>.sbnd served")
    p.add_argument("--sessions", default="1,2,4,8,16,32,64,128,256")
    p.add_argument("--rates", default="0,2500000,6250000", help="bytes/s each session reads at; 0 = unpaced")
    p.add_argument("--rounds", type=int, default=1)
    p.add_argument("--first-round", type=int, default=0)
    p.add_argument("--mutate", action="store_true")
    p.add_argument("--summary", action="store_true")
    p.add_argument("--out", required=True)
    a = p.parse_args()
    summary(a) if a.summary else run(a)
