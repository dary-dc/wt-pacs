# lab/av1/item — the AV1 item, written and read

Queue row 39 (UNIFY) of [`docs/av1/queue.md`](../../../docs/av1/queue.md): the format of
[`docs/av1/item-format.md`](../../../docs/av1/item-format.md), built end to end. The client's half is
`client/downloader/av1*.js` ([`client/downloader/README.md`](../../../client/downloader/README.md)).

```bash
lab/av1/tools.sh && ARMS=simd lab/av1/dav1d-wasm/build.sh     # aomenc 3.15.1, native dav1d, dav1d-WASM
FRAMES=1 OUT_ROOT=/tmp/x lab/scripts/gen_htj2k_fixtures.sh g160 # OpenJPH 0.31.0, built once
lab/av1/item/build.sh                                          # the check's in-process decoders (decode.cpp)
P=lab/av1/.venv/bin/python                                     # numpy, from lab/av1/requirements.txt
$P lab/av1/item/ingest.py lab/.av1-build lab/av1/data/rf_fluoro OUT --representation optimized --preset good:6
target/release/pack-study --metadata OUT/metadata.json --frames OUT --output rf_fluoro.sbnd
node lab/av1/item/check.mjs OUT                                # every item through the client's reader
$P lab/av1/item/make_golden.py lab/.av1-build                  # the client's golden items and probes
```

**`ingest.py`** reads a set as `lab/av1/fetch_data.py` writes it and writes `NNN.av1` items, or with
`--codec htj2k` the served `NNN.htj2k` codestreams (OpenJPH, reversible, 5 decompositions, 64² blocks,
RPCL — kept by row 70, [`docs/decode/README.md`](../../../docs/decode/README.md) §Encoder settings; a signed series coded shifted and its SIZ marked signed), `NNN.sha256` (the source's checksums,
copied) and `metadata.json` (`"codec": "av1"` and the representation for AV1). It writes nothing at all
unless every frame decodes back in-process (`decode.cpp`: dav1d and OpenJPH, no subprocess, no file):
each AV1 stream unit alone, at the depth it was coded at, merged as the client merges, and each HTJ2K
codestream as written, at its depth and signedness, against the checksum written when the source was
fetched. Each frame is read and offset once. Refused before coding: RGB over 8 bits, grey over 14
bits after the offset unless `--split K` names the low bits coded apart (k ≤ 8, up to 16 bits, a top of
at most 12 — row 43's matrix). Without it, optimized takes k by depth (`optimized_split`, row 72: 0 up to 9 bits, 3 at
13, 2 otherwise) and plain k = max(0, b − 12). `--preset` is `cpu0`, `good:N` or `allintra:N` (row 14 names the fastest
within 2 % of cpu0's bytes per content); frames are coded in `--jobs` processes, each frame's
stream in an encoder run of its own, so the bytes do not depend on the worker count (§One pipeline). RGB streams carry BT.709 primaries, the sRGB transfer and the identity matrix — AV1's RGB
signal; with the identity matrix alone Chromium's WebCodecs reports a BT.709 matrix, the 4:4:4
probes fail and every colour item goes to dav1d-WASM.

**`pack-study`** takes `NNN.av1` when the metadata says `"codec": "av1"` and `NNN.htj2k` otherwise.

**`make_golden.py`** writes seven synthetic 64×48 sources — 8, 10, 12 and 14-bit grey, 11 and 13-bit
signed, 8-bit RGB — with their checksums, and codes each through `ingest.py` in both representations
into `client/conformance/av1/items/`; and a 16×16 unit per layout WebCodecs may take (grey 8 and
10-bit, 4:4:4 8 and 10-bit) into `client/downloader/av1-probe.js`, with the FNV-1a of its coded
planes, checked against native dav1d before it is written.

## Checked (2026-10-05)

* **Real series, every item exact.** The first 8 frames of four series of
  [`docs/FIXTURES.md`](../../../docs/FIXTURES.md) §AV1 data, both representations, cpu0: 96 items,
  every one written (ingest's check) and every one decoded to its source by `check.mjs`. Optimized
  over plain: fluoroscopy 0.918, CT 0.990, MR 0.964, ultrasound 0.861 — row 28's ratios
  (fluoroscopy 0.942/1.027 = 0.917, MR 0.964, ultrasound 0.861) to the third digit.
* **The check catches what it must.** With the low stream left out of the merge, with RGB's planes
  unpermuted, or with the inverse colour transform's ⌊/4⌋ as ⌊/2⌋, `ingest.py` writes nothing and
  names the frame (3 mutations, each on a 13-bit signed and an RGB source, each caught).
* **Every depth and split (row 43).** Grey of 8–16 bits after the offset, unsigned and signed, at every
  k a per-depth rule could pick, synthetic and all nine real series, every frame exact natively, in
  Node and in three engines; 90 golden items in `client/conformance/av1/items/matrix/` — the counts,
  the mutations and the reader's corrected mask are [`lab/av1/splitok`](../splitok/README.md) §Checked.
* **A split item through two decoders (row 47).** With decoder config `mixed`, a top over 10 bits through
  dav1d-WASM and the low through WebCodecs: the same items exact in three engines, faster than one decoder,
  slower than w10 — [`lab/av1/mixdec`](../mixdec/README.md).

## One pipeline (2026-10-06, queue row 52)

`ingest.py --codec htj2k` replaced the HTJ2K ingest every lab row called (`lab/av1/speed/make_frames.py`'s
`htj2k()`: a frame at a time, `ojph_expand` and `sign_htj2k.py` as subprocesses through files), and both codecs'
check moved in-process (`decode.cpp`). `bench.py` sets it against a checkout of the revision before (`c566011^`).

* **Every output byte as before.** `bench.py same` at `good:6`, `--jobs 4`: all 23 sets fetched for rows 2, 45 and
  46 (the nine of row 2, the breast family's fourteen), HTJ2K, AV1 plain and AV1 optimized — **69/69 cells
  identical** by each file's SHA-256, 2 088 files a side; `ffdm_d`'s two AV1 cells at `--jobs 1`, since four
  aomenc at once on its 13.6 M-sample frames (3.5 GB each) exceed the container's memory, old and new alike.
* **The check, in-process: 0.63–0.84 of the subprocess's time a frame on AV1, 0.37–0.46 on HTJ2K**, every cell's
  range disjoint (n = 3, arms interleaved, `bench.py check`, a stream's first unit): fluoroscopy 40.1 → 29.9 ms
  (AV1) and 9.8 → 4.2 (HTJ2K), ultrasound 38.4 → 24.2 and 9.4 → 3.5, the 10-bit volume 46.8 → 33.4 and
  13.2 → 4.9, the GE projections 326.5 → 273.0 and 55.5 → 25.4.
* **A study, wall and CPU** (`bench.py time`, `good:6`, n = 3 interleaved, two arms n = 2 after a container
  restart; four cores, nothing else running). HTJ2K at one worker: CPU 1.0 → 0.7 s on the fluoroscopy and
  1.4 → 1.1 s on the 10-bit volume (−21 to −27 %, every round), wall 0.7 → 0.6 and 1.2 → 1.0 s; the old ingest
  had no workers, the new one fills four, 0.3 and 0.4 s. AV1: a tie, since the encode is ~99 % of it
  (3.3 s a frame against the check's 30–40 ms) — CPU −2.0 %, −3.6 % and +1.7 % at one worker on the fluoroscopy,
  the ultrasound and the 10-bit volume, ranges overlapping; four workers 3.5–3.9× one, old and new alike.
* **Mutations, each refused by the check and only in its codec:** one sample +1 in the AV1 decode (both sets
  AV1 refused, HTJ2K written), one sample +1 in the HTJ2K decode (the reverse), the signed SIZ left unmarked
  (the CT refused, the fluoroscopy written).

**The bytes depended on `--jobs`** *(row 52; corrected by row 71: no longer, below)*. On the 10-bit volume, AV1 at
2 and 4 workers differed from 1 worker in the frames after a chunk's start (12–23 at 2; 6–10 and 12–17 at 4) —
libaom carries state across keyframes within one run; every frame was exact either way.

**One encoder run per frame (row 71, 2026-10-07): the bytes no longer depend on `--jobs`, for +12 % encode CPU.**
`bench.py workers`, OLD this revision with only `av1()`'s encoder loop chunked again (`good:6`, the first 16 frames of each of the 23 sets of rows 2, 45 and 46, 252 items): **every
set byte-identical at 1, 2 and 4 workers**, `ffdm_d` at 1 and 2 (four aomenc on its frames exceed the container's
memory, as before). Bytes **0.99987–1.00015 of the chunked ingest's** at one worker, 0.999998 in total: a one-frame
run writes aomenc's reduced still-picture sequence header, the one every golden item already carried, and the
two-pass statistics of one frame instead of the chunk's. Forcing video mode (`--force-video-mode=1`) instead kept
the chunked bytes on most series but rewrote 106 golden items, so it was not taken; one golden item that row 80
wrote while it was on the branch (`grey420/g8`) is regenerated, exact through the gate. Mutation: the chunked
ingest as the new arm fails the check on both tomosynthesis volumes. **Time** (`bench.py time`, whole series,
n = 5, arms interleaved, four cores, nothing else running), new against chunked, wall at 1 worker: fluoroscopy
61.0 [59.5–61.4] against 54.1 [53.2–55.7] s, the 10-bit volume 103.4 [101.7–108.8] against 92.2 [91.2–92.7],
the ultrasound 165.7 [160.9–169.4] against 147.8 [145.2–151.9] — +12–13 % CPU, every range disjoint; at 4
workers +6–13 % wall (17.7 against 15.7, 25.9 against 24.4, 43.0 against 39.8 s). Whole series, bytes
0.99997–0.99998 of chunked; the chunked ingest gave three different totals for the 10-bit volume at 1, 2 and 4
workers, the new one the same in every round. Adopted under the row's rule (≤ 5 % bytes, under twice the time).
