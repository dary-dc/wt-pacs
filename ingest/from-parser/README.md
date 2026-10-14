# ingest/from-parser — the site's ingest, phase 1

The Rust ingest of [`docs/ingest/README.md`](../../docs/ingest/README.md): one series of the parser's directory output
([`docs/ingest/contract.md`](../../docs/ingest/contract.md)) to a `.sbnd`, HTJ2K coded in-process by OpenJPH 0.31.0
with the calls `ojph_compress` makes (`encode.cpp`), each frame decoded back through `ingest/coded-frames`'
`decode.cpp` and checked by XXH3-64, nothing written unless every frame is exact.

```bash
ingest/tools.sh                                                           # OpenJPH 0.31.0 and the check's decoders
cargo build --release -p from-parser -p pack-series                       # links ingest/.build
P=.venv/bin/python                                                        # numpy, xxhash, blake3: ingest/requirements.txt
$P ingest/from-parser/mirror.py lab/av1/data/rf_fluoro OUT                 # prints the series directory it wrote
target/release/from-parser OUT/PbPb/<E>/<S> rf_fluoro.sbnd --jobs 4
$P ingest/from-parser/same.py ingest/.build lab/av1/data/rf_fluoro WORK   # both ingests, --jobs 1, 2, 4: identical
$P ingest/from-parser/same_test.py                                        # the same on synthetic sets: the gate's step
for s in lab/av1/data/*/; do $P ingest/from-parser/same.py ingest/.build "$s" WORK; done   # every fetched set
```

`mirror.py` is the parser's stand-in until phase 2, deleted then. `INGEST_BUILD` moves the libraries the build and
`same_test.py` link from `ingest/.build` (`INGEST_BUILD=lab/.av1-build` where `lab/av1/tools/tools.sh` built them).
