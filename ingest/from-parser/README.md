# ingest/from-parser — the site's ingest, phase 1

The Rust ingest of [`docs/ingest/README.md`](../../docs/ingest/README.md): one series of the parser's directory output
([`docs/ingest/contract.md`](../../docs/ingest/contract.md)) to a `.sbnd`, HTJ2K coded in-process by OpenJPH 0.31.0
with the calls `ojph_compress` makes (`encode.cpp`), each frame decoded back through `ingest/coded-frames`'
`decode.cpp` and checked by XXH3-64, nothing written unless every frame is exact.

```bash
lab/av1/tools/tools.sh && FRAMES=1 OUT_ROOT=/tmp/x lab/scripts/gen_htj2k_fixtures.sh g160 && ingest/coded-frames/build.sh
cargo build --release -p from-parser -p pack-series                       # links lab/.openjph-build and lab/.av1-build
P=lab/av1/.venv/bin/python                                                # numpy, xxhash, blake3: lab/av1/requirements.txt
$P ingest/from-parser/mirror.py lab/av1/data/rf_fluoro OUT                 # prints the series directory it wrote
target/release/from-parser OUT/PbPb/<E>/<S> rf_fluoro.sbnd --jobs 4
$P ingest/from-parser/same.py lab/.av1-build lab/av1/data/rf_fluoro WORK   # both ingests, --jobs 1, 2, 4: identical
$P ingest/from-parser/same_test.py                                        # the same on synthetic sets: the gate's step
```

`mirror.py` is the parser's stand-in until phase 2, deleted then. `OPENJPH` and `INGEST_BUILD` move the libraries the
build links from `lab/.openjph-build/install` and `lab/.av1-build`.
