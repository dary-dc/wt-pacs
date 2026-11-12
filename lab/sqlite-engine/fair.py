#!/usr/bin/env python3
"""Each engine at its best, every arm interleaved round by round: lab/sqlite-engine/README.md §4.

  fair.py blocking OUT_DIR [ROUNDS]   # 1 and 2 workers; default, 64-page and 2 000-page engine cache
  fair.py files OUT_DIR [ROUNDS]
  fair.py summary OUT_DIR
"""
import functools
import json
import os
import pathlib
import statistics
import subprocess
import sys

BIN = pathlib.Path(__file__).parent / "target" / "release"
BLOCKING = [  # label, build, arm
    ("idle", "default", "idle"),
    ("turso", "default", "turso"),
    ("turso-uring", "default", "turso-uring"),
    ("rusqlite", "default", "rusqlite"),
    ("rusqlite-blocking", "default", "rusqlite-blocking"),
    ("lean turso-blocking", "lean", "turso-blocking"),
    ("lean turso-uring-blocking", "lean", "turso-uring-blocking"),
    ("lean rusqlite-blocking", "lean", "rusqlite-blocking"),
    ("lean rusqlite-blocking-tuned", "lean", "rusqlite-blocking-tuned"),
]
FILES = [  # label, build, engine, extra flags
    ("rusqlite", "default", "rusqlite", []),
    ("turso", "default", "turso", []),
    ("lean rusqlite", "lean", "rusqlite", []),
    ("lean rusqlite-tuned", "lean", "rusqlite-tuned", []),
    ("lean turso", "lean", "turso", []),
    ("lean turso-uring", "lean", "turso-uring", []),
    ("lean turso-uring-shared", "lean", "turso-uring-shared", []),
    ("lean turso, THP off", "lean", "turso", ["--no-thp", "1"]),
]


def exe(build):
    return str(BIN / f"sqlite-engine-{build}")


def rotated(arms, r):
    k = r % len(arms)
    return arms[k:] + arms[:k]


def blocking(out, rounds):
    data = pathlib.Path("target/blocking")
    subprocess.run([exe("default"), "blocking", "--arm", "idle", "--rounds", "1", "--secs", "0.1"], check=True, capture_output=True)
    with open(out / "blocking.jsonl", "a") as log:
        for workers in (1, 2):
            for cache in (0, 64, 2000):
                for r in range(rounds):
                    for label, build, arm in rotated(BLOCKING, r):
                        cmd = [exe(build), "blocking", "--arm", arm, "--workers", str(workers), "--cache-pages", str(cache),
                               "--rounds", "1", "--secs", "2", "--keep", "1", "--raw", "1", "--dir", str(data)]
                        row = json.loads(subprocess.run(cmd, check=True, capture_output=True, text=True).stdout.splitlines()[0])
                        row.update(label=label, round=r)
                        log.write(json.dumps(row) + "\n")
                        log.flush()


def files(out, rounds):
    data = pathlib.Path("target/files")
    subprocess.run([exe("default"), "files", "--rounds", "0", "--dir", str(data)], check=True)
    with open(out / "files.jsonl", "a") as log:
        for r in range(rounds):
            for label, build, engine, extra in rotated(FILES, r):
                for side in data.iterdir():
                    if not side.name.endswith(".db"):
                        side.unlink()
                cmd = [exe(build), "files-child", "--engine", engine, "--dir", str(data), "--files", "1000", "--round", str(r)] + extra
                row = json.loads(subprocess.run(cmd, check=True, capture_output=True, text=True).stdout)
                row.update(label=label)
                log.write(json.dumps(row) + "\n")
                log.flush()


def pct(v, p):
    v = sorted(v)
    return v[round((len(v) - 1) * p)]


def summary(out):
    cells = {}
    for line in open(out / "blocking.jsonl"):
        row = json.loads(line)
        cells.setdefault((row["workers"], row["cache_pages"], row["label"]), []).append(row)
    print("workers cache arm | lateness ms p50/p99/max [per-round p99] | scan p50 ms | reads/s | Pending | cache held | read threads")
    for (w, c, label), rows in sorted(cells.items(), key=lambda kv: (kv[0][0], kv[0][1], [b[0] for b in BLOCKING].index(kv[0][2]))):
        late = [x for r in rows for x in r["raw"]["lateness_us"]]
        scans = [x for r in rows for x in r["raw"]["scan_ms"]]
        p99s = [pct(r["raw"]["lateness_us"], 0.99) / 1e3 for r in rows]
        scan = f"{statistics.median(scans):.2f}" if scans else "-"
        threads = "blocking pool" if any(r["blocking_tids"] for r in rows) else ("worker" if scans else "-")
        print(f"{w} {c:>2} {label:<29}| {pct(late, .5)/1e3:.2f} / {pct(late, .99)/1e3:.2f} / {max(late)/1e3:.1f} "
              f"[{min(p99s):.2f}-{max(p99s):.2f}] | {scan} | {len(scans) / (2 * len(rows)):.0f} | "
              f"{sum(r['next_pending'] for r in rows)} | {rows[0]['cache_held']} | {threads} | n={len(rows)}")
    if not (out / "files.jsonl").exists():
        return
    print("\narm | open p50 ms (rounds) | open p99 | open 10k p50 | RSS / anon / file KiB per file | fds | held read p50/p99 us")
    by = {}
    for line in open(out / "files.jsonl"):
        row = json.loads(line)
        by.setdefault(row["label"], []).append(row)
    rng = lambda xs, s=1: f"{min(xs)/s:.2f}-{max(xs)/s:.2f}"
    for label, *_ in FILES:
        rows = by.get(label, [])
        if not rows:
            continue
        g = lambda *k: [functools.reduce(lambda d, x: d[x], k, r) for r in rows]
        print(f"{label:<26}| {rng(g('open_us', 'p50'), 1e3)} | {rng(g('open_us', 'p99'), 1e3)} | {rng(g('open_us_10000', 'p50'), 1e3)} | "
              f"{statistics.median(g('rss_kib_per_file')):.0f} / {statistics.median(g('anon_kib_per_file')):.0f} / "
              f"{statistics.median(g('file_kib_per_file')):.0f} | {rows[0]['fds_per_file']:.2f} | "
              f"{rng(g('held_read_us', 'p50'))} / {rng(g('held_read_us', 'p99'))} | {rows[0]['side_after_read']} n={len(rows)}")


if __name__ == "__main__":
    mode, out = sys.argv[1], pathlib.Path(sys.argv[2]).resolve()
    out.mkdir(parents=True, exist_ok=True)
    os.chdir(pathlib.Path(__file__).parent)
    {"blocking": lambda: blocking(out, int(sys.argv[3]) if len(sys.argv) > 3 else 6),
     "files": lambda: files(out, int(sys.argv[3]) if len(sys.argv) > 3 else 5),
     "summary": lambda: summary(out)}[mode]()
