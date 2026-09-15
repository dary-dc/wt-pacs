#!/usr/bin/env python3
"""T3's estimator, fixed before the run: pooled miss samples, not median-of-p95.

The Phase C review found the two disagree on sign of slope over the same 80 rows, and N11
asked for pooling. This reads `stream_shape_cells.sh`'s JSONs, pools every positive wait
across repeats per arm, and bootstraps a CI on each arm's p95 ratio against the reference.

    lab/scripts/stream_shape_pool.py <out-dir> [--ref shared] [--boot 10000] [--null <dir>]

Two columns, because the metric the campaign pre-registered is biased and the bias is known.
`miss p95` pools only positive waits, so arms that miss often are compared on their bulk while
arms that miss rarely are compared on their tail — the Phase C review's criticism, inherited
deliberately. `all p95` pools every step, zeros included, so every arm brings the same N. Read
`all p95` when the arms' miss counts differ by more than about 2x; the pre-registered rule is
still stated on `miss p95`.

`--null` names the same cell at 0 % loss. An arm that pays a cost absent loss — `pool:k` does,
by interleaving two frames that a shared stream would serialise — cannot be compared to the
reference under loss without carrying that cost into the difference. With `--null`, each arm is
also reported against **its own** null p95, which is the loss effect with the arm's baseline
divided out, and that column is the one to compare across arms.

Void checks run first and are fatal to the cell, not a footnote: a cell whose reference arm
records fewer than 20 misses cannot separate anything, and one the client's own pacer rate-limited
measured the harness rather than the link.

`on_time_rate` and the `late_*` fields are **not** read here. They are closed-reader metrics —
`wait_displayable` is handed a scheduled time only on that path — so in `--reader-mode open`,
the only mode admissible for stream shape, they are structurally zero and say nothing. An open
reader never blocks, so it reports distress as censoring instead: `censored_frac` is the gate.
"""
from __future__ import annotations

import json
import math
import random
import sys
from pathlib import Path

MIN_MISSES = 20


def nearest_rank(xs: list[float], p: float) -> float:
    if not xs:
        return 0.0
    s = sorted(xs)
    return s[min(max(math.ceil(p / 100 * len(s)), 1), len(s)) - 1]


def load(out_dir: Path) -> dict[str, list[dict]]:
    arms: dict[str, list[dict]] = {}
    for f in sorted(out_dir.glob("*.r*.json")):
        if f.name.startswith("probe."):
            continue
        run = json.loads(f.read_text())
        arms.setdefault(run.get("stream_mode") or run.get("arm_label", ""), []).append(run)
    return arms


def ratio_ci(a: list[float], b: list[float], boot: int) -> tuple[float, float]:
    """Bootstrap CI on p95(a)/p95(b) - 1, resampling each pool independently."""
    rs = random.Random(20260914)
    out = []
    for _ in range(boot):
        ra = [a[rs.randrange(len(a))] for _ in range(len(a))]
        rb = [b[rs.randrange(len(b))] for _ in range(len(b))]
        pb = nearest_rank(rb, 95)
        if pb > 0:
            out.append(nearest_rank(ra, 95) / pb - 1)
    out.sort()
    return (out[int(0.025 * len(out))] * 100, out[int(0.975 * len(out))] * 100)


def main() -> int:
    args = sys.argv[1:]
    out_dir = Path(args[0])
    ref = args[args.index("--ref") + 1] if "--ref" in args else "shared"
    null_dir = Path(args[args.index("--null") + 1]) if "--null" in args else None
    boot = int(args[args.index("--boot") + 1]) if "--boot" in args else 10000

    if (out_dir / "UNSHAPED").exists():
        print(f"{out_dir} ran without a shaped link — it decides nothing", file=sys.stderr)
        return 1

    arms = load(out_dir)
    if ref not in arms:
        print(f"reference arm `{ref}` has no runs in {out_dir}", file=sys.stderr)
        return 2

    pools = {a: [w for r in runs for w in r["wait_ms"] if w > 0] for a, runs in arms.items()}
    every = {a: [w for r in runs for w in r["wait_ms"]] for a, runs in arms.items()}
    strand = {a: sum(r["stranded_frames"] for r in runs) / len(runs) for a, runs in arms.items()}
    void = []
    if len(pools[ref]) < MIN_MISSES:
        void.append(f"{ref} pooled only {len(pools[ref])} misses, under {MIN_MISSES}")
    for a, runs in arms.items():
        if any(r["read_bps"] for r in runs):
            void.append(f"{a} ran with read_bps set — the client's pacer, not the link, set the rate")
        if any(r["asks_sent"] * 2 < r["wait_samples"] for r in runs):
            void.append(f"{a} sent under half the trace's asks — the outstanding ceiling suppressed them")
        if max(r["censored_frac"] for r in runs) > 0.1:
            void.append(f"{a} censored over 10% of waits")
        if min(r["cache_hit_rate"] for r in runs) > 0.9:
            void.append(f"{a} was displayable on over 90% of steps — the link is not in the loop")

    null_p95 = {}
    if null_dir:
        for a, runs in load(null_dir).items():
            w = [x for r in runs for x in r["wait_ms"] if x > 0]
            if w:
                null_p95[a] = nearest_rank(w, 95)

    head = (f"{'arm':<12} {'runs':>4} {'misses':>7} {'miss_p95':>9} {'vs ref':>8}"
            f" {'all_p95':>8} {'vs ref':>8} {'strand':>7}")
    print(head + (f" {'vs null':>8}  CI95(miss)  CI95(all)" if null_dir else "  CI95(miss)  CI95(all)"))
    for a in sorted(pools, key=lambda x: (x != ref, x)):
        p95 = nearest_rank(pools[a], 95)
        med = nearest_rank(pools[a], 50)
        if a == ref or not pools[a] or not pools[ref]:
            delta, ci, aci = "—", "", ""
        else:
            lo, hi = ratio_ci(pools[a], pools[ref], boot)
            delta = f"{(p95 / nearest_rank(pools[ref], 95) - 1) * 100:+.1f}%"
            ci = f"[{lo:+.1f}, {hi:+.1f}]"
            alo, ahi = ratio_ci(every[a], every[ref], boot)
            aci = f"[{alo:+.1f}, {ahi:+.1f}]"
        allp = nearest_rank(every[a], 95)
        ref_all = nearest_rank(every[ref], 95)
        adelta = "—" if a == ref or not ref_all else f"{(allp / ref_all - 1) * 100:+.1f}%"
        own = ""
        if null_dir:
            n = null_p95.get(a)
            own = f"{(p95 / n - 1) * 100:+.1f}%" if n else "no null"
            own = f" {own:>8}"
        print(f"{a:<12} {len(arms[a]):>4} {len(pools[a]):>7} {p95:>9.2f} {delta:>8}"
              f" {allp:>8.2f} {adelta:>8} {strand[a]:>7.1f}{own}  {ci:>12}  {aci}")

    if void:
        print("\nVOID — this cell decides nothing:", file=sys.stderr)
        for v in void:
            print(f"  · {v}", file=sys.stderr)
        return 1
    spread = max(len(p) for p in pools.values()) / max(1, min(len(p) for p in pools.values()))
    print("\nA CI spanning zero is not a result. T3's bar is 15% on the reference arm.")
    if spread > 2:
        print(f"Miss counts differ {spread:.1f}x across arms — read all_p95, not miss_p95.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
