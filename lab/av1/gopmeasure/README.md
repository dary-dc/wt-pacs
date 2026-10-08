# gopmeasure — frame groups in lossless AV1, measured to a pre-registered rule

Queue row 100 (GOPMEASURE) of [`docs/av1/queue.md`](../../../docs/av1/queue.md) runs the protocol
`docs/av1/gop-protocol.md` (on `claude/av1` at 821a368; § numbers below are its) as written: ρ before any encoder (§2), the codings
(§3), exactness, bytes and the decode cost of an ask (§4), then the rule fixed before the data (§5) and the
predictions (§6). The session that ran it read the protocol alone.

```bash
lab/av1/tools.sh && ARMS=simd lab/av1/dav1d-wasm/build.sh   # libaom 3.15.1, SVT-AV1 v4.2.0, dav1d 1.5.4, dav1d-WASM
lab/av1/fetch_data.sh dbts_a1 … dbts_c5                     # 15 sound DBT volumes, five a system
P=/path/to/venv/bin/python D=lab/av1/data W=lab/.av1-work/gop B=lab/.av1-build
$P lab/av1/gopmeasure/rho_test.py && $P lab/av1/gopmeasure/rho.py $W/rho.jsonl $D/dbts_*          # ~1 h, 4 cores
$P lab/av1/gopmeasure/arc.py $D $W/arc.jsonl dbts_a1 … dbts_c5          # fetches each source again, reads its header
$P lab/av1/gopmeasure/mutate.py $B $D/dbts_a3 && $P lab/av1/gopmeasure/mutate.py $B $D/dbts_b4   # 10- and 8-bit tops
$P lab/av1/gopmeasure/gop.py $B $W $W/bytes.jsonl $D/dbts_* --encoder aom --presets good:6 --keep dbts_a1,dbts_b1,dbts_c1
$P lab/av1/gopmeasure/gop.py $B $W $W/bytes.jsonl $D/dbts_* --encoder htj2k
$P lab/av1/gopmeasure/gop.py $B $W $W/bytes.jsonl $D/dbts_{a1,b1,c1} --encoder aom --presets cpu0 --groups 1,2,4,8,16
$P lab/av1/gopmeasure/gop.py $B $W $W/bytes.jsonl $D/dbts_{a1,b1,c1} --encoder svt --presets 8,0 --groups 1,2,4,8,16
$P lab/av1/gopmeasure/gop.py $B $W $W/bytes.jsonl $D/dbts_* --encoder aom --groups 8,16 --altref
$P lab/av1/gopmeasure/gop.py $B $W $W/bytes.jsonl $D/dbts_{a1,b1,c1} --encoder aom --representation plain
$P lab/av1/gopmeasure/items.py $B $W $W/frames $D/dbts_{a1,b1,c1}
NODE_PATH=$(npm root -g) node lab/av1/gopmeasure/time.mjs --frames $W/frames --rounds 10 --out $W/time.json
$P lab/av1/gopmeasure/report.py $W
```

**`rho.py`** takes each frame's LOCO-I median-predictor residual on the optimized representation's top and low
streams (`ingest.plan`), and for every pair of adjacent slices and every 64×64 block of frame t at least 8 px from
the edge, the Pearson correlation with frame t + 1's residual at the best integer offset within ±8 px and at
offset 0; per series the 10th, 50th and 90th percentiles over blocks and pairs. A block where either residual is
constant (the air around the breast) has no correlation and is left out. **`rho_test.py`** is §2's mutation: frames
of independent noise give ρ ≈ 0, a frame repeated gives 1, and the predictor takes each of its three branches.

**`arc.py`** fetches each set's DICOM again (checked against `data.json`'s pin), reads the X-Ray 3D Acquisition
Sequence (0018,9507) from its header and deletes the file.

**`gop.py`** codes the middle 16 slices of each series (`--frames`) in groups of G: each group of each stream in an
encoder run of its own, libaom with `--kf-min-dist=G --kf-max-dist=G --auto-alt-ref=0|1` over `ingest.py`'s
arguments, SVT-AV1 `--lossless 1 --lp 1 --keyint G --irefresh-type 2 --scd 0 --enable-tf 0|1` with grey as 4:2:0 at
mid-grey chroma (it has no 4:0:0), each group decoded alone through native dav1d, merged as the client does and
checked against the checksum written at fetch; HTJ2K through `ingest.py`'s served profile on the same frames.
**`mutate.py`** is §4's mutation: one sample of one frame flipped, and a group's frames reordered, must each make a
run inexact, and the unmutated run must stay exact.

**`items.py`, `time.mjs`, `page.js`** time an ask in headless Chromium through the product's decoder worker
(`client/downloader/decoder.js`, `groupLength` G): a run's 16 frames asked in order, the top unit from the group
coding and the low unit from the intra one (the client decodes the low stream intra), each frame's decode by the
worker's own stamps and hashed against the truth (`--mutate` flips a sample, and every frame must then fail).
The dav1d-WASM arm is the same worker with `VideoDecoder` deleted (`dav1d-worker.js`). An ask at frame k of a group
costs the group's frames 0 … k; the summary is its mean over the run, per round, then the median over rounds.
