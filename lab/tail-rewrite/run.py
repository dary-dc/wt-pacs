#!/usr/bin/env python3
"""Every tail-rewrite cell, interleaved; the checks; the breakages; what the host takes.

usage: run.py MOUNTS OUT ROUNDS     (mounts.sh MOUNTS first; README.md §Reproduce)

A cell is (filesystem, N, position, index place, full or tail, warm or durable). Each run copies the
series (no reflink), syncs, then times the merge alone with the page cache warm; the loop device's
sectors are counted across the merge and the sync after it. Writes OUT/{rows,checks,host}.jsonl, OUT/mutate.txt.
"""
import hashlib
import json
import os
import shutil
import subprocess
import sys
import time
from pathlib import Path

HERE = Path(__file__).resolve().parent
MERGE = HERE / "merge/target/release/tail-merge"
FILESYSTEMS = ("xfs", "ext4")
SIZES = (262, 2000)
POSITIONS = ("end", "middle", "start")
PLACES = ("front", "end")
METHODS = ("full", "tail")
MODES = ("warm", "durable")


def williams(n):
    """lab/order.mjs's square: every unit at every position and after every other equally often."""
    first, k = [0], 1
    while len(first) < n:
        first.append(k)
        if len(first) < n:
            first.append(n - k)
        k += 1
    rows = [[(u + r) % n for u in first] for r in range(n)]
    return [x for row in rows for x in (row, row[::-1])] if n % 2 else rows


def device(mount):
    src = subprocess.run(["findmnt", "-no", "SOURCE", str(mount)], capture_output=True, text=True, check=True).stdout.strip()
    return Path("/sys/block") / Path(src).name / "stat"


def sectors(stat):
    f = stat.read_text().split()
    return int(f[2]) * 512, int(f[6]) * 512


def at_for(n, position):
    return {"end": n, "middle": n // 2, "start": 0}[position]


def master(mounts, fs, place, n):
    path = mounts / fs / "master" / f"{place}-{n}.sbnd"
    if not path.exists():
        path.parent.mkdir(parents=True, exist_ok=True)
        subprocess.run([str(MERGE), "build", str(path), place, str(n)], check=True)
    return path


def fresh(mounts, fs, place, n, name="s.sbnd"):
    serve = mounts / fs / "serve"
    shutil.rmtree(serve, ignore_errors=True)
    serve.mkdir(parents=True)
    path = serve / name
    subprocess.run(["cp", "--reflink=never", str(master(mounts, fs, place, n)), str(path)], check=True)
    os.sync()
    return path


def merge(path, place, method, at, mode, mutate=""):
    env = dict(os.environ, TAIL_MUTATE=mutate)
    out = subprocess.run([str(MERGE), "merge", str(path), place, method, str(at), mode], capture_output=True, text=True, env=env)
    if out.returncode:
        raise RuntimeError(out.stderr.strip().splitlines()[0])
    return json.loads(out.stdout)


def sha(fileobj):
    fileobj.seek(0)
    h = hashlib.sha256()
    while chunk := fileobj.read(1 << 20):
        h.update(chunk)
    return h.hexdigest()


def shared_bytes(path):
    """Bytes of `path` in extents FIEMAP flags shared, by filefrag."""
    out = subprocess.run(["filefrag", "-v", "-b1", str(path)], capture_output=True, text=True, check=True).stdout
    rows = [line.split(":") for line in out.splitlines() if line.strip()[:1].isdigit()]
    return sum(int(r[3]) for r in rows if "shared" in r[-1])


def check(mounts, fs, n, position, place, mutate=""):
    """The tail's published file is the full rewrite's byte for byte, and the old file, held open, is unchanged.
    `shared` is read while the old file is open: once it is gone, its extents are no longer shared."""
    at = at_for(n, position)
    full = fresh(mounts, fs, place, n, "full.sbnd")
    merge(full, place, "full", at, "warm")
    want = sha(open(full, "rb"))
    keep = mounts / fs / "full.keep"
    shutil.move(str(full), keep)
    path = fresh(mounts, fs, place, n)
    old = open(path, "rb")
    before = sha(old)
    row = merge(path, place, "tail", at, "warm", mutate)
    published = sha(open(path, "rb"))
    after = sha(old)
    shared = shared_bytes(path)
    old.close()
    keep.unlink()
    return {"fs": fs, "n": n, "position": position, "place": place, "mutate": mutate,
            "identical": published == want, "old_unchanged": after == before,
            "shared": shared, "clone": row["clone"]}


def run(mounts, cell):
    fs, n, position, place, method, mode = cell
    path = fresh(mounts, fs, place, n)
    stat = device(mounts / fs)
    r0, w0 = sectors(stat)
    row = merge(path, place, method, at_for(n, position), mode)
    os.sync()
    r1, w1 = sectors(stat)
    return dict(zip(("fs", "n", "position", "place", "method", "mode"), cell), **row, dev_read=r1 - r0, dev_written=w1 - w0)


BREAKAGES = {
    "shift": "the late frame written one byte past its offset",
    "header": "the header (N) left as the old file's",
    "no-clone": "the clone skipped: the frames before the point left as holes",
    "in-place": "the tail written into the published file instead of a clone",
    "corrupt": "one byte of the staged file changed after it was written",
}


def mutate(mounts):
    """Each breakage on XFS, N = 262, the middle, front index: some check must fail."""
    lines = []
    for name, what in BREAKAGES.items():
        try:
            c = check(mounts, "xfs", 262, "middle", "front", name)
            caught = [k for k in ("identical", "old_unchanged") if not c[k]]
            verdict = f"caught by {', '.join(caught)}" if caught else "NOT CAUGHT"
        except RuntimeError as e:
            verdict = f"caught by the merge: {e}"
        lines.append(f"{name}: {what} — {verdict}")
    return lines


def host(mounts, rounds=3):
    """What each loop filesystem takes: 1 GiB written cached, written and fsync'd, read with O_DIRECT."""
    rows = []
    for r in range(rounds):
        for fs in FILESYSTEMS:
            f = mounts / fs / "rate.bin"
            row = {"round": r, "fs": fs, "bytes": 1 << 30}
            for key, args in (("write_cached_s", []), ("write_fsync_s", ["conv=fsync"])):
                f.unlink(missing_ok=True)
                os.sync()
                t = time.perf_counter()
                subprocess.run(["dd", "if=/dev/zero", f"of={f}", "bs=1M", "count=1024", *args], check=True, capture_output=True)
                row[key] = time.perf_counter() - t
            os.sync()
            t = time.perf_counter()
            subprocess.run(["dd", f"if={f}", "of=/dev/null", "bs=1M", "iflag=direct"], check=True, capture_output=True)
            row["read_direct_s"] = time.perf_counter() - t
            f.unlink()
            rows.append(row)
    return rows


def main():
    mounts, out, rounds = Path(sys.argv[1]), Path(sys.argv[2]), int(sys.argv[3])
    out.mkdir(parents=True, exist_ok=True)
    with open(out / "checks.jsonl", "w") as f:
        for fs in FILESYSTEMS:
            for n in SIZES:
                for position in POSITIONS:
                    for place in PLACES:
                        f.write(json.dumps(check(mounts, fs, n, position, place)) + "\n")
    (out / "mutate.txt").write_text("\n".join(mutate(mounts)) + "\n")
    cells = [(fs, n, p, pl, m, md) for fs in FILESYSTEMS for n in SIZES for p in POSITIONS for pl in PLACES for m in METHODS for md in MODES]
    order = williams(len(cells))
    with open(out / "rows.jsonl", "w") as f:
        for r in range(rounds):
            for i in order[r % len(order)]:
                f.write(json.dumps(dict(run(mounts, cells[i]), round=r)) + "\n")
                f.flush()
    with open(out / "host.jsonl", "w") as f:
        for row in host(mounts):
            f.write(json.dumps(row) + "\n")


if __name__ == "__main__":
    main()
