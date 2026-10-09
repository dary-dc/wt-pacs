#!/usr/bin/env python3
"""One DICOM series to a served bundle: OUT.sbnd and OUT.metadata.json, nothing at all unless every frame
decodes back to its source — docs/FIXTURES.md §From DICOM.

usage: from_dicom.py BUILD INPUT OUT.sbnd [--codec htj2k|av1|auto] [--preset P] [--jobs N]
  INPUT one multi-frame object, or a folder of single-frame objects of one series
"""
import argparse
import json
import subprocess
import sys
import tempfile
from pathlib import Path

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE))
sys.path.insert(0, str(HERE.parent / "coded-frames"))
import dicom_series  # noqa: E402
import ingest  # noqa: E402

PACK = ingest.ROOT / "target/release/pack-series"
# Row TOTAL4 adopted AV1 for no series (docs/av1/README.md §Total time): auto is HTJ2K until a rule is adopted.
AUTO = "htj2k"
# Row ENC's fastest preset within 2 % of the slowest's bytes, by content (docs/av1/queue.md row 14).
PRESET = {"MR": "good:6", "CT": "allintra:6", "RF": "allintra:7", "XA": "allintra:7", "MG": "good:6"}


def preset_for(meta):
    return "cpu0" if meta["channels"] == 3 else PRESET.get(meta["modality"], "cpu0")


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("build", type=Path)
    ap.add_argument("input", type=Path)
    ap.add_argument("out", type=Path)
    ap.add_argument("--codec", choices=["htj2k", "av1", "auto"], default="auto")
    ap.add_argument("--preset")
    ap.add_argument("--jobs", type=int, default=4)
    a = ap.parse_args()
    if not PACK.exists():
        sys.exit(f"no {PACK}: cargo build --release -p pack-series")
    codec = AUTO if a.codec == "auto" else a.codec
    try:
        s, ds = dicom_series.series(a.input)
        meta = dicom_series.display(ds)
        preset = a.preset or preset_for(meta)
        coded = ingest.coded(a.build, s, s.n, codec, a.jobs, preset=preset)
    except (dicom_series.Refused, ingest.Refused) as e:
        sys.exit(f"{a.input.name}: nothing written — {e}")
    meta = {"frameCount": s.n, **meta, "min": s.lo, "max": s.hi, "codec": codec,
            **({"representation": "optimized", "preset": preset} if codec == "av1" else {}),
            "digests": ingest.digests(s, s.n, codec)}
    with tempfile.TemporaryDirectory() as tmp:
        for i, data in coded:
            (Path(tmp) / f"{i:03d}.{codec}").write_bytes(data)
        meta_path = a.out.with_suffix(".metadata.json")
        meta_path.write_text(json.dumps(meta, indent=1) + "\n")
        subprocess.run([PACK, "--metadata", meta_path, "--frames", tmp, "--output", a.out], check=True, capture_output=True)
    print(f"{a.input.name}: {s.n} frames, {sum(len(d) for _, d in coded)} B {codec}, every one exact → {a.out}")


if __name__ == "__main__":
    main()
