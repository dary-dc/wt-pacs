# remap — rare values above 12 bits mapped out, against the split

Queue row 64 (REMAP) of [`docs/av1/queue.md`](../../../../docs/av1/queue.md): when the values that push a series over
12 bits are rare, does coding the series at 12 bits with a small map of them beat the split? The verdict is in
[`docs/av1/README.md`](../../../../docs/av1/README.md) §A3, the proposal in
[`docs/av1/payload-format.md`](../../../../docs/av1/payload-format.md) §Proposed: a remapped plane.

```bash
lab/av1/tools/tools.sh && ARMS=simd client/decode/wasm/dav1d/build.sh   # libaom 3.15.1, dav1d, dav1d-WASM
FRAMES=1 OUT_ROOT=/tmp/x lab/scripts/gen_htj2k_fixtures.sh g160  # ojph_compress 0.31.0
ingest/coded-frames/build.sh && client/decode/wasm/fetch_openjph.sh  # ingest's check; OpenJPH-WASM
lab/av1/fetch_data.sh dbtproj_ge dbtproj_holo dbtproj_c ct_lidc ct_nlst ct_crc xa_dynact16 pt15_cptac mg16_cbis
P=lab/av1/.venv/bin/python D=lab/av1/data W=lab/.av1-work/remap
$P lab/av1/bytes/remap/levels.py $D/{dbtproj_ge,dbtproj_holo,dbtproj_c,ct_lidc,ct_nlst,ct_crc,xa_dynact16,pt15_cptac,mg16_cbis}
for s in dbtproj_ge dbtproj_holo ct_lidc ct_nlst ct_crc xa_dynact16 mg16_cbis; do
  for m in map palette; do $P lab/av1/bytes/remap/remap.py $D/$s $W/$s.$m --mode $m; done; done
$P lab/av1/bytes/remap/mutate.py $W $D/ct_lidc $D/dbtproj_holo
$P lab/av1/bytes/remap/bytes.py lab/.av1-build $W $D/{dbtproj_holo,dbtproj_ge,ct_lidc,ct_nlst,ct_crc,xa_dynact16,mg16_cbis} --out bytes.json
$P lab/av1/bytes/remap/make_frames.py $W $W/frames $D/dbtproj_holo:8 $D/dbtproj_ge:6 $D/ct_lidc:18 --arms k2,k3,k4,mapk0,mapk2,palettek2
NODE_PATH=$(npm root -g) node lab/av1/bytes/remap/decode.mjs --rounds 10 --out decode.json
```

**The maps** (`remap.py`), each to a plane of at most T = 12 bits:

* **map** — the 2^12-wide window of levels holding most samples; a sample outside it is replaced by the
  window's nearer end (the predictor: a saturated run stays a flat run at the top), and its position and value go
  in a per-frame map — the runs of outliers in raster order as varint (gap, length) pairs, then their values as
  u16 — deflated.
* **palette** — v = h·2^L + l, the high parts h ranked: h's rank·2^L + l, with L the largest for which the
  ranks fit 12 bits, and the ranked high parts as a per-series table. L = 0 is histogram packing, row SPLITLIT's
  proposal (2) ([`split-prior-art.md`](../../../../docs/av1/split-prior-art.md)).

`remap.py` writes nothing unless every frame comes back from its plane and map to the source's checksum; ingest then
codes the plane and writes nothing unless every payload decodes back to the plane. The two checks together make every
frame exact against the source; the decode harness checks it again end to end in Chromium.

## The levels (2026-10-07)

Every frame of each series over 12 bits after its offset (`levels.py`): the share of samples and of levels at
4096 or above, and the share outside the best 12-bit window.

| series | b | levels | ≥ 4096: samples · levels | outside the best window |
| --- | --- | --- | --- | --- |
| `dbtproj_ge` projections | 14 | 3 364 | 10.9 % · **1** (16383) | 10.9 % |
| `dbtproj_holo` projections | 14 | 1 685 | 0.59 % · **1** (16383) | 0.59 % |
| `dbtproj_c` projections | 14 | 16 220 | 72 % · 12 275 | 29 % |
| `ct_lidc` CT | 13 | 3 219 | 0.0013 % · 312 | 0.0013 % |
| `ct_nlst` CT | 13 | 3 666 | 0.0003 % · 47 | 0.0003 % |
| `ct_crc` CT | 13 | 3 112 | 0.0008 % · 202 | 0.0008 % |
| `xa_dynact16` cone-beam | 13 | 5 460 | 0.018 % · 1 436 | 0.018 % |
| `pt15_cptac` PET | 15 | 30 900 | 7.1 % · 26 804 | 7.1 % |
| `mg16_cbis` film | 16 | 2 969 | 50 % · 2 782 | 50 % |

Two of the three projection systems are 12-bit data plus one saturated level; the CTs and the cone-beam are 12-bit
data plus a few hundred rare bright levels (the CT's pad is inside the window). The third projection system and the
PET are dense above 12 bits, and the film is a sparse histogram (2 969 levels spread over 16 bits): no 12-bit map
helps the first two (their maps would be 16 MB and 3 MB), and the film takes the palette at L = 0.

Maps' own bytes, whole series: projections 9.7 and 1.0 KB, CTs 1.2–2.2 KB, cone-beam 7.5 KB. Palettes: L = 8 (16
high parts) and L = 11 (2) on the projections, L = 2 or 4 on the CTs (the pad's gap ranked out), none on the
cone-beam (no L fits), L = 0 on the film.

## Bytes (2026-10-07)

Every frame of each series, over HTJ2K's (the served profile, on the source), the map included; AV1 at row
SPLITTIME's shipped preset for k = 2 — `--allintra --cpu-used=7` on the projections, good 6 on the CTs and cone-beam,
`--allintra --cpu-used=6` on the film — every arm of a series at the same preset. cpu0 was not run: on one projection
frame it took 108 s against 4.4 s for 0.09 % fewer bytes. **w10** is k = b − 10, every stream ≤ 10 bits.

| series | k = 2 | w10 | map k = 0 | map k = 2 | palette k = 2 | HTJ2K on the palette's plane |
| --- | --- | --- | --- | --- | --- | --- |
| projections, system 1 (`ge`) | **0.953** | 1.004 | 1.067 | 0.954 | 0.953 | 0.999 |
| projections, system 2 (`holo`) | **0.925** | 1.050 | 0.950 | 0.925 | 0.925 | 0.999 |
| CT `lidc` | 0.927 | 0.940 | 0.967 | 0.926 | **0.925** | 0.981 |
| CT `nlst` | 1.021 | **0.960** | 1.109 | 1.006 | 1.005 | 0.998 |
| CT `crc` | 0.905 | 0.918 | 0.939 | 0.904 | **0.904** | 0.981 |
| cone-beam | 0.999 | **0.956** | 1.129 | 0.998 | — | — |
| film, 16 bits | k4 1.091 | k6 1.012 | — | — | **0.571** (L = 0) | 0.576 |

* **Mapping out the rare values and coding one 12-bit stream loses to the split on every series**, by 2.6 % (system
  2's projections) to 13 % (cone-beam): the map costs nothing, but the two low bits apart are worth more than the
  one stream.
* **Mapped and then split at k = 2, the bytes are the split's**, within −0.1…+0.05 % (−1.5 % on `nlst`, where w10 is
  smaller still), and **every stream fits 10 bits**: the map's gain is the decoder, not the bytes (below).
* **The film's histogram packing halves it**: 0.571 of HTJ2K through AV1, but HTJ2K on the packed plane is 0.576 —
  the gain is the packing's, not AV1's, on the one 16-bit series here. Ranking out the CT's pad gap gives HTJ2K 1.9 %
  and AV1 0.1 %.

## Decode (2026-10-07)

Decode time a frame through the product's worker (`client/decode/decoder.js`), the payload picking its decoder —
dav1d-WASM where a stream is 12-bit (k = 2 on the source, a map at k = 0), WebCodecs where every stream is ≤ 10 bits
(w10, a map at k = 2) — and a remapped arm's map applied after the worker on the page (inflate and scatter, or the
palette's table), its time added. Headless Chromium 141 in the container (4 cores), 10 rounds, each throttle a fresh
browser in a Williams order, arms and sets rotating inside; the first 8, 6 and 18 frames; every frame of every
round exact against the source, 1 920/1 920 a throttle. Median of round medians, ms; in brackets the median
paired round ratio against k = 2 and against w10, with rounds faster.

| series | throttle | HTJ2K | k = 2 | w10 | map k = 0 | map k = 2 | palette k = 2 |
| --- | --- | --- | --- | --- | --- | --- | --- |
| projections `ge` 1914×2572 | 1× | 110 | 736 | 310 | 805 (1.10 · 2.65) | 403 (**0.55**, 10/10 · 1.30, 0/10) | 396 (0.54 · 1.30) |
| | 4× | 493 | 3 124 | 1 203 | 3 493 (1.11 · 2.91) | 1 599 (**0.51** · 1.34) | 1 571 (0.51 · 1.31) |
| projections `holo` 1280×2048 | 1× | 60 | 349 | 180 | 320 (0.92 · 1.76) | 189 (**0.55** · 1.05, 2/10) | 186 (0.55 · 1.02, 3/10) |
| | 4× | 260 | 1 497 | 687 | 1 345 (0.90 · 1.98) | 729 (**0.50** · 1.08) | 702 (0.48 · 1.03) |
| CT `lidc` 512² | 1× | 5.9 | 31.0 | 19.0 | 33.3 (1.08 · 1.73) | 22.8 (**0.71** · 1.17) | 20.1 (0.65 · 1.06) |
| | 4× | 21.7 | 125 | 53.0 | 121 (0.93 · 2.18) | 58.0 (**0.46** · 1.09) | 54.2 (0.43 · 1.00, 5/10) |

* **A map at k = 2 decodes in 0.46–0.71 of the k = 2 split's time, faster in 60/60 paired rounds, at the split's
  bytes** — the gain is WebCodecs taking a 10-bit top that dav1d-WASM took at 12 bits.
* **It is 1.05–1.34× w10's time** (1.00–1.31 for the palette: the map's pass on the page, unfused, against none), for 1.5–12 % fewer bytes than
  w10 on four of the six series it fits (projections 0.954 against 1.004 and 0.925 against 1.050; CTs `lidc` and
  `crc` 0.926 against 0.940 and 0.904 against 0.918), and 4.4–4.8 % more on two (CT `nlst`, cone-beam).
* **A map at k = 0** (one 12-bit stream, dav1d-WASM) decodes at 0.90–1.11 of k = 2, so it gains neither bytes nor time.
* The palette's table is cheaper to apply than the map's inflate and scatter: 0.88–0.99 of the map's time.
* Every AV1 arm is 2.6–7.3× HTJ2K. Container numbers; at 4× the 4.9-megapixel projections take dav1d-WASM 3.1 s a
  frame. Nothing is claimed about a phone.

## Checked

* `mutate.py`: a run's gap not accumulated, the window's low end off by one, the last outlier dropped, a palette rank
  off by one, the palette's low bits one fewer — each refused on the CT and a projection series, 5/5.
* `decode.mjs --mutate restore` (the restore skips the last outlier, or the palette's top entry is off by one), `sample`
  and `truth`: every arm affected reports 0 exact frames.
