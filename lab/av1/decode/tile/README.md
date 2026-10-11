# tile

Tiles as independent codestreams: a frame stored as k = 2 or 3 horizontal tiles, each its own HTJ2K codestream in
the served profile, decoded by k idle OpenJPH workers into one frame, against the whole frame on one worker. Queue
row 133 (TILEMEASURE) of [`docs/av1/queue.md`](../../../../docs/av1/queue.md) (it lives on `claude/av1`), run as
P-TILE in [`docs/decode/README.md`](../../../../docs/decode/README.md) §Not yet tried, where the reading is.

```bash
lab/av1/fetch_data.sh dbt12_ea1141 dbt12_c dbtproj_ge syn2d_d ffdm_d
FRAMES=1 OUT_ROOT=/tmp/x lab/scripts/gen_htj2k_fixtures.sh g160    # builds ojph_compress, ojph_expand once
VARIANTS=plain client/decode/wasm/dav1d/build.sh                    # fetches the pinned emsdk 3.1.74
lab/av1/decode/region/build.sh                                      # the decoders, row REGIONDECODE's
D=lab/av1/data; lab/av1/.venv/bin/python lab/av1/decode/tile/make_frames.py lab/.av1-work/tile \
  g512 $D/dbt12_ea1141 $D/dbt12_c $D/dbtproj_ge $D/syn2d_d $D/ffdm_d
for r in $(seq 0 9); do NODE_PATH=$(npm root -g) node lab/av1/decode/tile/run.mjs --rounds 1 --first-round $r \
  --out lab/av1/decode/tile/raw/tile.jsonl; done                    # --mutate flip|shift|swap
node lab/av1/decode/tile/summary.mjs lab/av1/decode/tile/raw/tile.jsonl lab/.av1-work/tile/manifest.json
```

**Frames** ([`make_frames.py`](make_frames.py)). Row REGIONDECODE's: the first 4 frames of `g512` and of the five
sound breast series (614×1359, 931×2124, 1914×2572, 2394×2850, 3328×4096), each input checked against its set's
checksum. Beside each frame's whole codestream, tile j of k holds rows [round(H·j/k), round(H·(j+1)/k)) and is coded
from those rows alone by the same `ojph_compress` call (RPCL, one layer, 64² blocks, five levels), then decoded
natively against those rows' checksum before it is kept.

**An ask** ([`index.html`](index.html), REGIONDECODE's [`worker.js`](../region/worker.js)). Six workers stay up in one
page: three of the delivered OpenJPH recipe (`ref` of [`../region/build.sh`](../region/build.sh)) and three of
OpenHTJ2K. Every worker holds every file of the set first. The time runs from the page's first post to the last reply;
each piece is written into one `SharedArrayBuffer` frame at its row. Arms: `ref` (the whole codestream, one worker),
`t2` and `t3` (k tiles on k workers), `t2one` and `t3one` (the k tiles in turn on one worker), and on 1914×2572 and
up `stripes3`, row REGIONDECODE's three OpenHTJ2K stripes of the whole codestream, so the rule's comparison is paired
in the same rounds.

**Rounds.** As REGIONDECODE: a fresh headless Chromium per (round × throttle) on 4 cores (`taskset`), 1× and 4×
(`lab/scripts/cpu_throttle.mjs`); throttles, sets and arms in Williams orders (`lab/order.mjs`); every arm decodes
every frame once to check, then 3 timed passes. Every row prints its settings (Chromium, cores, throttle, the two
builds' sha256). **Checked** on every check pass: each piece's sha256 against its rows of the input, and the assembled
frame's against the set's checksum, the frame zeroed first. `--mutate flip` (one sample of every output),
`--mutate shift` (every piece but the last written a row down) and `--mutate swap` (tiles 0 and 1 trade codestreams;
`stripes3` decodes one codestream, so swap leaves it alone) each must take the arms they touch to 0/4.

**Pins.** As REGIONDECODE's: Node 22.22.0; playwright 1.56.1's Chromium 141.0.7390.37; OpenJPH 0.31.0 (`c68064d`);
OpenHTJ2K v0.19.0 (`e0f7ae8`); emscripten 3.1.74. Nothing built or fetched is committed; `raw/` holds the rounds as
measured.
