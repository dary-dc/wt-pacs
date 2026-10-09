# lab/av1/delivery/scalable/webcodecs-base — a scalable payload's base through WebCodecs

Queue row 31 (WCBASE) of [`docs/av1/queue.md`](../../../../../docs/av1/queue.md). WebCodecs has no
operating point, so the base of a two-layer payload is asked for by feeding it the unit with the
OBUs of spatial layers above 0 dropped. Is that base the one native dav1d returns at the base's
operating point, does the whole unit still give the exact frame, and how fast is the base against
dav1d-WASM's (row SVCDEC's preview)? The verdict is in
[`docs/av1/README.md`](../../../../../docs/av1/README.md) §A5.

```bash
lab/av1/delivery/scalable/encoder/build.sh && ARMS=simd client/decode/wasm/dav1d/build.sh   # patched encoder, native dav1d, dav1d-WASM
lab/av1/fetch_data.sh rf_fluoro mr_ispy1 us_liver
python3 lab/av1/delivery/scalable/webcodecs-base/make_streams.py lab/.av1-build lab/.av1-work/wcbase lab/av1/data/us_liver \
  lab/av1/data/rf_fluoro lab/av1/data/mr_ispy1                                  # ~1.5 min
NODE_PATH=$(npm root -g) node lab/av1/delivery/scalable/webcodecs-base/time.mjs --check                    # every unit, ~1 min
NODE_PATH=$(npm root -g) node lab/av1/delivery/scalable/webcodecs-base/time.mjs --check --mutate keep-top  # also drop-base, sample
NODE_PATH=$(npm root -g) node lab/av1/delivery/scalable/webcodecs-base/time.mjs --rounds 15 --throttles 1,4  # ~50 min
```

## How

**Streams** (`make_streams.py`). Row SVCQ's cell: libaom 3.15.1's `svc_encoder_rtc` with
[`../encoder`](../encoder/README.md)'s patch, layering mode 5 (two spatial layers, the top predicted from
the base), base at q 40, top at q 0, speed 7, grey as 4:0:0 and RGB as 4:4:4 tagged G, B, R (`--rgb`,
added for this row: WebCodecs reads identity alone as `bt709`, `docs/decode/README.md`). Three
codings: `half` (a half-size base, one keyframe — row SVCQ's), `half-g1` and `full-g1` (a keyframe
every unit, half- and full-size base). Sets: the ultrasound (RGB 8), the fluoroscopy and MR at 12
bits, the same two as their top 10 bits (row SPLIT10's top stream: v ≫ 2 and v ≫ 1, each frame's
checksum written as it is made, after its source frame matched its own), and `roundtrip.py`'s
synthetic grey 10 and RGB 8.

**Truth.** A top: the checksum written when its input was made, after the encoder's even-size
padding is cut. A base, lossy: native dav1d 1.5.4 on the two-layer stream at `--oppoint 1
--alllayers 0`, each picture's planes hashed.

**The filter** (`baseOf` in `bench.mjs`): walk the unit's OBUs (each has a size field, checked) and
drop those whose extension header says `spatial_id` > 0. Its output is compared byte for byte with
the encoder's own base-only stream (`*_0.av1`).

**Arms**, in headless Chromium 141, every picture taken to `decoder.js`'s contract through the
product's `av1-frame.js`, so a base and an exact frame are timed to the same point:

| arm | decoder | fed | out |
| --- | --- | --- | --- |
| `wc-base` | WebCodecs, `prefer-software` | the filtered unit | the base |
| `wc-all` | WebCodecs | the whole unit | the exact frame |
| `dav1d-base` | `av1-dav1d.js` (row SVCDEC: dav1d-WASM `simd`, `all_layers` 1, the unit drained) | the whole unit | its `preview` |
| `dav1d-all` | the same call | the whole unit | the exact frame |

WebCodecs requires a key chunk after every `flush()`, so a unit can be flushed for its picture only
at G = 1. Past G = 1 (`half`), each unit is sent as a delta with `optimizeForLatency` and no flush,
and its picture awaited up to 250 ms before the next is sent; what comes out only on the final flush
is counted as late.

**Timing.** `half-g1` and `full-g1` on the ultrasound and both top-10 series, the first 18 units: per
arm an untimed pass, then a timed one on a fresh decoder (dav1d-WASM: the keyframe flushes it), the
ms from a unit sent to its picture in the contract, meaned over the 18. Each throttle a fresh browser
each round, the throttles in a Williams order (`lab/order.mjs`), sets and arms rotating inside;
1× and 4× (`lab/scripts/cpu_throttle.mjs`); 15 rounds; median [min–max].

## Exact

| | units | WebCodecs base = native dav1d at op 1 | WebCodecs top = source | dav1d-WASM preview = native, top = source |
| --- | --- | --- | --- | --- |
| ultrasound RGB 8, 760×421 (base 380×212 / 760×422) | 70 × 3 codings | 210/210 | 210/210 | 210/210, 210/210 |
| fluoroscopy top 10, 768² | 18 × 3 | 54/54 | 54/54 | 54/54, 54/54 |
| MR top 10, 512² | 58 × 3 | 174/174 | 174/174 | 174/174, 174/174 |
| synthetic grey 10, RGB 8, 512² | 16 × 3 each | 96/96 | 96/96 | 96/96, 96/96 |
| fluoroscopy, MR at 12 bits | 18, 58 × 3 | refused | refused | 228/228, 228/228 |

The filter's output equals the encoder's base-only stream byte for byte on every unit, 762/762, and
is the unit's prefix on every one (checked apart): the OBUs before the first with `spatial_id` 1. At 12 bits WebCodecs
refuses the keyframe of the base as of the whole unit (row WCAP). **Past G = 1 no flush is needed**:
with `optimizeForLatency` every base, and every exact frame, came out from its own unit before the
next was sent, 0 late of 178 each — dav1d at one frame context drains what it holds when asked for a
picture (`dav1d_get_picture`, `src/lib.c`), so the base it caches waiting for a top is returned at
once. Without `optimizeForLatency` it was not tried (row WCLAT's question).

Mutated on the ultrasound, grey 10 and MR top 10, each caught: the filter keeping the top's OBUs —
every WebCodecs "base" is the top, 0/432 match, and 0/432 units equal the base-only stream; dropping
layer 0's too — no picture out (G = 1: "0 frames out of unit 0"; past it nothing, late or not); one
sample of every decoded picture flipped — 0 matches on every arm.

## Bytes

OBU bytes; G = 1 against one keyframe, and the base's share of the payload:

| set | one keyframe: base share | G = 1, half: total ÷ one keyframe, base share | G = 1, full: total ÷ one keyframe, base share |
| --- | --- | --- | --- |
| ultrasound | 1.49 % | 1.133, 2.55 % | 1.072, 10.6 % |
| fluoroscopy top 10 | 0.22 % | 1.006, 0.34 % | 1.006, 0.77 % |
| MR top 10 | 0.17 % | 0.998, 0.22 % | 0.991, 0.59 % |
| fluoroscopy, MR at 12 bits | 0.14, 0.06 % | 1.006, 1.001 | 1.004, 0.998 |
| synthetic grey 10 / RGB 8 | 0.13 / 18 % | 1.029 / 2.27 | 1.014 / 2.23 |

G = 1, which a flushed WebCodecs path needs, costs nothing on the grey series and 13 % (half) or
7 % (full) on the ultrasound, whose inter prediction a scalable top uses.

## Time

ms from a unit sent to its picture in the contract, median [min–max] over 15 rounds, 18 units a run;
headless Chromium 141, this container, not a phone:

| set, coding | WebCodecs base | dav1d-WASM base (preview) | WebCodecs exact | dav1d-WASM exact |
| --- | --- | --- | --- | --- |
| **1×** | | | | |
| ultrasound, half | 5.5 [5.1–7.4] | 8.4 [6.4–9.9] | 46.5 [43.6–49.3] | 64.9 [52.7–69.0] |
| ultrasound, full | 15.5 [12.9–18.1] | 23.4 [18.4–26.9] | 42.5 [39.7–46.0] | 70.6 [66.7–78.9] |
| fluoroscopy top 10, half | 4.2 [3.6–5.1] | 3.7 [3.3–5.1] | 39.6 [37.1–43.4] | 45.6 [40.2–51.4] |
| fluoroscopy top 10, full | 10.8 [9.5–12.1] | 13.0 [11.3–15.0] | 40.9 [36.0–44.1] | 54.8 [45.7–62.8] |
| MR top 10, half | 2.7 [2.4–3.1] | 2.1 [1.7–2.4] | 19.0 [18.2–20.2] | 21.9 [19.8–27.8] |
| MR top 10, full | 5.8 [5.0–7.1] | 4.3 [3.3–5.5] | 19.8 [18.6–20.9] | 23.8 [20.5–27.8] |
| **4×** | | | | |
| ultrasound, half | 12.6 [11.5–65.1] | 36.5 [33.1–37.5] | 174 [166–229] | 282 [272–310] |
| ultrasound, full | 49.9 [41.0–54.6] | 106 [96–114] | 157 [150–212] | 301 [287–321] |
| fluoroscopy top 10, half | 10.7 [9.5–13.3] | 16.6 [14.0–19.4] | 150 [139–192] | 202 [183–233] |
| fluoroscopy top 10, full | 28.9 [23.6–38.8] | 57.3 [50.7–62.7] | 148 [142–191] | 236 [220–259] |
| MR top 10, half | 7.8 [6.3–8.9] | 9.7 [7.2–11.8] | 66.1 [63.9–122] | 93.4 [86.1–104] |
| MR top 10, full | 13.6 [10.5–17.0] | 19.8 [16.9–22.3] | 68.3 [63.6–115] | 96.2 [89.0–115] |

Paired by round, WebCodecs' base over dav1d-WASM's: at 1×, **0.65–0.66 on the ultrasound** (faster
15/15 and 15/15) and 0.80 on the fluoroscopy's full-size base (13/15), but **1.10–1.31 — slower — on
the small grey bases** (fluoroscopy half 1/15, MR 0/15 and 0/15), where a few ms of WebCodecs' round
trip outweigh dav1d-WASM's work; at 4×, **0.36–0.76, faster in 87/90 rounds**. The base takes
7–36 % of WebCodecs' own exact frame. Every picture timed matched: 19 440/19 440 (bases and tops).

## Verdict

**The base of a scalable payload comes out of WebCodecs exactly — identical, sample for sample, to
native dav1d's at the base's operating point — when the top's OBUs are dropped, and the whole unit
still gives the exact frame** (534/534 each, ≤ 10 bits; 12 bits refused, as row WCAP found). The
filter is an OBU-header walk, and its output is the encoder's own base-only stream. A flushed unit
needs G = 1 (WebCodecs wants a key chunk after a flush; −1 to +1 % bytes on grey, +7–13 % on the
ultrasound); past G = 1,
`optimizeForLatency` gives each base from its own unit with no flush. Against row SVCDEC's
dav1d-WASM preview it is **0.65 of the time on the colour ultrasound at 1× and 0.36–0.76 everywhere
at 4×**, but 1.1–1.3× on the grey bases of 2–4 ms at 1×: on a fast core a small base is not worth
the trip.
