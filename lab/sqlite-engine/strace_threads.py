#!/usr/bin/env python3
"""Which threads issued each read: lab/sqlite-engine/README.md §1.

  strace -f -e trace=pread64,io_uring_enter -o TRACE sqlite-engine blocking --arm ARM --rounds 1 > ROWS
  strace_threads.py TRACE ROWS
"""
import collections
import json
import sys


def main(trace, rows):
    row = next(json.loads(l) for l in open(rows) if '"round"' in l)
    role = {row["pid"]: "main (opens)"}
    role.update({t: "worker (reader task)" for t in row["reader_tids"]})
    role.update({t: "blocking pool" for t in row["blocking_tids"]})
    counts = collections.Counter()
    for line in open(trace):
        tid, _, rest = line.partition(" ")
        call = rest.lstrip().split("(", 1)[0]
        if call in ("pread64", "io_uring_enter"):
            counts[(role.get(int(tid), "other"), call)] += 1
    print(json.dumps({"arm": row["arm"], "calls": {f"{r}: {c}": n for (r, c), n in sorted(counts.items())}}))


if __name__ == "__main__":
    main(*sys.argv[1:3])
