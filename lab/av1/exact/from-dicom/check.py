#!/usr/bin/env python3
"""Checks on the lab's pinned sets: the product's DICOM ingest against independent paths.

  samples    every frame byte-identical to fetch_data.py's NNN.raw (pydicom's pixel_array, not the ingest's reader)
  attributes every display attribute equal to DCMTK's dcmdump's
  jobs       the bundle and its metadata byte-identical at --jobs 1, 2 and 4
  client     every frame of the HTJ2K and the AV1 bundle exact through ingest/coded-frames/check.mjs, and a
             frames folder for total-time's fill (`--frames`, variants htj2k and av1, each with its digests)
  time       one command against today's two steps (fetch_data's extraction, ingest.py, pack-series), interleaved

usage: DCMDUMP=... check.py BUILD WORK SET ... [--rounds 5] [--skip time]   — README.md beside this
"""
import argparse
import hashlib
import json
import os
import re
import shutil
import struct
import subprocess
import sys
import time
from pathlib import Path

ROOT = Path(__file__).resolve().parents[4]
sys.path.insert(0, str(ROOT / "ingest/from-dicom"))
sys.path.insert(0, str(ROOT / "lab/scripts"))
import dicom_series  # noqa: E402
from order import order  # noqa: E402

PY = sys.executable
DATA = ROOT / "lab/av1/data"
SETS = {s["name"]: s for s in json.loads((ROOT / "lab/av1/data.json").read_text())["sets"]}
TAGS = {"Rows": "0028,0010", "Columns": "0028,0011", "SamplesPerPixel": "0028,0002", "BitsAllocated": "0028,0100",
        "BitsStored": "0028,0101", "HighBit": "0028,0102", "PixelRepresentation": "0028,0103",
        "PhotometricInterpretation": "0028,0004", "Modality": "0008,0060", "FrameTime": "0018,1063",
        "CineRate": "0018,0040", "NumberOfFrames": "0028,0008", "InstanceNumber": "0020,0013",
        "WindowCenter": "0028,1050", "WindowWidth": "0028,1051", "RescaleIntercept": "0028,1052",
        "RescaleSlope": "0028,1053", "VOILUTFunction": "0028,1056"}
PER, SHARED = "(5200,9230)", "(5200,9229)"


def source(name, work):
    """The set's DICOM as the ingest takes it: its one file, a folder of its files, or `SET@K` its file K alone."""
    name, _, k = name.partition("@")
    files = [DATA / "dicom" / f["key"] for f in SETS[name]["files"]]
    if k:
        return files[int(k)]
    if len(files) == 1:
        return files[0]
    d = work / f"{name}.in"
    shutil.rmtree(d, ignore_errors=True)
    d.mkdir(parents=True)
    for f in files:
        (d / f.name).symlink_to(f)
    return d


def dump(path):
    """dcmdump's every instance of the tags, with the sequence path: [(path, keyword, values)]."""
    args = [a for t in TAGS.values() for a in ("+P", t)]
    out = subprocess.run([os.environ["DCMDUMP"], "+p", *args, path], capture_output=True, text=True, check=True).stdout
    rows = []
    for line in out.splitlines():
        m = re.match(r"^(\S+) \w\w (.*?)\s+#\s*\d+, \d+ (\w+)$", line.strip())
        if m:
            *where, _ = m.group(1).split(".")
            v = m.group(2)
            values = [] if v.startswith("(no value") else (v[1:-1] if v.startswith("[") else v).split("\\")
            rows.append((".".join(where), m.group(3), values))
    return rows


def independent(path):
    """The display attributes per frame from dcmdump alone, ordered by its InstanceNumber."""
    files = [path] if path.is_file() else sorted(path.iterdir())
    objs = []
    for f in files:
        rows = dump(f)
        top = {k: v for w, k, v in rows if not w}
        objs.append((int(top.get("InstanceNumber", ["0"])[0]), rows, top))
    objs.sort(key=lambda o: o[0])
    frames, first = [], objs[0][2]
    for _, rows, top in objs:
        n = int(top.get("NumberOfFrames", ["1"])[0])
        per = [(k, v) for w, k, v in rows if w.startswith(PER)]
        shared = {k: v for w, k, v in rows if w.startswith(SHARED)}
        counts = {k: sum(1 for kk, _ in per if kk == k) for k, _ in per}
        if any(c != n for c in counts.values()):
            raise SystemExit(f"{path}: per-frame values not one a frame ({counts}): cannot place them by order")
        for i in range(n):
            own = {k: [v for kk, v in per if kk == k][i] for k in counts}
            got = {**top, **shared, **own}
            f = {"rescale": {"slope": float(got.get("RescaleSlope", ["1"])[0]),
                             "intercept": float(got.get("RescaleIntercept", ["0"])[0])}}
            if "WindowCenter" in got:
                fn = (own if "WindowCenter" in own else shared if "WindowCenter" in shared else top).get("VOILUTFunction", ["LINEAR"])
                f["window"] = {"center": [float(x) for x in got["WindowCenter"]], "width": [float(x) for x in got["WindowWidth"]],
                               "function": fn[0]}
            frames.append(f)
    series = {"width": int(first["Columns"][0]), "height": int(first["Rows"][0]), "channels": int(first["SamplesPerPixel"][0]),
              "bitsAllocated": int(first["BitsAllocated"][0]), "bitsStored": int(first["BitsStored"][0]),
              "highBit": int(first["HighBit"][0]), "signed": first["PixelRepresentation"][0] == "1",
              "photometric": first["PhotometricInterpretation"][0], "modality": first.get("Modality", [""])[0]}
    if "FrameTime" in first:
        series["frameTimeMs"] = float(first["FrameTime"][0])
    if "CineRate" in first:
        series["cineRate"] = float(first["CineRate"][0])
    return series, frames


def expanded(meta):
    """The ingest's metadata as one display entry a frame."""
    per = meta.get("perFrame", {})
    return [{k: per[k][i] if k in per else meta[k] for k in ("rescale", "window") if k in per or k in meta}
            for i in range(meta["frameCount"])]


def ingest(build, src, out, codec, jobs):
    subprocess.run([PY, ROOT / "ingest/from-dicom/from_dicom.py", build, src, out, "--codec", codec, "--jobs", str(jobs)],
                   check=True, capture_output=True)
    return json.loads(out.with_suffix(".metadata.json").read_text())


def unpack(sbnd, dest, codec, truth):
    """The bundle's frames as NNN.<codec>, each beside its source's checksum, for check.mjs and total-time."""
    b = sbnd.read_bytes()
    _, _, _, n = struct.unpack_from("<4sIII", b)
    dest.mkdir(parents=True, exist_ok=True)
    for i in range(n):
        off, length = struct.unpack_from("<QI", b, 16 + 12 * i)
        (dest / f"{i:03d}.{codec}").write_bytes(b[off:off + length])
        (dest / f"{i:03d}.sha256").write_text(truth[i])


def two_step(build, name, work):
    """Today's path: fetch_data's extraction of the cached DICOM, ingest.py, pack-series."""
    out = work / "two"
    shutil.rmtree(out, ignore_errors=True)
    (out / "data").mkdir(parents=True)
    (out / "data/dicom").symlink_to(DATA / "dicom")
    set_name = name.partition("@")[0]
    subprocess.run([PY, ROOT / "lab/av1/fetch_data.py", ROOT / "lab/av1/data.json", out / "data", set_name], check=True,
                   capture_output=True)
    name = set_name
    subprocess.run([PY, ROOT / "ingest/coded-frames/ingest.py", build, out / "data" / name, out / "f", "--codec", "htj2k",
                    "--jobs", "4"], check=True, capture_output=True)
    subprocess.run([ROOT / "target/release/pack-series", "--metadata", out / "f/metadata.json", "--frames", out / "f",
                    "--output", out / "x.sbnd"], check=True, capture_output=True)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("build", type=Path)
    ap.add_argument("work", type=Path)
    ap.add_argument("sets", nargs="+")
    ap.add_argument("--rounds", type=int, default=5)
    ap.add_argument("--skip", default="")
    a = ap.parse_args()
    a.work.mkdir(parents=True, exist_ok=True)
    report = {}
    for name in a.sets:
        src, w = source(name, a.work), a.work / name
        w.mkdir(exist_ok=True)
        # fetch_data.py writes a set's files in data.json's order; the ingest orders them by InstanceNumber.
        set_name = name.partition("@")[0]
        s, ds = dicom_series.series(src)
        keys = [f["key"].split("/")[-1] for f in SETS[set_name]["files"]]
        raw = [DATA / set_name / f"{keys.index(Path(d.filename).name) + i:03d}" for d in ds for i in range(int(d.get("NumberOfFrames", 1)))]
        truth = [Path(f"{r}.sha256").read_text().strip() for r in raw]
        same = sum(s.frame(i).tobytes() == Path(f"{r}.raw").read_bytes() for i, r in enumerate(raw))
        r = report[name] = {"frames": s.n, "samples identical to NNN.raw": f"{same}/{len(truth)}"}

        metas = {j: ingest(a.build, src, w / f"htj2k-j{j}.sbnd", "htj2k", j) for j in (1, 2, 4)}
        bundles = {j: hashlib.sha256((w / f"htj2k-j{j}.sbnd").read_bytes()).hexdigest() for j in metas}
        r["htj2k bundles at --jobs 1, 2, 4"] = "identical" if len(set(bundles.values())) == 1 else f"differ {bundles}"
        meta = metas[4]
        series, frames = independent(src)
        r["series attributes as dcmdump"] = "equal" if all(meta.get(k) == v for k, v in series.items()) and \
            not ({"frameTimeMs", "cineRate"} & meta.keys()) - series.keys() else \
            f"differ: {[k for k, v in series.items() if meta.get(k) != v]}"
        mine = expanded(meta)
        r["frame attributes as dcmdump"] = f"{sum(x == y for x, y in zip(mine, frames))}/{len(frames)}"

        meta_av1 = ingest(a.build, src, w / "av1.sbnd", "av1", 4)
        for codec in ("htj2k", "av1"):
            sbnd = w / ("htj2k-j4.sbnd" if codec == "htj2k" else "av1.sbnd")
            unpack(sbnd, w / f"frames-{codec}", codec, truth)
        out = subprocess.run(["node", ROOT / "ingest/coded-frames/check.mjs", w / "frames-htj2k", w / "frames-av1"],
                             capture_output=True, text=True)
        r["through the client"] = out.stdout.strip().replace(str(w) + "/", "")
        fill = a.work / "fill" / name
        fill.mkdir(parents=True, exist_ok=True)
        for codec in ("htj2k", "av1"):
            for f in (w / f"frames-{codec}").glob(f"*.{codec}"):
                shutil.copy(f, fill / f.name)
        (fill / "variants.json").write_text(json.dumps({
            "name": name, "frames": s.n, "truth": truth,
            "variants": {"htj2k": {"digests": meta["digests"]["frames"]},
                         "av1": {"digests": meta_av1["digests"]["frames"]}}}))
        print(name, json.dumps(r, indent=1), flush=True)

    if "time" not in a.skip:
        # Per set: the one command on each series given of it, against the two steps over the whole set.
        sets = {}
        for name in a.sets:
            sets.setdefault(name.partition("@")[0], []).append(name)
        # A set of several series also as their commands run at once, one core each, as several series would be ingested.
        arms = [(n, arm) for n in sets for arm in ("one", "two", "together")[:2 + (len(sets[n]) > 1)]]
        rows = []
        for rnd in range(a.rounds):
            for name, arm in order(arms, rnd):
                t0 = time.perf_counter()
                if arm == "one":
                    for part in sets[name]:
                        ingest(a.build, source(part, a.work), a.work / part / "t.sbnd", "htj2k", 4)
                elif arm == "together":
                    runs = [subprocess.Popen([PY, ROOT / "ingest/from-dicom/from_dicom.py", a.build, source(part, a.work),
                                              a.work / part / "c.sbnd", "--codec", "htj2k", "--jobs", "1"], stdout=subprocess.DEVNULL)
                            for part in sets[name]]
                    if any(r.wait() for r in runs):
                        raise SystemExit(f"{name}: a command failed")
                else:
                    two_step(a.build, name, a.work / name)
                frames = sum(report[part]["frames"] for part in sets[name])
                rows.append(dict(round=rnd, set=name, arm=arm, s=time.perf_counter() - t0, frames=frames))
        (a.work / "time.json").write_text(json.dumps(rows))
        med = lambda x: x[len(x) // 2]
        for name, arm in arms:
            per = sorted(r["s"] / r["frames"] for r in rows if r["set"] == name and r["arm"] == arm)
            by = {(r["round"], r["arm"]): r["s"] for r in rows if r["set"] == name}
            pairs = sorted(by[(k, arm)] / by[(k, "two")] for k in range(a.rounds))
            print(f"{name} {arm}: s a frame {med(per):.3f} [{per[0]:.3f}–{per[-1]:.3f}]" +
                  ("" if arm == "two" else f", ÷ two ×{med(pairs):.3f} [{pairs[0]:.3f}–{pairs[-1]:.3f}] n={len(pairs)}"))

if __name__ == "__main__":
    main()
