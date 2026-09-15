# decode-bench

What decoding costs in memory. `docs/decode/README.md` says why that is the question and holds
every number these produce.

```bash
lab/decode-bench/fetch_decoder.sh                       # decoder from npm, pinned; not committed
lab/scripts/gen_htj2k_fixtures.sh g160 g256 g512 c512 g1024 g2048
node lab/decode-bench/decode_bench.mjs lab/fixtures/decode_g512
node lab/decode-bench/copy_cost.mjs lab/fixtures/decode_g512 lab/fixtures/decode_g2048
```

`decode_bench.mjs` runs 1..4 instances over one fixture set, dealing frames round-robin, and
reports heap per instance and in total. It is **serial by design**: the claim is memory, and a
parallel arm would turn it into a throughput claim as well. `copy_cost.mjs` prices `.slice()`
against handing back the heap view, across frame sizes.

Round 0 warms up and is not counted; arm order rotates each round. Every decoded frame is checked
against the `.sha256` the generator wrote from the **encoder's input**, not against an oracle this
decoder produced — an oracle built by the code under test shares its bugs, which a mutation proved
before this was changed (`docs/decode/README.md` §Ground truth).

`wasm/` builds a decoder from OpenJPH source with the same surface as the package's, at whatever
initial heap you ask for, plain and shared. It needs emsdk and the OpenJPH source tree the fixture
generator clones:

```bash
EMSDK=~/emsdk INITIAL_MB=4 lab/decode-bench/wasm/build.sh
node lab/decode-bench/parity.mjs lab/fixtures/decode_*      # same surface, same bytes?
node lab/decode-bench/shared_tax.mjs lab/fixtures/decode_g1024
EMSDK=~/emsdk lab/decode-bench/wasm/heap_curve.sh lab/fixtures/decode_g512
```

`parity.mjs` is the one that matters: it compares our build against the package byte for byte and
getter for getter, and against the encoder's input as well. `heap_curve.sh` builds a ladder of
initial heap sizes and interleaves them, so the floor is chosen from a curve.

`decode_sat256` is a full-range ramp rather than organic content. It exists because none of the
other fixtures contains a sample at its ceiling, so none of them exercises the decoder's clamp —
a mutant that clamped one count low passed all six and fails against this one.

`dispatch.mjs` runs a pool of real decoders, one per worker thread, and compares round-robin
against first-free and against first-free with one frame of lookahead. Dispatch is meaningless
without real parallelism, so workers rather than an interleaved queue; they preload the fixtures so
dispatching a frame costs a message of two integers rather than a copy of the codestream.

```bash
node lab/decode-bench/dispatch.mjs --width 3 --rounds 13 --frames 9
```

A mixed workload must not be a repeating cycle whose period shares a factor with the pool width —
that hands each worker one size and reverses the answer. The sizes are a seeded shuffle for that
reason.

Every millisecond these print is container-measured unless it was run on the rig
(`docs/cloud-rig-access.md`). Heap, byte-exactness and the build-flag findings are not timing and
do not carry that caveat.
