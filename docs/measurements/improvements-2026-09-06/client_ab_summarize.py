#!/usr/bin/env python3
"""Summarise before/after client CPU profiles: medians over repeats of wall, total, named functions."""
import glob, json, os, re, statistics as st, sys
from collections import defaultdict

d = sys.argv[1] if len(sys.argv) > 1 else "/tmp/claude-0/-home-user-wt-pacs/4388fb8e-14c3-5912-8315-3076f7ec068b/scratchpad/ab/prof"
KEYS = {
    "ts": ["take", "readLengthPrefixed", "encodeFodMsg", "sendFod", "heapBytes", "(program)", "(idle)", "(garbage collector)"],
    "wasm": ["__wbg_read", "__wbg_set", "decodeText", "__rdl_realloc", "push_chunk", "makeMutClosure", "heapBytes", "__wbg_write", "(program)", "(idle)", "(garbage collector)"],
}
rows = defaultdict(list)  # (cell, variant, arm) -> list of dicts
for f in sorted(glob.glob(os.path.join(d, "*.json"))):
    m = re.match(r"(.+)-(before|after)-r(\d+)-(ts|wasm)\.json", os.path.basename(f))
    if not m:
        continue
    cell, variant, rep, arm = m.groups()
    p = json.load(open(f))
    top = dict(p["top"])
    r = {"wall_ms": p["shell"]["wall_ms"], "total_ms": p["total_us"] / 1000, "delivered": p["shell"]["delivered"], "failed": p["shell"]["failed"]}
    for k in KEYS[arm]:
        r[k] = sum(us for name, us in top.items() if (name.startswith(k) if k.startswith("(") else k in name.split(" ")[0])) / 1000
    rows[(cell, variant, arm)].append(r)

cells = sorted({c for c, _, _ in rows})
for cell in cells:
    for arm in ("ts", "wasm"):
        print(f"\n== {cell} / {arm}  (median of repeats; ms of main-thread self time)")
        keys = ["wall_ms", "total_ms", "delivered", "failed"] + KEYS[arm]
        print(f"{'metric':22} {'before':>9} {'after':>9} {'delta':>10}")
        for k in keys:
            b = rows.get((cell, "before", arm), []); a = rows.get((cell, "after", arm), [])
            if not b or not a:
                continue
            vb = st.median(x[k] for x in b); va = st.median(x[k] for x in a)
            dl = f"{va - vb:+.1f}" if k not in ("delivered", "failed") else ""
            print(f"{k:22} {vb:9.1f} {va:9.1f} {dl:>10}")
