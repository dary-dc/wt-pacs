# lab/av1/bytes/represented — closing lossless AV1's byte gap with AV1 alone

Queue row 28 (LLSIZE) of [`docs/av1/queue.md`](../../../../docs/av1/queue.md). Lossless AV1 coded whole
was 2–53 % over HTJ2K (rows SIZE, CONTENT, TAXO), under it only split. This searches AV1-only ways
to close that, every coding exact: libaom's lossless controls, row DEPTH's splits on content of 12
bits or fewer, a reversible colour transform for RGB, SVT-AV1 where it is exact, and inter coding.
The verdict is in [`docs/av1/README.md`](../../../../docs/av1/README.md) §A1.

```bash
lab/av1/tools/tools.sh && ARMS=simd client/decode/wasm/dav1d/build.sh
FRAMES=1 OUT_ROOT=/tmp/x lab/scripts/gen_htj2k_fixtures.sh g160   # builds ojph_compress once
lab/av1/fetch_data.sh
W=lab/.av1-work; P=lab/av1/.venv/bin/python
$P lab/av1/bytes/represented/llsize.py lab/.av1-build $W/llsize $W/llsize1.tsv lab/av1/data/*/       # stage 1, ~70 min, 4 cores
CODINGS=low2.screen-sb64,low2.screen,rct.screen-sb64,rct.screen \
  $P lab/av1/bytes/represented/llsize.py lab/.av1-build $W/llsize $W/llsize2.tsv lab/av1/data/*/     # stage 2
CODINGS=low2.inter,low2.inter-screen,rct.inter,rct.inter-screen,direct.inter \
  $P lab/av1/bytes/represented/llsize.py lab/.av1-build $W/llsize $W/llsize3.tsv lab/av1/data/*/     # inter
$P lab/av1/bytes/represented/mutate.py lab/.av1-build $W/llsize-mut
NODE_PATH=$(npm root -g) node lab/av1/bytes/represented/time.mjs --codings set:rep.variant,... --rounds 15
```

## How

**Frames.** Every series of rows DATA, CONTENT and TAXO, its first 8 frames — fewer where a frame is
large, so each set costs about 8 M samples: 6 of the 10-bit tomosynthesis, 3 and 2 of the
projections. HTJ2K is row SIZE's served profile (OpenJPH 0.31.0) on the same frames.

**Representations** (each a set of plane streams and their merge back):

| name | planes | for |
| --- | --- | --- |
| direct | the samples (+ offset), at 8, 10 or 12 bits | grey ≤ 12 bits |
| low1, low2, low3 | v ≫ k at its container, and v & (2^k − 1) at 8 bits | grey; low2 is row DEPTH's best over 12 bits |
| gbr | G, B, R as 4:4:4 with the identity matrix — rows SIZE to TAXO | RGB |
| rct | JPEG 2000's reversible colour transform: Y = ⌊(R + 2G + B)/4⌋, B − G, R − G (+256), 10-bit 4:4:4 | RGB |
| ycocg-r | YCoCg-R: Co = R − B, Cg = G − (B + ⌊Co/2⌋), Y = B + ⌊Co/2⌋ + ⌊Cg/2⌋ (+256), 10-bit 4:4:4 | RGB |

**Encoders.** libaom 3.15.1 `aomenc --lossless=1 --cpu-used=0 --threads=1 --kf-max-dist=0`, one
keyframe a frame (the unit is a frame, row SIZE), plus a variant: `allintra` (`--allintra`),
`screen` (`--tune-content=screen`, which allows palette and intra block copy; otherwise libaom's
own screen-content detection decides), `sb64` / `sb128` (`--sb-size`), `screen-sb64`, `lean`
(every optional intra tool off), and `inter` / `inter-screen` (one keyframe, the rest predicted,
`--auto-alt-ref=0` — row TOOL found 10/12-bit inter exact only without it). Lossless AV1 codes every
block with the 4×4 Walsh–Hadamard transform, so transform search depth has nothing to choose, and
CDEF, loop restoration and the deblocking filter are off. SVT-AV1 v4.2.0 `--lossless 1 --preset 0
--keyint 1` on grey planes of 8 or 10 bits only (row TOOL: 4:2:0 8/10-bit is all it codes; grey enters
with neutral chroma). Stage 1 crosses the variants with the plain representation and the
representations with libaom's defaults and SVT-AV1; stage 2 tries the best representation with the
best variant. libaom's release bucket lists nothing after 3.15.1 (2026-09-21), so there is no newer
release to try.

**Checked.** Every frame of every coding, decoded by native dav1d 1.5.4 and merged, against the
checksum written when the series was fetched; an intra coding's last frame also decoded alone.

**Decode time.** `time.mjs`: dav1d-WASM `simd` (623 146 B) in Node 22, one decoder a plane stream,
every frame decoded alone and merged in JS (the merge counts: it is the client's work too), then
hashed. Each throttle a fresh process each round, throttles in a Williams order (`lab/order.mjs`),
sets and codings rotating inside; 1× and 4× (`lab/scripts/cpu_throttle.mjs`); 15 rounds; median
[min–max] and the paired ratio to the set's baseline in the same round. One process at a time on 4
cores. **Encode time** is the sweep's own: four encodes at once on 4 cores, not interleaved — a
ratio between codings of a set, not a clean figure.

## Bytes

Encoder variants on the plain representation (direct, gbr, or low2 over 12 bits), bytes over HTJ2K's:

| set | frames | plain | aom | allintra | screen | sb64 | sb128 | screen-sb64 | lean | svt0 |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| `ct_lidc` | 8 | low2 | 0.902 | 0.903 | 0.902 | 0.902 | 0.902 | 0.902 | 1.071 | n/a |
| `xa_dynact16` | 8 | low2 | 0.997 | 1.002 | 0.988 | 0.997 | 0.997 | 0.987 | 1.101 | n/a |
| `mr_ispy1` | 8 | direct | 1.013 | 1.016 | 1.012 | 1.012 | 1.013 | 1.011 | 1.064 | n/a |
| `rf_fluoro` | 8 | direct | 1.027 | 1.027 | 1.021 | 1.026 | 1.027 | 1.020 | 1.091 | n/a |
| `us_liver` | 8 | gbr | 1.117 | 1.118 | 1.114 | 1.116 | 1.117 | 1.113 | 1.833 | n/a |
| `dbt12_ea1141` | 8 | direct | 1.040 | 1.052 | 1.036 | 1.040 | 1.040 | 1.036 | 1.113 | n/a |
| `dbt10_ea1141` | 6 | direct | 0.977 | 0.982 | 0.969 | 0.977 | 0.977 | 0.968 | 1.042 | 0.988 |
| `dbtproj_ge` | 2 | low2 | 0.954 | 0.955 | 0.954 | 0.953 | 0.954 | 0.953 | 1.012 | n/a |
| `dbtproj_holo` | 3 | low2 | 0.924 | 0.924 | 0.924 | 0.923 | 0.924 | 0.923 | 1.007 | n/a |

Representations with libaom's defaults (and SVT-AV1 where it codes them), then the best with `--tune-content=screen --sb-size=64`:

| set | direct | low1 | low2 | low3 | gbr | rct | ycocg-r | best |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| `ct_lidc` | — | 0.911 | 0.902 | 0.969 (SVT 0.982) | — | — | — | **0.902** low2.sb64 |
| `xa_dynact16` | — | 1.077 | 0.997 | 1.000 (SVT 1.007) | — | — | — | **0.987** low2.screen-sb64 |
| `mr_ispy1` | 1.013 | 0.983 (SVT 1.084) | 0.977 (SVT 1.052) | 1.061 (SVT 1.064) | — | — | — | **0.977** low2.screen-sb64 |
| `rf_fluoro` | 1.027 | 0.967 | 0.944 (SVT 1.003) | 0.998 (SVT 0.998) | — | — | — | **0.942** low2.screen-sb64 |
| `us_liver` | — | — | — | — | 1.117 | 0.967 | 0.979 | **0.962** rct.screen-sb64 |
| `dbt12_ea1141` | 1.040 | 0.968 | 0.941 (SVT 1.001) | 0.990 (SVT 0.992) | — | — | — | **0.941** low2.screen-sb64 |
| `dbt10_ea1141` | 0.977 (SVT 0.988) | 0.953 (SVT 1.052) | 0.947 (SVT 1.020) | 1.029 (SVT 1.034) | — | — | — | **0.942** low2.screen-sb64 |
| `dbtproj_ge` | — | — | 0.954 | 0.998 | — | — | — | **0.953** low2.sb64 |
| `dbtproj_holo` | — | — | 0.924 | 1.003 | — | — | — | **0.923** low2.sb64 |

Inter, one keyframe and the rest predicted from it (the whole 8 frames, 6 for the 10-bit
tomosynthesis, a group), bytes over HTJ2K's against the best intra coding:

| set | best intra | direct or gbr, inter | low2 or rct, inter | the same, `inter-screen` | ycocg-r, inter |
| --- | --- | --- | --- | --- | --- |
| `ct_lidc` | 0.902 | — | 0.943 | 0.943 | — |
| `xa_dynact16` | 0.987 | — | 0.988 | 0.985 | — |
| `mr_ispy1` | 0.977 | 1.035 | 1.006 | 1.011 | — |
| `rf_fluoro` | 0.942 | 1.029 | 0.942 | 0.945 | — |
| `us_liver` | 0.962 | 1.355 | 0.850 | 0.854 | 0.861 |
| `dbt12_ea1141` | 0.941 | 1.064 | 0.981 | 0.989 | — |
| `dbt10_ea1141` | 0.942 | 0.974 | 0.946 | 0.947 | — |

Row POCGAP re-codes the first 4 frames of both 10-bit DBT series, paired, against the settings a gap could
hide in (`--threads`, the crop, libaom 3.8.2, an 8-bit copy): plain 0.973–0.976, optimized 0.940–0.943 —
[`../prior-gap`](../prior-gap/README.md).

## Decode and encode time of the winners

Baseline: row SIZE's coding (direct or gbr; low2 over 12 bits). Every frame exact, 46 cells, 15
rounds each:

| set | coding | encode, s a frame | decode 1×, ms a frame | over the baseline | 4× | over the baseline |
| --- | --- | --- | --- | --- | --- | --- |
| `ct_lidc` | low2.aom | 10.8 | 31.1 [28.6–34.9] | — | 140.3 [122.5–160.0] | — |
| `ct_lidc` | low2.sb64 | 8.7 | 31.4 [29.3–35.1] | 1.02, slower 10/15 | 142.3 [125.1–153.8] | 1.01, slower 8/15 |
| `xa_dynact16` | low2.aom | 6.2 | 39.9 [37.5–48.6] | — | 181.8 [164.1–232.0] | — |
| `xa_dynact16` | low2.screen-sb64 | 9.7 | 39.8 [38.1–51.3] | 1.00, slower 8/15 | 183.4 [165.3–222.2] | 1.00, slower 7/15 |
| `mr_ispy1` | direct.aom | 3.4 | 28.3 [27.5–34.9] | — | 125.8 [114.8–170.1] | — |
| `mr_ispy1` | low2.aom | 7.5 | 33.8 [32.2–40.0] | 1.19, slower 14/15 | 146.3 [133.5–164.7] | 1.16, slower 14/15 |
| `mr_ispy1` | low2.screen-sb64 | 9.4 | 34.9 [32.5–42.2] | 1.23, slower 14/15 | 150.9 [138.9–187.7] | 1.18, slower 15/15 |
| `rf_fluoro` | direct.aom | 10.3 | 82.1 [76.1–101.3] | — | 348.4 [331.8–431.7] | — |
| `rf_fluoro` | low2.aom | 19.7 | 84.4 [79.4–95.5] | 1.01, slower 8/15 | 369.3 [344.1–402.2] | 1.06, slower 11/15 |
| `rf_fluoro` | low2.screen-sb64 | 28.4 | 85.3 [79.3–92.7] | 1.04, slower 10/15 | 373.2 [341.5–420.9] | 1.05, slower 12/15 |
| `us_liver` | gbr.aom | 11.9 | 58.0 [54.2–78.2] | — | 264.5 [237.5–305.4] | — |
| `us_liver` | rct.aom | 9.0 | 53.2 [46.7–68.0] | 0.90, slower 3/15 | 237.4 [203.7–279.1] | 0.91, slower 2/15 |
| `us_liver` | rct.screen-sb64 | 15.3 | 52.0 [50.4–57.8] | 0.92, slower 0/15 | 242.5 [219.2–292.3] | 0.95, slower 4/15 |
| `dbt12_ea1141` | direct.aom | 8.5 | 85.0 [81.0–91.2] | — | 369.2 [338.3–438.8] | — |
| `dbt12_ea1141` | low2.aom | 19.3 | 87.3 [83.7–101.2] | 1.05, slower 13/15 | 382.0 [353.0–420.5] | 1.04, slower 11/15 |
| `dbt12_ea1141` | low2.screen-sb64 | 27.6 | 87.5 [83.3–95.6] | 1.04, slower 12/15 | 381.9 [362.2–450.5] | 1.01, slower 9/15 |
| `dbt10_ea1141` | direct.aom | 13.0 | 90.9 [88.0–102.4] | — | 416.5 [381.7–527.2] | — |
| `dbt10_ea1141` | low2.aom | 25.5 | 108.4 [103.2–119.7] | 1.20, slower 15/15 | 482.3 [441.3–573.9] | 1.16, slower 12/15 |
| `dbt10_ea1141` | low2.screen-sb64 | 40.6 | 111.6 [103.8–126.4] | 1.22, slower 15/15 | 499.5 [449.2–555.2] | 1.17, slower 14/15 |
| `dbtproj_ge` | low2.aom | 226.5 | 726.9 [663.3–809.3] | — | 3166.0 [2896.0–3711.6] | — |
| `dbtproj_ge` | low2.sb64 | 201.2 | 690.9 [665.7–736.9] | 0.95, slower 2/15 | 3044.2 [2885.0–3555.6] | 0.98, slower 5/15 |
| `dbtproj_holo` | low2.aom | 80.9 | 323.4 [309.2–331.8] | — | 1416.4 [1331.6–1611.7] | — |
| `dbtproj_holo` | low2.sb64 | 72.2 | 326.9 [316.1–356.4] | 1.01, slower 11/15 | 1465.1 [1304.1–1676.8] | 1.04, slower 12/15 |

The ultrasound's inter coding, a separate campaign of the same shape (15 rounds, 120/120 frames exact
a cell): gbr intra 57.1 [54.6–82.6] ms a frame at 1×, 248 [238–304] at 4×; rct intra 0.89 and 0.90
of it (slower in 1/15 and 2/15 rounds); **rct inter 0.81 and 0.83** (0/15), 47.6 and 212 ms.

## The checks were mutated

* fluoroscopy low2 as built 2/2 exact (alone too); merged at the wrong shift 0/2; without its low
  bits 0/2; one truth checksum corrupted 1/2;
* ultrasound rct as built 2/2; its inverse rounding the other way 0/2; YCoCg-R with Co and Cg
  swapped back 0/2;
* `--mutate sample` (one bit of every merged frame) in `time.mjs`: ultrasound rct 0/8.

## Verdict

**AV1 alone, one frame a unit, is under HTJ2K's bytes on every series — 0.902 to 0.987 — once its
samples are represented for it**: the two low bits apart on grey (row DEPTH's split, now also at 12
bits and under: fluoroscopy 1.027 → 0.942, 12-bit tomosynthesis 1.040 → 0.941, 10-bit 0.977 → 0.942,
MR 1.013 → 0.977) and JPEG 2000's reversible colour transform on RGB (the ultrasound 1.117 → 0.962),
then `--tune-content=screen --sb-size=64` for the last 0–1 %. Per series, best intra against HTJ2K:
CT 0.902, cone-beam 0.987, MR 0.977, fluoroscopy 0.942, ultrasound 0.962, tomosynthesis 0.941 and
0.942, projections 0.953 and 0.923. libaom's own controls move little: palette and intra block copy
through `--tune-content=screen` 0–1.0 %, superblock size and the all-intra usage nothing, every
optional intra tool off +6–64 %; SVT-AV1 is never smaller than libaom (0.98–1.08); one low bit or
three are worse than two (*corrected by ENCX, [`../low-stream`](../low-stream/README.md): at libaom's defaults
only, the one variant tried on low3; with `--tune-content=screen` three low bits are the best split on
the cone-beam set (0.949 against two's 0.987), the fluoroscopy, the 12-bit tomosynthesis and one set
of projections, 0.5–3.9 % under two*); YCoCg-R is 1.2 % behind the RCT. libaom has no release after 3.15.1.

What it costs to decode (dav1d-WASM, Node, n = 15 interleaved, against row SIZE's coding): the
colour transform is **faster** (0.89–0.92× at 1×, 0.90–0.95× at 4×); the split costs one more
decode and a merge, +1–5 % at 1× where the frame is large (fluoroscopy, 12-bit tomosynthesis) and
+19–23 % on 512² MR and 10-bit tomosynthesis (+16–18 % at 4×); over 12 bits the winner is the
baseline's split, ±5 %. The winners encode in 0.8–3.2× the baseline's time (contended, above). So AV1's
decode stays where row SPEED found it, 5–10× HTJ2K's.

**Inter coding pays on the ultrasound once the colour is transformed** (a lossy-sourced series outside the AV1
target series, `docs/av1/README.md` §A1, Scope): one keyframe in 8 frames,
RCT, 0.850 of HTJ2K — against 1.355 for GBR inter, the coding rows SIZE and CONTENT measured — and it
decodes faster still (0.81× of GBR intra at 1×, 0.83× at 4×); on grey, inter is level with intra or
worse (0.942–1.006 against 0.902–0.987). A group of 8 is the unit row GOP built.
