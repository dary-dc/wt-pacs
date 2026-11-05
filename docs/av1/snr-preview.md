# SNR preview: a tiny full-size preview, a visually lossless layer, and the exact frame

## SNR preview protocol, pre-registered

*Row SNRPREVIEW, 2026-11-05, the owner's idea of 2026-11-04. Theory, predictions and a protocol written before any
timed number of its own; separate sessions, given only this section and §Shards, measure it and change nothing in
it. Every input is a measured row of this repository, named with its file and branch, or a source quoted verbatim.
Arithmetic of ours is* derived*; what no source holds is* unverified*. The pilot of §6 only sized the protocol.*

1. **Asked.** Is a *two-layer* lossy carrier — a tiny full-size preview, then a visually lossless layer, both AV1,
   with the exact frame made from the second by an HTJ2K residual — a better trade than the quarter-size SVC base +
   exact layer, separate streams per role + the whole HTJ2K frame, or one visually lossless stream + residual?
2. **Answer, predicted (not yet measured).** A trade against each, never better on every stage: the preview buys a
   first picture at 0.3–2.5 % of an HTJ2K frame's bytes instead of 7–44 %, for 0.3–2.5 % more bytes to the exact
   frame; the quarter base is still smaller to first picture and to exact; the residual beats the whole HTJ2K frame.
3. **What decides it.** Coded as AV1 quality layers in one stream, the visually lossless layer needs its preview
   layer decoded under it on every frame, and libaom codes those layers only with its real-time encoder: predicted
   1.3–1.7× the two-stream form's decode to the visually lossless picture, for no fewer bytes.
4. **It rests on** three DBT volumes, one per system (`dbts_a1`, `dbts_b1`, `dbts_c1`), libaom 3.15.1, one-thread
   dav1d-WASM and OpenJPH in headless Chromium at 1×, on 4-core cloud hosts. Nothing else is claimed.
5. **Not in it:** a link (decode only), 4×, WebCodecs (§2c says what it would do), phones, ultrasound cine and ABUS
   (no fixture), libaom's good-quality two-layer example (8-bit only, §2b), and whether anything is visually lossless
   to a reader — "visually lossless" here is METRICS' noise anchor, bracketed by two rungs (§3).

### Terms

* **Frame, volume, slice.** A DBT volume is a stack of reconstructed slices; each slice is one frame of the series.
  **Systems A, B, C** are the three DBT scanners of the EA1141 dataset; A and C store 12 bits a sample, B 10.
  `dbts_a1` is A's (56 frames of 1142 × 1785), `dbts_b1` B's (50 of 2560 × 3328), `dbts_c1` C's (69 of 976 × 2513).
* **G** — frames coded together: a keyframe every G frames, every other frame of a group predicted from the one
  before it. G = 1 codes each frame alone. To show frame i a client with no decoder state decodes (i mod G) + 1
  units, i's keyframe to i. A **unit** is one AV1 temporal unit, the coded data of one frame.
* **Q** — libaom's quantizer, 0–63 (lower is finer, 0 is lossless), here held fixed for a whole stream
  (`--min-q = --max-q = --cq-level`, as `lab/av1/profiles/bytes.py` codes it). **CRF** is the same `--cq-level`
  with the quantizer left free per frame (`--end-usage=q` alone), as RESIDAPART coded its previews; the two scales
  are not the same, and CRF numbers below are quoted as CRF.
* **PSNR** — 10 log10(peak² ÷ MSE), peak 2^b − 1 at the stored depth b: 4095 on A and C, 1023 on B. An RMS error
  e in source units is peak ÷ 10^(PSNR / 20): at a 12-bit peak, 46 dB is e ≈ 20 units, 50 dB ≈ 13, 56 dB ≈ 6.4.
  The noise the sensor and reconstruction leave in A's and C's frames is σ ≈ 13–18 units (the profiles bytes run's
  estimate, quoted in [`profile-carriers.md`](profile-carriers.md) §2), so a 46 dB preview's error is about the
  noise's size: it is cheap mainly because it drops the noise. **In-window PSNR** counts only the samples the series'
  first display window shows strictly between black and white (the tissue), as the carriers row defined it.
* **Visually lossless (VL)** — here, METRICS' anchor (a): the coding error in the finest band is no larger than the
  frame's own noise in that band on every frame (`lab/av1/metrics/README.md` §5 on `claude/av1-quality-metrics`).
  It is a measured anchor, not a reader's verdict.
* **SVC, base, layer** — scalable coding: one AV1 stream whose every unit holds a **base** layer and one or more
  enhancement layers predicted from it; a client takes a prefix of each unit. The **quarter-size SVC base** is a
  quarter-resolution lossy picture at q 40 under a lossless top (`lab/av1/delivery/scalable/tool/svc-results.md`
  on `claude/av1-svc-preview`). An **AV1 quality layer** (an SNR layer) is an enhancement layer at the same size as
  the one below, coded finer (§2a).
* **Operating point** — the set of layers a decoder is told to decode (§2a). **Op 1** below is the preview layer
  alone, **op 0** both layers.
* **Residual** — the exact frame minus the lossy picture the client holds, per sample, plus one offset, coded
  losslessly in HTJ2K and added back; the exact frame is checked against the volume's checksum.
* **HTJ2K-frame unit** — a time divided by the median per-frame HTJ2K decode of its own block's control in the same
  round: every time below is a ratio inside one browser on one host.

### 1 · The carriers, stage by stage

A **progressive client** shows, in order, every slice's preview, then every slice's VL picture, then every exact
frame; a **jump** shows one slice i from no decoder state, at preview, then VL, then exact. Bytes and decode are
counted cumulatively to each stage: what the client has fetched and decoded by then.

| carrier | name | preview | visually lossless | exact |
| --- | --- | --- | --- | --- |
| two quality layers, one stream | `snr` | layer 1 of an `svc_encoder_rtc` stream, op 1 | both layers, op 0 (layer 2 is predicted from layer 1 and from its own previous layer 2) | + layer 2's residual |
| two streams | `two` | an `aomenc` stream at Q 24 | its own `aomenc` stream at Q 4 or 8 | + the VL stream's residual |
| (a) quarter base + exact | `svc` | the quarter base, q 40 | none: the next picture is exact | the lossless top over the base (+ the low two bits on 12) |
| (b) separate per role | `sep` | as `two` | as `two` | + the whole HTJ2K frame |
| (c) one VL stream | `one` | the VL stream itself (its first picture is VL) | the same | + its residual |
| the shipped exact profile | `htj2k` | the whole HTJ2K frame, at every stage | | |

`sep` could instead take its exact frame by a residual off the preview (RESIDAPART): that residual was 0.98–1.00 of
HTJ2K's bytes at CRF 20 on these volumes (§3), within 2 % of `sep` as defined; it is not a separate carrier here.

### 2 · What AV1, libaom and the decoders allow

**2a · AV1 codes a quality layer as a spatial layer of the same size.** There is no separate syntax: the OBU
extension header's `spatial_id` names the layer, and "The term 'spatial' refers to the fact that the enhancement here
occurs in the spatial dimension: either as an increase in spatial resolution, or an increase in spatial fidelity
(increased SNR)" [S1, OBU extension header semantics]. Prediction runs downward only: data of `spatial_id` S "are only
allowed to reference previously coded video data of temporal_id T' and spatial_id S', where T' <= T and S' <= S"
[S1, same]; so layer 1 never depends on layer 2, and a decoder at op 1 drops layer 2 whole. Which layers are decoded
is the sequence header's operating point: "Bit j+8 is equal to 1 if spatial layer j should be decoded" [S1,
operating_point_idc], and an application displays "the highest spatial layer that is both within the operating point
and present within the temporal unit" [S1, output process]. The predefined scalability structures are all 2:1 or
1.5:1 (`SCALABILITY_L2T1` … "2 2:1 1 Yes" [S1, scalability_mode_idc table]); a 1:1 quality structure is not among
them, and would be described, if at all, by `SCALABILITY_SS` with its own structure — whether libaom writes that
metadata OBU for these streams is *unverified*, and no decoder here needs it: the operating points are in the
sequence header.

**2b · libaom codes two same-size layers two ways; this protocol can build one.** `examples/svc_encoder_rtc.cc`,
layering mode 5, two spatial layers with `-r 1/1,1/1` (the lab's encoder, already used lossless as `L2T1-full`,
`lab/av1/delivery/scalable/encoder/README.md`): layer 1 "Reference LAST, update LAST"; layer 2 "Reference LAST and
GOLDEN … Update slot 1 (LAST)" [S2, `case 5`], i.e. layer 2 predicts from its own previous layer 2 and from this
frame's layer 1, so a VL jump to i decodes both layers from i's keyframe (*derived*). Its quantizer per layer is the
lab's `--layer-q` patch. It is libaom's real-time encoder (speed 7). `examples/scalable_encoder.c` codes the other
shape in the good-quality usage: "use LAST (base layer) as sole reference" for the enhancement layer, base at cq 62
and enhancement at cq 10, `AOME_SET_NUMBER_SPATIAL_LAYERS` 2 [S3] — its layer 2 has no temporal chain, so a VL jump
would cost i's layer-1 chain and one layer-2 unit (*derived*); but it reads 8-bit 4:2:0 input only (*derived* from its
`aom_img_read` of an I420 image) and is not built here. `aomenc` itself has no spatial-layer option (*derived*: no
`spatial` argument in `apps/aomenc.c` at v3.15.1). So the one-stream carrier here is the real-time encoder's, and the
two-stream carrier the good-quality encoder's; §3 says what that costs, and the protocol measures the encoder's share.

**2c · The decoders.** dav1d: `operating_point` "select an operating point for scalable AV1 bitstreams (0 - 31,
default 0)", `all_layers` "output all spatial layers of a scalable AV1 biststream (default 1)" [S4]. The lab's
dav1d-WASM build opens at a chosen operating point with `all_layers` 0 (`two-layer/dav1d_wrap_op.c`); every arm
here decodes through it. WebCodecs: a chunk is "a single temporal unit" and its AV1 config has no operating point
[S5]; so a WebCodecs client reaches layer 1 only by cutting each unit before the first OBU with `spatial_id` > 0, which
the WebCodecs-base measurement found returns that layer identical to native dav1d at op 1, for full-size bases at
q 40 too (`docs/av1/README.md` §Preview, row WCBASE), and Chromium opens dav1d with `all_layers = 0` ("Only output
the highest spatial layer", the same README, [P4]). It refuses 12 bits; every stream here is coded at 10 bits (§5a),
so a WebCodecs client could decode all of them — not timed here. libaom's decoder: `AV1D_SET_OPERATING_POINT` ("at
most 31") and `AV1D_SET_OUTPUT_ALL_LAYERS`, "For video playback, only the highest-quality version (within the
selected operating point) is needed" [S2, `aomdx.h`].

### 3 · Theory, with the numbers it predicts

Every number here is *derived* from the rows named; none is this protocol's measurement. Bytes are ÷ the volume's
HTJ2K bytes (67 812 443 · 107 407 602 · 70 664 924 B for `dbts_a1` · `dbts_b1` · `dbts_c1`, RESIDAPART).

**3a · Where visually lossless falls.** METRICS has not landed its collector (`§Quality metrics, measured` does not
exist on `claude/av1-quality-metrics` at `a959cb04`); its shards 1, 2 and 4 hold these three volumes. Its anchor (a),
the highest Q at which every frame's noise-band error is within its noise, at G 1 · 8 · 16, in the 10-bit form this
protocol codes (top 10 bits on A and C, B as stored): **Q 4 on `dbts_a1` and `dbts_c1`, Q 8 on `dbts_b1`** (its
12-bit stream reads Q 4 · 8 · 8; Q 12 on `dbts_b1` at G 1). No rung keeps every window's largest move within one
display level, not even Q 1. Its knees fall at Q 8 on PSNR and MS-SSIM. **So the VL layer is bracketed by two rungs,
Q 4 and Q 8**, and every result is reported at both; which one a reader accepts is outside this protocol.

**3b · The layers' bytes** (METRICS' compression ratios, ÷ HTJ2K's; G 1 · 8 · 16; PSNR all-sample, median frame):

| volume | preview Q 24 | VL Q 8 | VL Q 4 | for scale: Q 16 · Q 32 |
| --- | --- | --- | --- | --- |
| `dbts_a1` | 0.64 · 0.31 · 0.29 %, 45.8–45.9 dB | 6.9 %, 49.7–49.9 dB | 23.0–23.2 %, 55.8 dB | 0.75–1.22 · 0.12–0.35 % |
| `dbts_b1` | 2.46 · 1.56 · 1.51 %, 45.2 dB | 21.6–21.9 %, 51.9–52.1 dB | 43.5–44.3 %, 59.1–59.3 dB | 4.3–5.3 · 0.50–1.13 % |
| `dbts_c1` | 0.80 · 0.38 · 0.36 %, 46.4–46.5 dB | 8.8–9.0 %, 51.2–51.3 dB | 24.8 %, 57.5 dB | 1.15–1.73 · 0.15–0.43 % |

Q 24 is chosen as the preview because its PSNR matches RESIDAPART's CRF 20 previews (45.94 · 44.77 · 46.56 dB, 0.32 ·
1.18 · 0.40 % of HTJ2K at G 8) on all three volumes. The VL layer is 7–44 % of HTJ2K: **a VL first picture costs
10–80× a preview's bytes**, and G barely moves the VL rungs (at Q ≤ 8 the noise is coded, and no frame predicts
another's noise).

**The residual from the VL layer.** RESIDAPART measured residual ÷ HTJ2K against preview PSNR on these volumes (G 8):
`dbts_a1` 0.998 at 45.94 dB, 0.973 at 48.35, 0.664 at 61.90; `dbts_b1` 0.981 · 0.875 · 0.442 at 44.77 · 50.15 · 65.53;
`dbts_c1` 0.994 · 0.959 · 0.649 at 46.56 · 49.71 · 63.59. Linear in dB between the neighbours: from VL Q 8, **0.94 ·
0.82 · 0.92**; from Q 4, **0.80 · 0.62 · 0.79** (*derived*, ±0.05 for the chord). So to exact:

| volume | `two` P + V + R, Q 8 · Q 4 | `one` V + R | `sep` P + V + HTJ2K | `svc` |
| --- | --- | --- | --- | --- |
| `dbts_a1` | 1.01 · 1.04 | 1.01 · 1.03 | 1.07 · 1.24 | 0.93–0.95 |
| `dbts_b1` | 1.05 · 1.08 | 1.04 · 1.06 | 1.23 · 1.46 | 0.93–0.95 |
| `dbts_c1` | 1.01 · 1.04 | 1.01 · 1.04 | 1.09 · 1.25 | 0.93–0.95 |

`svc`'s from svc-results headline 7: `p2-*` 0.989–1.007 of the shipped payload, HTJ2K 1.055–1.065 of it. **The
preview costs the exact frame its own bytes and nothing more** (RESIDAPART's finding, *derived* here for a residual
off the VL layer): two's 0.3–2.5 % over `one`.

**3c · The quality-layer form's bytes.** In one stream the preview layer is coded by the real-time encoder, and layer
2 predicts from layer 1 as well as from its own past. The carriers row measured the real-time encoder's single-layer
stream at 1.18–1.77× `aomenc`'s bytes at equal in-window PSNR near 44 dB (`results/amended-content.json` on this
branch's base: `dbts_a1` G 8, q 15 662 904 B at 44.73 dB against Q 18 374 342 B at 44.75; `dbts_b1` 1.25; `dbts_c1`
1.64; at G 1 1.18–1.52; *derived*). One trial in this session's pilot, `dbts_a1` G 8 (measured, not a result): layer 1
at q 24 is 352 333 B at 44.39 dB in-window against `aomenc` Q 24's 209 754 B at 44.26 (1.68×); layers 1 + 2 at q 8 are
4 950 888 B at 47.91 dB against the two `aomenc` streams' 4 849 462 B (Q 24 + Q 8, the VL at 48.20 dB) — 1.02× the
bytes for 0.3 dB less. **Predicted: `snr`'s preview 1.2–1.8× `two`'s, its VL total 0.95–1.25× `two`'s at equal
PSNR, its exact total within ±3 % of `two`'s** (the residual dominates).

**3d · Decode, per frame, in HTJ2K-frame units** (RESIDAPART's dav1d-WASM medians ÷ its HTJ2K, G 8, 1×: CRF 20 1.31–1.38,
CRF 8 2.03–2.31, CRF 2 3.5–4.2; residual decode R 0.61–0.76 and the add 0.22–0.35 of an HTJ2K frame; *derived*):
preview **1.3–1.4**; VL Q 8 **2.2–2.5**, Q 4 **3.0–3.3** (linear in dB between CRF rows); residual + add **0.75–1.1**,
less from Q 4 (a smaller residual); `snr`'s VL pass decodes both layers, **3.5–4.7**, so **1.3–1.7× `two`'s**; the
quarter base 0.07–0.21 (carriers collected, cheap view scroll); `svc`'s exact frame **4–10** (svc-results headline 5,
three-layer: 3.4–9.2× HTJ2K). A jump at G multiplies a per-frame cost by the mean chain, (G + 1) ÷ 2 for draws spread
over the volume: 1, 4.5, 8.5 at G 1, 8, 16.

### 4 · Predictions, each with what refutes it

All per volume, at both VL rungs unless named; the collector's medians decide. "Stage" as §1.

| # | prediction | refuted by |
| --- | --- | --- |
| S1 | First picture, bytes: `svc` < `two` = `sep` ≤ `snr` < `one` < `htj2k`; `two`'s preview keyframe 0.3–3 % of an HTJ2K frame, `one`'s 6–50 % | any order swapped, or a value outside its band |
| S2 | Every slice at preview, bytes ÷ HTJ2K: `two` 0.25–2.6 %; `snr` 1.2–1.8× `two`; `svc` 0.02–0.15 % | a value outside its band |
| S3 | Every slice at VL, bytes: `snr` ÷ `two` 0.95–1.25 | outside |
| S4 | Every slice exact, bytes ÷ HTJ2K: `two` 1.00–1.10, `one` 0.99–1.08, `sep` 1.05–1.50, `svc` 0.92–0.96 | outside |
| S5 | Every slice at VL, decode: `snr` ÷ `two` 1.3–1.7 | outside |
| S6 | Exact by residual against whole HTJ2K at the exact stage (`two` against `sep`): the residual's bytes fewer and its decode + add 0.75–1.1× an HTJ2K frame, so `two` **better** than `sep` | `sep` dominating at any stage |
| S7 | `two` against `one`: **a trade** — `two` dominates at first picture and preview, `one` at VL (its VL is `two`'s minus the preview) | any other label |
| S8 | `two` and `snr` against `svc`: **a trade** — `svc` dominates at first picture, preview and exact bytes, the two-layer carriers at VL | any other label |
| S9 | `snr` against `two`: `two` **better** (`snr` dominated at VL, nowhere dominating) | `snr` dominating at any stage |

### 5 · The protocol

**5a · Content** (`snr_content.py`). Per volume and G ∈ {1, 8, 16}, coded at 10 bits — the top 10 bits on A and C,
p = min((v + 2) ≫ 2, 1023), B as stored — so every carrier codes the same pictures METRICS' top-10 rows did:

* `aomenc` 3.15.1 with the profiles bytes run's arguments at the preview Q 24 and the VL Q 4 and Q 8 (and, bytes and
  PSNR only, Q 16 and Q 32 for scale); the residual of each VL stream (source − (picture ≪ 2) + one offset per
  stream, HTJ2K lossless per frame, every frame added back and checked exact before it is kept).
* `svc_encoder_rtc` mode 5, two layers at full size (`-r 1/1,1/1`), keyframe every G, the same input pictures. Each
  layer's quantizer is **matched**: stepped one at a time from Q 24 (layer 1) or the VL rung (layer 2) until two
  neighbours bracket the `aomenc` stream's in-window PSNR at the same G, the nearer kept (layer 1 first, at any layer-2
  quantizer, since layer 1 depends on nothing above it; then layer 2 over the kept layer 1). The match is on PSNR, not
  on METRICS' noise anchor, which is a proxy for it here (stated). Layer 2's residual as above.
* The quarter-base stream: mode 5, `-r 1/4,1/1`, q 40 and 0, keyframe every G, the shipped payload's low two bits
  apart on 12 (the SVC preview's `p2-q40` at that G). Checked natively: the last frame of the first group and the first
  of the second, decoded from their keyframe, exact.
* `search` writes the pin, [`results/pin.json`](../../lab/av1/delivery/snr/results/pin.json): every quantizer
  tried, its PSNR and bytes, and every unit size. `code` re-codes the pin and stops on any unit size that differs.

**What the search found** (the pin, *measured* on the pilot's host after the predictions above were pushed at
`9799d78a`; in-window PSNR; `dbts_a1` · `dbts_b1` · `dbts_c1`, G 1 · 8 · 16). The real-time encoder's layer 1 lands
at q 25 on every volume and G (q 26 on `dbts_c1` G 16 at the Q 4 rung), within 0.15 dB of `aomenc` Q 24, at **1.46–1.55
· 1.18–1.30 · 1.30–1.48×** its bytes. Layer 2 lands at q 3 · 2 · 2 for the Q 4 rung and q 8 · 7 · 7 for Q 8. Bytes to
VL, layers 1 + 2 over `aomenc` Q 24 + the VL stream, read at the VL stream's PSNR (log bytes linear in PSNR between
the two bracketing quantizers, *derived*): **Q 8 1.12–1.16 · 1.10–1.11 · 1.14–1.16×, Q 4 1.34–1.40 · 1.25–1.30 ·
1.38–1.43×**. So prediction S3 (0.95–1.25) is already outside its band at Q 4 on all three volumes, by the pin; the
run re-derives it and does not change it. The timed streams are the nearer quantizers, whose PSNR gaps (up to 0.9 dB
on `dbts_b1` at Q 4, where layer 2's q 2 and q 3 straddle 54.5 dB) the collector prints beside every bytes figure.

**5b · Blocks, arms, order.** A **block** is one (volume, G, VL rung) in one fresh headless Chromium: arms `snr`,
`two`, `ctrl`, `ctrl-aa`, and `svc` too when the rung is 8 (`svc` does not depend on the rung, so it runs once a
(volume, G) and is compared at both rungs through the controls, rounds paired). `ctrl` decodes every HTJ2K frame of
the volume in order; `ctrl-aa` the same again — the A/A. Arms run in a Williams order (`lab/order.mjs`; period 4 for
the four-arm blocks, 10 for the five-arm), the 18 blocks of a round in a Williams order too. Each block starts with
an untimed pass of every path on frame 0; before each arm a forced collection and two untimed units on a throwaway
decoder (the carriers row's washout, its review finding 19).

**5c · The ops** (`snr.js`), every clock ending at the picture's samples in one array, every decode one-thread
dav1d-WASM or OpenJPH:

| arm | in order | for each of 4 asked frames i (uniform over 0 … F − 2, seeded by round and volume) |
| --- | --- | --- |
| `snr`, `two` | the preview stream, every unit on one fresh decoder (op 1 for `snr`); then the VL stream (op 0), each frame's residual decoded and added after its unit | a fresh decoder, the preview from i's keyframe to i; a fresh decoder, the VL the same; i's residual and the add |
| `svc` | the bases at op 1; then every full unit at op 0 merged with its low bits | the bases from i's keyframe to i; the full units the same, and i's low bits |
| `ctrl`, `ctrl-aa` | every HTJ2K frame | — (`htj2k` and `sep` read frame i from `ctrl`'s rows) |

Four asked frames, not the carriers row's eight: the round's time (§6). **Checked, every op:** every lossy picture
against native dav1d's hash at its operating point, every exact frame against the fetch's checksum; a miss removes
that arm's round in the collector and is counted.

**5d · Stages from ops** (`rule.stages`, *derived* from §1's definitions). In order, cumulative: first picture =
the first preview unit's decode (for `one` the first VL unit; `htj2k` HTJ2K frame 0); every slice at preview = Σ the
preview pass; at VL = that + Σ the VL pass (for `one`: Σ VL; for `svc`: + Σ the exact pass); exact = that + Σ the
residual and add (for `sep`: + Σ `ctrl`; `svc` and `htj2k` unchanged). A jump to i, cumulative the same way, averaged
over the round's 4 asked frames. **Bytes** by the same definitions from the pin's unit sizes, deterministic, a jump
averaged over every i in 0 … F − 2.

**5e · The rule** (`rule.py`; derived from the definitions and one cited interval, no bar of ours):

1. **Value.** Each (volume, G, rung, carrier, stage, round): the stage time ÷ its block's control's median frame.
2. **A/A gate, per block.** Read only if the 95 % interval of the median of log(`ctrl-aa` ÷ `ctrl`) over rounds holds 0.
3. **Order gate, per (block, arm).** The largest |predecessor median − overall median| of log(arm total ÷ control
   total); p from 2 000 shuffles of the predecessor labels; flagged if p < 0.05 ÷ (arms in the block). A carrier is
   not read where any arm it is built from (`one` from `two`, `sep` from `two` and `ctrl`), or the control, is flagged.
4. **A pair** (two carriers, one stage): per-round log ratio, its median and the distribution-free 95 % interval of
   the median from order statistics [S6]; **decided** for the lower time when the interval excludes 0, **not
   resolved** otherwise, **not read** under 2 or 3, and at n < 6, where no interval exists (so too few rounds never let
   bytes alone decide dominance).
5. **Dominance, per stage**, the carriers row's definition (`amended.dominates`): X dominates Y if X's bytes are no
   more, no time pair is decided against X or not read, and X has fewer bytes or the time decided for it. Each
   carrier's state at each stage — on the frontier, dominated, or not read — is printed with its bytes and median.
6. **The answer, per (volume, G, rung)**, for each two-layer carrier T ∈ {`snr`, `two`} against each alternative X ∈
   {`svc`, `sep`, `one`}, and `snr` against `two`: **better** if T dominates X at some stage and X dominates T at
   none; **worse** the mirror; **a trade** if each dominates somewhere; **neither dominates** otherwise; **not read**
   if a stage between them is not read and the label is not already a trade (one more stage cannot undo a trade, *derived*).
   A label holds "on these three volumes" when it is the same on each.
7. **Reported, not judged:** per-frame medians, the residual's decode and add apart, the Q 16 and Q 32 previews' bytes,
   the matched quantizers and their PSNR gaps, and the real-time encoder's share (`snr` ÷ `two` bytes per layer).

### 6 · Pilot, rounds, saturation

*Filled from the pilot (§6 is the pilot's section); see below.*

### 7 · The harness

[`lab/av1/delivery/snr/`](../../lab/av1/delivery/snr/), built on the carriers row's helpers (`sweep.py`, `ask.js`,
`amended.py`), which it imports and does not change.

| file | does |
| --- | --- |
| `snr_content.py` | `search`: every stream and the matched quantizers, the pin; `code`: re-codes the pin, stops on any difference, checks every residual and the quarter-base chains exact natively, writes one index a volume |
| `snr.js`, `snr.html` | one block: the untimed pass, the washouts, the arms in a Williams order, every op of §5c with its checks |
| `snr.mjs` | the driver: each (round, volume, G, rung) a fresh Chromium; a block past 15 min is `VOID`; `--mutate sample · truth · offset · skip · low · unit` |
| `mutations.py` | each browser break against the checks it must fail and only those |
| `rule.py` | the collector: §5d–e end to end |
| `rule_test.py`, `mutate_rule.py` | 47 claims of `rule.py`'s arithmetic, and 15 breaks of it, each caught |
| `run.sh` | a shard: `tools content mutate rounds` |

### Sources

* [S1] AV1 Bitstream & Decoding Process Specification, <https://aomediacodec.github.io/av1-spec/>, the rendered
  page read 2026-11-05 (SHA-256 `acf58a3fdb82…`, the same page `docs/av1/README.md` cites); sections by their headings.
* [S2] libaom v3.15.1, <https://aomedia.googlesource.com/aom/+/refs/tags/v3.15.1/>: `examples/svc_encoder_rtc.cc`
  (`73bdc5b48c0e…`), `aom/aomdx.h` (`2df31f09ec30…`), `aom/aomcx.h` (`525911c396b0…`), read 2026-11-05. Source code,
  the last resort, read for its layering and its controls.
* [S3] libaom v3.15.1 `examples/scalable_encoder.c`, from the pinned tarball (`dd7417eb0e82…`).
* [S4] dav1d 1.5.4 `include/dav1d/dav1d.h`, <https://code.videolan.org/videolan/dav1d/-/tree/1.5.4> through its GitHub
  mirror (`dbc211a0f548…`, the file `docs/av1/README.md` [P6] cites).
* [S5] WebCodecs AV1 codec registration, <https://w3c.github.io/webcodecs/av1_codec_registration.html>
  (`b77ff65ac41a…`): "EncodedVideoChunk [[internal data]] is expected to be a sequence of Open Bitstream Units (OBUs)
  compliant to the 'low-overhead bitstream format' (Section 5.2 of [AV1]) forming a single temporal unit".
* [S6] NIST/SEMATECH Dataplot Reference Manual, MEDIAN CONFIDENCE LIMITS, as [`profile-carriers.md`](profile-carriers.md)
  §Sources [C3] quotes it.
* Measured rows: RESIDAPART (`lab/av1/delivery/residual/README.md` on `claude/av1-residual-apart`, `6a2994f8`),
  METRICS shards 1, 2, 4 (`lab/av1/metrics/README.md` on `claude/av1-quality-metrics`, `a959cb04`), the SVC metrics
  (`svc-results.md` on `claude/av1-svc-preview`, `ad28ae2b`), the carriers row (this branch's base, `ff3e2de9`).
