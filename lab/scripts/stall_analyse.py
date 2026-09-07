#!/usr/bin/env python3
"""Fit per-connection memory under the pathological (stalled) client.

Companion to `mem_analyse.py`, which fits the same slope for clients that *read*. The
question this one answers is the one `docs/measurements/mem/README.md` left open: whether a
client that asks for a lot and then stops reading reaches the flow-control ceilings that
`transport-conclusions.md` recommends bounding.

Two differences from `mem_analyse.py`, both forced by the workload:

1. **Both ends are fitted.** The bytes a stalled client will not read have to queue
   somewhere. Fitting only the server would show a flat line and could not distinguish
   "the ceiling bounds the server" from "the queue moved to the client".
2. **The server slope is taken over the delta from that run's own baseline**, not raw
   RssAnon. Each row restarts the server, so per-row baseline drift (allocator state,
   arena reuse) would otherwise enter the fit as noise on the intercept.

Void rows are reported and excluded, never silently averaged: they are systematically the
runs where the connection died, and dropping them quietly would flatter whichever arm dies
more often.
"""
import sys
from collections import defaultdict


def load(path):
    rows = [l.rstrip("\n").split("\t") for l in open(path) if l.strip()]
    return [dict(zip(rows[0], r)) for r in rows[1:]]


def fit(xs, ys):
    """Ordinary least squares. Returns (slope, intercept, r2)."""
    n = len(xs)
    if n < 2:
        return float("nan"), float("nan"), float("nan")
    mx, my = sum(xs) / n, sum(ys) / n
    sxx = sum((x - mx) ** 2 for x in xs)
    if sxx == 0:
        return float("nan"), float("nan"), float("nan")
    slope = sum((x - mx) * (y - my) for x, y in zip(xs, ys)) / sxx
    intercept = my - slope * mx
    ss_res = sum((y - (slope * x + intercept)) ** 2 for x, y in zip(xs, ys))
    ss_tot = sum((y - my) ** 2 for y in ys)
    return slope, intercept, (1 - ss_res / ss_tot if ss_tot else float("nan"))


def main(path):
    rows = load(path)
    good, void = [], []
    for r in rows:
        (void if r.get("void") == "1" else good).append(r)

    if void:
        print(f"VOID — {len(void)} row(s) excluded from every fit:")
        seen = defaultdict(int)
        for r in void:
            seen[(r["arm"], r["stream_mode"], r["void_reason"])] += 1
        for (arm, sm, reason), k in sorted(seen.items()):
            print(f"  arm={arm:8s} stream={sm:9s} n={k:2d}  {reason}")
        print()

    by = defaultdict(list)
    for r in good:
        by[(r["arm"], r["stream_mode"])].append(
            (int(r["clients"]), int(r["srv_delta_kb"]), int(r["cli_anon_kb"]))
        )

    fits = {}
    for key, pts in sorted(by.items()):
        arm, sm = key
        print(f"=== arm={arm}  stream_mode={sm} " + "=" * 32)
        print(f"  {'clients':>7} {'srv delta MB':>13} {'client total MB':>16}")
        agg = defaultdict(lambda: ([], []))
        for n, s, c in pts:
            agg[n][0].append(s)
            agg[n][1].append(c)
        for n in sorted(agg):
            s, c = agg[n]
            print(f"  {n:>7} {sum(s)/len(s)/1024:>13.2f} {sum(c)/len(c)/1024:>16.2f}")
        ss, si, sr = fit([p[0] for p in pts], [p[1] for p in pts])
        cs, ci, cr = fit([p[0] for p in pts], [p[2] for p in pts])
        fits[key] = (ss, cs)
        print(f"  server  per connection: {ss:8.1f} kB   intercept {si:8.1f} kB   r2 {sr:.3f}")
        print(f"  client  per connection: {cs:8.1f} kB   intercept {ci:8.1f} kB   r2 {cr:.3f}")
        print()

    # The comparison the campaign exists to make. If bounding the windows mattered for the
    # pathological case, it would show up here as a large default-over-bounded ratio.
    print("=== bounded vs default, server cost per stalled connection " + "=" * 8)
    for sm in sorted({k[1] for k in fits}):
        d = fits.get(("default", sm))
        b = fits.get(("bounded", sm))
        if not d or not b:
            continue
        ratio = d[0] / b[0] if b[0] else float("nan")
        print(f"  {sm:9s}  default {d[0]:8.1f} kB   bounded {b[0]:8.1f} kB   ratio {ratio:5.2f}x")
    print()
    print("=== shared vs per-frame, client cost per stalled connection " + "=" * 7)
    for arm in sorted({k[0] for k in fits}):
        s = fits.get((arm, "shared"))
        p = fits.get((arm, "per-frame"))
        if not s or not p:
            continue
        ratio = p[1] / s[1] if s[1] else float("nan")
        print(f"  {arm:9s}  shared {s[1]:9.1f} kB   per-frame {p[1]:9.1f} kB   ratio {ratio:5.2f}x")


if __name__ == "__main__":
    main(sys.argv[1] if len(sys.argv) > 1 else ".local/measurements/mem/stall_client.tsv")
