# Codecs — which one carries a series, and why

The codec is chosen per series and carried in its metadata; the wire, the store and the server never look inside a
coded frame ([`../av1/README.md`](../av1/README.md) §What already does not care about the codec). This file sets the
codecs side by side. Each has its own doc under the same seventeen headings, and every number in the tables below
is keyed to the doc that owns it:

* [`htj2k.md`](htj2k.md) — HTJ2K, the product's codec;
* [`../av1/README.md`](../av1/README.md) — AV1, built beside it; its work queue is [`../av1/queue.md`](../av1/queue.md);
* [`jpeg-xl.md`](jpeg-xl.md), [`jpeg2000.md`](jpeg2000.md) (Part 1) and [`av2.md`](av2.md) — measured for contrast.

## The rule

**Every frame on screen is bit-exact with the source, whichever codec carried it.** Ground truth is the encoder's
input — a checksum written when the input is made — never a decoder under test. A codec, depth or decoder path that
does not round-trip exactly is not used for that series ([`../av1/README.md`](../av1/README.md) §Decided,
[`../decode/README.md`](../decode/README.md) §Ground truth).

## Which series AV1 is for

The owner's order ([`../av1/series.md`](../av1/series.md)): **the breast family first** — FFDM, synthesized 2D, DBT
slices and projections, breast ultrasound and ABUS — **general cine second** (echo and ultrasound cine, XA, RF), and
**CT and MR stay HTJ2K**. Measured so far, no series qualifies: by the per-series codec rule (queue row TOTAL4) a series is served as AV1 only
where it fills first in Chromium and Firefox on every link and CPU, and none does
([`../av1/README.md`](../av1/README.md) §Total time). Breast ultrasound, ABUS and angiography have no sound source
here (§Why HTJ2K is the default, and what would reopen it).

## The choice, as built

```
series ── the per-series codec rule (queue row TOTAL4): AV1 only where it fills first in both engines on every cell
   │        none qualifies today ─────────────────────────────────► HTJ2K, every depth to 16 bits, signed, RGB
   │
   └─ AV1 on request (ingest.py --codec av1), by b, the bits after the offset (the per-depth split rule, queue row 72):
        RGB 8 ────────── RCT, one 10-bit 4:4:4 stream ───────────► WebCodecs*, else dav1d-WASM
        grey ≤ 8 ─────── one 8-bit 4:0:0 stream ─────────────────► WebCodecs*, else dav1d-WASM
        grey 9 ───────── k = 0, one 10-bit stream ───────────────► WebCodecs*, else dav1d-WASM
        grey 10–12 ───── k = 2: a top of 8–10 bits, 2 low bits ──► WebCodecs*, else dav1d-WASM
        grey 13 ──────── k = 3: a 10-bit top, 3 low bits ────────► WebCodecs*, else dav1d-WASM
        grey 14 ──────── k = 2: a 12-bit top, 2 low bits ────────► dav1d-WASM
        grey 15–16 ───── refused by name ────────────────────────► HTJ2K

   * where the engine's probe of that layout passed: Chromium, every row; Firefox, none of these (it takes the
     plain representation's 8-bit GBR)
```

The rule per depth is [`../av1/payload-format.md`](../av1/payload-format.md) §The split per depth; the split itself,
with a worked example, [`../av1/README.md`](../av1/README.md) §The bit split, explained; which engine passes which
probe, [`../decode/README.md`](../decode/README.md) §Why, and what would make it exact.

## The target series' depths

*b* is the bits a series needs after subtracting its minimum; a conformance statement's Bits Stored only bounds it
([`../av1/series.md`](../av1/series.md)).

| series | b | where it is known from |
| --- | --- | --- |
| FFDM for presentation | 12 | [`series.md`](../av1/series.md) §1d (two vendors); 30 exams of three systems, the mammography-at-scale measurement (queue row FFDMSCALE; [`../av1/README.md`](../av1/README.md) §Samples over 12 bits) |
| FFDM for processing (raw) | 13–14 | §1d (13, one raw image); the mammography-at-scale measurement (14) |
| synthesized 2D | 10, 12 | §1d |
| DBT slices | 10, 12 | §1d; 15 volumes of three systems, the DBT-at-scale measurement (queue row DBTSCALE; [`../av1/README.md`](../av1/README.md) §Total time, *At scale*) |
| DBT projections | 14 | §1d; three systems, the breast-family fetch (queue row BREAST; [`../av1/README.md`](../av1/README.md) §Samples over 12 bits) |
| breast ultrasound, still and cine | 8 | §1d, from the standard and every statement read; no sound source in the lab |
| ABUS | 8 | §1d, one vendor's statement; none in the lab |
| echo and general ultrasound cine | 8 | [`series.md`](../av1/series.md) §2 |
| XA | 8–16 allowed | §2; no run open |
| RF (fluoroscopy) | 12 | §2 |
| CT | 13 | [`series.md`](../av1/series.md) §3 (three vendors) |
| MR | 9–11 | §3 |
| PET; a digitized film | 15; 16 | the missing-content search (queue row DATA3; [`../av1/README.md`](../av1/README.md) §Samples over 12 bits) |

## At a glance

| codec | here | bytes against HTJ2K | decode against HTJ2K | exact in a browser | DICOM syntax |
| --- | --- | --- | --- | --- | --- |
| HTJ2K | served | — | — | every engine, in WASM | yes |
| AV1 | built, not served | smaller once represented | slower on every frame | every engine through dav1d-WASM; WebCodecs in Chromium | no |
| JPEG XL | lab | smaller, by effort | slower, by effort | in WASM; natively at 8 bits only | yes |
| JPEG 2000 Part 1 | lab | smaller | several times slower | in WASM | yes |
| AV2 | lab, native only | smaller on grey to 13 bits but CT | slower, natively | no | no |

## Side by side

Every cell's key, in brackets, is the place that states its number; *unmeasured* is unmeasured. Ratios are over
HTJ2K on the same frames; "1× · 4×" is the CPU throttle.

| | HTJ2K | AV1 | JPEG XL | JPEG 2000 Part 1 | AV2 |
| --- | --- | --- | --- | --- | --- |
| lossless bytes | 1 | 0.902–0.987 represented, 0.760–0.797 on two 10-bit DBT volumes; 0.776–1.117 coded whole [A-bytes] | 0.81–0.96 default effort, 0.94–1.03 fastest [D-jxl] | 0.93–0.96, preview layers included [J2K] | 0.937–0.964 on grey up to 13 bits but CT; 1.648 RGB [AV2] |
| decode a frame, 1× · 4× | 4.88–9.78 · 16.8–34.8 ms at 512²–768², 93 · 396 ms at 1914×2572 [D-speed, A-14] | WebCodecs 1.59–4.12×, dav1d-WASM 5.4–11.6× [A-stands] | 1.03–1.91× fastest effort, 5.35–10.0× default, WASM [D-jxl] | 6–12×, WASM [J2K] | native only: 3.1–6.5× dav1d's [AV2] |
| total time, wire and CPU | the baseline; its decode the clock on no cell [A-total] | 0.89–0.98 on five of seven series where the wire is the clock; 1.33–2.53 in Firefox at 4× on 50 Mbit [A-total4] | unmeasured | unmeasured | unmeasured |
| client code | OpenJPH 246 209 B `.wasm`, 55 158 B glue, the product's build [D-build] | dav1d 623 KB `.wasm`, 238 KB gzipped; WebCodecs none [D-dav1d] | libjxl 625 KB `.wasm`, 220 KB gzipped [L-embed] | OpenJPEG 249 KB `.wasm`, 82 KB gzipped [L-embed] | no decoder |
| decoder worker, largest frames | 24.6 MB resident [A-mem] | dav1d-WASM 31.6 MB; WebCodecs 5–10 MB settled, 58 MB peak [A-mem] | unmeasured | unmeasured | — |
| deepest sample, one bitstream | 38 bits [S-2, PS3.5] | 12; 10 through WebCodecs [A-exact] | 31 in the standard, 24 in libjxl and DICOM [S-2] | 38 [S-2] | 10 [AV2] |
| exact browser path | OpenJPH-WASM in Chromium, Firefox, WebKitGTK [D-engines] | WebCodecs ≤ 10 bits in Chromium, 8-bit GBR in Firefox; dav1d-WASM in all three [D-engines, D-why] | libjxl-WASM; native 8-bit only, flagged [D-jxl] | OpenJPEG-WASM, Chromium [J2K] | none |
| DICOM transfer syntax | `1.2.840.10008.1.2.4.201`–`.203` [PS3.6] | none [PS3.6] | `1.2.840.10008.1.2.4.110` [PS3.6] | `1.2.840.10008.1.2.4.90`, `.91` [PS3.6] | none [PS3.6] |
| licence; patents | OpenJPH BSD-2-Clause; declarations not read [Lic] | dav1d, libaom BSD-2-Clause; AOM Patent License 1.0; pools' claims unconfirmed [Lic] | libjxl BSD-3-Clause; royalty-free grant [Lic] | OpenJPEG BSD-2-Clause; none granted [Lic] | AVM BSD-3-Clause-Clear; the AOM licence's reach to AV2 unconfirmed [Lic] |
| encode a frame | 58–136 frames/s a core [A-enc] | 0.35–1.6 s at the fastest preset within 2 % of the slowest's bytes (7.2 s on the RGB ultrasound), 3.0–11.1 s at the slowest [A-enc] | 0.01–0.08 s at effort 1, 14–47× HTJ2K at 7 [L-jxl] | unmeasured | 450–11 900 s [AV2] |

Keys: **A-** [`../av1/README.md`](../av1/README.md): *bytes* §Bytes; *stands* §Where AV1 stands; *total* §Total time,
*Every exact form, five links*; *total4* §Total time, *Every change of the round*; *mem* §Decode time and memory,
*Memory and first use*; *exact* §Exactness and the decoders; *enc* §Encoding; *14* §Samples over 12 bits, the 13- and 14-bit layout measurement (queue row REP14).
**D-** [`../decode/README.md`](../decode/README.md): *speed* §Decode time against HTJ2K; *jxl* §JPEG XL; *build*
§The build, as delivered; *dav1d* §dav1d-WASM, the decoder the client runs; *engines* §AV1 in WebKit and Firefox;
*why* §Why, and what would make it exact. **L-** *embed* [`lab/av1/bytes/embedded`](../../lab/av1/bytes/embedded/README.md)
§Decode time; *jxl* [`lab/av1/bytes/jpeg-xl`](../../lab/av1/bytes/jpeg-xl/README.md). **J2K**
[`jpeg2000.md`](jpeg2000.md); **AV2** [`av2.md`](av2.md) §Bytes and [`lab/av1/bytes`](../../lab/av1/bytes/README.md) §AV2.
**S-2** [`../av1/split-prior-art.md`](../av1/split-prior-art.md) §2; **Lic** [`../av1/licensing.md`](../av1/licensing.md);
**PS3.5**, **PS3.6** §Specifications below. Times are a container's, never a phone's; the ultrasound's numbers are
provisional (a lossy-sourced set, [`../av1/README.md`](../av1/README.md)).

## Why HTJ2K is the default, and what would reopen it

HTJ2K decodes every frame faster than any exact AV1 path, exactly, in every engine measured; it holds every target
depth in one codestream; it has a DICOM transfer syntax; and by the per-series codec rule (queue row TOTAL4) no series fills first as AV1 in
both engines on every cell. AV1's lead is bytes, and it collects them only where the wire is slower than its
decoder.

What would reopen it, each the owner's call or an engine's change; the owner tracks them in
[`../av1/queue.md`](../av1/queue.md) §Blocked:

* **a rule by link or by client** in place of "every cell in both engines" — the server would need to know them;
* **a faster exact AV1 path outside Chromium**: Firefox returning grey and over 8 bits from WebCodecs, or WebKit's
  decoder taking AV1 at all ([`../decode/README.md`](../decode/README.md) §Why, and what would make it exact);
* **a device run**: Safari and phones decide where the CPU, not the wire, is the clock;
* **sound cine, ABUS or angiography data**, the content where inter coding could pay and nothing here measured it.

## Tried and open

Queue row AUDITCODEC, 2026-10-13: every codec lever, the rows that touched it and where it stands. An audit: nothing
built or timed, every number the owning row's. **Net**, as the round reads it, is better on the target and nothing
worse beyond its measured spread (fill, ask, exactness, bytes, a phone's memory, a server's CPU) at the cost of code
alone; anything else is a trade-off and the owner's. **The target's links are row LINKREAL's**
([`../transport/link-conditions.md`](../transport/link-conditions.md)): cellular at a median of ~100 Mbit/s down,
one stream to an off-net server 27–85, the old 5–50 Mbit/s band its slow tail.

**Classes.** *Evidence* — closed by a measurement that still holds. *Premise* — closed under a premise that has since
changed: the band, a release newer than the pin, data provenance (row DATAAUDIT), or a decision rule (the round's net
reading replaces rules that asked every cell to gain). *Never* — never measured here; a lever argued but not measured
is never tried. *Owner* — waiting on a decision in [`../av1/queue.md`](../av1/queue.md) §Blocked. Rows are named by
queue number.

### HTJ2K

| lever | rows and verdict | class | owner doc |
| --- | --- | --- | --- |
| encoder settings: block size and shape, 3–6 decompositions, LRCP/RPCL, precincts | 70: no setting wins; best 0.990–1.000 of the served bytes, decode within spread | evidence | [`../decode/README.md`](../decode/README.md) §Encoder settings |
| OpenJPH build of our own: heap, range in the pack, wrapper passes | 49, 91: adopted (fill ×0.927–0.941, cold ask ×0.715–0.732) | evidence, adopted | [`decode`](../decode/README.md) §The build, as delivered |
| OpenJPH 0.32.0 | 41, 57: one WASM mask fix unreachable at ≤ 16 bits, codestreams identical but the COM marker; pin 0.31.0 | evidence | [`lab/av1/tools/newer`](../../lab/av1/tools/newer/README.md) |
| emscripten 6.0.11 for OpenJPH | 57, 125, 134: not adopted by its every-set rule; **a frame ×0.886–0.931 on the 1914×2572 projections in 9–10/10 rounds**, other sets and the cold ask ×0.96–1.06, fills ×0.995–1.003; a recipe fix owed (6.0.2 dropped `wasmBinary`) | **premise** (the net reading) | [`decode`](../decode/README.md) §Not yet tried, P-EMSDK |
| relaxed SIMD | §The decode tail, 125: `-mrelaxed-simd` leaves the binary byte-identical; hand-written ≤ 3 %, not Safari | evidence | [`decode`](../decode/README.md) §Not yet tried |
| the copy out and the RGB pack (P-COPY) | 41 bounded ≤ 15 %, 134: grey ×0.95–1.05, **RGB ×0.866 at 4× (8/10), peak memory 5–25 MB lower**, `-pthread` alone no cost; not adopted by its every-set rule | **premise** (the net reading; RGB measured on a synthetic set only) | [`decode`](../decode/README.md) §Not yet tried, P-COPY |
| code-blocks on threads (the pool) | 41, 78, 108, 110, 113: warm ask ×0.72–0.76, cold ×0.89–0.94 on projections; cold ask on 512² ×1.078 at 4×; heap +20–61 MB | owner (a second build per series, row 113) — a trade-off: memory | [`decode`](../decode/README.md) §Code-blocks on threads, measured |
| tiles as independent codestreams | 125, 133, 143: P-TILE passed, ask ×0.388–0.448 at 4× on large frames, +0.01–0.59 % bytes | owner (store format, row 143) | [`decode`](../decode/README.md) §Not yet tried, P-TILE; [`../adr/resolution-fitting-for-large-frames.md`](../adr/resolution-fitting-for-large-frames.md) |
| region decode, stripes, coarser hand-off unit | 109, 110, 113: fail their rules; tiles beat stripes | evidence | [`decode`](../decode/README.md) §Region decode, measured |
| resolution levels (a level picture first) | 59, 143: first view ×0.09–0.69 of the fill, whole frames a tie; exact once clamped | owner (row 143's five choices) | [`decode`](../decode/README.md) §A frame at the level the screen needs |
| a prefix first (RPCL cut, quality layers) | 12, 22, 61: half-size prefix 26–32 % of bytes; Part 1 layers decode 6–12× slower | evidence | [`jpeg2000.md`](jpeg2000.md) |
| WebGPU: the wavelet; the HT block decoder | 41 wavelet bounded out (≤ 6–12 %); 62, 111: block decoder exact on SwiftShader, bound 42–67 % of a large frame, untimed | owner (a phone with a GPU, row 113) | [`decode`](../decode/README.md) §Faster HTJ2K in the browser |
| decode paced to the wire; decoders started on need | 112, 142: fill holds, decoder CPU ×0.85–0.98, wake-ups ×0.18–0.47; rules missed on one cell each | path, row AUDITPATH | [`../ARCHITECTURE.md`](../ARCHITECTURE.md) §How many |
| the bit split for HTJ2K | 36: 0.9–1.6 % fewer bytes only with the low bits deflated, at 1.02–1.69× its decode | evidence (a trade-off) | [`lab/av1/bytes/low-stream`](../../lab/av1/bytes/low-stream/README.md) |
| histogram packing (a value map) for sparse series | 64: at L = 0 the 16-bit film is 0.576 of HTJ2K's bytes as for AV1; built for neither | **never** for HTJ2K | [`../av1/payload-format.md`](../av1/payload-format.md) §Proposed: a remapped plane |
| OpenJPH SIMD on native ARM | 125: the ARM dispatch is empty; P-ARM argued, not run | never (native only) | [`decode`](../decode/README.md) §Not yet tried, P-ARM |

### AV1

| lever | rows and verdict | class | owner doc |
| --- | --- | --- | --- |
| serving AV1 at all (the per-series rule) | 23, 34, 42, 77, 105, 106, 138: no series fills first in both engines on every cell; AV1 fills first below 45–56 Mbit/s on DBT at 1×, 11–14 at 4×; `dbts_b4` 0.755–0.778 to 20 Mbit/s, 1.71–1.97× at 4× on 50–100 | owner (a per-series or per-link rule) — **the band moved against it**: at row LINKREAL's cellular median the wire is no longer AV1's clock on most cells | [`../av1/README.md`](../av1/README.md) §Where AV1 fills first |
| representation: the bit split, k per depth, REMAP | 7, 28, 33, 36, 43, 44, 72 adopted (0.902–0.987 of HTJ2K); 64 REMAP proposed: every stream ≤ 10 bits, WebCodecs 0.46–0.71 of the split's dav1d time | evidence; REMAP never built | [`av1`](../av1/README.md) §The split per depth; [`../av1/payload-format.md`](../av1/payload-format.md) |
| the low bits deflated, k = 3 where σ ≥ 17 | 36, 42: −3 % only at 4× on 50 Mbit, ±0.6 % elsewhere | evidence | [`av1`](../av1/README.md) §The plain control and the low-stream changes |
| encoders: libaom presets, tools, `cpu-used`, SVT-AV1, rav1e | 1, 14, 27, 28, 57: SVT-AV1 4:2:0 ≤ 10 bits and inexact inter; rav1e no lossless; no setting cuts decode > 10 % | evidence | [`av1`](../av1/README.md) §Encoding |
| groups (inter) | 6, 10, 21, 46, 98–101: DBT G = 1, conclusive; cine, ABUS, angiography lack sound data | evidence on DBT; owner on the rest (data, rows 137, 149) | [`../av1/gop-theory.md`](../av1/gop-theory.md) |
| colour: RCT, YCoCg-R, GBR, grey as 4:2:0 | 28, 80, 97: RCT adopted (0.54–0.66 of GBR); GREY420 exact in Firefox, slower every Chromium fill | evidence; GREY420 a trade-off | [`av1`](../av1/README.md) §Bit depths, signed, colour |
| dav1d-WASM: SIMD, threads, tiles, newer emscripten | 4, 27, 57: tiles × threads a frame 0.37–0.44, fills −3…+4 %; dav1d head and emscripten 6.0.11 tie | evidence | [`../decode/README.md`](../decode/README.md) §AV1 |
| dav1d's entropy decoder in WASM SIMD | 125: ≤ 0.65 of dav1d-WASM by a native hint | never; not while AV1 is unserved | [`decode`](../decode/README.md) §Not yet tried |
| WebCodecs: ≤ 10 bits, `optimizeForLatency`, the mixed decoder | 3, 13, 20, 30, 47: exact in Chromium, 2–3× faster than dav1d-WASM; 12 bits refused (141, 154, 155) | evidence; `mixed` owner | [`decode`](../decode/README.md) §WebCodecs, what it decodes exactly |
| WebCodecs outside Chromium | 37, 74: Firefox exact at 8-bit GBR only, WebKitGTK not | evidence, until an engine changes | [`decode`](../decode/README.md) §Why, and what would make it exact |
| hardware AV1 | 161: no browser path serves the payload; native Main 4:2:0 only | owner (a device) | [`../decode/hardware.md`](../decode/hardware.md) |
| a lossy preview, scalable layers, a residual | 12, 17, 18, 24–26, 31, 40: bases 10–101× sooner, exact fill +0–8 % over single-layer AV1 (1.07–7.4× HTJ2K's time) | owner (a lossy first picture) — a trade-off | [`../av1/README.md`](../av1/README.md) §Preview |

### Other codecs

| lever | rows and verdict | class | owner doc |
| --- | --- | --- | --- |
| JPEG XL in WASM (libjxl), and natively | 22, 58, 63: e1 0.94–1.03 of HTJ2K's bytes at 1.03–1.91× its decode; the browsers return 8 bits | evidence (a trade-off) | [`jpeg-xl.md`](jpeg-xl.md) |
| JPEG XL through jxl-rs in WASM | 58, 63: listed; jxl-rs is the decoder both engines adopted; 0.7.0 rewrote the 16-bit lossless path since | **never**, and the release reopens it | [`../av1/lossless-literature.md`](../av1/lossless-literature.md) |
| JPEG-LS (CharLS) | 58, 125: 0.91–0.94 of HTJ2K by one third-party table, a DICOM syntax, a WASM build exists; decode cost unknown | **never** | [`decode`](../decode/README.md) §Not yet tried |
| JPEG 2000 Part 1 | 22: 0.93–0.96 of HTJ2K, decode 6–12× | evidence | [`jpeg2000.md`](jpeg2000.md) |
| AV2 (AVM) | 32: 0.937–0.964 of HTJ2K on grey to 13 bits but CT, no browser decoder | evidence | [`av2.md`](av2.md) |
| LCEVC | 19: no open encoder, no exact samples back in the browser, not exact at 14 bits | evidence | [`../av1/README.md`](../av1/README.md) §Preview |
| learned coders: Tomoz, TCT | 58: Tomoz WASM on npm (`@zeroxshot/tomoz` 0.2.0, 2026-10-02), self-reported 0.73–0.85 of HTJ2K on volumes, unreviewed; TCT no code | never | [`../av1/lossless-literature.md`](../av1/lossless-literature.md) |

### Releases since the pins

Read 2026-10-13 from each project's tags (tag dates from the repositories) and its changelog at the newest tag.

| project | pin here | newest (date) | what bears on a lever |
| --- | --- | --- | --- |
| OpenJPH | 0.31.0 (the build), 0.32.0 measured | 0.32.0 (2026-09-17) | nothing new since row 57: NLT markers, a CLI `raw_in` fix for > 8-bit input, POWER and AVX-512 build fixes, truncated streams decoded gracefully |
| dav1d | 1.5.4 | 1.5.4 (2026-07-14) | none newer |
| libaom | 3.15.1 | 3.15.2 (2026-10-09) | bug and fuzz fixes only (CHANGELOG) |
| SVT-AV1 | v4.2.0 | v4.2.0 (2026-07-13); `v4.2.0-cqp-extended` 2026-08-04 | fixes; unreleased on master, high-bit-depth intra SSE4.1 and an all-intra Hadamard overflow fix — row 1's inexact 10-bit inter not addressed by name |
| libjxl | 0.12.0 | 0.12.0 (2026-07-01) | none newer |
| jxl-rs | 0.6 (inside Chromium 154, row 63) | 0.7.4 (2026-09-17) | **0.7.0: 16-bit modular buffers end to end (RCT, palette, squeeze, 16-bit SIMD)** — the lossless path's speed and memory; 0.7.3 smaller stack use, which a WASM stack feels. Blink's JPEG XL through jxl-rs is "Proposed" for M155 (chromestatus 5114042131808256). Reopens row JXLRS below |
| CharLS | never used | 2.4.5 (2026-10-12) | fixes and a security advisory (GHSA-vx55-856r-qqxw); `@cornerstonejs/codec-charls` 1.2.7 (2026-09-08) carries 2.4.4, without that fix |
| emscripten | 3.1.74 (the build), 6.0.11 measured | 6.0.12 (2026-10-08) | 6.0.12 itself nothing on SIMD; since 3.1.74, `memory.copy` and BigInt by default (4.0.0), `GROWABLE_ARRAYBUFFERS` by default (6.0.2, less overhead for threads with memory growth), relaxed-SIMD FMA (6.0.3); 6.0.2 also dropped `wasmBinary` from the default module API (row 134) |
| WebCodecs, Chromium | 141, 154, 155 measured | — | no chromestatus entry on high bit depth or 4:0:0; its dav1d path still turns 4:0:0 into I420 with made-up chroma; 12-bit refused through 155 (row 57) |
| WebCodecs, Firefox | 157 measured | — | Bugzilla 2071132 (assigned, not landed): 10-bit frames reported as I420; 1779656 (I444 `VideoFrame`) and 2021505 (bit-depth check) still new — row 74's verdict stands |
| LCEVC | LCEVCdec 4.2.2 | 4.2.2 (2026-09-10) | **still no open encoder** (V-Nova's encoder SDK is a proprietary trial); no lossless mode in the decoder source — row 19 stands |
| AV2 | AVM v1.0.0 (row 32) | dav2d 0.0.1 (2026-04-30, VideoLAN) | a dav1d-style AV2 decoder, 8/10-bit, AVX2 and NEON; its CI builds WASM but nothing is distributed. AV2 stays without a browser decoder |

Of these, only jxl-rs 0.7 bears on a lever enough to reopen it; emscripten 6.0.12 adds nothing to row 134's 6.0.11 that
a frame would see, and libaom 3.15.2 is fixes only by its changelog.

### Left, ranked

By expected net gain on the target, each a proposed theory row (a name and one question); nothing here is queued.

| # | proposed row | one question | why it may be net | what it rests on |
| --- | --- | --- | --- | --- |
| 1 | **EMSDKNET** | Under the net reading, does OpenJPH built by emscripten 6.0.x (with `wasmBinary` restored) lose anything beyond its spread on any set, and with an A/A arm, is row 134's ×1.061 cell the toolchain or the host? | ×0.886–0.931 a frame on the projections in 9–10/10 rounds, a pin and one flag; nothing else changes | row 134 |
| 2 | **COPYRGB** | Is the shared-heap copy out net on sound colour series — RGB ×0.866 at 4× on a synthetic set, grey within spread, memory lower — and does grey lose anything beyond its spread? | the product page is already cross-origin isolated, so `-pthread` costs no deploy change; peak memory 5–25 MB lower | row 134; no sound RGB set was in its protocol |
| 3 | **HTJ2KPACK** | Which target series have sparse histograms (a few used levels in a wide range), and does a value map before HTJ2K cut their bytes with decode unchanged beyond a lookup pass? | row 64's L = 0 packing halved the 16-bit film for HTJ2K too (0.576); HTJ2K is the codec served | row 64; how often such series reach a PACS is unknown |
| 4 | **JPEGLS** | CharLS in WASM (`@cornerstonejs/codec-charls` 1.2.7, MIT) on the target series: bytes and decode against OpenJPH, exact? | a DICOM syntax; 0.91–0.94 of HTJ2K by one third-party table; net only if its decode is within HTJ2K's spread, which no source here shows — a trade-off is likelier | rows 58, 125 |
| 5 | **JXLRS** | jxl-rs, the decoder both engines adopted, built to WASM with a sample API: at e1 and e7 `--faster_decoding`, is any setting as fast as OpenJPH and smaller? | row 63's e7 f3 is 0.91–0.98 of HTJ2K's bytes at 1.56–2.45× its decode through libjxl; a faster decoder could close that, and jxl-rs 0.7.0 rewrote exactly the 16-bit lossless path | rows 58, 63; jxl-rs 0.7.4 |
| 6 | **TOMOZ** | `@zeroxshot/tomoz` 0.2.0 on the lab's volumes: exact across engines, bytes, decode? | self-reported 0.73–0.85 of HTJ2K on CT/MR/PET; ≈ JPEG XL on mammograms, slower than JPEG XL by its own figure — a trade-off at best on the breast family | row 58 |
| 7 | **ARMSIMD** | P-ARM as written ([`../decode/README.md`](../decode/README.md) §Not yet tried) | only for a native client, which does not exist yet | row 125, row 127 |

Not ranked, because none can be net while no series is served as AV1 (by row TOTAL4's rule and, since row LINKREAL,
less likely on the faster links): dav1d's entropy decoder in WASM SIMD, REMAP built, the mixed decoder adopted.

**Trade-offs, for the owner** (each better on one count and worse on another, measured):

* **The code-block pool for large series** — an ask ×0.72–0.94 on projections, heap +20–61 MB (row 113).
* **Tiles as independent codestreams** — an ask ×0.39–0.45 at 4× on large frames, bytes +0.01–0.59 % and a store
  format (rows 133, 143).
* **A level picture first** — the first view ×0.09–0.69 of the fill, a format change (rows 59, 143).
* **AV1 for a series** — fewer bytes where the wire is the clock (`dbts_b4` 0.755–0.778), slower at 4× on 50–100
  Mbit/s (1.71–1.97×); row LINKREAL's median link is in the second regime more often than the old band was (row 138).
* **A lossy first picture** (preview, scalable bases) — the cine on screen 10–101× sooner, the exact fill 1.07–7.4×
  HTJ2K's time (row 40).
* **Grey as 4:2:0** — Firefox's WebCodecs exact on 8-bit grey, every Chromium fill slower (row 80).
* **The HTJ2K bit split** — 0.9–1.6 % fewer bytes at 1.02–1.69× the decode (row 36).
* **JPEG XL at effort 1** — 0.94–1.03 of HTJ2K's bytes at 1.03–1.91× its decode (row 63).

## Specifications

| specification | edition | where | read | what for |
| --- | --- | --- | --- | --- |
| AV1 Bitstream & Decoding Process Specification | 1.0.0 with Errata 1, 2019-01-08 | <https://aomediacodec.github.io/av1-spec/av1-spec.pdf> | 2026-10-09, the approved PDF's front matter; profiles and levels 2026-10-05 ([`series.md`](../av1/series.md) [A1]) | profiles, depths, lossless as normative |
| AV1 Codec ISO Media File Format Binding | v1.3.0, AOM Final Deliverable, 2024-04-03 | <https://aomediacodec.github.io/av1-isobmff/v1.3.0.html> | 2026-10-09 | §5, the codecs parameter string ([`../av1/payload-format.md`](../av1/payload-format.md) §Decoder choice, per payload) |
| WebCodecs | W3C Working Draft, 2026-10-07 | <https://www.w3.org/TR/2026/WD-webcodecs-20261007/> | 2026-10-09; the draft of 2026-09-21 on 2026-10-05 | `VideoDecoder`, `VideoPixelFormat` |
| AV1 WebCodecs Registration | W3C Group Note Draft, 2026-06-08 | <https://www.w3.org/TR/2026/DNOTE-webcodecs-av1-codec-registration-20260608/> | 2026-10-09 | no operating-point field |
| DICOM PS3.3 | 2026d | <https://dicom.nema.org/medical/dicom/current/output/chtml/part03/PS3.3.html> | 2026-10-05 ([`series.md`](../av1/series.md) [D1]); C.7.6.3 2026-10-09 | each target series' pixel module |
| DICOM PS3.5 | 2026d | <https://dicom.nema.org/medical/dicom/current/output/chtml/part05/sect_8.2.html> | 2026-10-09: §8.2.4, §8.2.14–8.2.16 | JPEG 2000, HTJ2K (Bits Stored 1–38), JPEG XL, Deflated Image Frame |
| DICOM PS3.6 | 2026d | <https://dicom.nema.org/medical/dicom/current/output/chtml/part06/chapter_A.html> | 2026-10-09: Table A-1 | the transfer syntax UIDs; no AV1 entry |
| DICOM Supplement 232, JPEG XL Transfer Syntaxes | Final Text, 2024-09-18 | <https://www.dicomstandard.org/News-dir/ftsup/docs/sups/sup232.pdf> | 2026-10-09, its status and scope | `.4.110` |
| ITU-T T.814, High-throughput JPEG 2000 | 06/2019, in force | <https://www.itu.int/rec/T-REC-T.814> | 2026-10-09: the record and the freely available PDF's front matter | HTJ2K's standing |

**Not read.** ISO/IEC 15444-15 (HTJ2K) and ISO/IEC 18181-1 and -2 (JPEG XL) are sold; nothing here rests on them,
and T.814 is the common text of the first. ITU-T T.800 (JPEG 2000 Part 1) is free and was not read: no claim here
rests on it. AV2's specification: announced 2026-06-09, its host refused this container in the AV1-options sweep (queue row SWEEP) and not tried
since ([`av2.md`](av2.md)). Patent declarations on T.814 and T.800 (the ITU's patent database): not read.
