#!/usr/bin/env python3
"""A synthetic DICOM series through from_dicom.py to OUT.sbnd, each frame read back out of the bundle, decoded and
compared with the samples the object was written from — the encoder's input, not the ingest's reader.

usage: from_dicom.py's BUILD, pack-series built --release:  python3 ingest/from-dicom/end_to_end_test.py BUILD
"""
import json
import struct
import subprocess
import sys
import tempfile
from pathlib import Path

import numpy as np

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE))
sys.path.insert(0, str(HERE.parent / "coded-frames"))
import ingest  # noqa: E402
import from_dicom_test as t  # noqa: E402


def frames(sbnd):
    """The bundle's frames in index order: series-bundle's header (magic, version, metadata length, n), then (offset, length) each."""
    b = sbnd.read_bytes()
    n = struct.unpack_from("<4sIII", b)[3]
    return [b[o:o + length] for o, length in (struct.unpack_from("<QI", b, 16 + 12 * i) for i in range(n))]


def samples(build, codec, data, h, w, ch):
    """One served frame decoded as the client does: h×w×ch in stored values."""
    if codec == "htj2k":
        return ingest.decoded(build, "htj2k", data, h * w * ch)[0]
    _, _, split, flags, offset, n = struct.unpack_from("<xBBBB3xII", data)
    (length,) = struct.unpack_from("<I", data, 16)
    frame = data[16 + 4 * n:16 + 4 * n + length]
    if split:
        (top,) = struct.unpack_from("<I", frame)
        units = [frame[4:4 + top], frame[4 + top:]]
    else:
        units = [frame]
    pictures = [ingest.decoded(build, "av1", u, h * w * 3)[0] for u in units]
    return ingest.merge(dict(split=split, flags=flags), pictures)[:h, :w] - offset


def through(build, work, name, px, codec, **tags):
    """px n×h×w×ch as an object of `tags`, ingested; whether every frame comes back out of the bundle as written."""
    src = t.save(t.obj(px, **tags), work / f"{name}.dcm")
    out = work / f"{name}-{codec}.sbnd"
    run = subprocess.run([sys.executable, HERE / "from_dicom.py", build, src, out, "--codec", codec, "--jobs", "2"],
                         capture_output=True, text=True)
    if run.returncode:
        return f"from_dicom.py failed: {run.stderr.strip()}"
    meta = json.loads(out.with_suffix(".metadata.json").read_text())
    got = frames(out)
    n, h, w, ch = px.shape
    if (len(got), meta["frameCount"], meta["width"], meta["height"]) != (n, n, w, h):
        return f"{len(got)} frames, metadata {meta['frameCount']} of {meta['width']}×{meta['height']}"
    same = sum(np.array_equal(samples(build, codec, f, h, w, ch), px[i]) for i, f in enumerate(got))
    return f"{same}/{n} frames as written"


def failed_pack(build, work, px):
    """A pack refused at its last step, the rename (a directory holds the name): what it left beside the name."""
    src = t.save(t.obj(px), work / "refused.dcm")
    out = work / "refused.sbnd"
    out.mkdir()
    run = subprocess.run([sys.executable, HERE / "from_dicom.py", build, src, out, "--codec", "htj2k"],
                         capture_output=True, text=True)
    left = sorted(p.name for p in work.iterdir() if p.name.startswith("refused.") and p.suffix != ".dcm")
    return run.returncode != 0 and "nothing written" in run.stderr, left


def main():
    build = Path(sys.argv[1]).resolve()
    rng = np.random.default_rng(7)
    ct = rng.integers(-2048, 2048, (3, 24, 32, 1))
    ct[0, 0, :4, 0] = [-2048, -1, 0, 2047]
    rgb = rng.integers(0, 256, (2, 16, 24, 3))
    with tempfile.TemporaryDirectory() as tmp:
        work = Path(tmp)
        for codec in ("htj2k", "av1"):
            said = through(build, work, "ct", ct, codec, signed=True, modality="CT")
            t.check(said == "3/3 frames as written", f"test_signed_ct_{codec}: 12-bit signed CT out of the bundle ({said})")
            said = through(build, work, "rgb", rgb, codec, bits=8, stored=8, photometric="RGB", modality="XC")
            t.check(said == "2/2 frames as written", f"test_rgb_{codec}: 8-bit RGB out of the bundle ({said})")
        said, left = failed_pack(build, work, ct & 0x7FF)
        t.check(said and left == ["refused.sbnd"],
                f"test_failed_pack: refused as nothing written, no sidecar, no partial ({said}, {left})")
    sys.exit(1 if t.failed else 0)


if __name__ == "__main__":
    main()
