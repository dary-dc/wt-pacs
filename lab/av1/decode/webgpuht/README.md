# webgpuht

An HTJ2K decoder whose block decoding, wavelet and pack run on WebGPU, checked exact on SwiftShader.
Queue row 111 (WEBGPUHT) of `claude/av1`'s queue, run as its `levers-protocol.md` §L3 states it; the
reading is in [`docs/decode/README.md`](../../../../docs/decode/README.md) §A WebGPU block decoder, built.
**No timing:** the container has no GPU, and SwiftShader runs WGSL on the CPU.

```bash
FRAMES=87 lab/scripts/gen_htj2k_fixtures.sh g160 g256 g512 c512 cine512 g8 g1024 g2048 s512 s12 ct512 sat256
lab/av1/fetch_data.sh dbt12_ea1141 dbt12_c dbtproj_ge syn2d_d ffdm_d
FRAMES=1000 lab/av1/.venv/bin/python lab/av1/decode/htj2k-profile/make_frames.py lab/.av1-work/webgpuht \
  lab/av1/data/dbt12_ea1141 lab/av1/data/dbt12_c lab/av1/data/dbtproj_ge lab/av1/data/syn2d_d lab/av1/data/ffdm_d
NODE_PATH=$(npm root -g) node lab/av1/decode/webgpuht/run.mjs                    # every frame, four arms + mixed
for m in sample lift row scan; do NODE_PATH=$(npm root -g) node lab/av1/decode/webgpuht/run.mjs \
  --mutate $m --subgroups 0 --sets g8,c512,s12,dbt12_ea1141; done                     # each 0 exact
for m in sample lift row scansub; do NODE_PATH=$(npm root -g) node lab/av1/decode/webgpuht/run.mjs \
  --mutate $m --subgroups 1 --sets g8,c512,s12,dbt12_ea1141; done
NODE_PATH=$(npm root -g) node lab/av1/decode/webgpuht/run.mjs --mutate lanes --subgroups 1 --sets g160  # faults > 0
```

`gen_htj2k_fixtures.sh` needs NumPy on `python3`'s path (`PATH=lab/av1/.venv/bin:$PATH`); it builds
`ojph_compress` from OpenJPH 0.31.0, whose clone also gives `run.mjs` the VLC tables.

**The decoder.** `codestream.mjs` parses the main and tile headers and the packet headers on the CPU into a
list of code-blocks (offset, length, size, missing MSBs, K_max, place in the coefficient plane). Then, on the
device, as Naman and Taubman's GPU decoder splits the cleanup pass (ICIP 2019; `docs/decode/README.md`):

* `cleanup_vlc` (KCUPS1) — one thread a code-block decodes MEL and VLC serially into one word a quad
  (significance, EMB patterns, u) and unstuffs the MagSgn segment into a bit array;
* `cleanup_magsgn` (KCUPS2) — one workgroup of 32 a code-block, a thread a quad column. Quad rows go in
  order, since a row's exponent bound needs the magnitudes above it; within a row each thread's bit offset
  is an exclusive scan of the bit counts, through workgroup memory or, with `subgroups`, through
  `subgroupInclusiveAdd` (each lane checked to be its invocation's place, else counted in `faults`);
* `synth` — the reversible 5/3 synthesis (ITU-T T.800 F.3.8.1), a level a pair of dispatches (rows, then
  columns), a thread a line;
* `pack` — the colour transform inverted, the level shift added, samples written as the product's decoder
  emits them (8-bit, or 16-bit little-endian, components interleaved).

Bit reading and sample reconstruction follow OpenJPH 0.31.0's `ojph_block_decoder32.cpp`; its VLC tables
are built by `tables.mjs` from its `table0.h` and `table1.h` and agree with the ones OpenJPH builds, 2 624 of
2 624 entries. *One frame a dispatch* decodes each frame alone; *a batch a dispatch* puts many frames'
code-blocks into the same dispatches (up to 256 MB of coefficients a batch) and reads them back once.

## Scope

Parsed: one tile at the origin, one tile-part, one quality layer, default precincts, no SOP or EPH, no
COC or QCC, code-blocks up to 64 × 64, HT code-blocks, the reversible 5/3, components of one depth
unsubsampled, the RCT. Anything else is refused by name. **The refinement passes (SigProp, MagRef) are not
built:** every code-block of every frame here has one pass, the cleanup, as OpenJPH's encoder writes them,
so no frame could check them.

**Pins.** Node 22.22.0; playwright 1.56.1's Chromium 141.0.7390.37 and its SwiftShader; OpenJPH 0.31.0
(`c68064d`) for the encoder, `ojph_expand` and the tables. Nothing fetched or built is committed.
OpenJPH's notice is in `LICENSE.OpenJPH`.
