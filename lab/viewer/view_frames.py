#!/usr/bin/env python3
"""docs/adr/frame-path.md §7's series for total-time's run.mjs: each set through the product's DICOM ingest as HTJ2K,
its frames, its metadata and the viewer variants `page`, `pageaa` (its A/A copy) and `worker`.

usage: lab/av1/.venv/bin/python lab/viewer/view_frames.py BUILD WORK SET ...   (SET@K: that file of the set alone)
"""
import json
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "av1/exact/from-dicom"))
import check  # noqa: E402


def main():
    build, work, sets = Path(sys.argv[1]), Path(sys.argv[2]), sys.argv[3:]
    for name in sets:
        w = work / name.replace("@", "-")
        w.mkdir(parents=True, exist_ok=True)
        src = check.source(name, work)
        set_name, _, k = name.partition("@")
        s, ds = check.dicom_series.series(src)
        keys = [f["key"].split("/")[-1] for f in check.SETS[set_name]["files"]]
        raw = [check.DATA / set_name / f"{keys.index(Path(d.filename).name) + i:03d}" for d in ds for i in range(int(d.get("NumberOfFrames", 1)))]
        truth = [Path(f"{r}.sha256").read_text().strip() for r in raw]
        meta = check.ingest(build, src, w / "series.sbnd", "htj2k", 4)
        check.unpack(w / "series.sbnd", w, "htj2k", truth)
        (w / "metadata.json").write_text(json.dumps(meta))
        viewer = {"codec": "htj2k", "openjph": "delivered", "viewer": "metadata.json", "digests": meta["digests"]["frames"]}
        (w / "variants.json").write_text(json.dumps({"name": w.name, "frames": s.n, "truth": truth, "variants": {
            "page": viewer, "pageaa": viewer, "worker": {**viewer, "view": "worker"}}}))
        print(w.name, s.n, "frames", flush=True)


if __name__ == "__main__":
    main()
