# regiondecode

Region decode, the container half: a 1:1 phone viewport decoded alone, and one asked frame cut into stripes across
idle decoder workers, each exact against the encoder's input. Queue row 109 (REGIONDECODE) of
[`docs/av1/queue.md`](../../../../docs/av1/queue.md), run as
[`docs/decode/levers-protocol.md`](../../../../docs/decode/levers-protocol.md) §L2 (on `claude/av1`); the reading is in
[`docs/decode/README.md`](../../../../docs/decode/README.md) §Region decode, measured.

```bash
lab/av1/fetch_data.sh dbt12_ea1141 dbt12_c dbtproj_ge syn2d_d ffdm_d
FRAMES=1 OUT_ROOT=/tmp/x lab/scripts/gen_htj2k_fixtures.sh g160    # builds ojph_compress, ojph_expand once
VARIANTS=plain client/decode/wasm/dav1d/build.sh                    # fetches the pinned emsdk 3.1.74
lab/av1/decode/region/build.sh                                      # the three decoders, ~2 min
D=lab/av1/data; lab/av1/.venv/bin/python lab/av1/decode/region/make_frames.py lab/.av1-work/region \
  g512 $D/dbt12_ea1141 $D/dbt12_c $D/dbtproj_ge $D/syn2d_d $D/ffdm_d
for r in $(seq 0 9); do NODE_PATH=$(npm root -g) node lab/av1/decode/region/run.mjs --rounds 1 --first-round $r \
  --out lab/av1/decode/region/raw/region.jsonl; done                # ~10 min a round; --mutate flip|shift
node lab/av1/decode/region/summary.mjs lab/av1/decode/region/raw/region.jsonl
```

**Frames.** The first 4 frames of `g512` (generated as `gen_htj2k_fixtures.sh` makes it) and five sound breast series
— tomosynthesis 614×1359 and 931×2124, projections 1914×2572, synthesized 2D 2394×2850, full-field 3328×4096 — in
the served profile (RPCL, one layer, one tile, 64² blocks, five levels), beside their samples; each input's sha256 is
checked against the set's before anything is written.

**Decoders** ([`build.sh`](build.sh)). `ref`: the delivered OpenJPH build's recipe
(`client/decode/wasm/build/inside.sh`) on the lab's emsdk 3.1.74 — not byte-identical to the shipped `.wasm`
(246 241 against 246 209 B), since that build's container was not reachable. `pool`: row HTJ2KMT's two-thread build.
`ohtj`: OpenHTJ2K v0.19.0 (`e0f7ae8`), WASM SIMD, one thread, through [`region.cpp`](region.cpp) — its line decoder
with `set_row_range` and `set_col_range` for a rectangle, none for the whole frame — and
[`decoded-bytes.patch`](decoded-bytes.patch), one addition per code-block, counting the bytes of the blocks it decodes.

**An ask** ([`index.html`](index.html), [`worker.js`](worker.js)). Five decoder workers stay up in one page: `ref`,
`pool` and three `ohtj`. The frames are fetched into every worker first, so an ask names a frame and a rectangle; the
time runs from the page posting it until the last worker answers, its rectangle copied from its heap into a
`SharedArrayBuffer`. Arms: `ref`, `oh` (OpenHTJ2K, whole frame), `k2` and `k3` (equal horizontal stripes on 2 and 3
workers), `pool` on 1914×2572 and up, and `centre` and `corner` (1080 wide, 2400 tall, at the centre and the top-left;
clamped to the frame, so on 931×2124 they are the whole frame) on 931×2124 and up.

**Rounds.** A fresh headless Chromium per (round × throttle), on 4 cores (`taskset`), 4× each core a quarter as fast
(`lab/scripts/cpu_throttle.mjs`); throttles, sets and arms in Williams orders (`lab/order.mjs`). Each arm decodes every
frame once to check, then 3 timed passes. **Checked** on every check pass: each rectangle's sha256 against the same
rectangle of the input, and the assembled frame's against the set's checksum, the shared buffer zeroed first.
`--mutate flip` (one sample of every output) took all 35 arms to 0/4; `--mutate shift` (every region and stripe one
row down) took all 23 region and stripe arms to 0/4.

**Pins.** Node 22.22.0; playwright 1.56.1's Chromium 141.0.7390.37; OpenJPH 0.31.0 (`c68064d`); OpenHTJ2K v0.19.0
(`e0f7ae8`, BSD-3-Clause, [`licensing.md`](../../../../docs/av1/licensing.md)); emscripten 3.1.74. Nothing built or
fetched is committed; `raw/` holds the rounds as measured.
