# exactprod

What checking every shown frame costs in a decoder worker: five hashes of the decoded samples against
the decode, and a decode-bound fill with the check and without it. Queue row 73 (EXACTPROD) of
[`docs/av1/queue.md`](../../../../docs/av1/queue.md); the proposal and its reading are in
[`docs/adr/exactness-in-production.md`](../../../../docs/adr/exactness-in-production.md).

```bash
lab/av1/fetch_data.sh mr_ispy1 rf_fluoro dbtproj_ge ffdm_a
FRAMES=1 OUT_ROOT=/tmp/x lab/scripts/gen_htj2k_fixtures.sh g160   # builds ojph_compress once
client/decode/wasm/fetch_openjph.sh                                 # OpenJPH, the shipped package
lab/av1/exact/in-production/fetch.sh                                        # hash-wasm; the truth's hashers
D=lab/av1/data W=lab/.av1-work/exactprod
FRAMES=4 lab/av1/.venv/bin/python lab/av1/decode/htj2k-profile/make_frames.py $W $D/mr_ispy1 $D/rf_fluoro $D/dbtproj_ge $D/ffdm_a
lab/av1/exact/in-production/.venv/bin/python lab/av1/exact/in-production/make_truth.py $W $D/mr_ispy1 $D/rf_fluoro $D/dbtproj_ge $D/ffdm_a
NODE_PATH=$(npm root -g) node lab/av1/exact/in-production/bench.mjs --rounds 10 --throttles 1,4 --out rows.json   # ~40 min
NODE_PATH=$(npm root -g) node lab/av1/exact/in-production/bench.mjs --rounds 1 --throttles 1 --passes 1 --mutate  # every cell 0/n, exit 1
```

**Frames.** The first 4 frames of four series as the served HTJ2K profile (row FASTHTJ2K's
`make_frames.py`): MR 512² (16-bit container), fluoroscopy 768² 12-bit, tomosynthesis projections
1914×2572 14-bit, a mammogram 2560×3328 12-bit. Three hash-only buffers (`raw*`, random bytes, no
codestream) cover the sizes no series has: 512² at 8 bits, 4096×3328 at 8 and at 16 bits.

**Truth.** `make_truth.py` reads each fetched `NNN.raw`, holds its SHA-256 to the checksum written when
it was fetched, and writes its BLAKE3 (`blake3` 1.0.8), XXH3-64 (`xxhash` 3.6.0) and CRC-32 (zlib)
beside it: every arm is checked against an independent implementation over the encoder's input, never
against another arm.

**Hash** (`worker.js` `bench`). One worker a set, as the product runs a decoder: each frame decoded
by the shipped OpenJPH package and copied into a `SharedArrayBuffer`, as `decodeFrame` hands samples
on; then every arm's digest of every frame checked, then 3 timed passes an arm, the arms in a
Williams order per round. Arms: `decode` (codestream to shared samples), `sha256-webcrypto` (a copy
out of shared memory first: WebCrypto refuses a shared view, which the run prints), `sha256-wasm`,
`blake3-wasm`, `xxh3-wasm`, `crc32-wasm` (hash-wasm 4.12.0).

**Pool** (`index.html` `pool`). A decode-bound fill: 3 decoder workers take each set's frames 6 times
over (24 frames) as fast as they finish, each frame decoded then hashed by the arm before it is
handed on (`none`: not checked); the first frame handed on is the earliest a checked picture can be
painted, the last the fill's decode side. No wire: where the wire is the fill's clock, a check that
fits in the decoders' idle time costs nothing.

A fresh headless Chromium per (round × throttle), the throttles, sets and arms each in a Williams
order; browser on 4 cores (`taskset`); 4× is `lab/scripts/cpu_throttle.mjs`, four cores each a
quarter as fast. `--mutate` flips one byte of every decoded frame before it is hashed: every hash and
pool cell went 0/n and the run exits 1.

**Pins.** Node 22.22.0; playwright 1.56.1's Chromium 141.0.7390.37; OpenJPH 0.31.0 (encoder, tag
`c68064d`); `@cornerstonejs/codec-openjph` 2.4.11 (decoder, tarball sha256 in its `SOURCE.txt`);
hash-wasm 4.12.0 (tarball sha256 pinned in `fetch.sh`); blake3, xxhash and NumPy hash-pinned in
`requirements.txt`. Nothing built or fetched is committed.
