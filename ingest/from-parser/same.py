#!/usr/bin/env python3
"""Both ingests on one set, at --jobs 1, 2 and 4: every .sbnd byte-identical, or both refuse it; with Q G, the
optimal-quality series beside it too.

The Python ingest's bundle is ingest.py's HTJ2K codestreams and digests (or its `lossy` payloads), packed by
pack-series under the metadata from_dicom.py writes for the keys the frame attributes decide; the Rust one is
from-parser on mirror.py's output.

usage: same.py BUILD SET_DIR WORK [Q G]   — exit 0 when the two agree, printing one line
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


def display(s, meta):
    return {"width": s.w, "height": s.h, "channels": s.ch, "bitsAllocated": 8 if s.stored <= 8 else 16,
            "bitsStored": s.stored, "highBit": s.stored - 1, "signed": s.signed, "photometric": meta["photometric"]}


def pack(coded, m, suffix, out):
    frames = out.parent / "py-frames"
    shutil.rmtree(frames, ignore_errors=True)
    frames.mkdir()
    for i, data in coded:
        (frames / f"{i:03d}.{suffix}").write_bytes(data)
    (frames / "metadata.json").write_text(json.dumps(m, indent=1) + "\n")
    subprocess.run([PACK, "--metadata", frames / "metadata.json", "--frames", frames, "--output", out], check=True,
                   capture_output=True)
    shutil.rmtree(frames)


def python_bundle(build, s, meta, jobs, out):
    try:
        coded = ingest.coded(build, s, s.n, "htj2k", jobs)
    except ingest.Refused as e:
        return f"refused: {e}"
    pack(coded, ingest.metadata(s, display(s, meta), "htj2k"), "htj2k", out)
    return None


def cut(s):
    """The product's form: unsigned D over 10 always its depth cut (docs/av1/payload-format.md §Depth cut)."""
    return not s.signed and s.stored > ingest.CUT_DEPTH


def optimal_path(exact, q, g, s):
    return exact.with_name(f"{exact.stem}-q{q}-g{g}{'-cut' if cut(s) else ''}.sbnd")


def python_optimal(build, s, meta, jobs, q, g, exact):
    try:
        if s.signed and int(s.hi + s.offset).bit_length() > ingest.CUT_DEPTH:
            raise ingest.Refused("signed over 10 bits after the offset: no product form")
        coded = ingest.coded(build, s, s.n, "av1", jobs, lossy=(q, g, cut(s)))
    except ingest.Refused as e:
        return f"refused: {e}"
    lossy = dict(q=q, g=g, depth=ingest.lossy_header(s, q, g, cut(s))["depth"], **({"bitsStored": s.stored} if cut(s) else {}))
    m = {"frameCount": s.n, **display(s, meta), "min": s.lo, "max": s.hi, "codec": "av1", "lossy": lossy,
         "exactSeries": exact.stem, "sourceFingerprint": ingest.source_fingerprint(s, s.n)}
    pack(coded, m, "av1", optimal_path(exact, q, g, s))
    return None


def rust_bundle(series, jobs, out, oq=None):
    flags = ["--optimal-quality", str(oq[0]), "--group", str(oq[1])] if oq else []
    r = subprocess.run([RUST, series, out, "--jobs", str(jobs), *flags], capture_output=True, text=True)
    return None if r.returncode == 0 else f"refused: {r.stderr.strip()}"


def outcome(path, why):
    return path.read_bytes() if path.exists() else why or "refused: nothing written"


def same(build, set_dir, work, oq=None):
    s = size.Set(set_dir)
    meta = json.loads((set_dir / "metadata.json").read_text())
    shutil.rmtree(work, ignore_errors=True)
    work.mkdir(parents=True)
    series = mirror.mirror(set_dir, work / "parsed")
    outcomes = {}
    for jobs in JOBS:
        for side in ("py", "rs"):
            (work / f"{side}{jobs}").mkdir()
            out = work / f"{side}{jobs}" / "series.sbnd"
            if side == "rs":
                why = rust_bundle(series, jobs, out, oq)
                optimal = oq and outcome(optimal_path(out, *oq, s), why)
            else:
                why = python_bundle(build, s, meta, jobs, out)
                optimal = oq and (why or outcome(optimal_path(out, *oq, s), python_optimal(build, s, meta, jobs, *oq, out)))
            outcomes[side, jobs] = outcome(out, why), optimal if oq else None
    for part, kind in ((0, "exact"), (1, "optimal-quality")):
        values = {k: v[part] for k, v in outcomes.items()}
        if part and not oq:
            break
        bundles = set(values.values())
        if len(bundles) == 1 and not isinstance(next(iter(bundles)), str):
            continue
        if not all(isinstance(v, str) for v in bundles):
            kinds = {k: (v if isinstance(v, str) else f"{len(v)} B") for k, v in values.items()}
            return False, f"{set_dir.name}: {kind} DIFFER {kinds}"
    exact, optimal = outcomes["py", 1]
    shown = lambda v: v if isinstance(v, str) else f"{len(v)} B"
    if isinstance(exact, str):
        return True, f"{set_dir.name}: both refuse — {exact} | {outcomes['rs', 1][0]}"
    line = f"{set_dir.name}: {len(outcomes)} bundles byte-identical, {len(exact)} B, {s.n} frames"
    return True, line + (f"; optimal quality Q {oq[0]} G {oq[1]}: {shown(optimal)} | {shown(outcomes['rs', 1][1])}" if oq else "")


if __name__ == "__main__":
    ok, line = same(Path(sys.argv[1]), Path(sys.argv[2]), Path(sys.argv[3]), tuple(map(int, sys.argv[4:6])) or None)
    print(line)
    sys.exit(0 if ok else 1)
