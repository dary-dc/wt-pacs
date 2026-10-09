#!/usr/bin/env python3
"""MIXDEC's frames: lab/av1/delivery/split-rule/make_frames.py's layout (NNN.htj2k, NNN.kK.av1, variants.json, manifest.json)
for the 13- and 14-bit series, each split k at its shipped preset — the fastest within 2 % of cpu0, as rows 44
(lab/av1/delivery/split-rule) and 45 (lab/av1/bytes/breast) found it per k.

usage: make_frames.py BUILD OUT DATA [--jobs 4]   — lab/av1/decode/mixed/README.md
"""
import argparse
import importlib.util
import json
import shutil
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path

HERE = Path(__file__).resolve().parent
# splittime's make_frames imports speed's under the same name: loaded by path, under its own.
spec = importlib.util.spec_from_file_location("splittime_frames", HERE.parents[1] / "delivery/split-rule/make_frames.py")
splittime = importlib.util.module_from_spec(spec)
spec.loader.exec_module(splittime)
Set, bits, htj2k_frames, payloads = splittime.Set, splittime.bits, splittime.htj2k_frames, splittime.payloads

PRESETS = {
    "ct_lidc": {1: "good:6", 2: "good:6", 3: "good:6"},
    "xa_dynact16": {1: "allintra:6", 2: "good:6", 3: "allintra:6"},
    "ct_nlst": {1: "allintra:6", 2: "allintra:7", 3: "allintra:6"},
    "ct_crc": {1: "good:6", 2: "good:6", 3: "allintra:6"},
    "dbtproj_ge": {2: "allintra:7", 3: "allintra:7", 4: "allintra:9"},
    "dbtproj_holo": {2: "allintra:7", 3: "allintra:7", 4: "allintra:9"},
}


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("build", type=Path)
    ap.add_argument("out", type=Path)
    ap.add_argument("data", type=Path)
    ap.add_argument("--jobs", type=int, default=4)
    a = ap.parse_args()
    build, out = a.build.resolve(), a.out.resolve()
    with ThreadPoolExecutor(a.jobs) as pool:
        made = {(name, k): pool.submit(payloads, build, a.data / name, out, k, preset, None)
                for name, ks in PRESETS.items() for k, preset in ks.items()}
        manifest = []
        for name, ks in PRESETS.items():
            s = Set(a.data / name)
            dst = out / name
            dst.mkdir(parents=True, exist_ok=True)
            htj2k_frames(a.data / name, dst)
            entry = dict(name=name, frames=s.n, bits=bits(s), truth=s.truth, variants={"htj2k": {}}, presets={},
                         bytes={"htj2k": sum((dst / f"{i:03d}.htj2k").stat().st_size for i in range(s.n))})
            for k, preset in ks.items():
                src = made[(name, k)].result()
                for i in range(s.n):
                    shutil.copyfile(src / f"{i:03d}.av1", dst / f"{i:03d}.k{k}.av1")
                entry["variants"][f"k{k}"] = dict(ext=f"k{k}.av1")
                entry["presets"][f"k{k}"] = preset
                entry["bytes"][f"k{k}"] = sum((dst / f"{i:03d}.k{k}.av1").stat().st_size for i in range(s.n))
            (dst / "variants.json").write_text(json.dumps(entry, indent=1))
            manifest.append(dict(name=name, bits=entry["bits"], variants=entry["variants"], frames=[dict(truth=t) for t in s.truth]))
            ratio = ", ".join(f"{n} {v / entry['bytes']['htj2k']:.3f}" for n, v in entry["bytes"].items() if n != "htj2k")
            print(f"{name}: {s.n} frames, {entry['bits']} bits, over HTJ2K {ratio}", flush=True)
    (out / "manifest.json").write_text(json.dumps(manifest))


if __name__ == "__main__":
    main()
