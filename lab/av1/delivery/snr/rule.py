#!/usr/bin/env python3
"""Row SNRPREVIEW: the collector (docs/av1/snr-preview.md §5.5). Pools the shards' rows, puts every time in its
block's HTJ2K-frame unit, gates each block on its A/A and each arm on its order effect, builds every carrier's
stages from the arms' ops, decides each pair by the median's order-statistic interval, and labels each two-layer
carrier against each alternative from dominance at every stage.

usage: rule.py INDEX-PREFIX ROWS.jsonl ...   — prints the tables; rule_test.py checks the arithmetic
  INDEX-PREFIX: snr_content.py code's indexes are INDEX-PREFIX*.json (results/shard-1.index. or WORK/)
"""
import glob
import json
import math
import statistics
import sys
from collections import defaultdict
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "carriers"))
from amended import ALPHA, decided, dominates, median_interval, order_p, status  # noqa: E402

STAGES = ("first picture", "every slice, preview", "every slice, visually lossless", "every slice, exact",
          "jump, preview", "jump, visually lossless", "jump, exact")
CARRIERS = ("snr", "two", "one", "sep", "svc", "htj2k")
TWO_LAYER = ("snr", "two")
ALTERNATIVES = ("svc", "sep", "one")
PAIRS = [(t, x) for t in TWO_LAYER for x in ALTERNATIVES] + [("snr", "two")]
ARMS_OF = {"snr": ("snr",), "two": ("two",), "one": ("two",), "sep": ("two", "ctrl"), "svc": ("svc",), "htj2k": ("ctrl",)}
SVC_VL = 8


def load(paths):
    rows = [json.loads(line) for p in paths for line in Path(p).open()]
    return [r for r in rows if not r.get("mutate") and not r.get("void")], sum(1 for r in rows if r.get("void"))


def failed(x):
    return bool(x.get("error") or x.get("exact") is False or x.get("lossy") is False
                or ("frames" in x and (x.get("lossy", x.get("exact")) < x["frames"]))
                or ("res" in x and x.get("exact") < x["frames"]))


def arms(rows):
    """{(set, g, v, round): {arm: {op: [rows]}}}; an arm-round with any failed check is left out."""
    by = defaultdict(lambda: defaultdict(list))
    for r in rows:
        by[(r["set"], r["g"], r["v"], r["round"])][r["arm"]].append(r)
    out = {}
    for cell, got in by.items():
        out[cell] = {}
        for arm, rs in got.items():
            if any(failed(x) for x in rs):
                continue
            ops = defaultdict(list)
            for x in rs:
                ops[x["op"]].append(x)
            out[cell][arm] = ops
    return out


def jumps(ops, *names):
    """Per asked i, the sum of the named ops' ms."""
    by = defaultdict(float)
    for n in names:
        for x in ops[n]:
            by[x["i"]] += x["ms"]
    return by


def stages(carrier, a, ctrl):
    """A carrier's seven stage times (ms) from one block-round's arm ops a (snr, two or svc) and the control's per-frame ms.
    In order the client shows every preview, then every visually lossless frame, then every exact one; a jump shows
    frame i at each in turn, from no decoder state."""
    mean = lambda d: statistics.mean(d.values())  # noqa: E731
    if carrier == "htj2k":
        i = [x["i"] for x in a["vl-jump"]]
        t, j = sum(ctrl), statistics.mean(ctrl[k] for k in i)
        return dict(zip(STAGES, (ctrl[0], t, t, t, j, j, j)))
    if carrier == "svc":
        pre, ex = a["preview"][0]["ms"], a["exact"][0]["ms"]
        jp, je = jumps(a, "preview-jump"), jumps(a, "preview-jump", "exact-jump")
        return dict(zip(STAGES, (pre[0], sum(pre), sum(pre) + sum(ex), sum(pre) + sum(ex), mean(jp), mean(je), mean(je))))
    pre, vl, res = a["preview"][0]["ms"], a["vl"][0]["ms"], a["vl"][0]["res"]
    if carrier == "one":
        jv, je = jumps(a, "vl-jump"), jumps(a, "vl-jump", "residual")
        return dict(zip(STAGES, (vl[0], sum(vl), sum(vl), sum(vl) + sum(res), mean(jv), mean(jv), mean(je))))
    jp, jv = jumps(a, "preview-jump"), jumps(a, "preview-jump", "vl-jump")
    if carrier == "sep":
        je = {i: t + ctrl[i] for i, t in jv.items()}
        exact = sum(pre) + sum(vl) + sum(ctrl)
    else:
        je = jumps(a, "preview-jump", "vl-jump", "residual")
        exact = sum(pre) + sum(vl) + sum(res)
    return dict(zip(STAGES, (pre[0], sum(pre), sum(pre) + sum(vl), exact, mean(jp), mean(jv), mean(je))))


def normalized(cells):
    """{(set, g, v, carrier): {round: {stage: time ÷ the block's control frame}}}; svc from the VL-8 block under every v."""
    out = defaultdict(dict)
    for (s, g, v, r), a in cells.items():
        if "ctrl" not in a:
            continue
        ctrl = a["ctrl"]["cine-exact"][0]["ms"]
        ref = statistics.median(ctrl)
        for c in CARRIERS:
            src = {"snr": "snr", "svc": "svc"}.get(c, "two")
            if not all(x in a for x in (*ARMS_OF[c], src)):
                continue
            got = {k: x / ref for k, x in stages(c, a[src], ctrl).items()}
            for vv in ((4, 8) if c == "svc" else (v,)):
                out[(s, g, vv, c)][r] = got
    return out


def aa(cells):
    """{(set, g, v): (median, low, high, n)} of log(ctrl-aa ÷ ctrl), each a block's median frame, over rounds."""
    d = defaultdict(list)
    for (s, g, v, _), a in cells.items():
        if "ctrl" in a and "ctrl-aa" in a:
            m = [statistics.median(a[x]["cine-exact"][0]["ms"]) for x in ("ctrl-aa", "ctrl")]
            d[(s, g, v)].append(math.log(m[0] / m[1]))
    return {c: (*median_interval(x), len(x)) for c, x in d.items()}


def total(ops):
    return sum(sum(x["ms"]) if isinstance(x["ms"], list) else x["ms"] for rs in ops.values() for x in rs)


def order_effects(cells, rows):
    """{(set, g, v, arm): (p, flagged)}: each arm's log total ÷ the control's (the control's ÷ the A/A's), by predecessor."""
    prev = {(r["set"], r["g"], r["v"], r["round"], r["arm"]): r["prev"] for r in rows}
    by = defaultdict(lambda: defaultdict(list))
    for (s, g, v, r), a in cells.items():
        if "ctrl" not in a or "ctrl-aa" not in a:
            continue
        for arm, ops in a.items():
            other = "ctrl-aa" if arm == "ctrl" else "ctrl"
            by[(s, g, v, arm)][prev[(s, g, v, r, arm)] or "first"].append(math.log(total(ops) / total(a[other])))
    n = defaultdict(int)
    for s, g, v, _ in by:
        n[(s, g, v)] += 1
    out = {}
    for c, groups in by.items():
        p = order_p(groups, seed=sum(map(ord, "".join(map(str, c)))))
        out[c] = (p, p < ALPHA / n[c[:3]])
    return out


def unread_blocks(gate, effects):
    out = {b for b, (_, lo, hi, _) in gate.items() if lo is None or not lo <= 0 <= hi}
    return out | {(s, g, v, a) for (s, g, v, a), (_, f) in effects.items() if f}


def readable(s, g, v, c, unread):
    """A carrier's time is read when the block its arms ran in passes its A/A and neither its arms nor the control is flagged."""
    b = (s, g, SVC_VL if c == "svc" else v)
    return b not in unread and not any((*b, a) in unread for a in (*ARMS_OF[c], "ctrl"))


def pair(norm, s, g, v, x, y, stage, unread):
    """'x', 'y' (the lower time), 'not resolved', or 'not read' (a gate, or too few rounds for an interval)."""
    if not (readable(s, g, v, x, unread) and readable(s, g, v, y, unread)):
        return "not read"
    X, Y = norm.get((s, g, v, x), {}), norm.get((s, g, v, y), {})
    d = [math.log(X[r][stage] / Y[r][stage]) for r in X if r in Y]
    if median_interval(d)[1] is None:
        return "not read"
    return {"A": "x", "B": "y"}.get(decided(d)[0], "not resolved")


def stage_bytes(e, g, v):
    """{carrier: {stage: bytes}}: in order, cumulative to each stage; a jump, the mean over i = 0 … F − 2 of what
    showing i from nothing needs, cumulative too."""
    c = e["g"][str(g)]
    F, H, low = e["frames"], e["htj2k_bytes"], e.get("low_bytes")
    P, V, R = c["preview"]["units"], c["vl"][str(v)]["units"], c["vl"][str(v)]["residual_units"]
    n = c["snr"][str(v)]
    L1, L12, Rs = n["layers"]["preview"]["units"], n["layers"]["vl"]["units"], n["residual_units"]
    B, T = c["svc"]["base"]["units"], c["svc"]["full"]["units"]
    lo = low or [0] * F
    key = lambda i: i - i % g  # noqa: E731
    run = lambda u, i: sum(u[key(i):i + 1])  # noqa: E731
    jump = lambda f: statistics.mean(f(i) for i in range(F - 1))  # noqa: E731
    two = lambda p, pv, r: (p[0], sum(p), sum(pv), sum(pv) + sum(r))  # noqa: E731
    out = {
        "snr": (*two(L1, L12, Rs), jump(lambda i: run(L1, i)), jump(lambda i: run(L12, i)), jump(lambda i: run(L12, i) + Rs[i])),
        "two": (*two(P, P + V, R), jump(lambda i: run(P, i)), jump(lambda i: run(P, i) + run(V, i)),
                jump(lambda i: run(P, i) + run(V, i) + R[i])),
        "one": (V[0], sum(V), sum(V), sum(V) + sum(R), jump(lambda i: run(V, i)), jump(lambda i: run(V, i)),
                jump(lambda i: run(V, i) + R[i])),
        "sep": (*two(P, P + V, H), jump(lambda i: run(P, i)), jump(lambda i: run(P, i) + run(V, i)),
                jump(lambda i: run(P, i) + run(V, i) + H[i])),
        "svc": (B[0], sum(B), sum(T) + sum(lo), sum(T) + sum(lo), jump(lambda i: run(B, i)),
                jump(lambda i: run(T, i) + lo[i]), jump(lambda i: run(T, i) + lo[i])),
        "htj2k": (H[0], sum(H), sum(H), sum(H), jump(lambda i: H[i]), jump(lambda i: H[i]), jump(lambda i: H[i])),
    }
    return {k: dict(zip(STAGES, x)) for k, x in out.items()}


def label(doms):
    """doms: per stage (t dominates x, x dominates t, read). 'better', 'worse', 'a trade', 'neither dominates', or
    'not read' when an unread stage could change the label (a trade cannot be changed by one)."""
    t = any(a for a, _, r in doms if r)
    x = any(b for _, b, r in doms if r)
    got = "a trade" if t and x else "better" if t else "worse" if x else "neither dominates"
    return got if got == "a trade" or all(r for *_, r in doms) else "not read"


def judge(norm, s, g, v, nbytes, unread):
    """Per stage, each carrier's state among all six; and per (two-layer, alternative), its label and the stages each dominates."""
    states, doms = {}, defaultdict(list)
    for stage in STAGES:
        table = [{"name": c, "bytes": nbytes[c][stage],
                  "times": {o: {stage: pair(norm, s, g, v, c, o, stage, unread)} for o in CARRIERS if o != c}} for c in CARRIERS]
        by = {c["name"]: c for c in table}
        states[stage] = {c["name"]: status(c, table) for c in table}
        for t, x in PAIRS:
            read = "not read" not in by[t]["times"][x].values()
            doms[(t, x)].append((dominates(by[t], by[x]), dominates(by[x], by[t]), read))
    return states, {k: (label(d), [st for st, (a, _, _) in zip(STAGES, d) if a], [st for st, (_, b, _) in zip(STAGES, d) if b])
                    for k, d in doms.items()}


def reported(cells, e, s, g, v):
    """Beside the rule: each layer's in-window PSNR on both encoders, and per-frame decodes in HTJ2K-frame units."""
    c = e["g"][str(g)]
    q = lambda x: f"{x['quality']['psnr_in']:.2f}"  # noqa: E731
    n = c["snr"][str(v)]["layers"]
    lines = [f"in-window PSNR, aomenc · quality layers: preview {q(c['preview'])} · {q(n['preview'])} dB, "
             f"visually lossless {q(c['vl'][str(v)])} · {q(n['vl'])} dB (quantizers {c['snr'][str(v)]['q']})"]
    per = defaultdict(list)
    for (s2, g2, v2, _), a in cells.items():
        if (s2, g2, v2) != (s, g, v) or "ctrl" not in a:
            continue
        ref = statistics.median(a["ctrl"]["cine-exact"][0]["ms"])
        for arm in ("snr", "two"):
            if arm in a:
                per[f"{arm} preview frame"].append(statistics.median(a[arm]["preview"][0]["ms"]) / ref)
                per[f"{arm} VL frame"].append(statistics.median(a[arm]["vl"][0]["ms"]) / ref)
                per[f"{arm} residual decode"].append(statistics.mean(x["decode"] for x in a[arm]["residual"]) / ref)
                per[f"{arm} add"].append(statistics.mean(x["add"] for x in a[arm]["residual"]) / ref)
    if per:
        lines.append("per frame, median over rounds: " + "; ".join(f"{k} {statistics.median(x):.3g}" for k, x in per.items()))
    return lines


def median_of(norm, key, stage):
    v = [x[stage] for x in norm.get(key, {}).values()]
    return (statistics.median(v) if v else None), len(v)


def main():
    indexes, (rows, voids) = sorted(glob.glob(sys.argv[1] + "*.json")), load(sys.argv[2:])
    cells = arms(rows)
    norm, gate, effects = normalized(cells), aa(cells), order_effects(cells, rows)
    unread = unread_blocks(gate, effects)
    print(f"## SNR preview, collected\n\nrounds {len({r['round'] for r in rows})}; VOID blocks {voids}\n")
    print("| volume · G · VL rung | A/A: median log (interval), n | A/A | arms flagged by order (p) |\n| --- | --- | --- | --- |")
    for b, (med, lo, hi, n) in sorted(gate.items()):
        flagged = [f"{a} ({p:.3g})" for (*b2, a), (p, f) in sorted(effects.items()) if tuple(b2) == b and f]
        state = "n < 6: not read" if lo is None else "passes" if lo <= 0 <= hi else "fails: not read"
        print(f"| {b[0]} · {b[1]} · {b[2]} | {med:+.4f} ({lo and round(lo, 4)}, {hi and round(hi, 4)}), {n} | {state} |"
              f" {', '.join(flagged) or '—'} |")
    failing = sum(lo is not None and not lo <= 0 <= hi for _, lo, hi, _ in gate.values())
    print(f"\nA/A decided (interval excludes 0) in {failing} of {sum(x[1] is not None for x in gate.values())} readable blocks")
    verdicts = defaultdict(dict)
    for idx in indexes:
        e = json.loads(Path(idx).read_text())
        s = e["name"]
        for g in sorted(map(int, e["g"])):
            for v in (4, 8):
                nbytes = stage_bytes(e, g, v)
                states, labels = judge(norm, s, g, v, nbytes, unread)
                print(f"\n## {s} · G {g} · visually lossless rung Q {v}\n")
                print("| stage | " + " | ".join(CARRIERS) + " |\n| --- |" + " --: |" * len(CARRIERS))
                for stage in STAGES:
                    cells_ = []
                    for c in CARRIERS:
                        m, n = median_of(norm, (s, g, v, c), stage)
                        mark = {"on the frontier": "", "dominated": " ✗", "not read": " ?"}[states[stage][c]]
                        cells_.append(f"{nbytes[c][stage]:.0f} B · {'—' if m is None else f'{m:.3g}'}{mark}")
                    print(f"| {stage} | " + " | ".join(cells_) + " |")
                print("\nbytes · median time ÷ the block's HTJ2K frame; ✗ dominated, ? not read, n per carrier "
                      + ", ".join(f"{c} {median_of(norm, (s, g, v, c), STAGES[0])[1]}" for c in CARRIERS) + "\n")
                for line in reported(cells, e, s, g, v):
                    print(f"*Reported:* {line}\n")
                for (t, x), (lab, won, lost) in labels.items():
                    verdicts[(t, x, g, v)][s] = lab
                    print(f"* **{t} against {x}: {lab}** — {t} dominates at {', '.join(won) or 'no stage'}; "
                          f"{x} dominates at {', '.join(lost) or 'no stage'}")
    print("\n## The answer, per two-layer carrier, alternative, G and rung\n")
    print("| two-layer | against | G | VL rung | " + " | ".join(sorted({s for d in verdicts.values() for s in d}))
          + " | on these three volumes |\n| --- | --- | --: | --: |" + " --- |" * 4)
    for (t, x, g, v), by in sorted(verdicts.items()):
        same = len(set(by.values())) == 1 and len(by) == 3
        print(f"| {t} | {x} | {g} | {v} | " + " | ".join(by[s] for s in sorted(by)) + f" | {next(iter(by.values())) if same else 'differs'} |")


if __name__ == "__main__":
    main()
