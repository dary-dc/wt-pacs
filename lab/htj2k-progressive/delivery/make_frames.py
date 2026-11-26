#!/usr/bin/env python3
"""Stage 3's entries for the total-time rig, from ladder.py's work: today's codestream twice (A, A′), and the ladder
split at the level fit and at level 2, level-major — entry i frame i's prefix (cut.mjs's cut, checked), entry F + i its
rest, so the two concatenate to today's codestream. With --svc, the scalable preview's predicted quarter base at
q 40 is linked in from lab/av1/delivery/scalable/tool/make_frames.py's OUT.

usage: make_frames.py LADDER OUT SET ... [--svc SVC_OUT]   — lab/htj2k-progressive/README.md §Stage 3
"""
import argparse
import json
import os
import sys
from pathlib import Path

SVC = "predicted-two-quarter-q40"


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("ladder", type=Path)
    ap.add_argument("out", type=Path)
    ap.add_argument("sets", nargs="+")
    ap.add_argument("--svc", type=Path)
    a = ap.parse_args()
    for name in a.sets:
        src, dst = (a.ladder / name).resolve(), a.out / name
        dst.mkdir(parents=True, exist_ok=True)
        lad = json.loads((src / "ladder.json").read_text())
        cuts = json.loads((src / "cuts.json").read_text())
        if not all(c["exact"] and all(v["ok"] for v in c["levels"].values()) for c in cuts):
            sys.exit(f"{name}: cut.mjs failed a check; nothing written")
        if json.loads((src / "openjpeg.json").read_text())["failed"]:
            sys.exit(f"{name}: OpenJPEG differs on a prefix; nothing written")
        n = lad["frames"]
        delivered = {"codec": "htj2k", "openjph": "delivered"}
        entry = dict(name=name, frames=n, truth=lad["truth"], levelFit=lad["levelFit"],
                     variants={"htj2k": dict(delivered), "htj2k-aa": dict(delivered, ext="htj2k")},
                     bytes={"htj2k": sum(c["whole"] for c in cuts)})
        for i in range(n):
            link = dst / f"{i:03d}.htj2k"
            if not link.exists():
                os.symlink(src / f"{i:03d}.htj2k", link)
        for variant, level in (("fit", lad["levelFit"]), ("l2", 2)):
            if level == 0:
                continue
            for i in range(n):
                cs = (src / f"{i:03d}.htj2k").read_bytes()
                cut = cuts[i]["levels"][str(level)]["prefix"]
                (dst / f"{i:03d}.{variant}").write_bytes(cs[:cut])
                (dst / f"{n + i:03d}.{variant}").write_bytes(cs[cut:])
            entry["variants"][variant] = dict(delivered, layers=2, level=level, worker="/lab/htj2k-progressive/delivery/decoder.js",
                                              previewTruth=lad["witness"][str(level)]["reduced"])
            entry["bytes"][f"{variant}-prefix"] = sum(cuts[i]["levels"][str(level)]["prefix"] for i in range(n))
        if a.svc and (a.svc / name / "variants.json").exists():
            svc = json.loads((a.svc / name / "variants.json").read_text())
            v = svc["variants"][SVC]
            for f in (a.svc / name).glob(f"*.{SVC}"):
                link = dst / f.name
                if not link.exists():
                    os.symlink(f.resolve(), link)
            entry["variants"][SVC] = v
            entry["bytes"][SVC] = svc["bytes"][SVC]
        (dst / "variants.json").write_text(json.dumps(entry, indent=1))
        print(name, ", ".join(f"{k} {v} B" for k, v in entry["bytes"].items()), flush=True)


if __name__ == "__main__":
    main()
