#!/usr/bin/env python3
"""Both ingests on one set, at --jobs 1, 2 and 4: every .sbnd byte-identical, or both refuse it.

The Python ingest's bundle is ingest.py's HTJ2K codestreams and digests, packed by pack-series under the metadata
from_dicom.py writes for the keys the frame attributes decide; the Rust one is from-parser on mirror.py's output.

usage: same.py BUILD SET_DIR WORK   — exit 0 when the two agree, printing one line
"""
import json
import os
import shutil
import subprocess
import sys
from pathlib import Path

HERE = Path(__file__).resolve().parent
ROOT = HERE.parents[1]
sys.path.insert(0, str(HERE))
sys.path.insert(0, str(ROOT / "ingest/coded-frames"))
sys.path.insert(0, str(ROOT / "lab/av1"))
import ingest  # noqa: E402
import mirror  # noqa: E402
import size  # noqa: E402

RELEASE = Path(os.environ.get("CARGO_TARGET_DIR", ROOT / "target")) / "release"
RUST, PACK = RELEASE / "from-parser", RELEASE / "pack-series"
JOBS = (1, 2, 4)


def python_bundle(build, s, meta, jobs, out):
    try:
        coded = ingest.coded(build, s, s.n, "htj2k", jobs)
    except ingest.Refused as e:
        return f"refused: {e}"
    display = {"width": s.w, "height": s.h, "channels": s.ch, "bitsAllocated": 8 if s.stored <= 8 else 16,
               "bitsStored": s.stored, "highBit": s.stored - 1, "signed": s.signed, "photometric": meta["photometric"]}
    m = ingest.metadata(s, display, "htj2k")
    frames = out.parent / "py-frames"
    shutil.rmtree(frames, ignore_errors=True)
    frames.mkdir()
    for i, data in coded:
        (frames / f"{i:03d}.htj2k").write_bytes(data)
    (frames / "metadata.json").write_text(json.dumps(m, indent=1) + "\n")
    subprocess.run([PACK, "--metadata", frames / "metadata.json", "--frames", frames, "--output", out], check=True,
                   capture_output=True)
    shutil.rmtree(frames)
    return None


def rust_bundle(series, jobs, out):
    r = subprocess.run([RUST, series, out, "--jobs", str(jobs)], capture_output=True, text=True)
    return None if r.returncode == 0 else f"refused: {r.stderr.strip()}"


def same(build, set_dir, work):
    s = size.Set(set_dir)
    meta = json.loads((set_dir / "metadata.json").read_text())
    shutil.rmtree(work, ignore_errors=True)
    work.mkdir(parents=True)
    series = mirror.mirror(set_dir, work / "parsed")
    outcomes = {}
    for jobs in JOBS:
        for side, make in (("py", lambda o: python_bundle(build, s, meta, jobs, o)), ("rs", lambda o: rust_bundle(series, jobs, o))):
            out = work / f"{side}{jobs}.sbnd"
            outcomes[side, jobs] = make(out) or out.read_bytes()
    bundles = set(outcomes.values())
    refused = [v for v in bundles if isinstance(v, str)]
    if len(bundles) == 1 and not refused:
        size_b = len(next(iter(bundles)))
        return True, f"{set_dir.name}: {len(outcomes)} bundles byte-identical, {size_b} B, {s.n} frames"
    if refused and all(isinstance(v, str) for v in outcomes.values()):
        return True, f"{set_dir.name}: both refuse — {outcomes['py', 1]} | {outcomes['rs', 1]}"
    kinds = {k: (v if isinstance(v, str) else f"{len(v)} B") for k, v in outcomes.items()}
    return False, f"{set_dir.name}: DIFFER {kinds}"


if __name__ == "__main__":
    ok, line = same(Path(sys.argv[1]), Path(sys.argv[2]), Path(sys.argv[3]))
    print(line)
    sys.exit(0 if ok else 1)
