#!/usr/bin/env python3
"""Row CARRIERS' predictions C1–C8 (docs/av1/profile-carriers.md §3), each against its band as written there.

usage: predictions.py WORK ROWS.jsonl   — a time ratio is per round, then the median over rounds
"""
import json
import statistics
import sys
from collections import defaultdict
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
from roles import PAIRS, at_psnr, load_rows  # noqa: E402

LAY, K1 = "three-full-m20", "three-full-m20-k1"


def band(v, lo, hi):
    if v is None:
        return "— (no round)"
    return f"{v:.3g} {'held' if lo <= v <= hi else 'REFUTED'} ({lo}–{hi})"


def fmt(a, b):
    return "—" if a is None or b is None else f"{a / b:.3g}"


def per_round(rows, s, t, arm, key):
    by = defaultdict(list)
    for r in rows:
        if (r["set"], r["throttle"], r["arm"]) == (s, t, arm):
            by[r["round"]].append(r)
    return {n: key(rs) for n, rs in by.items()}


def ratio(a, b):
    """Median over the rounds both have of a ÷ b, and n."""
    common = sorted(set(a) & set(b))
    vals = [a[n] / b[n] for n in common if a[n] is not None and b[n] is not None]
    return (statistics.median(vals), len(vals)) if vals else (None, 0)


def ask_mean(position=None):
    def key(rs):
        rs = [r for r in rs if position is None or r["position"] == position]
        return statistics.mean(r["ms"] for r in rs) if rs and all(r["exact"] for r in rs) else None
    return key


def frame_median(rs):
    r = rs[0]
    return statistics.median(r["ms"]) if r["lossy"] == r["frames"] else None


def main():
    work, rows = Path(sys.argv[1]), load_rows(sys.argv[2])
    throttles = sorted({r["throttle"] for r in rows})
    for idx in sorted(work.glob("dbts_*.json")):
        e = json.loads(idx.read_text())
        s, lay, sep = e["name"], e["layered"], e["separate"]
        H, frame = sum(e["htj2k_bytes"]), statistics.mean(e["k2_bytes"])
        low = e["low_bytes"] if e["shift"] else [0] * e["frames"]
        print(f"## {s}\n")
        for t in throttles:
            ref = per_round(rows, s, t, "htj2k", ask_mean())
            r, n = ratio(per_round(rows, s, t, "svc", ask_mean()), ref)
            r0, _ = ratio(per_round(rows, s, t, "svc", ask_mean(0)), ref)
            r7, _ = ratio(per_round(rows, s, t, "svc", ask_mean(7)), ref)
            print(f"* C1 {t}×: mean {band(r, 15, 60)}; position 0 {band(r0, 3, 15)}; position 7 {band(r7, 25, 100)};"
                  f" position 7 ÷ 0 {fmt(r7, r0)} (theory refuted if < 2); n {n}")
            res, n3 = ratio(per_round(rows, s, t, "res", ask_mean()), ref)
            aa, _ = ratio(per_round(rows, s, t, "htj2k-aa", ask_mean()), ref)
            print(f"* C3 {t}×: residual + add {band(res, 0.85, 1.15)}; whole (htj2k-aa) {band(aa, 0.85, 1.15)}; n {n3}")
            k1, n4 = ratio(per_round(rows, s, t, "svc1", ask_mean()), ref)
            print(f"* C4 {t}×: `p3k1-m20` ask {band(k1, 3, 15)}; n {n4}")
            for m, q in PAIRS:
                mid = per_round(rows, s, t, f"mid-{m}", frame_median)
                d, n6 = ratio(per_round(rows, s, t, f"sep-{q}", frame_median), mid)
                line = f"* C6 {t}× {m}: sep-{q} ÷ mid-{m} a frame {band(d, 0.5, 1.5)}"
                if q == "q16":
                    w, _ = ratio(per_round(rows, s, t, "wc-q16", frame_median), mid)
                    line += f"; wc-q16 ÷ mid-m20 {'—' if w is None else f'{w:.3g} ' + ('held' if w <= 1.0 else 'REFUTED')} (≤ 1.0)"
                print(line + f"; n {n6}")
            base = per_round(rows, s, t, "base", frame_median)
            d7, n7 = ratio(per_round(rows, s, t, "sep-q56", frame_median), base)
            print(f"* C7 {t}×: sep-q56 ÷ base a frame {band(d7, 3, 30)}; n {n7}")
        top = [a - b for a, b in zip(lay[LAY]["bytes"]["top"], lay[LAY]["bytes"]["middle"])]
        g = e["group"]
        asked = [sum(top[g:k + 1]) + low[k] for k in range(g, g + 8)]
        share = sum(top) / (sum(top) + sum(low))
        b2 = band(statistics.mean(asked) / frame, *((4.0, 5.0) if not e["shift"] else (2.0, 4.0)))
        print(f"* C2: ask bytes ÷ a shipped frame {b2}; the top's share t of top + low {share:.3f}")
        bm = sum(lay[K1]["bytes"]["middle"]) / sum(lay[LAY]["bytes"]["middle"])
        st = (sum(lay[K1]["bytes"]["top"]) + sum(low)) / (sum(lay[LAY]["bytes"]["top"]) + sum(low))
        print(f"* C4: `p3k1-m20` base + middle ÷ `p3-m20`'s {band(bm, 1.15, 1.8)}; stored {band(st, 0.99, 1.05)}")
        qs = [(c["quality"]["psnr"], sum(c["units"])) for c in sep.values()]
        for m, _ in PAIRS:
            c = lay[f"three-full-{m}"]
            eq = at_psnr(qs, c["middle_quality"]["psnr"])
            print(f"* C5 {m}: separate at {c['middle_quality']['psnr']:.2f} dB ÷ base + middle "
                  f"{band(eq / sum(c['bytes']['middle']), 0.4, 0.8)}")
        pairing = ", ".join(f"{m} {lay[f'three-full-{m}']['middle_quality']['psnr']:.2f} dB ↔ {q} "
                            f"{sep[q]['quality']['psnr']:.2f} dB" for m, q in PAIRS)
        print(f"* pairing by nearest PSNR: {pairing}")
        cb, cs = sum(lay[LAY]["bytes"]["base"]), sum(sep["q56"]["units"])
        dq = sep["q56"]["quality"]["psnr"] - lay[LAY]["base_quality"]["psnr"]
        print(f"* C7: Q 56 bytes ÷ base {cs / cb:.3g} {'held' if cs / cb <= 1.5 else 'REFUTED'} (≤ 1.5);"
              f" PSNR {sep['q56']['quality']['psnr']:.2f} − {lay[LAY]['base_quality']['psnr']:.2f} = {band(dq, 0.5, 3.5)} dB")
        streams = sum(sep["q16"]["units"]) + cs
        print(f"* C8: layered {band((sum(lay[LAY]['bytes']['top']) + sum(low)) / H, 0.93, 0.95)}; "
              f"by residual {band((streams + sum(sep['q16']['residual_units'])) / H, 0.99, 1.02)}; "
              f"by whole frame {band((streams + H) / H, 1.00, 1.06)}\n")


if __name__ == "__main__":
    main()
