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
  frame's own noise in that band on every frame (`lab/av1/metrics/README.md` §5 on `claude/av1-quality-metrics`, `a959cb04`).
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
| S8 | `two` and `snr` against `svc` (Q 8): **a trade** — `svc` dominates at first picture, preview and exact bytes, the two-layer carriers at VL | any other label |
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
(volume, G) and is judged at the Q 8 rung only, in its own block, §6). `ctrl` decodes every HTJ2K frame of
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
   {`svc`, `sep`, `one`} (`svc` at the Q 8 rung), and `snr` against `two`: **better** if T dominates X at some stage
   and X dominates T at none; **worse** the mirror; **a trade** if each dominates somewhere; **neither dominates**
   otherwise; **not read** if a stage between them is not read and the label is not already a trade (one more stage
   cannot undo a trade, *derived*).
   A label holds "on these three volumes" when it is the same on each.
7. **Reported, not judged:** per-frame medians, the residual's decode and add apart, the Q 16 and Q 32 previews' bytes,
   the matched quantizers and their PSNR gaps, and the real-time encoder's share (`snr` ÷ `two` bytes per layer).

### 6 · Pilot, rounds, saturation

**The pilot** (this session, 2026-11-05: a 4-core Intel Xeon @ 2.10 GHz, 15 GB, headless Chromium 153.0.8010.12; rows
in [`results/pilot.jsonl`](../../lab/av1/delivery/snr/results/pilot.jsonl), not read for any verdict). Three rounds of
all 18 blocks, 20.0 · 21.2 · 20.4 min; every check passed in all 54 blocks, no `VOID`; the six browser breaks on
`dbts_a1` · G 8 · Q 8 each caught, only its own
([`results/pilot.mutations.jsonl`](../../lab/av1/delivery/snr/results/pilot.mutations.jsonl)). The robust spread
(1.4826 × MAD of per-round log ratios, `pilot_spread.py`) of the A/A is **0.061 · 0.073 · 0.061** (`dbts_a1` ·
`dbts_b1` · `dbts_c1`), against the carriers pilot's 0.022–0.032: whole passes slowed by 20–40 % at random on every
arm alike, and where `ctrl-aa` ran first in a block (round 1, the nine five-arm blocks) it was slower than `ctrl` in
six, by up to 42 %, despite the washout. V8's optimizing WASM compiler forced from the start (`--no-liftoff`, four
rounds of `dbts_a1` · G 8's two blocks) left the A/A as spread, so it is not adopted; the cause is *unverified* (the
host's own noise is the reading). The order gate (§5e.3) counts "first" as a predecessor, so a first-arm effect is
tested, not assumed away. **Of the pairs the rule reads**, the spread's median · 90th percentile per stage: first
picture 0.12 · 0.36; every slice at preview 0.068 · 0.21, at VL 0.028 · 0.097, exact 0.026 · 0.091; a jump at preview
0.057 · 0.26, at VL 0.044 · 0.17, exact 0.035 · 0.16 (a single unit, or a mean over four asked frames that change from
round to round, spreads the most). Three values give a crude spread; the collector prints the run's own.

**The control differs between the two kinds of block**: its median HTJ2K frame is 1.25× slower in the four-arm (Q 4)
blocks than in the five-arm (Q 8) blocks on `dbts_a1` and `dbts_c1`, and 0.94× on `dbts_b1`, over the pilot's rounds
(the cause is *unverified*: the Q 4 blocks hold larger streams and residuals in the page). A time divided by one block's
control and compared with a time divided by another's would carry that gap, so **`svc` is judged only at the Q 8 rung,
in its own block**; at Q 4 its bytes are printed and its pairs are not read (`rule.normalized`; tested and mutated).

**Rounds, from it.** The budget holds **10 rounds a shard, n = 20 over the two shards** (§Shards: about 39 min of
tools, frames, content and mutations, then 21 min a round, within 4.5 h). No resolution is a bar on the answer; it is
what n buys, said before the run. For a median of n paired log ratios of spread σ the rule's interval excludes 0 for a
true ratio e^δ in about 80 % of runs when δ ≥ 2.80 × 1.2533 × σ ÷ √n (normal approximation; 1.2533 = √(π/2), the
median's cost against the mean; *derived*). At n = 20, at the pilot's median spread, a stage resolves: first picture
9.3 %, every slice at preview 5.3 %, at VL 2.2 %, exact 2.0 %, a jump at preview 4.5 %, at VL 3.5 %, exact 2.7 %; at
its 90th percentile 28 · 17 · 7.6 · 7.1 · 20 · 13 · 12 % (*derived*). The gaps §4 predicts for the decisive pairs are
30–70 % (`snr` against `two` at VL) or orders of magnitude (first picture against `one` and `svc`); the residual
against the whole HTJ2K frame (S6), predicted within 0.75–1.1×, may not resolve, which the label then shows as a stage
neither side dominates. The pilot's own medians, crude and not read: `snr` ÷ `two` to every slice at VL 1.13–1.65,
`two` ÷ `sep` to every slice exact 1.04–1.11.

**Order at that n.** The four-arm blocks' Williams period is 4 rounds, the five-arm blocks' 10, the round's own order
of 18 blocks 18: 20 rounds are whole periods of the first two, so each arm follows each other arm 5 times in a
four-arm block and 4 in a five-arm block (and runs first as often), enough for the permutation test to have values
a predecessor (§5e.3; the carriers review's finding 1).

**Saturation.** One decode in flight, one thread a decoder: one core of four, on the page's thread; the host does not
saturate in any arm, and a shard runs nothing else while it times. Nothing is claimed past 1×, for concurrent asks, a
link, a phone, another host, or WebCodecs; no absolute ms: every time is a ratio inside one block, and only ratios are
pooled across shards.

**Fixtures, and the only ones.** `dbts_a1`, `dbts_b1`, `dbts_c1` (`lab/av1/fetch_data.sh`, SHA-256-checked), one per
system. The repository holds few cine-like breast series: its ultrasound cine is lossy-sourced and ABUS is absent, so
nothing is claimed for ultrasound, FFDM, or any volume but these three.

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
| `rule_test.py`, `mutate_rule.py` | 48 claims of `rule.py`'s arithmetic, and 15 breaks of it, each caught |
| `pilot_spread.py` | the pilot's spread per stage and pair, which sizes the rounds (§6) |
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

## Shards

| shard | rounds | writes | heading |
| --- | --- | --- | --- |
| 1 | 0–9, every block | in `lab/av1/delivery/snr/results/`: `shard-1.jsonl`, `.mutations.jsonl`, `.index.dbts_{a1,b1,c1}.json`, `.md` | `### SNR shard 1, measured` |
| 2 | 10–19, every block | in `lab/av1/delivery/snr/results/`: `shard-2.jsonl`, `.mutations.jsonl`, `.md` | `### SNR shard 2, measured` |

Each on its own 4-core cloud host, ≤ 4.5 h wall; split by rounds, never by arm, so every shard runs every block whole.

```bash
git fetch origin && git checkout claude/av1-snr-preview
SHARD=k ROUNDS_PER_SHARD=10 BUDGET_S=16200 lab/av1/delivery/snr/run.sh tools content mutate rounds
python3 lab/av1/delivery/snr/rule.py lab/.av1-work/snr/ lab/av1/delivery/snr/results/shard-k.jsonl \
  > lab/av1/delivery/snr/results/shard-k.md   # the shard's own rows, a check, not read for any verdict
```

| step | `run.sh` | minutes on the pilot's host |
| --- | --- | --: |
| tools: libaom, dav1d, the patched `svc_encoder_rtc`, dav1d-WASM with operating points, OpenJPH, the volumes | `tools` | 6 |
| the shipped frames (HTJ2K and the low bits) 5.5; `snr_content.py code` re-coding the pin, every unit checked, 21 | `content` | 27 |
| `rule_test.py`, `mutate_rule.py`; six browser breaks on block `dbts_a1` · G 8 · Q 8, `mutations.py` | `mutate` | 6 |
| 10 rounds at 20.0–21.2 min | `rounds` | 200–212 |
| **total** | | **239–251**, under 270 |

`BUDGET_S` is 4.5 h from `run.sh`'s start: a shard on a slower host stops after a whole round once less than one
round's time is left and reports its n; the collector pools what came. `code` stops the shard if any unit differs from
the pin; `mutations.py` stops it if a break misses its own check or fails another's, and the shard reports that
instead of rounds.

Each shard appends its heading at the end of this file (after `git pull --rebase`) and writes nothing else: its host
(`lscpu` model, cores, memory, Chromium), each step's wall, its n and `VOID` count, its mutations' table, and anything
that differed from the protocol; `.md` holds `rule.py`'s output on its own rows.

**The collector**, once both headings exist (or the last says it stopped):

```bash
python3 lab/av1/delivery/snr/rule.py lab/av1/delivery/snr/results/shard-1.index. \
  lab/av1/delivery/snr/results/shard-{1,2}.jsonl > lab/av1/delivery/snr/results/collected.md
```

It prints, under `## SNR preview, collected`: n and `VOID`s; every block's A/A interval and the count that fail; every
arm flagged by order with its p; per (volume, G, rung) each stage's bytes and median in HTJ2K-frame units for all six
carriers with its frontier state, the match's PSNR and the per-frame decodes beside it; each pair's label and the
stages each side dominates; and the answer table, per (two-layer carrier, alternative, G, rung), with whether it
holds "on these three volumes".

### SNR shard 1, measured

* **Run:** rounds 0–9 of §Shards, every one of the 18 blocks whole in each round, on one 4-core cloud host, 2026-11-05.
* **Shows:** n = 10 rounds, 180 timed blocks, 0 `VOID`, 0 failed checks; 17 of 18 blocks pass the A/A gate.
* **Every check held:** each lossy picture against native dav1d's hash, each exact frame against the fetch's checksum.
* **Rests on:** `dbts_a1`, `dbts_b1`, `dbts_c1` only, at 1×, one-thread dav1d-WASM and OpenJPH, this host's Chromium.
* **Left:** shard 2's rounds 10–19 and the collector over both; nothing below is a verdict, only this shard's rows.

A **block** is one (volume, G, VL rung) in a fresh Chromium; an **arm** one carrier's ops within it; the **A/A** is
`ctrl-aa` against `ctrl`, the same HTJ2K pass twice; a **`VOID`** block is one stopped past 15 min; **n** is rounds
read. Times are in HTJ2K-frame units (§Terms). Every other term is §Terms'.

**Host.** Intel(R) Xeon(R) Processor @ 2.10GHz (`lscpu`), 4 cores, 15 GB, Google Chrome for Testing 153.0.8010.12
headless — the pilot's model and build. Where it saturates: it does not, in any arm; one decode in flight on one
thread, one core of four, as §6 says, and nothing is claimed past 1×. While blocks timed, the only other work was
`git commit`/`push` of this shard's rows (below).

| step | wall |
| --- | --: |
| `tools` | 7.3 min |
| `content`: shipped frames 6.3, `snr_content.py code` 22.0 (no unit differed from the pin) | 28.3 min |
| `mutate`: `rule_test.py` 48/48, `mutate_rule.py` 15/15 caught, six browser breaks | 6 min |
| `rounds`: 20.7 · 20.9 · 19.5 · 20.0 · 20.7 · 19.2 · 19.9 · 20.6 · 20.8 · 19.8 | 201.9 min |
| **total**, 09:03:43–13:07:10 UTC, under `BUDGET_S` | 243.5 min |

**Mutations** ([`shard-1.mutations.jsonl`](../../lab/av1/delivery/snr/results/shard-1.mutations.jsonl), block
`dbts_a1` · G 8 · Q 8; `mutations.py`'s table):

| break | checks failed | must fail | outcome |
| --- | --- | --: | --- |
| sample | all 16 (`snr`, `two`: preview, vl, preview-jump, vl-jump, residual; `svc`: preview, exact, both jumps; `ctrl`, `ctrl-aa`) | 16 | caught, only its own |
| truth | the same 16 | 16 | caught, only its own |
| offset | `snr` residual, `snr` vl, `two` residual, `two` vl | 4 | caught, only its own |
| skip | `snr`, `two` preview-jump, vl-jump, residual; `svc` preview-jump, exact-jump | 8 | caught, only its own |
| low | `svc` exact, `svc` exact-jump | 2 | caught, only its own |
| unit | `snr` residual, `snr` vl, `snr` vl-jump | 3 | caught, only its own |

**A/A** (`rule.py` on this shard's rows, [`shard-1.md`](../../lab/av1/delivery/snr/results/shard-1.md)): the 95 %
interval of the median log(`ctrl-aa` ÷ `ctrl`) holds 0 in 17 of 18 blocks; `dbts_c1` · G 16 · Q 4 does not (+0.035,
interval 0.012 to 0.098, n 10), so that block is not read. No arm is flagged by the order gate in any block.

**Numbers, this shard's rows only** (every slice; bytes are the pin's at the timed — nearer — quantizers, not the
PSNR-interpolated figures of §5a; time is the ratio of the two carriers' medians, *derived* from `shard-1.md`, not
the rule's paired interval). `dbts_a1` · `dbts_b1` · `dbts_c1`, G 1 · 8 · 16:

| | Q 4 rung | Q 8 rung |
| --- | --- | --- |
| VL, `snr` ÷ `two` bytes | 1.26 1.21 1.21 · 1.33 1.33 1.33 · 1.55 1.52 1.51 | 1.10 1.02 1.01 · 1.07 1.05 1.05 · 1.28 1.23 1.23 |
| VL, `snr` ÷ `two` time | 1.52 1.50 1.39 · 1.25 1.38 1.42 · 1.62 1.58 1.56 | 1.61 1.24 1.36 · 1.21 1.29 1.32 · 1.65 1.50 1.43 |
| exact, ÷ HTJ2K bytes: `two` | 1.045 1.045 1.045 · 1.077 1.067 1.066 · 1.043 1.042 1.043 | 1.025 1.020 1.020 · 1.068 1.053 1.053 · 1.029 1.021 1.022 |
| exact, ÷ HTJ2K bytes: `one` | 1.039 1.042 1.042 · 1.053 1.051 1.051 · 1.035 1.038 1.039 | 1.019 1.017 1.017 · 1.044 1.038 1.038 · 1.021 1.017 1.018 |
| exact, ÷ HTJ2K bytes: `sep` | 1.236 1.234 1.234 · 1.467 1.452 1.451 · 1.256 1.251 1.251 | 1.075 1.072 1.071 · 1.243 1.232 1.231 · 1.098 1.092 1.092 |
| exact, ÷ HTJ2K bytes: `snr` | 1.120 1.107 1.106 · 1.219 1.185 1.183 · 1.167 1.150 1.149 | 1.037 1.027 1.026 · 1.091 1.073 1.072 · 1.050 1.038 1.037 |
| exact, `two` ÷ `sep` time | 1.05 1.03 1.05 · 1.04 1.07 1.06 · 1.05 1.08 1.11 | 1.07 1.07 1.06 · 1.05 1.07 1.06 · 1.08 1.09 1.09 |

`svc`'s exact bytes ÷ HTJ2K: 0.979 0.942 0.940 · 1.022 0.945 0.940 · 1.001 0.940 0.936. `two`'s every-slice preview ÷
HTJ2K: 0.64 0.31 0.29 · 2.46 1.56 1.51 · 0.80 0.38 0.36 %. The matched quantizers are the pin's (layer 1 q 25, q 26
on `dbts_c1` G 16 Q 4; layer 2 q 3 · 2 · 2 at Q 4, q 8 · 7 · 7 at Q 8); their in-window PSNR gaps are in `shard-1.md`.

**Labels the rule prints on this shard's rows** (n = 10; `svc` pairs at Q 4 are not read by design, §6):

| pair | label at every (G, rung) read on all three volumes |
| --- | --- |
| `snr` against `two` | worse |
| `snr` against `sep` | worse |
| `snr`, `two` against `one` | a trade |
| `snr`, `two` against `svc` (Q 8) | a trade |
| `two` against `sep` | neither dominates, except better on `dbts_b1` G 1 Q 4 and `dbts_a1` G 8 Q 4 |

At G 16 · Q 4 the `dbts_c1` block is not read (A/A), so no label there holds on all three volumes from this shard.

**What differed from the protocol.** (1) `meson`, which `tools` needs for dav1d, was absent from the host and was
installed from PyPI (1.12.1, not pinned); the first `run.sh` stopped there and was restarted from the start, and the
budget runs from that start. (2) `run.sh` exits 1 after a whole run: its last command is the budget test, false when
budget remains (*derived* from `set -e` and the loop's last status); every round finished. (3) This shard's rows were
committed and pushed after each round, at the next round's first block, and seven more times inside rounds 2, 3, 4,
6, 7 and 8, while a block timed: a few seconds of `git` on a second core each. (4) `tools` leaves `lab/av1/profiles/`
checked out from the carriers row; it is not committed.

### SNR shard 2, measured

* **Run:** rounds 10–19 of §Shards, the 18 blocks of each round in its Williams order, on one 4-core cloud host, 2026-11-05.
* **Shows:** n = 10 rounds, 178 timed blocks, 2 `VOID` (both in round 15, cause below), 0 failed checks; 17 of 18 blocks pass the A/A gate.
* **Every check held:** 50 004 lossy pictures against native dav1d's hash, 48 580 exact frames against the fetch's checksum.
* **Rests on:** `dbts_a1`, `dbts_b1`, `dbts_c1` only, at 1×, one-thread dav1d-WASM and OpenJPH, this host's Chromium.
* **Left:** the collector over both shards; nothing below is a verdict, only this shard's rows.

A **block** is one (volume, G, VL rung) in a fresh Chromium; an **arm** is one carrier's ops within it; the **A/A** is
`ctrl-aa` against `ctrl`, the same HTJ2K pass twice; a **`VOID`** block is one with no timed rows; **n** is rounds
read. Times are in HTJ2K-frame units (§Terms). Every other term is §Terms'.

**Host.** Intel(R) Xeon(R) Processor @ 2.10GHz (`lscpu`), 4 cores, 15.7 GB, Chromium 153.0.8010.12 headless (the
pre-installed Playwright build) — the pilot's model and build. Where it saturates: it does not, in any arm; one decode
in flight on one thread, one core of four, as §6 says, and nothing is claimed past 1×.

| step | wall |
| --- | --: |
| `tools` | 7.9 min |
| `content`: shipped frames 7.3, `snr_content.py code` 22.6 (no unit differed from the pin) | 29.9 min |
| `mutate`: `rule_test.py` 48/48, `mutate_rule.py` 15/15 caught, six browser breaks | 5.4 min |
| `rounds` 10–19: 22.2 · 21.4 · 18.9 · 19.8 · 20.9 · 16.6 (stopped, below) · 20.2 · 19.4 · 19.5 · 20.8 | 199.7 min |
| **total**, from the `tools` start at 09:03 UTC to round 19's end, under `BUDGET_S` | 245.6 min |

**Mutations** ([`shard-2.mutations.jsonl`](../../lab/av1/delivery/snr/results/shard-2.mutations.jsonl), block
`dbts_a1` · G 8 · Q 8, round 0; `mutations.py`'s table):

| break | checks failed | must fail | outcome |
| --- | --- | --: | --- |
| sample | all 16 (`snr`, `two`: preview, vl, preview-jump, vl-jump, residual; `svc`: preview, exact, both jumps; `ctrl`, `ctrl-aa`) | 16 | caught, only its own |
| truth | the same 16 | 16 | caught, only its own |
| offset | `snr` residual, `snr` vl, `two` residual, `two` vl | 4 | caught, only its own |
| skip | `snr`, `two` preview-jump, vl-jump, residual; `svc` preview-jump, exact-jump | 8 | caught, only its own |
| low | `svc` exact, `svc` exact-jump | 2 | caught, only its own |
| unit | `snr` residual, `snr` vl, `snr` vl-jump | 3 | caught, only its own |

**A/A** (`rule.py` on this shard's rows, [`shard-2.md`](../../lab/av1/delivery/snr/results/shard-2.md)): the 95 %
interval of the median log(`ctrl-aa` ÷ `ctrl`) holds 0 in 17 of 18 blocks; `dbts_a1` · G 8 · Q 4 does not (−0.126,
interval −0.422 to −0.030, n 10), so that block is not read. No arm is flagged by the order gate in any block.
`dbts_b1` · G 1 at both rungs has n 9 (the two `VOID`s).

**Numbers, this shard's rows only** (every slice; bytes are the pin's at the timed — nearer — quantizers, identical to
shard 1's; time is the ratio of the two carriers' medians, *derived* from `shard-2.md`, not the rule's paired
interval). `dbts_a1` · `dbts_b1` · `dbts_c1`, G 1 · 8 · 16:

| | Q 4 rung | Q 8 rung |
| --- | --- | --- |
| VL, `snr` ÷ `two` bytes | 1.26 1.21 1.21 · 1.33 1.33 1.33 · 1.55 1.52 1.51 | 1.10 1.02 1.01 · 1.07 1.05 1.05 · 1.28 1.23 1.23 |
| VL, `snr` ÷ `two` time | 1.49 1.40 1.40 · 1.25 1.36 1.35 · 1.63 1.52 1.57 | 1.68 1.32 1.38 · 1.15 1.25 1.27 · 1.63 1.49 1.51 |
| exact, ÷ HTJ2K bytes: `two` | 1.045 1.045 1.045 · 1.077 1.067 1.066 · 1.043 1.042 1.043 | 1.025 1.020 1.020 · 1.068 1.053 1.053 · 1.029 1.021 1.022 |
| exact, ÷ HTJ2K bytes: `one` | 1.039 1.042 1.042 · 1.053 1.051 1.051 · 1.035 1.038 1.039 | 1.019 1.017 1.017 · 1.044 1.038 1.038 · 1.021 1.017 1.018 |
| exact, ÷ HTJ2K bytes: `sep` | 1.236 1.234 1.234 · 1.467 1.452 1.451 · 1.256 1.251 1.251 | 1.075 1.072 1.071 · 1.243 1.232 1.231 · 1.098 1.092 1.092 |
| exact, ÷ HTJ2K bytes: `snr` | 1.120 1.107 1.106 · 1.219 1.185 1.183 · 1.167 1.150 1.149 | 1.037 1.027 1.026 · 1.091 1.073 1.072 · 1.050 1.038 1.037 |
| exact, `two` ÷ `sep` time | 1.05 1.03 1.04 · 1.05 1.06 1.05 · 1.07 1.11 1.09 | 1.07 1.07 1.06 · 1.06 1.06 1.05 · 1.10 1.10 1.08 |

`svc`'s exact bytes ÷ HTJ2K: 0.979 0.942 0.940 · 1.022 0.945 0.940 · 1.001 0.940 0.936. `two`'s every-slice preview ÷
HTJ2K: 0.64 0.31 0.29 · 2.46 1.56 1.51 · 0.80 0.38 0.36 %. The matched quantizers are the pin's; their in-window PSNR
gaps are in `shard-2.md`.

**Labels the rule prints on this shard's rows** (n = 10, 9 on `dbts_b1` G 1; `svc` pairs at Q 4 are not read by
design, §6):

| pair | label at every (G, rung) read on all three volumes |
| --- | --- |
| `snr` against `two` | worse |
| `snr` against `sep` | worse |
| `snr`, `two` against `one` | a trade |
| `snr`, `two` against `svc` (Q 8) | a trade |
| `two` against `sep` | neither dominates |

At G 8 · Q 4 the `dbts_a1` block is not read (A/A), so no label there holds on all three volumes from this shard.

**What differed from the protocol.** (1) `meson`, which `tools` needs for dav1d, was absent from the host and was
installed from PyPI at 1.9.1, the version `README.md` names; the first `tools` stopped there and was restarted, and
the budget runs from that restart. (2) The steps were run one `run.sh` call at a time, and the rounds by the same
`snr.mjs` command `run.sh` uses, so that each round's rows could be committed and pushed between rounds; the budget
test was the same, from the `tools` restart. (3) Round 15's last two blocks, `dbts_b1` · G 1 · Q 8 and Q 4, are
`VOID`: this session's two-hour limit on one background command stopped the round runner and its local file server
mid-block (rows: "Browser closed", then "ERR_CONNECTION_REFUSED"), not the 15-min block limit; they were not re-run,
which would have broken the round's order, and rounds 16–19 ran after a gap of about a minute. (4) Once, during round 11, a
commit and push of this heading ran beside a timed block: a few seconds of `git` on a second core. (5) `tools` leaves
`lab/av1/profiles/` checked out from the carriers row; it is not committed.

## SNR preview, measured

*2026-11-05, the collector over shards 1 and 2.*

* **Run:** `rule.py` (§5e) over both shards' rows, as §Shards writes it, into [`results/collected.md`](../../lab/av1/delivery/snr/results/collected.md); no new timing.
* **Shows:** `two` is a trade against `svc` (Q 8 rung) and `one`, and neither it nor `sep` dominates the other; `snr` is worse than `two` and `sep`.
* **And:** every AV1 carrier's decode to every exact slice is 2.8–10× the shipped HTJ2K's, and the residual plus its add costs 1.2–1.6 HTJ2K frames, not the 0.75–1.1 predicted.
* **Rests on:** `dbts_a1`, `dbts_b1`, `dbts_c1` only (one DBT volume per system), n = 20 rounds (19 on `dbts_b1` G 1), at 1×, one-thread dav1d-WASM and OpenJPH in headless Chromium on two 4-core hosts.
* **Left:** no breast ultrasound cine or ABUS fixture exists, so nothing here speaks for them; `dbts_a1` · G 8 · Q 4 is not read (A/A); `svc` at the Q 4 rung is not read by design (§6).

**Terms.** A **carrier** is one way of delivering the volume (§1): `snr` (preview and VL as two AV1 quality layers
in one stream), `two` (preview and VL as two `aomenc` streams), `svc` (quarter-size SVC base + exact layer), `sep`
(`two`'s streams + the whole HTJ2K frame), `one` (the VL stream alone + residual), `htj2k` (the shipped exact
profile). **VL** is visually lossless, METRICS' noise anchor (§Terms), at the **Q 4** or **Q 8 rung**. A
**stage** is what the client has shown: the first picture, every slice at preview, at VL or exact, or a **jump**
(one slice from no decoder state) at each. A **block** is one (volume, G, rung) in a fresh browser, and a **round**
is one pass over all 18 blocks. **n** is the rounds read. Times are in **HTJ2K-frame units**: a time ÷ the median
HTJ2K frame decode of its own block's control. A carrier **dominates** another at a stage when its bytes are no more,
no time pair is decided against it or not read, and its bytes are fewer or its time is decided lower (§5e.5). A pair
is **decided** when the 95 % order-statistic interval of the median per-round log ratio excludes 0. A **label**
(better, worse, a trade, neither dominates, not read) is §5e.6's.

**Collected.** 20 rounds and 2 `VOID` blocks (shard 2's round 15). The A/A (`ctrl-aa` against `ctrl`) holds 0 in 17
of 18 blocks. Over both shards `dbts_a1` · G 8 · Q 4 fails (median −0.131, interval −0.208 to −0.030); shard 1 had
failed `dbts_c1` · G 16 · Q 4 alone, which passes at n = 20. No arm is flagged by order in any block. The collector
step ran exactly as §Shards writes it. `rule_test.py` holds 48/48 on this checkout.

**The answer** (§5e.6; "all three" = the same label on each volume):

| pair | G 1 | G 8 | G 16 |
| --- | --- | --- | --- |
| `two` against `svc` (Q 8) | a trade, all three | a trade, all three | a trade, all three |
| `two` against `one` | a trade, all three, both rungs | Q 8 all three; Q 4 not read on `dbts_a1`, a trade on the others | a trade, all three, both rungs |
| `two` against `sep` | neither dominates, all three, both rungs | Q 8 all three; Q 4 not read on `dbts_a1`, neither on the others | neither dominates, all three, both rungs |
| `snr` against `two` | worse, all three, both rungs | Q 8 all three; Q 4 not read on `dbts_a1`, worse on the others | worse, all three, both rungs |
| `snr` against `sep` | worse, all three, both rungs | as `snr` against `two` | worse, all three, both rungs |
| `snr` against `one` | a trade, all three, both rungs | as `two` against `one` | a trade, all three, both rungs |
| `snr` against `svc` (Q 8) | a trade, all three | a trade, all three | a trade on `dbts_a1`, `dbts_c1`; **worse on `dbts_b1`** |

The stages decide it like this (from `collected.md`). `svc` dominates the two-layer carriers at the first picture,
at preview and at every slice exact. `two` dominates `svc` at VL: `svc`'s next picture is the exact one, 4–13× `two`'s
VL bytes for one slice (Q 8). On `dbts_b1` · G 16 `snr`'s VL also costs fewer bytes than `svc`'s, but its time is decided
higher, so `snr` dominates `svc` nowhere. `two` dominates `one` at preview, and at the first picture except on
`dbts_b1` at G 8 · 16, where `one`'s first unit decodes faster. `one` dominates `two` at VL and exact, with fewer
bytes and less time. Against `sep`, `two` has fewer bytes to exact (`sep` 1.07–1.47 of HTJ2K, `two` 1.02–1.08) but
is decided slower, 1.04–1.11× (ratio of medians, *derived*). Every earlier stage is the same arm, so neither side
dominates.

**Predictions** (§4), against the pooled rows; bands are §4's:

| # | outcome |
| --- | --- |
| S1 | **held**: the order `svc` < `two` = `sep` < `snr` < `one` < `htj2k`; `two`'s first unit 0.49–2.34 % of an HTJ2K frame, `one`'s 6.7–44 % |
| S2 | **refuted, narrowly**: `two` 0.29–2.46 % held; `snr` ÷ `two` 1.18–1.55, below 1.2 on `dbts_b1` G 8 · 16; `svc` 0.018–0.143 %, below 0.02 on `dbts_a1` G 16 |
| S3 | **refuted**: `snr` ÷ `two` at VL 1.21–1.55 at Q 4 (already outside by the pin, §5a) and 1.01–1.28 at Q 8 (`dbts_c1` G 1 1.28) |
| S4 | `two` 1.02–1.08, `one` 1.02–1.05, `sep` 1.07–1.47 **held**; `svc` 0.94–1.02 **refuted** at G 1 (0.98 · 1.02 · 1.00) |
| S5 | **refuted on part**: `snr` ÷ `two` at VL decode 1.17–1.66 (ratio of medians, *derived*); below 1.3 on `dbts_a1` G 8 Q 8, `dbts_b1` G 1 both rungs and G 8 Q 8 |
| S6 | **refuted**: label neither dominates, not better. Its stated refuter (`sep` dominating) did not occur; residual decode + add 1.18–1.56 HTJ2K frames per frame (`two` · `snr`), outside 0.75–1.1 |
| S7 | **held**: a trade wherever read |
| S8 | `two` **held**; `snr` **refuted** on `dbts_b1` G 16 (worse) |
| S9 | **held**: `snr` worse than `two` wherever read |

**Checked by hand.** Two verdict cells were re-derived from the committed rows and index (`shard-{1,2}.jsonl`,
`shard-1.index.dbts_b1.json`) by a script that imports neither `rule.py` nor `amended.py`. It re-implements §5d's
stage sums, the per-round HTJ2K-frame units, the order-statistic interval (n = 20: the 6th and 15th) and §5e.5
dominance. The gates were taken from `collected.md`: both blocks pass the A/A and no arm is flagged. Both match the
rule. **`two` against `one`, `dbts_b1` · G 8 · Q 8: a trade.** `two` dominates at every slice preview (1.67 MB
against 23.2 MB, log time ratio −0.240, interval −0.271 to −0.205) and jump preview. `one` dominates at VL and exact,
both kinds (every slice VL: 23.2 against 24.9 MB, +0.580, interval +0.567 to +0.596). At the first picture `two` has
fewer bytes (49.5 against 468 kB) but `one` is decided faster (+0.096, interval +0.023 to +0.186), so neither
dominates there. **`snr` against `svc`, `dbts_b1` · G 16 · Q 8: worse.** `svc` dominates at the first picture
(2.5 against 64.2 kB, +2.33), every slice preview, jump preview and every slice exact (101 against 115 MB, +0.355).
At VL `snr` has fewer bytes, but `svc` is decided faster (every slice +0.079, interval +0.047 to +0.110; jump
+0.107), so neither dominates there.

**For the owner: bytes · time per carrier and G.** Each cell shows the lowest and highest of the three volumes. Times
are in HTJ2K-frame units. **First picture** is the first slice's first picture. **One slice, VL** and **one slice,
exact** are a jump to one slice from no decoder state: its bytes are the mean over every slice, its time the mean over
the round's four asked slices. `svc`'s VL is its exact frame, and `one`'s first picture is VL. **Every slice, exact**
is the whole volume delivered and decoded, the total decode. **The rule's verdict** is the two-layer carrier against
that row's carrier. A verdict that differs by volume is listed `dbts_a1` · `dbts_b1` · `dbts_c1`. At G 8 · Q 4 the
times leave out `dbts_a1` (not read).

**VL rung Q 8**

| carrier | G | first picture | one slice, VL | one slice, exact | every slice, exact | the rule's verdict |
| --- | --: | --- | --- | --- | --- | --- |
| `snr` | 1 | 8.84 kB–64.2 kB · 1.1–2.4 | 100 kB–558 kB · 4.3–7.3 | 1.08 MB–2.35 MB · 5.6–8.9 | 70.3 MB–117 MB · 272–550 | `snr` worse |
| `snr` | 8 | 8.84 kB–64.2 kB · 1.1–2.3 | 398 kB–2.34 MB · 17–30 | 1.47 MB–4.12 MB · 19–31 | 69.6 MB–115 MB · 281–503 | `snr` worse |
| `snr` | 16 | 8.84 kB–64.2 kB · 1.1–2.2 | 707 kB–4.38 MB · 33–49 | 1.86 MB–6.16 MB · 34–51 | 69.6 MB–115 MB · 274–481 | `snr` worse |
| `two` | 1 | 6.16 kB–49.5 kB · 1.9–2.2 | 91.1 kB–523 kB · 3.6–4.3 | 1.06 MB–2.3 MB · 5–5.8 | 69.5 MB–115 MB · 241–375 | — |
| `two` | 8 | 6.16 kB–49.5 kB · 1.8–2 | 388 kB–2.22 MB · 14–20 | 1.37 MB–3.98 MB · 15–21 | 69.2 MB–113 MB · 232–377 | — |
| `two` | 16 | 6.16 kB–49.5 kB · 1.9–2.2 | 697 kB–4.16 MB · 26–36 | 1.73 MB–5.92 MB · 28–38 | 69.2 MB–113 MB · 226–362 | — |
| `svc` | 1 | 0.848 kB–2.5 kB · 0.11–0.33 | 1.03 MB–2.2 MB · 4.8–12 | 1.03 MB–2.2 MB · 4.8–12 | 66.4 MB–110 MB · 241–672 | `two` a trade; `snr` a trade |
| `svc` | 8 | 0.848 kB–2.5 kB · 0.11–0.27 | 3.31 MB–9.08 MB · 15–31 | 3.31 MB–9.08 MB · 15–31 | 63.9 MB–102 MB · 195–582 | `two` a trade; `snr` a trade |
| `svc` | 16 | 0.848 kB–2.5 kB · 0.11–0.33 | 5.88 MB–16.9 MB · 30–51 | 5.88 MB–16.9 MB · 30–51 | 63.7 MB–101 MB · 190–566 | `two` a trade; `snr` a trade · worse · a trade |
| `sep` | 1 | 6.16 kB–49.5 kB · 1.9–2.2 | 91.1 kB–523 kB · 3.6–4.3 | 1.13 MB–2.67 MB · 4.8–5.4 | 72.9 MB–134 MB · 231–343 | `two` neither dominates; `snr` worse |
| `sep` | 8 | 6.16 kB–49.5 kB · 1.8–2 | 388 kB–2.22 MB · 14–20 | 1.44 MB–4.37 MB · 15–21 | 72.7 MB–132 MB · 219–342 | `two` neither dominates; `snr` worse |
| `sep` | 16 | 6.16 kB–49.5 kB · 1.9–2.2 | 697 kB–4.16 MB · 26–36 | 1.8 MB–6.31 MB · 27–37 | 72.7 MB–132 MB · 215–334 | `two` neither dominates; `snr` worse |
| `one` | 1 | 84.5 kB–468 kB · 1.6–2.1 | 83.3 kB–470 kB · 1.9–2.1 | 1.05 MB–2.24 MB · 3.1–3.6 | 69.1 MB–112 MB · 148–241 | `two` a trade; `snr` a trade |
| `one` | 8 | 84.5 kB–468 kB · 1.6–2.1 | 370 kB–2.06 MB · 7.5–11 | 1.35 MB–3.83 MB · 8.9–13 | 69 MB–111 MB · 159–269 | `two` a trade; `snr` a trade |
| `one` | 16 | 84.5 kB–468 kB · 1.6–2.2 | 666 kB–3.88 MB · 16–21 | 1.7 MB–5.65 MB · 17–22 | 69 MB–111 MB · 156–261 | `two` a trade; `snr` a trade |
| `htj2k` | 1 | 1.09 MB–2.11 MB · 1–1.1 | 1.03 MB–2.15 MB · 1–1.1 | 1.03 MB–2.15 MB · 1–1.1 | 67.8 MB–107 MB · 54–74 | — |
| `htj2k` | 8 | 1.09 MB–2.11 MB · 1–1.3 | 1.03 MB–2.15 MB · 1 | 1.03 MB–2.15 MB · 1 | 67.8 MB–107 MB · 54–73 | — |
| `htj2k` | 16 | 1.09 MB–2.11 MB · 1–1.2 | 1.03 MB–2.15 MB · 1–1.1 | 1.03 MB–2.15 MB · 1–1.1 | 67.8 MB–107 MB · 54–75 | — |

**VL rung Q 4** (`svc`'s bytes do not depend on the rung; its times are read only in the Q 8 blocks, §6)

| carrier | G | first picture | one slice, VL | one slice, exact | every slice, exact | the rule's verdict |
| --- | --: | --- | --- | --- | --- | --- |
| `snr` | 1 | 8.84 kB–64.2 kB · 1.1–1.9 | 362 kB–1.33 MB · 5.1–7.7 | 1.2 MB–2.62 MB · 6.5–9.1 | 76 MB–131 MB · 321–532 | `snr` worse |
| `snr` | 8 | 8.84 kB–64.2 kB · 1–1.7 | 1.54 MB–5.75 MB · 19–25 | 2.52 MB–7 MB · 21–26 | 75.1 MB–127 MB · 324–486 | `snr` not read · worse · worse |
| `snr` | 16 | 8.84 kB–64.2 kB · 1.2–1.6 | 2.76 MB–10.8 MB · 36–51 | 3.76 MB–12 MB · 37–53 | 75 MB–127 MB · 320–492 | `snr` worse |
| `two` | 1 | 6.16 kB–49.5 kB · 1.7–1.9 | 262 kB–1 MB · 4.2–5.2 | 1.07 MB–2.32 MB · 5.6–6.7 | 70.9 MB–116 MB · 265–364 | — |
| `two` | 8 | 6.16 kB–49.5 kB · 1.7–1.8 | 1.14 MB–4.32 MB · 15–16 | 1.95 MB–5.64 MB · 16–17 | 70.9 MB–115 MB · 250–359 | — |
| `two` | 16 | 6.16 kB–49.5 kB · 1.7–1.9 | 2.12 MB–8.12 MB · 24–37 | 2.93 MB–9.44 MB · 25–39 | 70.9 MB–115 MB · 253–346 | — |
| `svc` | 1 | 0.848 kB–2.5 kB · not read | 1.03 MB–2.2 MB · not read | 1.03 MB–2.2 MB · not read | 66.4 MB–110 MB · not read | `two` not read; `snr` not read |
| `svc` | 8 | 0.848 kB–2.5 kB · not read | 3.31 MB–9.08 MB · not read | 3.31 MB–9.08 MB · not read | 63.9 MB–102 MB · not read | `two` not read; `snr` not read |
| `svc` | 16 | 0.848 kB–2.5 kB · not read | 5.88 MB–16.9 MB · not read | 5.88 MB–16.9 MB · not read | 63.7 MB–101 MB · not read | `two` not read; `snr` not read |
| `sep` | 1 | 6.16 kB–49.5 kB · 1.7–1.9 | 262 kB–1 MB · 4.2–5.2 | 1.29 MB–3.15 MB · 5.3–6.3 | 83.8 MB–158 MB · 256–346 | `two` neither dominates; `snr` worse |
| `sep` | 8 | 6.16 kB–49.5 kB · 1.7–1.8 | 1.14 MB–4.32 MB · 15–16 | 2.16 MB–6.47 MB · 16–17 | 83.7 MB–156 MB · 239–324 | `two` not read · neither dominates · neither dominates; `snr` not read · worse · worse |
| `sep` | 16 | 6.16 kB–49.5 kB · 1.7–1.9 | 2.12 MB–8.12 MB · 24–37 | 3.15 MB–10.3 MB · 25–38 | 83.7 MB–156 MB · 238–323 | `two` neither dominates; `snr` worse |
| `one` | 1 | 265 kB–940 kB · 2.2–2.8 | 254 kB–952 kB · 2.3–3.2 | 1.06 MB–2.26 MB · 3.6–4.7 | 70.5 MB–113 MB · 176–252 | `two` a trade; `snr` a trade |
| `one` | 8 | 265 kB–940 kB · 2.2–2.5 | 1.12 MB–4.17 MB · 9.1–10 | 1.93 MB–5.49 MB · 10–12 | 70.7 MB–113 MB · 180–274 | `two` not read · a trade · a trade; `snr` not read · a trade · a trade |
| `one` | 16 | 265 kB–940 kB · 2.1–2.9 | 2.09 MB–7.84 MB · 16–25 | 2.9 MB–9.16 MB · 17–26 | 70.7 MB–113 MB · 181–270 | `two` a trade; `snr` a trade |
| `htj2k` | 1 | 1.09 MB–2.11 MB · 0.97–1 | 1.03 MB–2.15 MB · 1 | 1.03 MB–2.15 MB · 1 | 67.8 MB–107 MB · 53–76 | — |
| `htj2k` | 8 | 1.09 MB–2.11 MB · 1–1.1 | 1.03 MB–2.15 MB · 1 | 1.03 MB–2.15 MB · 1 | 67.8 MB–107 MB · 54–73 | — |
| `htj2k` | 16 | 1.09 MB–2.11 MB · 0.99–1 | 1.03 MB–2.15 MB · 1–1.1 | 1.03 MB–2.15 MB · 1–1.1 | 67.8 MB–107 MB · 53–73 | — |

What the table says, on these three volumes only. The quarter base (`svc`) is the cheapest first picture by
7–20× in bytes and 7–18× in time against `two`. The two-layer preview (`two`) gets a full-size first picture for 0.5–2.3 %
of an HTJ2K frame. It decodes in 1.7–2.2 HTJ2K frames, so it costs more time than the shipped HTJ2K frame, though
far fewer bytes. To the exact frame, every AV1 carrier decodes 2.8–10× slower than HTJ2K over the whole volume
(`one` 2.8–4.1×, `sep` 4.0–5.4×, `two` 4.2–5.8×, `snr` 5.0–7.7×, `svc` 3.5–10×; *derived*, ratios of medians). The quality-layer form (`snr`) costs 1.01–1.55× `two`'s bytes to VL and 1.01–1.13× to exact, and 1.17–1.66× its
decode to VL, and it is better at no stage.

**What differed.** (1) Shard 2's doc commit (`7c594e7b`) had overwritten §Shards' run and collector text and the
whole `### SNR shard 1, measured` section. Both were restored verbatim from shard 1's commit `723bb6aa` (`0c3a1f8a`),
with shard 2's section unchanged after them; both headings were then present, so no fetch-wait was needed. (2)
`scripts/gate.sh --quick --no-browser` stopped at its prerequisites: this host has no built
`client/transport/wasm/pkg`. It did not run; the change is docs and the collector's output only.
