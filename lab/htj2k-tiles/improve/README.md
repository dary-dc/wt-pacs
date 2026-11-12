# htj2k-tiles/improve

[`docs/htj2k-tiles.md`](../../../docs/htj2k-tiles.md) §Improve's protocol, pre-registered by row HTJ2K-IMPROVE and run
by row HTJ2K-MEASURE, a session that wrote none of it. The readings and any amendment are in the same doc,
§Improve, measured.

```bash
ingest/tools.sh                                                    # OpenJPH 0.31.0's ojph_compress and ojph_expand
# OpenJPEG 2.5.4 native (tag v2.5.4, commit 6c4a29b0), as lab/av1/bytes/embedded/build.sh's first half builds it
OUT=DATA lab/av1/fetch_data.sh dbts_a1 dbts_b1 dbts_c1
lab/av1/.venv/bin/python lab/htj2k-tiles/improve/offline.py ingest/.build OPJ/opj_decompress DATA dbts_b1 \
  lab/htj2k-tiles/improve/rows/stage0-dbts_b1.jsonl            # stages 0 and 1, every frame; --mutate NAME
```

**Stage 0 and 1, offline** ([`offline.py`](offline.py)), every frame: today's codestream (the ingest's arguments)
and I1's (`-tileparts R -tlm_marker true`, NL 5, or 6 where DICOM's base ≤ 64 asks it: `dbts_b1`) of the whole
frame; I2's three strips in I1's profile, boundaries on multiples of 2^NL. Each TLM length is checked against its
SOT's Psot; each level's TLM prefix, EOC appended, is decoded by OpenJPEG 2.5.4 (`-r ℓ -allow-partial`) and by
OpenJPH's `ojph_expand -skip_res ℓ,ℓ` and held against the reversible 5/3 analysis of the strip
(`lab/av1/decode/resolution-level/ll.py`, `witness.py`'s `reduced`); the level-0 strips stacked against the frame's
sha256; Layout 1's three bands cut at TLM boundaries and tiling the strip. Mutants (`--mutate`), each must turn R0 off:
`tlm-short` (every TLM length one byte short), `strip-order` (strips stacked reversed), `untiled-truth` (a strip's
level truth taken from the untiled frame), `truth` (every comparison's truth flipped).

**Stage 3's strip series** ([`stage3_prep.py`](stage3_prep.py), [`stage3_check.py`](stage3_check.py)): every frame's
three strips in I1's profile, cut at TLM's boundaries into Layout 1's band-major entries (bands = levels 2, 1, 0;
entry `e = b·N·T + f·T + t`), loose as `pack-series` reads them, with each picture's truth in `frames.json`. The
check reads the entries back, joins each strip's bands in order and decodes them by OpenJPH, whole and at each fit
level, against the truths; its mutants (`band-order`, `entry-index`, `truth`) must each turn it to 0 exact. Bytes
and digests: [`rows/stage3-series.json`](rows/stage3-series.json).

```bash
cd lab/htj2k-tiles/improve
../../av1/.venv/bin/python stage3_prep.py ../../../ingest/.build DATA ../../../lab/.av1-work/htj2k-improve dbts_a1 dbts_b1 dbts_c1
../../av1/.venv/bin/python stage3_check.py ../../../ingest/.build ../../../lab/.av1-work/htj2k-improve/dbts_b1-bands [--mutate NAME]
```

**Stage 3's D series**: the demo commit `157b7109`'s own `scripts/demo-series.sh`, run in a worktree of that commit
with its own ingest build (its `ingest/coded-frames/decode.cpp` differs from this branch's); the exact series and Q 8
at G 1 and G 16 (the depth cut on `dbts_a1`, `dbts_c1`) are the arms' inputs. Their bytes equal FREEZE-E2E's run of
the same script; digests in [`rows/stage3-d-series.json`](rows/stage3-d-series.json).

**Stage 3, time on links** ([`stage3/`](stage3/)): one lab page for every arm ([`page.js`](stage3/page.js)) on the
product's `DownloaderClient`: the D arms fill the OQ series through the product's AV1 route (WebCodecs first), S★
fills the strip series' bands at the fit with `decode: false`, and the strips decode on three lab workers (strip t on
worker t; whole on the delivered build, a level on the lab binding). Once every slice is pictured, the Lossless
request on the middle slice: D and D′ on a second client on the exact series, the others by the strips' entries.
Every picture is hashed after the clock against `frames.json`; OQ pictures have no truth, so a visit's are joined into
one digest that must agree across a volume's D visits. The pictures and S★'s coded bands go to the lab store
([`store.js`](stage3/store.js), OPFS) after the clock, and the page is reopened in the same tab (J10). The driver
([`run.mjs`](stage3/run.mjs)) runs from a tree of the demo commit `157b7109` with this directory copied in, one
server and relay per series of a visit; [`summary.py`](stage3/summary.py) reads the rows against the rule. Mutants
(`--mutate`): `bands-dropped`, `preview`, `truth`, `sample`, each must be caught ([`rows/stage3-mutants.jsonl`](rows/stage3-mutants.jsonl)).

```bash
cd TREE   # 157b7109, lab/htj2k-tiles/improve copied in, lab/.demo-series -> the D series, lab/.av1-work/htj2k-improve -> the strip series
NODE_PATH=$(npm root -g) node lab/htj2k-tiles/improve/stage3/run.mjs --series lab/.demo-series --bands lab/.av1-work/htj2k-improve \
  --rounds 2 --first-round 0 --out rows.jsonl
python3 lab/htj2k-tiles/improve/stage3/summary.py rows.jsonl
```
