"""Each frame's digest as the client's decoder worker checks it — docs/FIXTURES.md §Frame digests."""
import hashlib

import numpy as np
import xxhash

ALGORITHM = "xxh3-64"


def frame_digest(samples, wide, signed):
    """samples: (h, w, ch) values; `wide` as the decoder hands them on, two bytes a sample, else one."""
    dtype = ("<i2" if signed else "<u2") if wide else ("i1" if signed else "u1")
    return xxhash.xxh3_64_hexdigest(np.ascontiguousarray(samples, dtype=dtype).tobytes())


def series_digests(s, n, wide):
    """`metadata.json`'s `frameDigests` for frames [0, n) of a size.Set, each from samples its checksum vouches for."""
    frames = []
    for i in range(n):
        px = s.frame(i)
        if hashlib.sha256(px.tobytes()).hexdigest() != s.truth[i]:
            raise ValueError(f"frame {i}: samples do not match {i:03d}.sha256")
        frames.append(frame_digest(px, wide, s.signed))
    return {"algorithm": ALGORITHM, "frames": frames}
