#!/usr/bin/env python3
"""Every arm, both series, cold then warm, on each emulated link; one JSON line per visit.

usage: links.py ROOT RUN [--rounds floor=12,fiber=12,4g5g=16,geo=8] [--bin PATH]   as root; links in that order
ROOT is `metadata-delivery prepare`'s; RUN an empty directory for the certificate, nginx and the logs.
"""
import argparse
import json
import multiprocessing
import os
import subprocess
import sys
import time

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)

import rig  # noqa: E402

ARMS = ("a1-instances", "a1-ready", "a2-instances", "a2-ready", "b", "b-again", "c")
SERIES = ("ct", "ct2000")


def plan(rounds: int) -> list:
    """Every (arm, series) once a round, the order rotated round by round."""
    cells = [(a, s) for a in ARMS for s in SERIES]
    return [(r, cells[(r * 5) % len(cells):] + cells[:(r * 5) % len(cells)]) for r in range(rounds)]


def run_link(name: str, rounds: int, run: str, fds: tuple) -> None:
    proc = multiprocessing.Process(target=rig.forward, args=(fds[0], fds[1], rig.LINKS[name], rounds), daemon=True)
    proc.start()
    visits = [{"link": name, "round": r, "arm": a, "series": s} for r, cells in plan(rounds) for a, s in cells]
    path = os.path.join(run, f"plan-{name}.json")
    with open(path, "w") as fh:
        json.dump(visits, fh)
    try:
        subprocess.run(rig.netns_prefix(rig.VIEWER[0]) + ["node", os.path.join(HERE, "visits.mjs"), path,
                                                          os.path.join(run, "home"), f"https://{rig.PACS[1]}"],
                       check=True, env={**os.environ, "NODE_PATH": subprocess.check_output(["npm", "root", "-g"], text=True).strip()})
    finally:
        proc.terminate()


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("root")
    ap.add_argument("run")
    ap.add_argument("--rounds", default="floor=12,fiber=12,4g5g=16,geo=8")
    ap.add_argument("--bin", default=os.path.join(HERE, "target", "release", "metadata-delivery"))
    args = ap.parse_args()
    os.makedirs(args.run)
    fds = rig.namespaces()
    sha = rig.certificate(args.run)
    rig.web(args.run, args.root, rig.PACS[1], sha)
    servers = [rig.nginx(args.run, rig.PACS[1], 2, rig.PACS[0]),
               rig.serve(args.run, args.root, args.bin, f"{rig.PACS[1]}:4433", rig.PACS[0])]
    time.sleep(1)
    try:
        for link in args.rounds.split(","):
            name, rounds = link.split("=")
            run_link(name, int(rounds), args.run, fds)
    finally:
        for p in servers:
            p.terminate()


if __name__ == "__main__":
    main()
