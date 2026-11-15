"""Stage 3's strip series: every frame's three strips in I1's profile, cut at TLM's boundaries into Layout 1's
band-major entries (bands = levels 2, 1, 0; entry e = b·N·T + f·T + t), loose as pack-series reads them, with each
picture's truth. lab/htj2k-tiles/improve/README.md

    stage3_prep.py BUILD DATA OUT VOLUME... [--jobs 4]
"""
import argparse
import hashlib
import json
import tempfile
from concurrent.futures import ProcessPoolExecutor
from pathlib import Path

import numpy as np

from offline import PHONE, SIDEWAYS, decompositions, encode, level_of, prefix_end, profile, reduced, strip_rows, tile_parts

BANDS = 3
STRIPS = 3


def digest(px):
    return hashlib.sha256(px.astype("<u2").tobytes()).hexdigest()


def frame(job):
    build, data, vol, i, w, h, bits, nl, levels = job
    top = (1 << bits) - 1
    samples = np.frombuffer((data / vol / f"{i:03d}.raw").read_bytes(), "<u2").reshape(h, w).astype(np.int64)
    rows = strip_rows(h, nl)
    with tempfile.TemporaryDirectory() as tmp:
        cuts = []
        for r0, r1 in rows:
            cs = encode(build, samples[r0:r1], bits, profile(nl), Path(tmp))
            header, tlm, _ = tile_parts(cs)
            ends = [prefix_end(header, tlm, nl, lv) for lv in (2, 1)]
            cuts.append([cs[:ends[0]], cs[ends[0]:ends[1]], cs[ends[1]:]])
    truth = {0: digest(samples)}
    for lv in levels:
        truth[lv] = digest(np.concatenate([np.clip(reduced(samples[r0:r1], lv), 0, top) for r0, r1 in rows]))
    return i, cuts, truth


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("build", type=Path)
    ap.add_argument("data", type=Path)
    ap.add_argument("out", type=Path)
    ap.add_argument("volumes", nargs="+")
    ap.add_argument("--jobs", type=int, default=4)
    a = ap.parse_args()
    for vol in a.volumes:
        meta = json.loads((a.data / vol / "metadata.json").read_text())
        w, h, bits, n = meta["width"], meta["height"], meta["bitsStored"], meta["frameCount"]
        nl = decompositions(w, h)
        levels = sorted({level_of(w, h, PHONE), level_of(w, h, SIDEWAYS)} - {0})
        out = a.out / f"{vol}-bands"
        out.mkdir(parents=True, exist_ok=True)
        frames = [None] * n
        with ProcessPoolExecutor(a.jobs) as pool:
            jobs = [(a.build, a.data, vol, i, w, h, bits, nl, levels) for i in range(n)]
            for i, cuts, truth in pool.map(frame, jobs):
                for t, bands in enumerate(cuts):
                    for b, part in enumerate(bands):
                        (out / f"{b * n * STRIPS + i * STRIPS + t:03d}.htj2k").write_bytes(part)
                frames[i] = {"bands": [[len(p) for p in bands] for bands in cuts], "truth": truth}
                print(vol, i, flush=True)
        (out / "metadata.json").write_text(json.dumps({"frameCount": BANDS * n * STRIPS, "codec": "htj2k"}))
        (out / "frames.json").write_text(json.dumps({
            "volume": vol, "C": w, "R": h, "bits": bits, "NL": nl, "N": n, "T": STRIPS, "B": BANDS,
            "strips": strip_rows(h, nl), "fit": {"phone": level_of(w, h, PHONE), "sideways": level_of(w, h, SIDEWAYS)},
            "frames": frames}))


if __name__ == "__main__":
    main()
