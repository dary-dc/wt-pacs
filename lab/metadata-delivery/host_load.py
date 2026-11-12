#!/usr/bin/env python3
"""H2: server CPU per open, peak descriptors and memory, h2load holding N viewers over HTTPS across S studies.
H3: study DB connections held open (`metadata-delivery hold`), one per viewer or one per study.

usage: host_load.py h2 ROOT RUN [--rounds N] [--arms a,b] [--studies 1,100] [--revalidate]
                                                  as root, nothing else running; one JSON line per cell
       host_load.py hold ROOT [--journal wal]     one JSON line per cell
"""
import argparse
import json
import os
import re
import subprocess
import sys
import threading
import time

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)

import rig  # noqa: E402

BIN = os.path.join(HERE, "target", "release", "metadata-delivery")
ARMS = ("a1-instances", "a1-ready", "b", "c")
KINDS = ("open", "revalidation")
VIEWERS = (1, 100, 1000)
STUDIES = (1, 10, 100)
OPENS = {1: 1000, 100: 3000, 1000: 5000}
TICKS = os.sysconf("SC_CLK_TCK")


def urls(arm: str, series: str, studies: int) -> list:
    out = []
    for n in range(studies):
        s = f"s{n:03d}"
        out += {"a1-instances": [f"/meta/{s}/{series}?from=instances"], "a1-ready": [f"/meta/{s}/{series}?from=ready"],
                "a1-gz": [f"/meta/{s}/{series}?from=gz"],
                "b": [f"/files/{s}/{series}.json"], "c": [f"/files/{s}/{series}.paint.json", f"/files/{s}/study.json"]}[arm]
    return [f"https://127.0.0.1{u}" for u in out]


def etag(url: str) -> str:
    head = subprocess.run(["curl", "-sk", "-H", "accept-encoding: gzip", "-D", "-", "-o", "/dev/null", url],
                          capture_output=True, text=True, check=True).stdout
    return re.search(r"(?im)^etag:\s*(\S+)", head).group(1)


def validator(arm: str, series: str, studies: int) -> str:
    """The one ETag every study's copy answers with: a revalidation cell sends it to all of them."""
    first, last = urls(arm, series, studies)[0], urls(arm, series, studies)[-1]
    tag = etag(first)
    if etag(last) != tag:
        sys.exit(f"{arm} {series}: the studies' ETags differ, so one If-None-Match cannot revalidate them all")
    return tag


def cpu_ticks(pid: int) -> int:
    fields = open(f"/proc/{pid}/stat").read().rsplit(")", 1)[1].split()
    return int(fields[11]) + int(fields[12])


def footprint(pid: int) -> tuple:
    fds = len(os.listdir(f"/proc/{pid}/fd"))
    rss = int(re.search(r"VmRSS:\s+(\d+)", open(f"/proc/{pid}/status").read()).group(1))
    return fds, rss


class Sampler(threading.Thread):
    """Every 5 ms, each watched process's descriptors and resident KiB; keeps the peak of their sums by role."""

    def __init__(self, roles: dict):
        super().__init__(daemon=True)
        self.roles, self.stop, self.peak = roles, False, {r: (0, 0) for r in roles}

    def run(self) -> None:
        while not self.stop:
            for role, pids in self.roles.items():
                fds, rss = map(sum, zip(*(footprint(p) for p in pids)))
                self.peak[role] = (max(self.peak[role][0], fds), max(self.peak[role][1], rss))
            time.sleep(0.005)


def workers(master: int) -> list:
    return [int(p) for p in subprocess.check_output(["pgrep", "-P", str(master)], text=True).split()]


def h2(args) -> None:
    os.makedirs(args.run)
    sha = rig.certificate(args.run)
    rig.web(args.run, args.root, "127.0.0.1", sha)
    nginx = rig.nginx(args.run, "127.0.0.1", 2)
    serve = rig.serve(args.run, args.root, BIN, "127.0.0.1:4433")
    time.sleep(1)
    roles = {"nginx": workers(nginx.pid), "serve": [serve.pid]}
    variants = [(arm, kind) for arm in args.arms for kind in (KINDS if args.revalidate else KINDS[:1])]
    try:
        for viewers in VIEWERS:
            for studies in args.studies:
                for series in ("ct", "ct2000"):
                    tags = {arm: validator(arm, series, studies) for arm in args.arms} if args.revalidate else {}
                    for r in range(args.rounds):
                        for arm, kind in variants[r % len(variants):] + variants[:r % len(variants)]:
                            tag = tags[arm] if kind == "revalidation" else None
                            print(json.dumps(cell(arm, series, viewers, studies, r, roles, args.run, tag)), flush=True)
    finally:
        nginx.terminate()
        serve.terminate()


def cell(arm: str, series: str, viewers: int, studies: int, r: int, roles: dict, run: str, tag=None) -> dict:
    listing = os.path.join(run, "urls.txt")
    with open(listing, "w") as fh:
        fh.write("\n".join(urls(arm, series, studies)) + "\n")
    per_open = 2 if arm == "c" else 1
    opens = OPENS[viewers]
    idle = {role: tuple(map(sum, zip(*(footprint(p) for p in pids)))) for role, pids in roles.items()}
    cpu0 = {role: sum(cpu_ticks(p) for p in pids) for role, pids in roles.items()}
    sampler = Sampler(roles)
    sampler.start()
    revalidate = ["-H", f"if-none-match: {tag}"] if tag else []
    out = subprocess.run(["h2load", "-n", str(opens * per_open), "-c", str(viewers), "-m", "1", "-H", "accept-encoding: gzip",
                          *revalidate, "-i", listing], capture_output=True, text=True)
    sampler.stop = True
    sampler.join()
    cpu1 = {role: sum(cpu_ticks(p) for p in pids) for role, pids in roles.items()}
    done = re.search(r"(\d+) succeeded, (\d+) failed", out.stdout)
    codes = re.search(r"status codes: (\d+) 2xx, (\d+) 3xx", out.stdout)
    rate = re.search(r"finished in [\d.]+\w+, ([\d.]+) req/s", out.stdout)
    after = {role: tuple(map(sum, zip(*(footprint(p) for p in pids)))) for role, pids in roles.items()}
    return {"arm": arm, "kind": "revalidation" if tag else "open", "series": series, "viewers": viewers, "studies": studies, "round": r, "opens": opens,
            "succeeded": int(done.group(1)) // per_open if done else None, "failed": int(done.group(2)) if done else None,
            "status_2xx": int(codes.group(1)) if codes else None, "status_3xx": int(codes.group(2)) if codes else None,
            "requests_per_s": float(rate.group(1)) if rate else None,
            **{f"{role}_cpu_us_per_open": (cpu1[role] - cpu0[role]) * 1e6 / TICKS / opens for role in roles},
            **{f"{role}_peak_fds": sampler.peak[role][0] - idle[role][0] for role in roles},
            **{f"{role}_peak_rss_kib": sampler.peak[role][1] - idle[role][1] for role in roles},
            **{f"{role}_fds_after": after[role][0] - idle[role][0] for role in roles}}


def hold(args) -> None:
    for per_study in (False, True):
        for source in ("instances", "ready"):
            for series in ("ct", "ct2000"):
                for viewers in VIEWERS:
                    for studies in (s for s in STUDIES if s <= viewers):
                        cmd = [BIN, "hold", args.root, "--viewers", str(viewers), "--studies", str(studies), "--from",
                               source, "--series", series] + (["--per-study"] if per_study else [])
                        row = json.loads(subprocess.check_output(cmd, text=True))
                        print(json.dumps({"journal": args.journal, **row}), flush=True)


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("mode", choices=("h2", "hold"))
    ap.add_argument("root")
    ap.add_argument("run", nargs="?")
    ap.add_argument("--rounds", type=int, default=3)
    ap.add_argument("--journal", default="wal")
    ap.add_argument("--arms", type=lambda v: tuple(v.split(",")), default=ARMS)
    ap.add_argument("--studies", type=lambda v: tuple(int(n) for n in v.split(",")), default=STUDIES)
    ap.add_argument("--revalidate", action="store_true", help="each arm also with If-None-Match holding its ETag")
    args = ap.parse_args()
    h2(args) if args.mode == "h2" else hold(args)


if __name__ == "__main__":
    main()
