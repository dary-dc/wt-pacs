# helper-start

Whether the HTJ2K code-block pool's helper Worker, started after the decoder answers ready, takes the cold-ask loss
off the pool and keeps its warm gain. Queue row 108 (HELPERSTART) of [`docs/av1/queue.md`](../../../docs/av1/queue.md),
run as `docs/decode/levers-protocol.md` §L1 on `claude/av1` fixes it; the reading is in
[`docs/decode/README.md`](../../../docs/decode/README.md) §Code-blocks on threads, measured.

**Arms.** `ref` is the delivered build (`client/decode/wasm/build`, checked against its manifest; `built` in
`builds.mjs`, a byte-identical copy as `ref` for the relay). `cb2` is row HTJ2KMT's pool, one helper.
`cb2late` is the same source and `.wasm` linked with `-sPTHREAD_POOL_DELAY_LOAD=1`: the glue posts the helper its
module and answers ready without waiting for it; the patch's claim loop lets the caller take every block meanwhile.

```bash
client/decode/wasm/build/build.sh                      # the delivered build; needs a docker daemon
PATH=$PWD/lab/av1/.venv/bin:$PATH lab/scripts/gen_htj2k_fixtures.sh g512 && git checkout lab/fixtures
lab/av1/fetch_data.sh dbtproj_ge
# emsdk 3.1.74 as client/decode/wasm/dav1d/build.sh fetches it
export EMSDK=$PWD/lab/.av1-build/emsdk E="-sENVIRONMENT=web,worker,node" M="-pthread -DOJPH_CB_THREADS=1 -sPTHREAD_POOL_SIZE=1"
cp -r lab/.openjph-build/src lab/.openjph-build/src-mt
git -C lab/.openjph-build/src-mt apply "$PWD/lab/av1/decode/htj2k-profile/cb-threads.patch"
SRC=$PWD/lab/.openjph-build/src-mt VARIANTS=cb2 EXTRA_FLAGS="$E $M" lab/decode-bench/wasm/build.sh
SRC=$PWD/lab/.openjph-build/src-mt VARIANTS=cb2late EXTRA_FLAGS="$E $M -sPTHREAD_POOL_DELAY_LOAD=1" lab/decode-bench/wasm/build.sh
cp client/decode/wasm/built/openjph/openjph.js lab/.openjph-build/wasm/ref.js
cp client/decode/wasm/built/openjph/openjph.wasm lab/.openjph-build/wasm/ref.wasm
W=lab/.av1-work/helperstart
lab/av1/.venv/bin/python lab/av1/decode/htj2k-threads/make_frames.py $W lab/av1/data/dbtproj_ge
python3 lab/decode-bench/helper-start/sets.py $W lab/fixtures/decode_g512 $W/dbtproj_ge lab/av1/data/dbtproj_ge
client/transport/ts/build.sh
lab/decode-bench/helper-start/run.sh 10 rows       # ten rounds, the four blocks rotated within each
node lab/decode-bench/helper-start/summary.mjs rows  # the tables; raw/ holds the campaign's rows
```

**Loopback** is `builds.mjs`: a fresh browser a visit on 4 cores, three decoders, every unit Williams-ordered within
the round. `ready` is three product decoder workers started together, ms to the last `ready`; `ask` a cold ask, a
fresh browser and one frame; `warm` the last frame asked 500 ms after a fill of the others. **The relay** is
`total-time/run.mjs` on 3 cores with the relay on the fourth: the fills on 50 Mbit and `lte-good`, and the cold
ask on `lte-good` as a fill of one frame.

**Checked.** Every frame against the `.sha256` written from the encoder's input.
