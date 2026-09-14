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

`wasm/` builds the same OpenJPH release to WASM twice, differing only in `-pthread`, so the cost
of a shared heap can be measured as a controlled set; `shared_tax.mjs` runs that pair. It needs
emsdk and the OpenJPH source tree the fixture generator clones:

```bash
EMSDK=~/emsdk INITIAL_MB=4 lab/decode-bench/wasm/build.sh
node lab/decode-bench/shared_tax.mjs lab/fixtures/decode_g1024
```

Every millisecond these print is container-measured unless it was run on the rig
(`docs/cloud-rig-access.md`). Heap, byte-exactness and the build-flag findings are not timing and
do not carry that caveat.
