# lab/av1/exact/coded-frame — the ingest, checked and timed

What was measured on [`ingest/coded-frames`](../../../../ingest/coded-frames/README.md), the ingest that writes a
series as coded frames ([`docs/av1/payload-format.md`](../../../../docs/av1/payload-format.md)). `bench.py` sets it
against a checkout of the ingest it replaced.

## Checked (2026-10-05)

* **Real series, every payload exact.** The first 8 frames of four series of
  [`docs/FIXTURES.md`](../../../../docs/FIXTURES.md) §AV1 data, both representations, cpu0: 96 payloads,
  every one written (ingest's check) and every one decoded to its source by `check.mjs`. Optimized
  over plain: fluoroscopy 0.918, CT 0.990, MR 0.964, ultrasound 0.861 — row 28's ratios
  (fluoroscopy 0.942/1.027 = 0.917, MR 0.964, ultrasound 0.861) to the third digit.
* **The check catches what it must.** With the low stream left out of the merge, with RGB's planes
  unpermuted, or with the inverse colour transform's ⌊/4⌋ as ⌊/2⌋, `ingest.py` writes nothing and
  names the frame (3 mutations, each on a 13-bit signed and an RGB source, each caught).
* **Every depth and split (row 43).** Grey of 8–16 bits after the offset, unsigned and signed, at every
  k a per-depth rule could pick, synthetic and all nine real series, every frame exact natively, in
  Node and in three engines; 90 golden payloads in `client/contract/av1/payloads/matrix/` — the counts,
  the mutations and the reader's corrected mask are [`lab/av1/exact/split`](../split/README.md) §Checked.
* **A split payload through two decoders (row 47).** With decoder config `mixed`, a top over 10 bits through
  dav1d-WASM and the low through WebCodecs: the same payloads exact in three engines, faster than one decoder,
  slower than w10 — [`lab/av1/decode/mixed`](../../decode/mixed/README.md).

## One pipeline (2026-10-06, queue row 52)

`ingest.py --codec htj2k` replaced the HTJ2K ingest every lab row called (`lab/av1/decode/per-frame/make_frames.py`'s
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
* **A series, wall and CPU** (`bench.py time`, `good:6`, n = 3 interleaved, two arms n = 2 after a container
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
`bench.py workers`, OLD this revision with only `av1()`'s encoder loop chunked again (`good:6`, the first 16 frames of each of the 23 sets of rows 2, 45 and 46, 252 payloads): **every
set byte-identical at 1, 2 and 4 workers**, `ffdm_d` at 1 and 2 (four aomenc on its frames exceed the container's
memory, as before). Bytes **0.99987–1.00015 of the chunked ingest's** at one worker, 0.999998 in total: a one-frame
run writes aomenc's reduced still-picture sequence header, the one every golden payload already carried, and the
two-pass statistics of one frame instead of the chunk's. Forcing video mode (`--force-video-mode=1`) instead kept
the chunked bytes on most series but rewrote 106 golden payloads, so it was not taken; one golden payload that row 80
wrote while it was on the branch (`grey420/g8`) is regenerated, exact through the gate. Mutation: the chunked
ingest as the new arm fails the check on both tomosynthesis volumes. **Time** (`bench.py time`, whole series,
n = 5, arms interleaved, four cores, nothing else running), new against chunked, wall at 1 worker: fluoroscopy
61.0 [59.5–61.4] against 54.1 [53.2–55.7] s, the 10-bit volume 103.4 [101.7–108.8] against 92.2 [91.2–92.7],
the ultrasound 165.7 [160.9–169.4] against 147.8 [145.2–151.9] — +12–13 % CPU, every range disjoint; at 4
workers +6–13 % wall (17.7 against 15.7, 25.9 against 24.4, 43.0 against 39.8 s). Whole series, bytes
0.99997–0.99998 of chunked; the chunked ingest gave three different totals for the 10-bit volume at 1, 2 and 4
workers, the new one the same in every round. Adopted under the row's rule (≤ 5 % bytes, under twice the time).
