#!/usr/bin/env python3
"""docs/av1/noise-point.md §8, run as pre-registered: the AC-table check, the held-out arms, P2–P6 and the mutations.

usage: noise_point.py BUILD WORK OUT_DIR DATA STEP      STEP: tables | predict | arms | sigma | tiles | noise | headers
"""
import json
import re
import sys
import time
from concurrent.futures import ProcessPoolExecutor
from html import unescape
from pathlib import Path

import numpy as np

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE))
import cell  # noqa: E402
import collect  # noqa: E402
import quality  # noqa: E402
from cell import ROOT, Middle, aomenc_args, child, display, display_windows, forms, order, planes, write_y4m, \
    y4m_frames  # noqa: E402

LADDER = [1, 2, 4, 8, 12, 16, 24, 32, 40, 56]
X_STAR = {1: 4.9293, 16: 4.6359}
X_HI = 6.69
HELD_OUT = ["dbts_a3", "dbts_a4", "dbts_a5", "dbts_b4", "dbt10_d"]
TIMED = ["dbts_a1", "dbts_b1", "dbts_c1"]
IN_SAMPLE = ["dbts_a1", "dbts_a2", "dbts_b1", "dbts_b2", "dbts_b3", "dbts_b5", "dbts_c1", "dbts_c2", "dbts_c3",
             "dbts_c4", "dbts_c5", "dbt10_ea1141", "dbt12_ea1141", "dbt12_c"]
TILE = 64
LIMIT = 1.03
PREDICTED = {"dbts_a3": (8, 8, 8, 8), "dbts_a4": (8, 8, 8, 8), "dbts_a5": (4, 4, 7, 7), "dbts_b4": (12, 12, 13, 12),
             "dbt10_d": (8, 8, 9, 9)}
SRC = ROOT / "lab/.av1-build/aom-3.15.1-src"


def c_table(text, name):
    body = re.search(rf"{name}\[[^\]]*\]\s*=\s*\{{(.*?)\}};", text, re.S).group(1)
    return [int(v) for v in re.findall(r"-?\d+", body)]


def libaom_ac():
    text = (SRC / "av1/common/quant_common.c").read_text()
    return {8: c_table(text, "ac_qlookup_QTX"), 10: c_table(text, "ac_qlookup_10_QTX"),
            12: c_table(text, "ac_qlookup_12_QTX")}


def qindex():
    return c_table((SRC / "av1/encoder/av1_quantize.c").read_text(), "quantizer_to_qindex")


def spec_ac(html):
    """Ac_Qlookup[3][256] as the AV1 specification's §Dequantization functions prints it: 8, 10, 12 bits."""
    text = unescape(re.sub(r"<[^>]+>", "", html))
    at = text.index("Ac_Qlookup is defined as follows")
    body = text[text.index("{", at):]
    values = [int(v) for v in re.findall(r"\d+", body[:body.index("}\n}") + 3])]
    assert len(values) == 3 * 256, len(values)
    return {8: values[:256], 10: values[256:512], 12: values[512:]}


def tables_equal(a, b):
    return {d: [i for i in range(256) if a[d][i] != b[d][i]] for d in (8, 10, 12)}


AC, QINDEX = None, None


def delta(q, depth, table=None):
    return (table or AC)[depth][QINDEX[q]] / 8


def rule(sigma_min, g, depth, ladder=True, table_depth=None):
    """§4 step 3: the highest Q with Δ ÷ σ_min < x*; None when not even Q 1 qualifies."""
    qs = LADDER if ladder else range(1, 62)
    ok = [q for q in qs if delta(q, table_depth or depth) < X_STAR[1 if g == 1 else 16] * sigma_min]
    return max(ok) if ok else None


def load_rows(paths):
    series, cells, controls = {}, {}, {}
    for p in paths:
        for line in open(p):
            r = json.loads(line)
            if r["kind"] == "series":
                series[r["set"]] = r
            elif r["kind"] == "cell":
                cells[(r["set"], r["form"], r["q"], r["g"])] = r
            elif r["kind"] == "control" and r["codec"] == "htj2k":
                controls[r["set"]] = sum(r["bytes"])
    return series, cells, controls


def stream(s, form):
    """σ_min and B in stream units for a stored or top-10 form."""
    sig = min(s["sigma"])
    return (sig / 2 ** (s["b"] - 10), 10) if form == "top10" else (sig, 10 if s["b"] in (9, 10) else s["b"])


def form_names(s):
    return [f"{s['b']}bit"] + (["top10"] if s["b"] > 10 else [])


def anchor(series, cells, name, form, g):
    pts = [dict(q=q, **collect.summary(series[name], r)) for (n, f, q, gg), r in cells.items()
           if (n, f, gg) == (name, form, g)]
    return collect.highest(pts, lambda p: p["nb_sigma_max"] <= 1), pts


def step_tables(a):
    html = (a.work / "av1-spec.html").read_text()
    spec, ours = spec_ac(html), libaom_ac()
    moved = {d: list(t) for d, t in ours.items()}
    moved[12][4 * 8] += 1
    out = dict(spec="https://aomediacodec.github.io/av1-spec/ §Dequantization functions, Ac_Qlookup",
               libaom="v3.15.1 av1/common/quant_common.c ac_qlookup_QTX, _10_, _12_",
               as_run=dict(differs=tables_equal(ours, spec), held=not any(tables_equal(ours, spec).values())),
               mutated=dict(entry="12-bit, qindex 32 (Q 8), +1", differs=tables_equal(moved, spec),
                            held=not any(tables_equal(moved, spec).values())),
               qindex=QINDEX[:62], qindex_is_4q=all(QINDEX[q] == 4 * q for q in range(62)))
    out["sees_it"] = out["as_run"]["held"] and not out["mutated"]["held"]
    (a.out / "ac-table.json").write_text(json.dumps(out, indent=1))
    print(json.dumps({k: v for k, v in out.items() if k != "qindex"}))


def step_predict(a):
    rows = HERE / "rows"
    series, cells, controls = load_rows([rows / f"shard-{k}.jsonl" for k in (1, 2, 3, 4)])
    held = []
    for name in HELD_OUT:
        sig, depth = stream(series[name], form_names(series[name])[0])
        got = (rule(sig, 1, depth), rule(sig, 16, depth), rule(sig, 1, depth, False), rule(sig, 16, depth, False))
        nxt = LADDER[LADDER.index(got[0]) + 1]
        held.append(dict(set=name, depth=depth, sigma_min=sig, ladder_g1=got[0], ladder_g16=got[1], integer_g1=got[2],
                         integer_g16=got[3], edge_next=nxt, edge_x=delta(nxt, depth) / sig,
                         edge_band=delta(nxt, depth) / sig < X_HI, matches_doc=got == PREDICTED[name],
                         mutated_8bit=(rule(sig, 1, depth, table_depth=8), rule(sig, 16, depth, table_depth=8))))
    in_sample = []
    for name in IN_SAMPLE:
        s = series[name]
        for form in form_names(s):
            sig, depth = stream(s, form)
            med = np.median(s["sigma"]) / (2 ** (s["b"] - 10) if form == "top10" else 1)
            for g in (1, 8, 16):
                anc, _ = anchor(series, cells, name, form, g)
                in_sample.append(dict(set=name, form=form, g=g, anchor=anc, rule=rule(sig, g, depth),
                                      rule_median=rule(med, g, depth)))
    out = dict(held_out=held, in_sample=in_sample)
    (a.out / "predict.json").write_text(json.dumps(out, indent=1))
    for h in held:
        print(h)
    for r in in_sample:
        if r["rule"] != r["anchor"] or r["rule_median"] != r["anchor"]:
            print(r)


def arm_qs(name):
    g1, g16, i1, i16 = PREDICTED[name]
    k = LADDER.index(g1)
    rungs = [LADDER[k - 1], g1, LADDER[k + 1], LADDER[k + 2]]
    return {1: sorted({*rungs, i1, i1 + 1}), 16: sorted({*rungs, i16, i16 + 1})}


def step_arms(a):
    out = a.out / "arms.jsonl"
    done = set()
    if out.exists():
        done = {(r["set"], r["q"], r["g"]) for r in map(json.loads, out.open()) if r["kind"] == "cell"}
    todo = []
    for k, name in enumerate(HELD_OUT):
        path = a.data / name
        s = Middle(path, 0)
        meta = display_windows(ROOT / "lab/av1/data.json", s.name, path.parent)
        (a.work / f"{s.name}.display.json").write_text(json.dumps(meta))
        form = forms(s, meta["windows"])[0].name
        units = [(q, g) for g, qs in arm_qs(name).items() for q in qs]
        todo += [(a.build, str(a.work), str(path), form, q, g, None) for q, g in order(units, k)
                 if (name, q, g) not in done]
    print(f"{len(todo)} cells", flush=True)
    with open(out, "a") as fh, ProcessPoolExecutor(a.jobs) as pool:
        for row in pool.map(cell.cell, todo):
            fh.write(json.dumps(row) + "\n")
            fh.flush()
            print(row["set"], f"Q{row['q']}", f"G{row['g']}", sum(row["units"]), f"{row['cell_wall']:.0f} s", flush=True)


def frame_sigma(s, tables, i):
    v = s.frame(i).astype(np.int32) + s.offset
    inside = [(tables[0][p - s.offset] > 0) & (tables[0][p - s.offset] < 255) for p in planes(v)]
    return float(np.median([quality.sigma(p, m) for p, m in zip(planes(v), inside)]))


def timed_sigma(path, work, every):
    s = Middle(Path(path), 0)
    meta = json.loads((Path(work) / f"{s.name}.display.json").read_text())
    tables = display(meta, (1 << s.b) - 1)
    t0 = time.process_time()
    sig = [frame_sigma(s, tables, i) for i in range(0, s.n, every)]
    return sig, time.process_time() - t0, s.n * s.w * s.h / 1e6


def step_sigma(a):
    """P2: σ over every frame and over every fourth, interleaved in a Williams order, CPU s of one process."""
    rows = HERE / "rows"
    series, _, _ = load_rows([rows / f"shard-{k}.jsonl" for k in (1, 2, 3, 4)])
    timings = []
    for name in TIMED:
        path = a.data / name
        meta = display_windows(ROOT / "lab/av1/data.json", name, path.parent)
        (a.work / f"{name}.display.json").write_text(json.dumps(meta))
    units = [(name, every) for name in TIMED for every in (1, 4)]
    for rnd in range(5):
        for name, every in order(units, rnd):
            sig, cpu, mpx = timed_sigma(a.data / name, a.work, every)
            same = np.allclose(sig, series[name]["sigma"][::every], rtol=0, atol=1e-9)
            timings.append(dict(round=rnd, set=name, every=every, cpu=cpu, mpx=mpx, matches_rows=bool(same)))
            print(timings[-1], flush=True)
    picks = []
    for name in IN_SAMPLE + HELD_OUT:
        s = series[name]
        for form in form_names(s) if name in IN_SAMPLE else form_names(s)[:1]:
            full, depth = stream(s, form)
            quarter = stream(dict(s, sigma=s["sigma"][::4]), form)[0]
            for g in (1, 16):
                picks.append(dict(set=name, form=form, g=g, all=rule(full, g, depth), every4=rule(quarter, g, depth),
                                  all_int=rule(full, g, depth, False), every4_int=rule(quarter, g, depth, False)))
    (a.out / "sigma-time.json").write_text(json.dumps(dict(timings=timings, picks=picks), indent=1))


def coded(a, s, form, q, g, tmp):
    """The cell's encode and decode, as cell.py runs them; returns the decoded y4m and the coded bytes."""
    tmp.mkdir(parents=True, exist_ok=True)
    y4m, ivf, dec = tmp / "in.y4m", tmp / "out.ivf", tmp / "dec.y4m"
    write_y4m(s, form, y4m)
    child([a.build / "aom-3.15.1/bin/aomenc", "-o", ivf, f"--limit={s.n}", "--q-hist=64", "--disable-warning-prompt",
           *aomenc_args(form, q, g, s.n), y4m])
    y4m.unlink()
    child([a.build / "dav1d/bin/dav1d", "-q", "--threads=1", "-i", ivf, "-o", dec])
    return dec, ivf.stat().st_size


def tile_stats(v, x, inside, shift=0):
    """Per 64 × 64 tile wholly in-window: σ, e_N and mean signal; shift moves the tile mask by that many tiles."""
    d = (x - v).astype(np.float64)
    h, w = v.shape[0] // TILE, v.shape[1] // TILE
    whole = inside[:h * TILE, :w * TILE].reshape(h, TILE, w, TILE).all(axis=(1, 3))
    whole = np.roll(whole, shift, axis=1) if shift else whole
    out = []
    for r, c in zip(*np.nonzero(whole)):
        sl = np.s_[r * TILE:(r + 1) * TILE, c * TILE:(c + 1) * TILE]
        out.append((int(r), int(c), quality.sigma(v[sl]), quality.noise_band(d[sl]), float(v[sl].mean())))
    return out


def tiles_job(job):
    a, name, g = job
    path = a.data / name
    s = Middle(path, 0)
    meta = json.loads((a.work / f"{name}.display.json").read_text())
    form = forms(s, meta["windows"])[0]
    series, _, _ = load_rows([HERE / "rows" / f"shard-{k}.jsonl" for k in (1, 2, 4)])
    sig, depth = stream(series[name], form.name)
    q = rule(sig, g, depth)
    tables = display(meta, (1 << s.b) - 1)
    dec, size = coded(a, s, form, q, g, a.work / f"tiles-{name}-g{g}")
    rows = {0: [], 1: []}
    for i, p in enumerate(y4m_frames(dec, s, form)):
        v = s.frame(i).astype(np.int32)[..., 0] + s.offset
        x = form.back(p)[..., 0]
        inside = (tables[0][v - s.offset] > 0) & (tables[0][v - s.offset] < 255)
        for shift in rows:
            rows[shift] += [(i, *t) for t in tile_stats(v, x, inside, shift)]
    dec.unlink()
    return dict(set=name, g=g, q=q, bytes=size, height=s.h, width=s.w, frames=s.n,
                tiles=rows[0], shifted=rows[1])


def step_tiles(a):
    for name in TIMED:
        meta = display_windows(ROOT / "lab/av1/data.json", name, (a.data / name).parent)
        (a.work / f"{name}.display.json").write_text(json.dumps(meta))
    with ProcessPoolExecutor(a.jobs) as pool, open(a.out / "tiles.jsonl", "w") as fh:
        for r in pool.map(tiles_job, [(a, n, g) for n in TIMED for g in (1, 16)]):
            fh.write(json.dumps(r) + "\n")
            fh.flush()
            t = np.array([x[3:5] for x in r["tiles"]])
            print(r["set"], r["g"], r["q"], len(t), float(np.mean(t[:, 1] / t[:, 0] > LIMIT)), flush=True)


class Noisier(Middle):
    """The middle 8 frames with white Gaussian noise of σ add, rounded and clipped to the series' depth."""

    def __init__(self, path, add, seed):
        super().__init__(path, 8)
        self.add, self.seed = add, seed

    def frame(self, i):
        v = super().frame(i).astype(np.float64) + self.offset
        v += np.random.default_rng(self.seed + i).normal(0, self.add, v.shape)
        return (np.clip(np.rint(v), 0, (1 << self.b) - 1) - self.offset).astype(np.int32)


def noise_job(job):
    a, k, q, g, add = job
    path = a.data / "dbts_c1"
    s = Noisier(path, add, 1000 * k) if add else Middle(path, 8)
    meta = json.loads((a.work / "dbts_c1.display.json").read_text())
    form = forms(s, meta["windows"])[0]
    tables = display(meta, (1 << s.b) - 1)
    sig = [frame_sigma(s, tables, i) for i in range(s.n)]
    dec, size = coded(a, s, form, q, g, a.work / f"noise-k{k}-q{q}-g{g}")
    frames = cell.measure(s, form, meta, y4m_frames(dec, s, form))
    dec.unlink()
    return dict(k=k, add=add, q=q, g=g, bytes=size, sigma=sig,
                nb_sigma=[f["err_noise_band"] / x for f, x in zip(frames, sig)])


def step_noise(a):
    """P5: σ_min raised 2× and 4× on dbts_c1's middle 8 frames; the rule, and the ladder around its Q."""
    path = a.data / "dbts_c1"
    meta = display_windows(ROOT / "lab/av1/data.json", "dbts_c1", path.parent)
    (a.work / "dbts_c1.display.json").write_text(json.dumps(meta))
    s = Middle(path, 8)
    tables = display(meta, (1 << s.b) - 1)
    base = min(frame_sigma(s, tables, i) for i in range(s.n))
    plan = []
    for k in (1, 2, 4):
        add = base * np.sqrt(k * k - 1)
        probe = Noisier(path, add, 1000 * k) if add else s
        smin = min(frame_sigma(probe, tables, i) for i in range(s.n))
        for g in (1, 16):
            q = rule(smin, g, 12)
            j = LADDER.index(q)
            plan += [(a, k, qq, g, add) for qq in LADDER[max(0, j - 1):j + 3]]
            print(dict(k=k, add=add, sigma_min=smin, g=g, rule=q), flush=True)
    with ProcessPoolExecutor(a.jobs) as pool, open(a.out / "noise.jsonl", "w") as fh:
        for r in pool.map(noise_job, plan):
            fh.write(json.dumps(dict(r, base_sigma_min=base)) + "\n")
            fh.flush()
            print(r["k"], r["q"], r["g"], f"{min(r['sigma']):.2f}", f"{max(r['nb_sigma']):.3f}", flush=True)


def step_headers(a):
    """P6: the lossy-history attributes and the transfer syntax as fetched, or what the source is when not DICOM."""
    import pydicom
    import zipfile
    manifest = {s["name"]: s for s in json.loads((ROOT / "lab/av1/data.json").read_text())["sets"]}
    out = []
    for name in ("usb_cine", "usb_cine_rgb", "us_liver"):
        spec = manifest[name]
        row = dict(set=name, provenance=spec["provenance"])
        if "files" in spec:
            ds = pydicom.dcmread(a.data / "dicom" / spec["files"][0]["key"], stop_before_pixels=True)
            for tag, key in ((0x00282110, "lossy"), (0x00282112, "ratio"), (0x00282114, "method")):
                row[key] = str(ds[tag].value) if tag in ds else None
            row["transfer_syntax"] = str(ds.file_meta.TransferSyntaxUID)
            row["transfer_syntax_name"] = ds.file_meta.TransferSyntaxUID.name
            row["transfer_syntax_lossy"] = str(ds.file_meta.TransferSyntaxUID) not in LOSSLESS_TS
        else:
            member = spec["members"][0]["name"]
            with zipfile.ZipFile(a.data / "archives" / Path(spec["archive"]["url"]).name) as z:
                head = z.open(member).read(4096)
            row.update(dicom=False, member=member, fourcc=sorted({head[i + 4:i + 8].decode("latin1")
                                                                  for i in range(len(head) - 8)
                                                                  if head[i:i + 4] == b"strf"}),
                       container=head[8:12].decode("latin1"))
            row["vids_handler"] = [head[i + 4:i + 8].decode("latin1") for i in range(len(head) - 8)
                                   if head[i:i + 4] == b"vids"]
        out.append(row)
        print(row)
    (a.out / "headers.json").write_text(json.dumps(out, indent=1))


LOSSLESS_TS = {"1.2.840.10008.1.2", "1.2.840.10008.1.2.1", "1.2.840.10008.1.2.2", "1.2.840.10008.1.2.5",
               "1.2.840.10008.1.2.4.57", "1.2.840.10008.1.2.4.70", "1.2.840.10008.1.2.4.80", "1.2.840.10008.1.2.4.90",
               "1.2.840.10008.1.2.4.201", "1.2.840.10008.1.2.4.202"}


def main():
    global AC, QINDEX
    import argparse
    ap = argparse.ArgumentParser()
    for k in ("build", "work", "out", "data"):
        ap.add_argument(k, type=lambda v: Path(v).resolve())
    ap.add_argument("step")
    ap.add_argument("--jobs", type=int, default=4)
    a = ap.parse_args()
    a.work.mkdir(parents=True, exist_ok=True)
    a.out.mkdir(parents=True, exist_ok=True)
    AC, QINDEX = libaom_ac(), qindex()
    globals()[f"step_{a.step}"](a)


if __name__ == "__main__":
    main()
