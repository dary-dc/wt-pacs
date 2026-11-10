#!/usr/bin/env python3
"""One series' cells of the groups protocol (docs/av1/groups.md §5–§6): per (arm, G, Q, source) the stream encoded,
its headers parsed, decoded by dav1d and measured frame by frame with the quality study's own measure().

usage: cell.py BUILD WORK OUT.jsonl SETDIR ... [--jobs 4] [--memory-gb 13.5] [--vdp TORCH_PYTHON] [--index K]
               [--settings]     (the settings amendment's cells, §S4, and its one ladder extension)
"""
import argparse
import copy
import hashlib
import importlib.util
import json
import os
import shutil
import subprocess
import sys
import time
from concurrent.futures import FIRST_COMPLETED, ProcessPoolExecutor, wait
from pathlib import Path

import numpy as np

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE))
sys.path.insert(0, str(HERE.parent / "profiles"))
sys.path.insert(0, str(HERE.parents[1] / "scripts"))
import anchor  # noqa: E402
import arms  # noqa: E402
import bands  # noqa: E402
import headers  # noqa: E402
import plan  # noqa: E402
from bytes import AOM, ROOT, Form, Middle, forms, q_hist, write_y4m, y4m_frames  # noqa: E402
from order import order  # noqa: E402
from voi import display_windows  # noqa: E402

sys.path.insert(0, str(ROOT / "ingest/coded-frames"))
import ingest  # noqa: E402

_spec = importlib.util.spec_from_file_location("metrics_cell", HERE.parent / "metrics/cell.py")
metrics = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(metrics)
DEPTH_CUT = Path(os.environ.get("DEPTH_CUT", ROOT / "lab/.av1-work/depth-cut/ingest.py"))


def depth_cut():
    """claude/oq-depth-cut's depth_cut, imported unchanged from a scratch checkout of its ingest.py."""
    spec = importlib.util.spec_from_file_location("depth_cut_ingest", DEPTH_CUT)
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    return mod.depth_cut


def cut_form(s, scale=4):
    """§S4's cut form, back as c · scale (4; 2 is the check's mutation)."""
    cut = depth_cut()
    return Form("cut", 10, 0, True, lambda v: [cut(v[..., 0], s.b)], lambda p: (p[0].astype(np.int32) * scale)[..., None])


class Source(Middle):
    """The series cut as plan.MIDDLE says, or a noise swap of it (§5): S_k, S_k + r_(k+n/2), S_k + r_mid, S_k + r_k.
    Frames are stored values, as Set.frame returns them; `clipped` counts samples held to the stream's range."""

    def __init__(self, path, src="real", work=None, shift=None):
        super().__init__(Path(path), plan.MIDDLE.get(Path(path).name, 0))
        self.src, self.clipped = src, 0
        self.shift = self.n // 2 if shift is None else shift
        proxy = Path(work or ".") / f"{self.name}.S.npy"
        self.S = np.load(proxy, mmap_mode="r") if src != "real" or proxy.exists() else None

    def real(self, i):
        return super().frame(i).astype(np.int32) + self.offset

    def noise(self, i):
        return self.real(i) - self.S[i]

    def frame(self, i):
        if self.src == "real":
            return super().frame(i)
        partner = {"S": None, "X": (i + self.shift) % self.n, "C": self.n // 2}[self.src]
        v = self.S[i].astype(np.int32) + (0 if partner is None else self.noise(partner))
        top = (1 << self.b) - 1
        self.clipped += int(((v < 0) | (v > top)).sum())
        return (np.clip(v, 0, top) - self.offset).astype(self.dtype)


def encode(cmd):
    """Wall, CPU seconds and peak resident kB of one child, from wait4 on it alone; stderr kept."""
    t0 = time.perf_counter()
    p = subprocess.Popen([str(c) for c in cmd], stdout=subprocess.DEVNULL, stderr=subprocess.PIPE)
    err = p.stderr.read()
    _, status, ru = os.wait4(p.pid, 0)
    if status:
        lines = [x for x in err.decode().replace("\r", "\n").splitlines() if x.strip() and " fps " not in x]
        raise RuntimeError(f"{Path(cmd[0]).name}: {' | '.join(lines)[-400:]}")
    return time.perf_counter() - t0, ru.ru_utime + ru.ru_stime, ru.ru_maxrss, err.decode()


def luma_hashes(dec, s, form):
    return [hashlib.sha256(np.ascontiguousarray(p[0]).tobytes()).hexdigest() for p in y4m_frames(dec, s, form)]


def name_of(c):
    return f"{c['arm']}-g{c['g']}-q{c['q']}-{c['src']}{c.get('tag', '')}"


def run(job):
    """One cell, or a `failed` row naming it and the error, so that a miss is reported and coded again on resume."""
    try:
        return run_cell(job)
    except Exception as e:  # noqa: BLE001
        c = job[3]
        return dict(kind="failed", set=Path(job[2]).name, **{k: c[k] for k in ("arm", "g", "q", "src")},
                    tag=c.get("tag"), error=f"{type(e).__name__}: {e}"[-600:])


def run_cell(job):
    """One cell; `extra` flags override the arm's, `shift` replaces X's offset (the checks)."""
    build, work, path, c, vdp = job
    t0 = time.perf_counter()
    before = os.times()
    s = Source(path, c["src"], work, c.get("shift"))
    meta = json.loads((Path(work) / f"{s.name}.display.json").read_text())
    form = cut_form(s, c.get("scale", 4)) if c.get("form") == "cut" else forms(s, meta["windows"])[0]
    tmp = Path(work) / f"{s.name}-{name_of(c)}"
    tmp.mkdir(parents=True, exist_ok=True)
    y4m, ivf, dec = tmp / "in.y4m", tmp / "out.ivf", tmp / "dec.y4m"
    flags = arms.args(c["arm"], form, c["q"], c["g"], s.n, c.get("extra", ()))
    if c.get("per_group"):
        return dict(kind="check", set=s.name, tag=c.get("tag"), flags=flags,
                    units=[len(u) for u in per_group(build, tmp, s, form, c)])
    write_y4m(s, form, y4m)
    wall, cpu, rss, err = encode([build / f"aom-{AOM}/bin/aomenc", "-o", ivf, f"--limit={s.n}", "--q-hist=64",
                                  "--disable-warning-prompt", *flags, y4m])
    y4m.unlink()
    units = ingest.ivf_units(ivf)
    dwall, dcpu, _, _ = encode([build / "dav1d/bin/dav1d", "-q", "--threads=1", "-i", ivf, "-o", dec])
    row = dict(kind=c.get("kind", "cell"), set=s.name, first=s.first, n=s.n, **{k: c[k] for k in ("arm", "g", "q", "src")},
               tag=c.get("tag"), flags=flags, units=[len(u) for u in units], headers=headers.summary(units),
               q_hist=q_hist(err), encode_wall=wall, encode_cpu=cpu, encode_rss_kb=rss, decode_cpu=dcpu,
               mpx=s.n * s.w * s.h * s.ch / 1e6)
    if c.get("kind") != "check":
        shown = {}
        t1 = time.perf_counter()
        row["frames"] = metrics.measure(s, form, meta, y4m_frames(dec, s, form), shown=shown if vdp else None)
        row["clipped"] = s.clipped
        row["sigma_out"] = sigma_out(s, meta, form, y4m_frames(dec, s, form))
        if c.get("bands") and s.S is not None and c["q"] != plan.NOISE_PROXY_Q:
            row["kappa"] = kappa(s, form, meta, y4m_frames(dec, s, form))
        row["vdp"] = metrics.visibility(vdp, tmp, shown) if vdp and shown else None
        row["measure_wall"] = time.perf_counter() - t1
    if c.get("keep") or c.get("kind") == "check":
        row["hashes"] = luma_hashes(dec, s, form)
    if c.get("kind") == "check":
        row["headers_late"] = headers.summary(units, late=1)
    if c.get("span"):
        d = [form.back(p)[..., 0] - s.frame(i)[..., 0].astype(np.int32) - s.offset
             for i, p in enumerate(y4m_frames(dec, s, form))]
        row["span"] = [int(min(x.min() for x in d)), int(max(x.max() for x in d))]
    if c.get("keep"):
        (Path(work) / "streams").mkdir(exist_ok=True)
        shutil.copy(ivf, Path(work) / "streams" / f"{s.name}-{name_of(c)}.ivf")
    if c["q"] == plan.NOISE_PROXY_Q and c["src"] == "real" and c["arm"] == "O" and c["g"] == 1:
        S = np.stack([form.back(p) for p in y4m_frames(dec, s, form)]).astype(np.int32)
        np.save(Path(work) / f"{s.name}.S.npy", S)
    shutil.rmtree(tmp)
    after = os.times()
    row["cell_cpu"] = (after.children_user + after.children_system - before.children_user - before.children_system
                       + after.user + after.system - before.user - before.system)
    row["cell_wall"] = time.perf_counter() - t0
    return row


def per_group(build, tmp, s, form, c):
    """The ingest's way (§S8): one encoder run per group of G frames, the units concatenated."""
    out = []
    for a in range(0, s.n, c["g"]):
        part = copy.copy(s)
        part.first, part.n = s.first + a, min(c["g"], s.n - a)
        y4m, ivf = tmp / f"in{a}.y4m", tmp / f"out{a}.ivf"
        write_y4m(part, form, y4m)
        encode([build / f"aom-{AOM}/bin/aomenc", "-o", ivf, f"--limit={part.n}", "--disable-warning-prompt",
                *arms.args(c["arm"], form, c["q"], c["g"], part.n, c.get("extra", ())), y4m])
        out += ingest.ivf_units(ivf)
    shutil.rmtree(tmp)
    return out


def sigma_out(s, meta, form, decoded):
    """σ of each decoded frame by the estimator σ is read with, over the source frame's in-window samples (§S6's ν)."""
    table = metrics.display(meta, (1 << s.b) - 1)[0]
    out = []
    for i, p in enumerate(decoded):
        v = s.frame(i)[..., 0].astype(np.int32) + s.offset
        out.append(metrics.quality.sigma(form.back(p)[..., 0], (table[v - s.offset] > 0) & (table[v - s.offset] < 255)))
    return out


def kappa(s, form, meta, decoded):
    """κ_ℓ per frame (§6.4): the decode's error against this cell's source, over the noise this source carries
    (the real r_k, or the swapped one), in the real source's first window; none for S, which carries no noise."""
    if s.src == "S":
        return None
    table = metrics.display(meta, (1 << s.b) - 1)[0]
    out = []
    for i, p in enumerate(decoded):
        src = s.frame(i)[..., 0].astype(np.int32) + s.offset
        err = form.back(p)[..., 0] - src
        noise = {"real": lambda: s.noise(i), "X": lambda: s.noise((i + s.shift) % s.n),
                 "C": lambda: s.noise(s.n // 2)}[s.src]()
        real = s.real(i)[..., 0]
        inside = (table[real - s.offset] > 0) & (table[real - s.offset] < 255)
        out.append(bands.kappa(err, noise[..., 0], inside))
    return out


def series(job):
    """σ and neighbour steps as the quality study's series_row, on this protocol's cut of the series."""
    path, work = job
    n = plan.MIDDLE.get(Path(path).name, 0)
    metrics.Middle = lambda p, _: Middle(p, n)
    row = metrics.series_row(path, work)
    row["first"] = Middle(Path(path), n).first
    return row


def rho(job):
    """ρ_ℓ of the noise proxy r_k between neighbours (§6.4), in the first window, luma or first channel."""
    path, work = job
    s = Source(path, "S", work)
    meta = json.loads((Path(work) / f"{s.name}.display.json").read_text())
    table = metrics.display(meta, (1 << s.b) - 1)[0]
    noise = (s.noise(i)[..., 0] for i in range(s.n))
    inside = ((lambda v: (table[v - s.offset] > 0) & (table[v - s.offset] < 255))(s.real(i)[..., 0]) for i in range(s.n))
    swap = {k: Source(path, k, work) for k in "XC"}
    for k in swap.values():
        for i in range(k.n):
            k.frame(i)
    return dict(kind="rho", set=s.name, bands=bands.rho(noise, inside),
                clipped={k: v.clipped for k, v in swap.items()}, samples=s.n * s.w * s.h * s.ch)


def jobs(sets, index, cells=plan.cells):
    """Per series: its noise proxy first, then its cells in a Williams row, the cut-first ones (§9) last."""
    out = []
    for k, path in enumerate(sets):
        cs = cells(Path(path).name)
        rest = [c for c in cs[1:] if c["arm"] not in plan.LAST]
        out.append([(path, c) for c in cs[:1]] + [(path, c) for c in order(rest, index + k)]
                   + [(path, c) for c in cs[1:] if c["arm"] in plan.LAST])
    return out


def scheduled(pool, js, need, budget, most):
    """Rows of `js` as they finish, at most `most` in flight and their estimated GB within `budget`; a job is
    started only in its turn, so the order holds."""
    js, live = list(js), {}
    while js or live:
        while js and len(live) < most and (not live or sum(live.values()) + need(js[0]) <= budget):
            j = js.pop(0)
            live[pool.submit(run, j)] = need(j)
        finished, _ = wait(live, return_when=FIRST_COMPLETED)
        for f in finished:
            del live[f]
            yield f.result()


MEASURE_GB_PER_FRAME_MPX = 0.3
WORKER_GB = 0.3


def line(row):
    head = f"{row['set']} {row['arm']} G{row['g']} Q{row['q']} {row['src']}"
    if row["kind"] == "failed":
        return f"{head} FAILED {row['error']}"
    return f"{head} {sum(row['units'])} B enc {row['encode_cpu']:.0f} cpu-s {row['encode_rss_kb'] / 1e6:.2f} GB"


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("build", type=Path)
    ap.add_argument("work", type=Path)
    ap.add_argument("out", type=Path)
    ap.add_argument("sets", nargs="+")
    ap.add_argument("--jobs", type=int, default=4)
    ap.add_argument("--memory-gb", type=float, default=13.5)
    ap.add_argument("--vdp", type=Path)
    ap.add_argument("--index", type=int, default=0)
    ap.add_argument("--settings", action="store_true")
    a = ap.parse_args()
    cells = plan.settings_cells if a.settings else plan.cells
    a.build, a.work = a.build.resolve(), a.work.resolve()
    a.work.mkdir(parents=True, exist_ok=True)
    rows = [json.loads(r) for r in a.out.open()] if a.out.exists() else []
    done = {plan.key(r["set"], r) for r in rows if r["kind"] == "cell"}
    have = {(r["kind"], r["set"]) for r in rows}
    for path in a.sets:
        name = Path(path).name
        meta = display_windows(ROOT / "lab/av1/data.json", name, Path(path).parent)
        (a.work / f"{name}.display.json").write_text(json.dumps(meta))
    emit = lambda fh, row: (fh.write(json.dumps(row) + "\n"), fh.flush())
    with open(a.out, "a") as fh, ProcessPoolExecutor(a.jobs) as pool:
        todo = [p for p in a.sets if ("series", Path(p).name) not in have]
        for row in pool.map(series, [(p, a.work) for p in todo]):
            emit(fh, row)
            print(row["set"], "series", flush=True)
        per = jobs(a.sets, a.index, cells)
        first = [(p, c) for p, c in (s[0] for s in per)
                 if plan.key(Path(p).name, c) not in done or not (a.work / f"{Path(p).name}.S.npy").exists()]
        for row in pool.map(run, [(a.build, a.work, p, c, None) for p, c in first]):
            if plan.key(row["set"], row) not in done:
                emit(fh, row)
            print(line(row), flush=True)
            if row["kind"] == "failed":
                sys.exit("the noise proxy failed; nothing else can run")
        rho_todo = [] if a.settings else [(p, a.work) for p in a.sets if ("rho", Path(p).name) not in have]
        rho_futures = [pool.submit(rho, j) for j in rho_todo]
        rss = json.loads((HERE / "plan.json").read_text()).get("rss_gb_per_frame_mpx", {})
        family = lambda name, arm: (name, arm in arms.LOOKAHEAD)
        seen = {}
        for r in rows:
            if r["kind"] == "cell":
                k = family(r["set"], r["arm"])
                seen[k] = max(seen.get(k, 0), r["encode_rss_kb"] / 1e6)

        def need(j):
            name, mpx = Path(j[2]).name, plan.FRAME_MPX[Path(j[2]).name] / 1e6
            enc = seen.get(family(name, j[3]["arm"]), rss.get(j[3]["arm"], 0.5) * mpx)
            return max(enc, MEASURE_GB_PER_FRAME_MPX * mpx) + WORKER_GB

        todo = [(a.build, a.work, p, c, a.vdp if c["vdp"] else None) for s in per for p, c in s[1:]
                if plan.key(Path(p).name, c) not in done]
        print(f"{len(todo)} cells", flush=True)
        for row in scheduled(pool, todo, need, a.memory_gb, a.jobs):
            emit(fh, row)
            print(line(row), flush=True)
            if row["kind"] == "cell":
                k = family(row["set"], row["arm"])
                seen[k] = max(seen.get(k, 0), row["encode_rss_kb"] / 1e6)
            for f in [f for f in rho_futures if f.done()]:
                emit(fh, f.result())
                rho_futures.remove(f)
        for f in rho_futures:
            emit(fh, f.result())
        if a.settings:
            rows = [json.loads(r) for r in a.out.open()]
            more = [(a.build, a.work, p, c, a.vdp) for p in a.sets for c in extension(rows, Path(p).name)]
            print(f"{len(more)} extension cells", flush=True)
            for row in scheduled(pool, more, need, a.memory_gb, a.jobs):
                emit(fh, row)
                print(line(row), flush=True)


def extension(rows, name):
    """§S4's one rung outward for each stream whose worst-frame e_N/σ its ladder does not bracket."""
    series = next(r for r in rows if r["kind"] == "series" and r["set"] == name)
    ladder = plan.SETTINGS_LADDER[name]
    have = {(r["arm"], r["g"], r["q"]) for r in rows if r["kind"] == "cell" and r["set"] == name}
    out = []
    for arm, g in plan.SETTINGS_STREAMS:
        x = {r["q"]: anchor.worst(series, r) for r in rows if r["kind"] == "cell" and r["set"] == name
             and (r["arm"], r["g"]) == (arm, g) and r["q"] in ladder}
        q = anchor.outward(x, ladder)
        if q is not None and (arm, g, q) not in have:
            out += [c for c in plan.settings_cells(name, (q,))[1:] if (c["arm"], c["g"]) == (arm, g)]
    return out

if __name__ == "__main__":
    main()
