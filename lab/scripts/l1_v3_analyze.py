#!/usr/bin/env python3
"""L1 v3 decision analysis — frozen before collection (Gate S12 + C2).

Reads docs/measurements/r2/l1_s_vs_q_loss_v3.tsv (or --tsv).

TSV columns (action plan §5):
  arm fixture trace rtt_label_ms rtt_measured_ms loss_pct loss_model depth
  step_interval_ms run order_index miss_p95_wait_ms miss_mean_wait_ms
  p95_wait_ms mean_wait_ms cache_hit_rate cache_misses asks_sent
  peak_outstanding bytes_on_wire step_loop_ms link_util_measured
  wait_h1_median_ms wait_h2_median_ms cell_label protocol_sha server_sha ts_iso

Decision rule (same rtt_label_ms + depth):
  gain(cell) = (median_S - median_Q) / median_S * 100
  CI(cell)   = bootstrap 95% CI on gain, 20_000 resamples (seed=20260902)

  Q wins iff all three hold:
    1. Null control: CI(0% loss) contains 0.
    2. Effect bar:   lower bound of CI(0.5% loss) > 15.
    3. Dose (C2):    gain must not *decrease* between two loss rates that
                     gate A5 marks delivery-limited (cell_label != CONGESTION_LIMITED).
                     Congestion-limited cells are diagnostic and exempt; the campaign
                     must then carry ≥2 delivery-limited loss rates.

Also reports S vs P for attribution. Rows with cell_label in {BACKLOG, VOID}
are excluded from the decision.
"""

from __future__ import annotations

import argparse
import csv
import math
import sys
from collections import defaultdict
from pathlib import Path
from typing import Dict, List, Sequence, Tuple

BOOTSTRAP_N = 20_000
SEED = 20260902
EFFECT_BAR = 15.0  # percent; clause 2 lower-bound threshold
EXCLUDE_FROM_DECISION = frozenset({"BACKLOG", "VOID"})
CONGESTION = "CONGESTION_LIMITED"
METRIC = "miss_p95_wait_ms"


def median(xs: Sequence[float]) -> float:
    if not xs:
        return float("nan")
    s = sorted(xs)
    n = len(s)
    mid = n // 2
    if n % 2:
        return s[mid]
    return 0.5 * (s[mid - 1] + s[mid])


def gain(med_s: float, med_q: float) -> float:
    if med_s == 0 or math.isnan(med_s) or math.isnan(med_q):
        return float("nan")
    return (med_s - med_q) / med_s * 100.0


class XorShift64:
    """Tiny deterministic PRNG so the frozen script has no numpy dependency."""

    def __init__(self, seed: int) -> None:
        self.state = seed & 0xFFFFFFFFFFFFFFFF or 1

    def rand_u64(self) -> int:
        x = self.state
        x ^= (x << 13) & 0xFFFFFFFFFFFFFFFF
        x ^= (x >> 7) & 0xFFFFFFFFFFFFFFFF
        x ^= (x << 17) & 0xFFFFFFFFFFFFFFFF
        self.state = x & 0xFFFFFFFFFFFFFFFF
        return self.state

    def rand_int(self, n: int) -> int:
        while True:
            r = self.rand_u64()
            if r < (1 << 64) - ((1 << 64) % n):
                return r % n


def bootstrap_gain_ci(
    s_vals: Sequence[float],
    q_vals: Sequence[float],
    n_boot: int = BOOTSTRAP_N,
    seed: int = SEED,
) -> Tuple[float, float, float]:
    """Return (point_gain, lo, hi) — percentile bootstrap on the gain of medians."""
    point = gain(median(s_vals), median(q_vals))
    if not s_vals or not q_vals:
        return point, float("nan"), float("nan")
    rng = XorShift64(seed)
    boots: List[float] = []
    ns, nq = len(s_vals), len(q_vals)
    for _ in range(n_boot):
        s_samp = [s_vals[rng.rand_int(ns)] for _ in range(ns)]
        q_samp = [q_vals[rng.rand_int(nq)] for _ in range(nq)]
        boots.append(gain(median(s_samp), median(q_samp)))
    boots.sort()
    lo_i = int(0.025 * (n_boot - 1))
    hi_i = int(0.975 * (n_boot - 1))
    return point, boots[lo_i], boots[hi_i]


def load_rows(path: Path) -> List[dict]:
    with path.open(newline="") as f:
        lines = [ln for ln in f if ln.strip() and not ln.lstrip().startswith("#")]
    if not lines:
        return []
    return list(csv.DictReader(lines, delimiter="\t"))


def cell_key(row: dict) -> Tuple[str, str, str, str]:
    return (
        row["rtt_label_ms"],
        row["loss_pct"],
        row["depth"],
        row.get("loss_model", "iid"),
    )


def is_decision_row(row: dict) -> bool:
    label = (row.get("cell_label") or "OK").strip().upper()
    if label in EXCLUDE_FROM_DECISION:
        return False
    try:
        float(row[METRIC])
    except (KeyError, ValueError, TypeError):
        return False
    return True


def group_arm_values(rows: List[dict]) -> Dict[Tuple, Dict[str, List[float]]]:
    """(rtt, loss, depth, loss_model) -> arm -> list of miss_p95."""
    out: Dict[Tuple, Dict[str, List[float]]] = defaultdict(lambda: defaultdict(list))
    for r in rows:
        if not is_decision_row(r):
            continue
        key = cell_key(r)
        arm = r["arm"].strip().upper()
        out[key][arm].append(float(r[METRIC]))
        label = (r.get("cell_label") or "OK").strip().upper()
        if label == CONGESTION:
            out[key]["_CONGESTION"] = [1.0]
    return out


def fmt(x: float) -> str:
    if math.isnan(x):
        return "nan"
    return f"{x:.2f}"


def analyze(rows: List[dict], n_boot: int) -> int:
    groups = group_arm_values(rows)
    if not groups:
        print("No usable rows.", file=sys.stderr)
        return 2

    print("=== L1 v3 cell summary (miss_p95 medians) ===")
    print(
        f"{'rtt':>5} {'loss':>6} {'D':>3} {'model':>7} "
        f"{'nS':>3} {'nP':>3} {'nQ':>3} "
        f"{'medS':>8} {'medP':>8} {'medQ':>8} "
        f"{'gSQ':>7} {'lo':>7} {'hi':>7} {'gSP':>7} {'label':>18}"
    )

    by_axis: Dict[Tuple[str, str, str], Dict[float, dict]] = defaultdict(dict)

    for key in sorted(
        groups.keys(), key=lambda k: (float(k[0]), float(k[1]), int(k[2]), k[3])
    ):
        rtt, loss, depth, model = key
        arms = groups[key]
        s_vals = arms.get("S", [])
        p_vals = arms.get("P", [])
        q_vals = arms.get("Q", [])
        congested = "_CONGESTION" in arms
        med_s, med_p, med_q = median(s_vals), median(p_vals), median(q_vals)
        g_sq, lo_sq, hi_sq = bootstrap_gain_ci(s_vals, q_vals, n_boot=n_boot)
        if p_vals:
            g_sp, _, _ = bootstrap_gain_ci(s_vals, p_vals, n_boot=n_boot)
        else:
            g_sp = float("nan")
        label = CONGESTION if congested else "OK"
        print(
            f"{rtt:>5} {loss:>6} {depth:>3} {model:>7} "
            f"{len(s_vals):>3} {len(p_vals):>3} {len(q_vals):>3} "
            f"{fmt(med_s):>8} {fmt(med_p):>8} {fmt(med_q):>8} "
            f"{fmt(g_sq):>7} {fmt(lo_sq):>7} {fmt(hi_sq):>7} {fmt(g_sp):>7} {label:>18}"
        )
        by_axis[(rtt, depth, model)][float(loss)] = {
            "gain": g_sq,
            "lo": lo_sq,
            "hi": hi_sq,
            "congested": congested,
        }

    print()
    print("=== Decision test (S12 + C2) ===")
    any_fail = False
    any_pass = False
    for (rtt, depth, model), losses in sorted(by_axis.items()):
        print(f"\n-- RTT={rtt} D={depth} model={model} --")

        if 0.0 not in losses:
            print("  1 null CI(0%): MISSING cell — cannot decide")
            any_fail = True
            continue
        c0 = losses[0.0]
        ok1 = c0["lo"] <= 0.0 <= c0["hi"]
        print(
            f"  1 null CI(0%)=[{fmt(c0['lo'])}, {fmt(c0['hi'])}] "
            f"{'PASS' if ok1 else 'FAIL'} (must contain 0)"
        )
        if not ok1:
            print("     STOP: null control failed — campaign does not measure loss.")
            any_fail = True
            continue

        if 0.5 not in losses:
            print("  2 bar  CI(0.5%): MISSING cell — cannot decide")
            ok2 = False
            any_fail = True
        else:
            c05 = losses[0.5]
            ok2 = c05["lo"] > EFFECT_BAR
            print(
                f"  2 bar  CI(0.5%)=[{fmt(c05['lo'])}, {fmt(c05['hi'])}] "
                f"point={fmt(c05['gain'])} "
                f"{'PASS' if ok2 else 'FAIL'} (lo must be > {EFFECT_BAR:g})"
            )

        delivery = sorted(
            (loss, cell)
            for loss, cell in losses.items()
            if loss > 0 and not cell["congested"]
        )
        if len(delivery) < 2:
            print(
                f"  3 dose  delivery-limited losses={len(delivery)} "
                f"(need ≥2) — INCONCLUSIVE; congested="
                f"{sum(1 for c in losses.values() if c['congested'])}"
            )
            ok3 = True
        else:
            ok3 = True
            for (l0, a), (l1, b) in zip(delivery, delivery[1:]):
                if b["gain"] < a["gain"]:
                    ok3 = False
                    print(
                        f"  3 dose  gain({l1:g}%)={fmt(b['gain'])} < "
                        f"gain({l0:g}%)={fmt(a['gain'])} — FAIL"
                    )
                    break
            if ok3:
                chain = " → ".join(f"{l:g}%:{fmt(c['gain'])}" for l, c in delivery)
                print(f"  3 dose  {chain} — PASS (non-decreasing on delivery-limited)")

        if 0.5 in losses and ok2 and ok3:
            print("  RESULT: Q wins on this axis")
            any_pass = True
        elif 0.5 in losses:
            print("  RESULT: Q does not win on this axis")
            any_fail = True

    print()
    if any_pass and not any_fail:
        print("VERDICT: Q wins (all tested axes pass S12+C2)")
        return 0
    if any_pass:
        print("VERDICT: MIXED — see per-axis results")
        return 1
    print("VERDICT: Q does not win (or campaign stopped on null control)")
    return 1


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument(
        "--tsv",
        type=Path,
        default=Path("docs/measurements/r2/l1_s_vs_q_loss_v3.tsv"),
        help="v3 results TSV",
    )
    ap.add_argument("--bootstrap", type=int, default=BOOTSTRAP_N)
    args = ap.parse_args()
    if not args.tsv.exists():
        print(
            f"missing {args.tsv} (expected — script is frozen before collection)",
            file=sys.stderr,
        )
        return 2
    rows = load_rows(args.tsv)
    return analyze(rows, n_boot=args.bootstrap)


if __name__ == "__main__":
    sys.exit(main())
