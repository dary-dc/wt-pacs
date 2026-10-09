# ingest/coded-frames — a series as coded frames, written and checked

The format of
[`docs/av1/payload-format.md`](../../docs/av1/payload-format.md), built end to end. The client's half is
`client/decode/av1*.js` ([`client/README.md`](../../client/README.md)).

```bash
lab/av1/tools/tools.sh && VARIANTS=simd client/decode/wasm/dav1d/build.sh   # aomenc 3.15.1, native dav1d, dav1d-WASM
FRAMES=1 OUT_ROOT=/tmp/x lab/scripts/gen_htj2k_fixtures.sh g160 # OpenJPH 0.31.0, built once
ingest/coded-frames/build.sh                                            # the check's in-process decoders (decode.cpp)
P=lab/av1/.venv/bin/python                                              # numpy, from lab/av1/requirements.txt
$P ingest/coded-frames/ingest.py lab/.av1-build lab/av1/data/rf_fluoro OUT --representation optimized --preset good:6
target/release/pack-series --metadata OUT/metadata.json --frames OUT --output rf_fluoro.sbnd
node ingest/coded-frames/check.mjs OUT                                  # every payload through the client's reader
$P ingest/coded-frames/make_golden.py lab/.av1-build                    # the client's golden payloads and probes
```

**`ingest.py`** reads a set as `lab/av1/fetch_data.py` writes it and writes `NNN.av1` payloads, or with
`--codec htj2k` the served `NNN.htj2k` codestreams (OpenJPH, reversible, 5 decompositions, 64² blocks,
RPCL — [`docs/decode/README.md`](../../docs/decode/README.md) §Encoder settings; a signed series coded shifted and its SIZ marked signed), `NNN.sha256` (the source's checksums,
copied) and `metadata.json` (`"codec": "av1"` and the representation for AV1). It writes nothing at all
unless every frame decodes back in-process (`decode.cpp`: dav1d and OpenJPH, no subprocess, no file):
each AV1 stream unit alone, at the depth it was coded at, merged as the client merges, and each HTJ2K
codestream as written, at its depth and signedness, against the checksum written when the source was
fetched. Each frame is read and offset once. Refused before coding: RGB over 8 bits, grey over 14
bits after the offset unless `--split K` names the low bits coded apart (k ≤ 8, up to 16 bits, a top of
at most 12 — the matrix of `make_golden.py --matrix`). Without it, optimized takes k by depth (`optimized_split`: 0 up to 9 bits, 3 at
13, 2 otherwise) and plain k = max(0, b − 12). `--preset` is `cpu0`, `good:N` or `allintra:N` (`lab/av1/bytes/README.md` §ENC names the fastest
within 2 % of cpu0's bytes per content); frames are coded in `--jobs` processes, each frame's
stream in an encoder run of its own, so the bytes do not depend on the worker count ([`lab/av1/exact/coded-frame`](../../lab/av1/exact/coded-frame/README.md) §One pipeline). RGB streams carry BT.709 primaries, the sRGB transfer and the identity matrix — AV1's RGB
signal; with the identity matrix alone Chromium's WebCodecs reports a BT.709 matrix, the 4:4:4
probes fail and every colour payload goes to dav1d-WASM.

**`pack-series`** takes `NNN.av1` when the metadata says `"codec": "av1"` and `NNN.htj2k` otherwise.

**`make_golden.py`** writes seven synthetic 64×48 sources — 8, 10, 12 and 14-bit grey, 11 and 13-bit
signed, 8-bit RGB — with their checksums, and codes each through `ingest.py` in both representations
into `client/contract/av1/payloads/`; and a 16×16 unit per layout WebCodecs may take (grey 8 and
10-bit, 4:4:4 8 and 10-bit) into `client/decode/av1-probe.js`, with the FNV-1a of its coded
planes, checked against native dav1d before it is written.

What was measured on it — every payload exact on real series, the check's mutations, one pipeline for both
codecs — is [`lab/av1/exact/coded-frame`](../../lab/av1/exact/coded-frame/README.md).
