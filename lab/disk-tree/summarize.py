#!/usr/bin/env python3
"""The README's tables from the rows: python3 lab/disk-tree/summarize.py lab/disk-tree/rows-*.jsonl"""
import json
import statistics
import sys
from collections import defaultdict

ARMS = ["flat", "coded-date", "ymd", "hash1", "hash2"]


def load(paths):
    rows = []
    for p in paths:
        fs = "xfs" if "-xfs-" in p else "ext4"
        size = p.rsplit("-", 1)[1].split(".")[0]
        for line in open(p):
            r = json.loads(line)
            r["fs"] = fs
            if size.startswith("1e"):
                r.setdefault("n", 10 ** int(size[2:]))
            rows.append(r)
    return rows


def table(head, body):
    print("| " + " | ".join(head) + " |")
    print("|" + " --- |" * len(head))
    for b in body:
        print("| " + " | ".join(str(c) for c in b) + " |")
    print()


def main():
    rows = load(sys.argv[1:])
    by = defaultdict(list)
    for r in rows:
        by[r["p"]].append(r)
    cells = sorted({(r["fs"], r["n"]) for r in by["lookup"]}, key=lambda c: (c[0], c[1]))

    print("P1 lookup: open of <Study>/x.sbnd, p50 / p99 ns; bytes read from the device during the timed opens\n")
    look = {(r["fs"], r["n"], r["arm"]): r for r in by["lookup"]}
    table(["fs", "studies"] + ARMS,
          [[fs, n] + [f'{look[(fs, n, a)]["p50_ns"]} / {look[(fs, n, a)]["p99_ns"]}; {look[(fs, n, a)].get("read_bytes", "?")}'
                      for a in ARMS] for fs, n in cells])

    print("P4 scan: readdir + lstat, ns per entry, median of rounds (entries; MiB read per timed walk, max)\n")
    scan = defaultdict(list)
    ent = {}
    read = defaultdict(int)
    for r in by["scan"]:
        key = (r["fs"], r["n"], r["arm"])
        scan[key].append(r["ns_per_entry"])
        ent[key] = r["entries"]
        read[key] = max(read[key], r.get("read_mb", -1))
    scells = sorted({k[:2] for k in scan})
    table(["fs", "studies"] + ARMS,
          [[fs, n] + [f'{int(statistics.median(scan[(fs, n, a)]))} ({ent[(fs, n, a)]}; {read[(fs, n, a)]})'
                      for a in ARMS] for fs, n in scells])

    print("P3 publish at the largest size: whole publish p50 / p99 µs; rename alone p50 / p99 µs\n")
    pub = {(r["fs"], r["n"], r["k"], r["arm"]): r for r in by["publish"]}
    top = {fs: max(n for f, n in cells if f == fs) for fs, _ in cells}
    body = []
    for fs, n in sorted(top.items()):
        for k in sorted({k for f, nn, k, _ in pub if f == fs and nn == n}):
            body.append([fs, n, k] + [
                f'{pub[(fs, n, k, a)]["p50_us"]} / {pub[(fs, n, k, a)]["p99_us"]}; '
                f'{pub[(fs, n, k, a)]["rename_p50_us"]} / {pub[(fs, n, k, a)]["rename_p99_us"]}' for a in ARMS])
    table(["fs", "studies", "writers"] + ARMS, body)

    print("P5 deletion by age: µs per study, no fsync; then syncfs ms\n")
    dl = {(r["fs"], r["n"], r["arm"]): r for r in by["delete"]}
    table(["fs", "studies"] + ARMS,
          [[fs, n] + [f'{dl[(fs, n, a)]["us_per_study"]}; {dl[(fs, n, a)]["syncfs_ms"]}' for a in ARMS] for fs, n in cells])

    print("P6 corrected date: moved / old path gone, p50 / p99 µs\n")
    co = {(r["fs"], r["n"], r["arm"]): r for r in by["correct"]}
    table(["fs", "studies"] + ARMS,
          [[fs, n] + [f'{co[(fs, n, a)]["moved"]}/{co[(fs, n, a)]["old_path_gone"]}, '
                      f'{co[(fs, n, a)]["p50_us"]} / {co[(fs, n, a)]["p99_us"]}' for a in ARMS] for fs, n in cells])

    for r in by["ceiling"]:
        if "stopped" in r:
            print(f'P2 ceiling: {r["kind"]}, {r["name_len"]}-character names: {r["entries"]} entries, '
                  f'stopped by {r["stopped"]} after {r["s"]} s')
    print("\ncache drops during runs:", [r["drop_caches_during_run"] for r in by["cache"]])


if __name__ == "__main__":
    main()
