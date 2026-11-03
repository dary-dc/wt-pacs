#!/usr/bin/env python3
"""The seven tables of docs/av1/README.md §The scalable preview as a tool, 10, from the fill rows (run.mjs --per-frame),
the layer errors (layer_error.py) and the offline decode rounds (time.mjs --protocol), and the rule of 5 on the cells run.

Every time is the median over a cell's kept visits with its p25–p75 beside it, from the fill's issue. A ratio is
round-paired. Layers rank base < middle < exact (HTJ2K: prefix < exact); a frame is "at ℓ or better" from the first
picture it has at ℓ or above.

usage: svc_tables.py ROWS.jsonl FRAMES_DIR [--errors E.jsonl] [--decode D.json] [--aa ROWS.jsonl]
       — lab/av1/delivery/scalable/tool/README.md §SVC metrics
"""
import argparse
import json
import statistics
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[4] / "scripts"))
import aa_rule  # noqa: E402

VARIANTS = ["htj2k", "htj2k-aa", "res", "k2", "a2-q20", "a2-q40", "p2-q20", "p2-q40", "p3-m10", "p3-m20", "p3-m30",
            "lossy-q20", "lossy-m20"]
LOSSY = {"lossy-q20", "lossy-m20"}
SHAPES = ["a2-q20", "a2-q40", "p2-q20", "p2-q40", "p3-m10", "p3-m20", "p3-m30"]
STALL_MS = 10_000
LINKS = ["none", "r20000", "r50000", "r5000", "r20000-l2", "r20000-j20"]


def layers_of(v):
    if v == "res":
        return ["prefix", "exact"]
    if v.startswith("p3"):
        return ["base", "middle", "exact"]
    if v == "lossy-m20":
        return ["base", "middle"]
    if v == "lossy-q20":
        return ["base"]
    if v[:2] in ("a2", "p2"):
        return ["base", "exact"]
    return ["exact"]


def q(v, p):
    s = sorted(v)
    k = (len(s) - 1) * p
    lo = int(k)
    return s[lo] + (s[min(lo + 1, len(s) - 1)] - s[lo]) * (k - lo)


def fmt_s(v):
    return "—" if v is None else f"{v / 1000:.2f}" if v < 10_000 else f"{v / 1000:.1f}"


def span(v, f=fmt_s):
    v = [x for x in v if x is not None]
    if not v:
        return "—"
    return f"{f(statistics.median(v))} [{f(q(v, .25))}–{f(q(v, .75))}]" if len(v) > 1 else f(v[0])


def ratio_fmt(x):
    return f"{x:.3f}"


def pct(x):
    return f"{100 * x:.0f} %"


def per_frame(row):
    """Each layer's per-frame times, ms from the issue: None where the frame never had that layer."""
    out = {}
    if "exactMs" in row and row["variant"] not in LOSSY:
        out["exact"] = row["exactMs"]
    if row["variant"] == "res":
        out["prefix"] = row.get("previewMs")
    for layer in ("base", "middle"):
        if f"{layer}Ms" in row:
            out[layer] = row[f"{layer}Ms"]
    return out


def at_or_better(row, layer):
    """Per frame, the first time it had a picture at `layer` or above."""
    lay = layers_of(row["variant"])
    frames = per_frame(row)
    above = lay[lay.index(layer):]
    n = len(next(iter(frames.values())))
    out = []
    for i in range(n):
        t = [frames[ell][i] for ell in above if frames.get(ell) and frames[ell][i] is not None]
        out.append(min(t) if t else None)
    return out


def t_all(times):
    return None if not times or None in times else max(times)


def load(path):
    rows = [json.loads(line) for line in Path(path).read_text().splitlines() if line.strip()]
    for r in rows:
        r["cell"] = (r["set"], r["link"] + ("" if r.get("impairment", "clean") == "clean" else "-" + r["impairment"]), r["throttle"])
    return rows


def kept(rows):
    return [r for r in rows if not r["void"] and (r.get("frames") or r.get("previews"))]


class Cells:
    def __init__(self, rows):
        self.all = rows
        self.kept = kept(rows)
        self.frames = {}
        for r in rows:
            if r.get("exactMs"):
                self.frames[r["set"]] = len(r["exactMs"])
        self.cells = sorted({r["cell"] for r in rows}, key=lambda c: (c[0], LINKS.index(c[1]) if c[1] in LINKS else 9, c[2]))

    def owed(self, r):
        """Exact frames a visit owes: its series' F, none for a lossy-only one."""
        return 0 if r["variant"] in LOSSY else self.frames[r["set"]]

    def visits(self, cell, v, keep=True):
        return [r for r in (self.kept if keep else self.all) if r["cell"] == cell and r["variant"] == v]

    def by_round(self, cell, v):
        return {r["round"]: r for r in self.visits(cell, v)}

    def htj2k_tx(self, cell):
        return {k: t_all(at_or_better(r, "exact")) for k, r in self.by_round(cell, "htj2k").items()}


def table(title, headline, cols, rows):
    out = [f"#### {title}", "", headline, "", "| series, link, CPU | " + " | ".join(f"`{c}`" for c in cols) + " |",
           "| --- |" + " --- |" * len(cols)]
    out += [f"| {k} | " + " | ".join(row) + " |" for k, row in rows]
    return "\n".join(out)


def cell_name(cell):
    s, link, cpu = cell
    return f"`{s}` {link} {cpu}×"


def headline_cells(cells):
    return [c for c in cells if c[1] in ("none", "r20000")]


def metric1(C):
    rows = []
    for c in C.cells:
        rows.append((cell_name(c), [span([r["firstMs"] for r in C.visits(c, v)]) for v in VARIANTS]))
    return rows


def metric2(C):
    """Per layer: t_first · t_all; t_all ÷ own t_X; shares at 25/50/75 % of HTJ2K's t_X; scroll at 5/15/30 slices/s."""
    a, b, sh, sc = [], [], [], []
    for c in C.cells:
        hx = C.htj2k_tx(c)
        hx_med = statistics.median([x for x in hx.values() if x is not None]) if any(hx.values()) else None
        ra, rb, rs, rc = [], [], [], []
        for v in VARIANTS:
            vs = C.visits(c, v)
            pa, pb, ps, pc = [], [], [], []
            for ell in layers_of(v):
                per = [at_or_better(r, ell) for r in vs]
                first = [min((t for t in p if t is not None), default=None) for p in per]
                every = [t_all(p) for p in per]
                pa.append(f"{ell[0]} {span(first)} · {span(every)}")
                if "exact" in layers_of(v) and ell != "exact":
                    own = [t_all(at_or_better(r, "exact")) for r in vs]
                    pb.append(f"{ell[0]} " + span([e / x for e, x in zip(every, own) if e and x], ratio_fmt))
                shares = []
                for frac in (.25, .5, .75):
                    got = []
                    for r, p in zip(vs, per):
                        ref = hx.get(r["round"]) or hx_med
                        if ref:
                            got.append(sum(t is not None and t <= frac * ref for t in p) / len(p))
                    shares.append(pct(statistics.median(got)) if got else "—")
                ps.append(f"{ell[0]} " + "/".join(shares))
                scroll = []
                for speed in (5, 15, 30):
                    got = [sum(t is not None and t <= 1000 * i / speed for i, t in enumerate(p)) / len(p) for p in per]
                    scroll.append(pct(statistics.median(got)) if got else "—")
                pc.append(f"{ell[0]} " + "/".join(scroll))
            ra.append("<br>".join(pa) if vs else "—")
            rb.append("<br>".join(pb) if pb else "n/a")
            rs.append("<br>".join(ps) if vs else "—")
            rc.append("<br>".join(pc) if vs else "—")
        a.append((cell_name(c), ra))
        b.append((cell_name(c), rb))
        sh.append((cell_name(c), rs))
        sc.append((cell_name(c), rc))
    return a, b, sh, sc


def metric4(C):
    rows = []
    for c in C.cells:
        out = []
        for v in VARIANTS:
            if v in LOSSY:
                out.append("n/a")
                continue
            vs = C.visits(c, v)
            tx = [t_all(at_or_better(r, "exact")) for r in vs]
            med = [statistics.median([t for t in r["exactMs"] if t is not None]) for r in vs if any(r["exactMs"])]
            p95 = [q([t for t in r["exactMs"] if t is not None], .95) for r in vs if any(r["exactMs"])]
            out.append(f"{span(tx)}<br>x̃ {span(med)} · p95 {span(p95)}")
        rows.append((cell_name(c), out))
    return rows


def decode_ms(r, layer):
    key = {"exact": "exactDecodeMs", "base": "baseDecodeMs", "middle": "middleDecodeMs", "prefix": "baseDecodeMs"}[layer]
    return [x for x in r.get(key) or [] if x is not None]


def metric5(C):
    rows = []
    for c in C.cells:
        out = []
        for v in VARIANTS:
            vs = C.visits(c, v)
            parts = []
            for ell in layers_of(v):
                if ell == "prefix":
                    continue
                per = [statistics.median(decode_ms(r, ell)) for r in vs if decode_ms(r, ell)]
                paths = sorted({p for r in vs for p in (r.get("exactPath") or []) if p}) if ell == "exact" else ["dav1d-WASM"]
                parts.append(f"{ell[0]} {span(per, lambda x: f'{x:.1f}')} ({', '.join(paths)})")
            out.append("<br>".join(parts) if vs else "—")
        rows.append((cell_name(c), out))
    return rows


def metric6(C):
    rows = []
    for c in C.cells:
        out = []
        for v in VARIANTS:
            vs = C.visits(c, v)
            total = [sum(decode_ms(r, "exact") + decode_ms(r, "base") + decode_ms(r, "middle")) for r in vs]
            cpu = [r.get("cpuMs") for r in vs]
            out.append(f"{span(total)} · cpu {span(cpu)}" if vs else "—")
        rows.append((cell_name(c), out))
    return rows


def metric7(C):
    rows = []
    for c in C.cells:
        k2 = {r["round"]: r["wireBytes"] for r in C.visits(c, "k2") if r.get("wireBytes")}
        out = []
        for v in VARIANTS:
            vs = C.visits(c, v)
            if v in LOSSY:
                last = [r.get("lastByteMs") for r in vs]
                by = [r["wireBytes"] / k2[r["round"]] for r in vs if r["round"] in k2 and r.get("wireBytes")]
                out.append(f"n/a · byte {span(last)} · ÷k2 {span(by, lambda x: f'{x:.4f}')}" if vs else "—")
                continue
            tx = [t_all(at_or_better(r, "exact")) for r in vs]
            last = [r.get("lastByteMs") for r in vs]
            by = [r["wireBytes"] / k2[r["round"]] for r in vs if r["round"] in k2 and r.get("wireBytes")]
            out.append(f"{span(tx)} · byte {span(last)} · ÷k2 {span(by, lambda x: f'{x:.4f}')}" if vs else "—")
        rows.append((cell_name(c), out))
    return rows


def aa(C, c):
    """The A/A arm on t_X: its round-paired ratio to HTJ2K, and aa_rule.py's smallest change caught at this n."""
    ref = C.htj2k_tx(c)
    twin = {k: t_all(at_or_better(r, "exact")) for k, r in C.by_round(c, "htj2k-aa").items()}
    ratios = [twin[k] / ref[k] for k in ref if k in twin and ref[k] and twin[k]]
    if len(ratios) < 2:
        return f"A/A n = {len(ratios)}", None
    mdl = aa_rule.mdl(len(ratios), aa_rule.arm_sd(ratios)) if aa_rule.can_flag(len(ratios)) else None
    return (f"A/A {statistics.median(ratios):.3f} [{min(ratios):.3f}–{max(ratios):.3f}] n = {len(ratios)}, "
            + (f"resolution ±{100 * mdl:.1f} %" if mdl is not None else "n too small for aa_rule.py to flag")), mdl


def footer(C):
    lines = []
    for c in C.cells:
        allv = [r for r in C.all if r["cell"] == c]
        kv = [r for r in C.kept if r["cell"] == c]
        ns = sorted({len(C.visits(c, v)) for v in VARIANTS})
        exact = sum(r.get("exact", 0) for r in allv)
        owed = sum(C.owed(r) for r in allv)
        # The worker's stall bound: a unit that gave nothing in it was flushed (client/decode/av1-webcodecs.js).
        stalls = sum(x >= STALL_MS for r in allv for x in decode_ms(r, "exact"))
        base_ok = sum(r.get("previewExact", 0) or 0 for r in allv if r["variant"] not in ("res",))
        mid_ok = sum(r.get("middleExact", 0) or 0 for r in allv)
        late = sum(r.get("late", 0) or 0 for r in allv)
        strays = sum(r.get("strays", 0) or 0 for r in allv)
        lines.append(f"* {cell_name(c)}: n = {ns[0]}–{ns[-1]}, VOID {len(allv) - len(kv)} of {len(allv)}; exact {exact}/{owed};"
                     f" bases as native {base_ok}, middles as native {mid_ok}; late {late}, stray {strays}; stall-flushes {stalls}; {aa(C, c)[0]}")
    return "\n".join(lines)


# Part 5's links; `none` is the metrics protocol's own and outside the rule.
RULE_LINKS = ("r5000", "r20000", "r50000", "r20000-l2", "r20000-j20")


def both(a, b):
    """A clause over cells: False if any cell fails, None if none fails but one has no kept visit, else True."""
    return False if False in (a, b) else None if None in (a, b) else True


def rule(C, sets_run):
    """Part 5's clauses per shape and volume, layer-major (the only order here), on its cells that were run; a clause of
    a cell with no kept visit is undecided, and so is the t_P clause while a 5 or 20 Mbit/s cell of it was not run."""
    out = []
    for shape in SHAPES:
        per_set = {}
        for s in sets_run:
            cells = [c for c in C.cells if c[0] == s and c[1] in RULE_LINKS]
            got = dict(exact=True, tp=True, scroll=True, tx=True, bytes=True)
            notes = []
            got["exact"] = all(r.get("exact", 0) == C.owed(r) for c in cells for r in C.visits(c, shape))
            for need in (("r5000", 1), ("r5000", 4), ("r20000", 1), ("r20000", 4)):
                if (s, *need) not in C.cells:
                    got["tp"] = both(got["tp"], None)
            for c in cells:
                vs, hx, res, k2 = C.by_round(c, shape), C.htj2k_tx(c), C.by_round(c, "res"), C.by_round(c, "k2")
                if not vs:
                    for k in ("tp", "scroll", "tx", "bytes"):
                        got[k] = both(got[k], None) if k != "tp" or c[1] in ("r5000", "r20000") else got[k]
                    notes.append(f"{c[1]} {c[2]}×: no kept visit")
                    continue
                if c[1] in ("r5000", "r20000"):
                    tp = [t_all(at_or_better(r, "base")) / hx[k] for k, r in vs.items() if hx.get(k) and t_all(at_or_better(r, "base"))]
                    got["tp"] = both(got["tp"], (statistics.median(tp) <= 0.2) if tp else None)
                sc = [sum(t is not None and t <= 1000 * i / 15 for i, t in enumerate(at_or_better(r, "base"))) for r in vs.values()]
                sr = [sum(t is not None and t <= 1000 * i / 15 for i, t in enumerate(at_or_better(r, "prefix"))) for r in res.values()]
                got["scroll"] = both(got["scroll"], (statistics.median(sc) > statistics.median(sr)) if sr else None)
                tx = [t_all(at_or_better(r, "exact")) / t_all(at_or_better(k2[k], "exact")) for k, r in vs.items()
                      if k in k2 and t_all(at_or_better(r, "exact")) and t_all(at_or_better(k2[k], "exact"))]
                by = [r["wireBytes"] / k2[k]["wireBytes"] for k, r in vs.items() if k in k2 and r.get("wireBytes")]
                _, mdl = aa(C, c)
                if tx:
                    m = statistics.median(tx)
                    within = mdl is not None and m - 1.10 <= mdl
                    got["tx"] = both(got["tx"], True if m <= 1.10 else None if within or mdl is None else False)
                    if m > 1.10:
                        notes.append(f"{c[1]} {c[2]}×: t_X {m:.3f}× shipped" + (", within the A/A resolution" if within else ", A/A resolution unknown" if mdl is None else ""))
                else:
                    got["tx"] = both(got["tx"], None)
                if by:
                    m = statistics.median(by)
                    got["bytes"] = both(got["bytes"], m <= 1.02)
                    if m > 1.02:
                        notes.append(f"bytes {m:.3f}× shipped")
                else:
                    got["bytes"] = both(got["bytes"], None)
            per_set[s] = dict(got, notes=sorted(set(notes)))
        out.append((shape, per_set))
    return out


def error_tables(path):
    rows = [json.loads(line) for line in Path(path).read_text().splitlines() if line.strip()]
    out = []
    keys = sorted({(r["set"], r["variant"], r["layer"]) for r in rows}, key=lambda k: (k[0], SHAPES.index(k[1]), k[2] == "middle"))
    for at in ("own", "full"):
        lines = ["| series | variant | layer (size) | PSNR dB x̃ · p95 · worst | max abs Δ x̃ · p95 · worst | SSIM x̃ · p95 · worst |"
                 " windowed max abs Δ x̃ · p95 · worst | windowed share ≥ 1 · ≥ 2, x̃ |", "| --- |" + " --- |" * 7]
        for s, v, layer in keys:
            g = [r for r in rows if (r["set"], r["variant"], r["layer"]) == (s, v, layer)]
            m = lambda k: [r[at][k] for r in g]  # noqa: E731

            def three(vals, worse_high, f):
                worst = max(vals) if worse_high else min(vals)
                frame = g[vals.index(worst)]["frame"]
                p95 = q(vals, .95 if worse_high else .05)
                return f"{f(statistics.median(vals))} · {f(p95)} · {f(worst)} (#{frame})"
            lines.append(f"| `{s}` | `{v}` | {layer} ({g[0]['size'] if at == 'own' else 'upscaled'}) | "
                         f"{three(m('psnr'), False, lambda x: f'{x:.1f}')} | {three(m('max'), True, lambda x: f'{x:.1f}')} | "
                         f"{three(m('ssim'), False, lambda x: f'{x:.4f}')} | {three(m('win_max'), True, lambda x: f'{x:.0f}')} | "
                         f"{pct(statistics.median(m('win_ge1')))} · {pct(statistics.median(m('win_ge2')))} |")
        out.append(("at the layer's own size, against the source's box mean" if at == "own"
                     else "upscaled to the source's size by the viewer's bilinear, against the source", "\n".join(lines)))
    windows = sorted({(r["set"], json.dumps(r["window"], sort_keys=True)) for r in rows})
    return out, windows


def decode_table(path):
    rows = json.loads(Path(path).read_text())
    groups = {}
    for r in rows:
        groups.setdefault((r["throttle"], r["set"], r["variant"]), []).append(r)
    med = {k: statistics.median([x["ms"] for x in g]) for k, g in groups.items()}
    lines = ["| CPU, series | " + " | ".join(["k2 top + low", "HTJ2K"] + [f"`{v}` base · middle · whole" for v in
                                                                         ("p2-q20", "p2-q40", "p3-m10", "p3-m20", "p3-m30")]) + " |",
             "| --- |" + " --- |" * 7]
    checked = [0, 0]
    for g in groups.values():
        for x in g:
            if x["exact"] is not None:
                checked[0] += x["exact"]
                checked[1] += x["frames"]
    for t, s in sorted({(k[0], k[1]) for k in groups}):
        k2 = med[(t, s, "shipped")] + med[(t, s, "low")]
        h = med.get((t, s, "htj2k"))
        cells = [f"{k2:.1f} ms", f"{h:.1f} ms" if h else "—"]
        for v in ("p2-q20", "p2-q40", "p3-m10", "p3-m20", "p3-m30"):
            parts = []
            for layer in ("base", "middle", "all"):
                ms = med.get((t, s, f"{v}-{layer}"))
                if ms is None:
                    continue
                # A split top needs its low stream too, so a whole unit's exact frame costs both.
                whole = ms + (med[(t, s, "low")] if layer == "all" and s != "dbts_b1" else 0)
                parts.append(f"{whole:.1f} ({whole / k2:.2f}× k2, {whole / h:.2f}× HTJ2K)" if h else f"{whole:.1f}")
            cells.append(" · ".join(parts))
        lines.append(f"| {t}× `{s}` | " + " | ".join(cells) + " |")
    n = max(len(g) for g in groups.values())
    return "\n".join(lines), checked, n


RATE = {"r5000": 5e6, "r20000": 20e6, "r50000": 50e6, "r20000-l2": 20e6, "r20000-j20": 20e6, "none": float("inf")}


def model(C, frames_dir, decode_path):
    """Part 2's model, t₀ left out: t_P = max(βH/R, F·d_b) on one decoder; t_X = max((β + s)·H/R, F·d_x/m), m = 3."""
    rows = json.loads(Path(decode_path).read_text())
    med = {}
    for r in rows:
        med.setdefault((r["throttle"], r["set"], r["variant"]), []).append(r["ms"])
    med = {k: statistics.median(v) for k, v in med.items()}
    out = []
    for c in C.cells:
        s, link, cpu = c
        meta = json.loads((Path(frames_dir) / s / "variants.json").read_text())
        F = meta["frames"]
        low = med[(cpu, s, "low")] if s != "dbts_b1" else 0
        parts = []
        for v in SHAPES:
            a = meta["variants"][v]
            size = lambda i: (Path(frames_dir) / s / f"{i:03d}.{a['ext']}").stat().st_size  # noqa: E731
            base = sum(size(i) for i in range(F))
            exact = sum(size(a["exactAt"] + i) for i in range(F)) + (sum(size(a["middleAt"] + i) for i in range(F)) if "middleAt" in a else 0)
            shape = "p2-q20" if v == "a2-q20" else "p2-q40" if v == "a2-q40" else v
            d_b = med[(cpu, s, f"{shape}-base")]
            d_x = med[(cpu, s, "shipped")] + med[(cpu, s, "low")] if v.startswith("a2") else med[(cpu, s, f"{shape}-all")] + low
            R = RATE.get(link, float("inf")) / 8 / 1000  # bytes a ms
            tp, tx = max(base / R, F * d_b), max((base + exact) / R, F * d_x / 3)
            vs = C.visits(c, v)
            mp = [t_all(at_or_better(r, "base")) for r in vs]
            mx = [t_all(at_or_better(r, "exact")) for r in vs]
            mp, mx = [x for x in mp if x], [x for x in mx if x]
            parts.append(f"{fmt_s(tp)} / {fmt_s(statistics.median(mp)) if mp else '—'} · {fmt_s(tx)} / {fmt_s(statistics.median(mx)) if mx else '—'}")
        out.append((cell_name(c), parts))
    return out


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("rows")
    ap.add_argument("frames")
    ap.add_argument("--errors")
    ap.add_argument("--decode")
    a = ap.parse_args()
    C = Cells(load(a.rows))
    sets_run = sorted({c[0] for c in C.cells})
    print(f"Visits {len(C.all)}, kept {len(C.kept)}, VOID {len(C.all) - len(C.kept)}; cells {len(C.cells)}.\n")
    print(table("1 · First picture, s", "", VARIANTS, metric1(C)))
    t2a, t2b, t2c, t2d = metric2(C)
    print()
    print(table("2a · Useful pictures by layer: t_first · t_all, s (b base, m middle, p prefix, x exact)", "", VARIANTS, t2a))
    print()
    print(table("2b · t_ℓ,all ÷ the variant's own t_X", "", VARIANTS, t2b))
    print()
    print(table("2c · Share of slices at ℓ or better at 25 / 50 / 75 % of HTJ2K's t_X", "", VARIANTS, t2c))
    print()
    print(table("2d · Share of slices at ℓ or better when reached, scrolling from slice 0 at 5 / 15 / 30 slices/s", "", VARIANTS, t2d))
    if a.errors:
        tabs, windows = error_tables(a.errors)
        for name, t in tabs:
            print(f"\n#### 3 · Error of each lossy layer, {name}\n\n{t}")
        print("\nWindows: " + "; ".join(f"`{s}` {w}" for s, w in windows))
    print()
    print(table("4 · Time to exact: t_X, s; each frame's t_x median · p95", "", VARIANTS, metric4(C)))
    print()
    print(table("5 · Per-frame decode, ms, by layer and path (in the fill)", "", VARIANTS, metric5(C)))
    if a.decode:
        t, checked, n = decode_table(a.decode)
        print(f"\n#### 5 offline · ms a frame, one decoder in order, first 8 units, median of {n} rounds; exact {checked[0]}/{checked[1]}\n\n{t}")
    print()
    print(table("6 · Total decode: the fill's per-frame decode sum, s · the decoders' CPU, s", "", VARIANTS, metric6(C)))
    print()
    print(table("7 · Total fill: to the last exact frame drawn · to the last byte, s · wire bytes ÷ k2's", "", VARIANTS, metric7(C)))
    if a.decode:
        print()
        print(table("Part 2's model against the measured: t_P model / measured · t_X model / measured, s", "", SHAPES,
                    model(C, a.frames, a.decode)))
    print("\n#### Per cell\n")
    print(footer(C))
    print("\n#### Part 5's rule on the cells run\n")
    word = {True: "pass", False: "FAIL", None: "undecided"}
    print("| shape | " + " | ".join(f"`{s}` exact · t_P ≤ 0.2 · scroll 15 · t_X ≤ 1.10 · bytes ≤ 1.02" for s in sets_run) + " | volumes passing every clause |")
    print("| --- |" + " --- |" * (len(sets_run) + 1))
    for shape, per_set in rule(C, sets_run):
        passing = sum(all(p[k] is True for k in ("exact", "tp", "scroll", "tx", "bytes")) for p in per_set.values())
        failing = sum(any(p[k] is False for k in ("exact", "tp", "scroll", "tx", "bytes")) for p in per_set.values())
        cells = [" · ".join(word[p[k]] for k in ("exact", "tp", "scroll", "tx", "bytes")) + (f" ({'; '.join(p['notes'])})" if p["notes"] else "")
                 for p in per_set.values()]
        print(f"| `{shape}` | " + " | ".join(cells) + f" | {passing} pass, {failing} fail, {len(per_set) - passing - failing} undecided |")


if __name__ == "__main__":
    main()
