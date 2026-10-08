# AV1 — a second lossless codec beside HTJ2K

The phase's goal: a study can be served as lossless AV1 as well as lossless HTJ2K, the codec chosen
per series, and **every frame on screen is bit-exact with the source**, whichever codec carried it.
This file owns the phase: what is decided, what is open and the measurement that decides each. The
work itself is queued in [`queue.md`](queue.md); licences are in [`licensing.md`](licensing.md). The AV1 item — what one stored entry
carries, in its plain and optimized representations — is [`item-format.md`](item-format.md), adopted
2026-10-04 and built end to end on `claude/av1-unified` (row 39).
What each target series is, per the DICOM standard and vendors' conformance statements: [`series.md`](series.md).
The bit split against the literature, and the alternatives above 12 bits: [`split-prior-art.md`](split-prior-art.md).
Lossless coding published 2023–2026, and what of it a browser can decode exactly: [`lossless-literature.md`](lossless-literature.md).

## What already does not care about the codec

| layer | what it carries | codec-specific today |
| --- | --- | --- |
| wire (`common/frame-envelope`, [`WIRE.md`](../WIRE.md)) | `[4B display_index][opaque bytes]` | nothing |
| store ([`FIXTURES.md`](../FIXTURES.md) §SBND) | a frame table, a metadata JSON, opaque frames | nothing; `pack-study` names its inputs `NNN.htj2k` |
| server | bytes by index | nothing |
| decoder (`client/downloader/decoder.js`) | codestream in, `{pixels, width, bits, signed, range}` out | **all of it** (OpenJPH) |

So an intra-only AV1 frame — one that decodes alone — needs a codec tag in the series metadata, an
ingest step and a second decoder behind the same output contract. Nothing above the decoder changes,
and that contract is what a viewer integrating the downloader consumes, so it changes nothing there
either.

## Open, each with what decides it

**A1 — one frame, or a group of frames, as the unit.** Inter prediction (a frame coded from its
neighbours) is where AV1 is expected to beat HTJ2K on size; intra-only AV1 against lossless HTJ2K is
not expected to win by much. *Expected, not measured* — queue row SIZE measures it.

What inter costs is **random access**, and a viewer has it even with no timeline: a stack is
scrolled both ways and jumped across (a reference line clicked, a linked series, a key image, the
middle slice first). Here that is the ask during a fill ([`WIRE.md`](../WIRE.md) §An ask during a
fill). With a group of G frames that only decode in order:

* an ask for frame N costs the bytes and the decode of every frame from N's keyframe up to N — up to
  G frames instead of one;
* the fill is decoder-bound ([`decode/README.md`](../decode/README.md)), and frames in one group
  decode one after another on one decoder: decoders run in parallel only across groups, so G bounds
  the fill's parallelism from above;
* once a frame is decoded and cached nothing changes — frames are decoded once
  ([`ARCHITECTURE.md`](../ARCHITECTURE.md)).

So G trades bytes on the wire against the ask's latency and the fill's parallelism. A G of 1 keeps
today's model; any G > 1 makes the group a unit of delivery (an ask names a frame and receives its
group from the keyframe, or the client keeps the group's decoder state). Rows SIZE and SPEED give
the curve. The shape is proposed in [`adr-unit.md`](adr-unit.md): a `codec` field in the bundle's
metadata, one decoder module per codec behind `decoder.js`, and for G > 1 the group as the
*client's* unit — an ask for N is `request_frames [k … N]`, a group goes to one decoder — with the
wire, the store and the server unchanged. *Built since (row GOP), the simplest form:* a group is the
item, an ask for N asks k … k+G−1, a group decodes in order on one decoder, every frame exact on a
G = 8 and a one-group set; no wire, store or server change was needed (`adr-unit.md` §3, *Built*).

*Scope (row GOPSCOPE, 2026-10-08), for everything below on groups.* **Outside the target series**
([`series.md`](series.md)): the fluoroscopy, MR and RGB ultrasound of row SIZE, the tomosynthesis projections of row
TAXO (FOR PROCESSING views), and any CT or MR; their group results stand as measured and decide nothing for AV1.
**Inside**: the DBT slice series — four volumes from three reconstruction systems (rows CONTENT and BREAST, two of
them in both) — and the breast ultrasound cine, whose one open source is a lossy recording (row DATAGUARD); no ABUS
or angiography is open. What was measured on DBT, and no more: libaom 3.15.1 alone, alt-ref off (exactness requires
it), a keyframe at exactly every G, two presets; G = 1, 2, 4, 8, 16 and whole on two volumes coded whole (CONTENT),
G = 8 and 16 only on the k = 2 split (BREAST). "Inter does not pay" below means *on those volumes, at those
settings*; whether it pays on DBT is asked again, theory first (rows GOPTHEORY, GOPMEASURE, GOPREVIEW).

*Measured (SIZE, libaom 3.15.1, every coding exact; [`lab/av1`](../../lab/av1/README.md) §SIZE):*
**inter coding does not pay on any real series here** (*outside the target series, Scope above; corrected by LLSIZE: on the ultrasound it
does once the colour is transformed, below*), and coded whole, AV1 does not beat HTJ2K —
*corrected by DEPTH (§A3): coded as two streams, the two low bits apart, it does on every series
over 10 bits, 0.918–0.997; and by LLSIZE: on every series, below*. Bytes over
HTJ2K's at the slowest preset, intra → whole series: fluoroscopy (12-bit, 2 frames/s) 1.024 → 1.027,
MR (11-bit, 3.5 mm) 1.034 → 1.062, ultrasound cine (RGB 8) 1.117 → 1.534; at a practical preset
1.04–1.75. The smallest G that collects most of the gain is **G = 1**: there is no gain to collect
(fluoroscopy's best group, G = 2, is 0.04 % under intra). Lossless JPEG XL, for reference, is
0.83–0.93 of HTJ2K. CT and the cone-beam set need 13 bits — row DEPTH. Bytes therefore give G > 1
no reason; the content measured is three series, none of them a contrast angiography run.
*Tomosynthesis since (row CONTENT, [`lab/av1`](../../lab/av1/README.md) §SIZE): inter still did
not pay on two volumes, libaom, alt-ref off, two presets.* Two reconstructed volumes, 1 mm slices — the content where neighbours share most: the best
group is 1.2 % larger than intra on the 12-bit volume and 0.6 % smaller on the 10-bit one (1.8 % at
cpu6), against the fifth `adr-unit.md` §4 asks. Coded whole, AV1 is 1.043 of HTJ2K on the 12-bit
volume and **0.977 on the 10-bit one — the first series where AV1 coded whole is smaller**; split
top11+low, 0.943 and 0.946. Still no contrast angiography run: none is open.
*Tomosynthesis projections since (row TAXO, [`lab/av1`](../../lab/av1/README.md) §SIZE): inter
does not pay there either* (outside the target series, Scope above). The raw views of two vendors' systems, 9 and 15 a series, 14 bits
stored: on top11+low the best group is 0.3 % under intra on one and 0.2–0.8 % over it on the other.
Split top12+low they are 0.952 and 0.923 of HTJ2K (§A3). No breast ultrasound cine, automated breast
ultrasound or angiography run is reachable ([`queue.md`](queue.md) §Blocked).
*AV1 alone under HTJ2K on every series (row LLSIZE, [`lab/av1/llsize`](../../lab/av1/llsize/README.md)).*
At G = 1, libaom 3.15.1 at its slowest preset, the first 2–8 frames of all nine series, every coding
exact: **0.902–0.987 of HTJ2K's bytes** once the samples are represented for AV1 — the two low bits
apart at every depth over 8 (fluoroscopy 1.027 → 0.942, 12-bit tomosynthesis 1.040 → 0.941, MR
1.013 → 0.977, 10-bit tomosynthesis 0.977 → 0.942) and JPEG 2000's reversible colour transform on
RGB (ultrasound 1.117 → 0.962), plus `--tune-content=screen --sb-size=64` for 0–1 %. libaom's other
controls, SVT-AV1 and YCoCg-R do not beat that. Decode (dav1d-WASM, n = 15 interleaved): the colour
transform 0.89–0.95× row SIZE's coding, the split +1–5 % on large frames and +16–23 % on 512² MR and
10-bit tomosynthesis — still 5–10× HTJ2K (row SPEED). **Inter pays on the colour-transformed
ultrasound** (outside the target series and lossy-sourced, Scope above): one keyframe in 8 frames, 0.850 of HTJ2K (GBR inter 1.355), decoding 0.81–0.83× GBR
intra; on grey it does not (0.942–1.006 against intra's 0.902–0.987).
*The breast family (row BREAST, [`lab/av1/breast`](../../lab/av1/breast/README.md)): inter did not pay on
four DBT volumes at G = 8 and 16, and the one cine where it pays is a lossy recording.* Four DBT slice series from three reconstruction systems, 24–32
slices in position order, k = 2 split, every frame exact: G = 8 and 16 are 0.963–1.054 of intra's bytes at cpu0 and
0.998–1.050 at `good` 6 — the one gain over 2 % (a 10-bit volume at cpu0, 0.963) is a loss at `good` 6 — against
intra's 0.942–0.945 of HTJ2K. A breast ultrasound cine in RGB gains under 2 %. A grey one (CC BY 4.0, MPEG-4 at 512²)
halves: G = 16 is 0.53 of intra, 0.47 of HTJ2K, decoding in 0.56 of intra's time in dav1d-WASM — but only 30–47 %
of its samples change between frames, which is the source's lossy inter coding repeating blocks; a scanner's own
cine is not open here (`queue.md` §Blocked), so whether inter pays on one is not measured. No ABUS volume is open.

*What is left to cut (row ENCX, [`lab/av1/encx`](../../lab/av1/encx/README.md)).* On row 28's
frames, every coding exact (358/358 codings, 7 100/7 100 frames in Chromium): **HTJ2K gains only
0.9–1.6 % from the same split, and only with its low bits deflated** (0.984–0.991, at 1.02–1.69× its
decode), so row 28's gain is AV1's — on the same split AV1 is 0.916–0.997 of HTJ2K. The low bits are
near noise: **deflated (`DecompressionStream`) they cost what AV1 codes them in, ±0.5 points, and the
frame decodes in 0.64–0.83× of row 28's time** (0.63–0.76× at 4×, dav1d-WASM, n = 10 interleaved).
**Three low bits apart beat two on the four series whose noise σ is ≥ 17**, 0.5–3.9 % (cone-beam
0.987 → 0.948), decoding in 0.59–0.78× — row 28 measured three only at libaom's defaults. With the top
through WebCodecs where it is ≤ 10 bits (k = 3 brings CT and the cone-beam set there) a frame decodes
in **0.34–0.56× of row 28's time, 2.1–3.4× HTJ2K's**. Inter coding finds nothing predictable in the
noise (the low stream inter is 0–3.6 % larger), and libaom's remaining tools nothing (palette, already
on, is worth 4.5–9.2 %; the rest ±1 %). What that does to total time is arithmetic until row TOTAL2. *Measured since (row TOTAL3, §Total time): the deflated low bits and k = 3 cut a grey fill by 3 % at 4× on 50 Mbit and by 0–1 % elsewhere; the deflate alone at k = 2 costs 0.4 %.*

*What G = 1 costs an ask (SPEED's decode times × SIZE's bytes; arithmetic, not measured).* An ask is
one frame either way: AV1 adds 2–12 % of a frame's bytes and **20–260 ms of decoding** in Chromium
at 1×–4× (fluoroscopy 9.8 → 70 ms at 1×, 35 → 291 ms at 4×).

*What it costs a fill, measured (row FILL, [`lab/av1/fill`](../../lab/av1/fill/README.md)).* Each
series whole through the downloader with today's three decoders, the real server behind the relay
(40 ms round trip), headless Chromium 141 at 1× and 4×; 40 rounds at 20 Mbit/s and 16 at 50,
Williams-ordered, `VOID` visits dropped (230 of 784), n = 12–30 a cell; **40 544 of 40 544 frames
exact**. Seconds from the fill's issue to the last frame's pixels on the page, medians (every cell's
range within 7 %), and in brackets the ms of decoding left after the last byte arrived:

| series | link | HTJ2K 1× | AV1 1× | HTJ2K 4× | AV1 4× |
| --- | --- | --: | --: | --: | --: |
| fluoroscopy, 18 × 768², 12-bit | 20 Mbit | 3.93 (10) | 4.07 (66) | 3.95 (34) | 4.28 (274) |
| | 50 Mbit | 1.72 (10) | 1.82 (72) | 1.75 (38) | **2.36 (604)** |
| MR, 58 × 512², 11 bits | 20 Mbit | 4.56 (5) | 4.72 (25) | 4.57 (16) | 4.79 (94) |
| | 50 Mbit | 1.97 (6) | 2.06 (24) | 1.99 (20) | **2.53 (503)** |
| ultrasound, 70 × 760×421, RGB 8 | 20 Mbit | 7.49 (9) | 8.38 (45) | 7.51 (32) | 8.52 (182) |
| | 50 Mbit | 3.15 (10) | 3.53 (44) | 3.17 (34) | **5.34 (1 854)** |

AV1 is slower in all 174 round-paired fills. **At 1× both codecs fill at the wire's pace**: AV1's
decoding ends 24–72 ms after its last byte, and what it costs is its extra bytes, +86 to +895 ms
(+4–12 %). **At 4× on the 50 Mbit link AV1 is the fill's clock on every series and HTJ2K on none**:
0.5–1.9 s of decoding after the last byte against HTJ2K's 20–38 ms, the fill +27 % (MR), +35 %
(fluoroscopy) and +68 % (ultrasound) over HTJ2K's; at 20 Mbit its decoders fall 94–274 ms behind.
That is the verdict the arithmetic gave, but its sizes were optimistic: it set the decoders' total
time against the wire's (0.2–1.4 s apart) as if every decode overlapped a frame still arriving.
WebCodecs on the ultrasound, its one exact series, keeps up — 3.60 s (116) at 4× and 50 Mbit, 8.45
(115) at 20; 3.52 (38) and 8.37 (36) at 1× — so there its fill is AV1's bytes alone. A container's
4 cores, the browser on 3 of them and the relay alone on the fourth; not a phone.

*Cutting the decode (row DECSPEED, [`lab/av1/decspeed`](../../lab/av1/decspeed/README.md)): tiles
and threads cut a frame's latency, not a fill's.* A lossless frame's decode is 66–84 % entropy
decoding (a profile of dav1d-WASM), serial within a tile. No encoder setting cuts it by more than
10 %: presets, 64² superblocks, and every optional intra tool off, at +6–72 % bytes. dav1d's threads
do nothing without tiles. With 4 tile columns (+0.1–0.4 % bytes) and 3 threads, one frame decodes in
0.37–0.44 of its time: 29 against 76 ms on the fluoroscopy at 1×, 116 against 314 at 4×. That is
still 2.6–2.9× HTJ2K's. Through the fill at 50 Mbit, 12 rounds, 487 of 504 visits kept and all 24 528
frames exact, the gain goes away at 4×. Here 4× is three slowed cores for the whole browser, as a
phone has, which is stricter than row FILL's quarter-core per thread. Seven arms ran: today's
3 decoders; 6 decoders; and the tiled frames on 1 decoder × 3 threads, 2 × 2, 3 × 2 and 3 × 3. They
end within −3 to +4 % of each other on the fluoroscopy and ultrasound, and the oversubscribed arms
are worst on the MR (+11–15 %). The cores are the clock, and threads only move the same work between
them. **The best combination is 1 decoder × 3 threads on 4-tile frames**: 1.83×, 1.81× and 2.39× HTJ2K's
fill at 4× (3.21, 3.60, 7.62 s against 1.75, 1.99, 3.18), against today's 1.82×, 1.86× and 2.32×.
At 1× it ends 20–40 ms sooner. What it buys is an ask's single frame at 0.37–0.44 of
the time; a fill's total stays where the decoder's CPU work puts it. Containers, not phones.

**A2 — which decoder for which frame.** WebCodecs' `VideoDecoder` is native (on Chromium without an
AV1 hardware decoder it is dav1d in the browser process) and dav1d compiled to WASM runs everywhere.
Neither is assumed faster or exact:

* the profiles, per the AV1 spec: Main is 8/10-bit 4:0:0 or 4:2:0; High is 8/10-bit 4:4:4 (no
  4:0:0); Professional adds 12-bit, 4:0:0 included. **Measured (WCAP), headless Chromium 141, no
  GPU:** every 8- and 10-bit layout comes back exact through `copyTo`, intra and inter, Professional
  4:2:2 included; **12-bit is refused** — `decode()` will not take its keyframe — although
  `isConfigSupported` says `true` for it (and for strings the spec forbids), so the answer to that
  call decides nothing. A 4:0:0 frame comes back as three planes. Safari offers AV1 only on hardware
  with an AV1 decoder (M3 and later, iPhone 15 Pro and later), at profiles unconfirmed.
  [`decode/README.md`](../decode/README.md) §AV1.
* lossless coding is part of the normative decode process, not an optional tool, so every
  conforming decoder must take it.
* a hardware decoder may hand back a GPU frame whose read-back is converted; exactness is per
  platform, not per spec.
* one decoder for everything is the simplest shape; a second path earns its place by a measured
  win, interleaved, on the frames it would serve.

**dav1d in WASM is exact** (row WASM, [`lab/av1/dav1d-wasm`](../../lab/av1/dav1d-wasm/README.md)):
dav1d 1.5.4 under emscripten 3.1.74, scalar, `-msimd128` and `-msimd128 -pthread` (four threads),
matches the native dav1d CLI and a second native build with assembly on every frame of 12 lossless
streams — 8/10/12-bit 4:0:0 and 4:4:4 identity, intra and G = 8 — one picture per temporal unit at a
frame delay of 1. 546 KB `.wasm` scalar, 623 KB with SIMD (219 and 238 KB gzipped). Decode time is
5–10× OpenJPH's on the same frames (below). **It is the client's AV1 decoder at G = 1** (row
DEC): `decoder.codec: "av1"` loads it behind `decoder.js`'s contract, and every shape decodes
through the downloader to its source's checksum ([`client/downloader/README.md`](../../client/downloader/README.md)).
*WCDEC since:* WebCodecs is the client's decoder for a series that says `depth` ≤ 10 in a browser
with `VideoDecoder`, dav1d-WASM for every other, the top10+low split and a signed series' offset
undone by both; exact through the downloader in headless Chromium 141, not timed there
([`decode/README.md`](../decode/README.md) §WebCodecs, the decoder the client runs).

**Decode time, measured (SPEED, [`decode/README.md`](../decode/README.md) §Decode time against
HTJ2K):** the product's worker, the same 18 frames of three real series, 16 interleaved rounds, Node
and Chromium 141, 1× and 4×, every frame exact. dav1d-WASM takes **5.4–9.7× OpenJPH's time** a frame
— 70 against 9.8 ms on 12-bit fluoroscopy in Chromium, 26 against 4.9 on MR, 48 against 7.9 on RGB
ultrasound — slower in all 224 paired rounds, and dav1d itself is ~90 % of it. WebCodecs, on the one
series it decodes exactly (8-bit), is 1.55× faster than dav1d-WASM and still 4.1–4.2× OpenJPH. So
neither AV1 path wins on decode, and with §A1's bytes AV1 at G = 1 wins on nothing on this content:
by [`adr-unit.md`](adr-unit.md) §4's rule it does not earn its place. Whether the phase continues is
the owner's call; DEPTH (CT, cone-beam) is the content not yet measured. Container figures, not a
phone's. *DEPTH since (§A3):* split into two streams, AV1 is 0.3–8 % under HTJ2K's bytes on the four
series over 10 bits (CT 0.918) — the one place it wins, set against a decode SPEED measures at
5–10× (a split's two streams decode natively in the time of one; not timed in WASM). *SPLIT10 since
(§A3):* timed in Chromium, top11+low through dav1d-WASM is 5.7–8.2× OpenJPH and top10+low through
WebCodecs 2.6–3.9×. *XBROWSER since:* in Firefox 157 and WebKitGTK 2.52 the
client's choice of WebCodecs fails every frame of every series that says `depth` ≤ 10 (Firefox
refuses monochrome AV1 and returns 4:4:4 as 8-bit `BGRX`; WebKitGTK's GStreamer decodes no AV1
here), with no fallback to dav1d-WASM (*since row 39 there is one, and a per-layout probe; not re-run
in those engines*); dav1d-WASM and OpenJPH are exact in all three engines, at
4–10× apart as in Chromium ([`decode/README.md`](../decode/README.md) §AV1 in WebKit and Firefox).

**Memory and first use (FOOTPRINT, [`lab/av1/footprint`](../../lab/av1/footprint/README.md)):** the
product's worker in headless Chromium 141, the largest frames here (14-bit projections, 4.92 M samples,
split two low bits apart; RGB ultrasound as the reversible colour transform), every frame exact
(13 440/13 440). **A dav1d-WASM worker costs 31.6 MB resident [31.2–32.2] on the projections against
24.6 [24.4–25.0] for HTJ2K's adopted wrapper (26.1 the package), and 7.6 against 7.1 on the
ultrasound** — the renderer's RSS slope over 1, 2 and 4 workers, 6 rounds. Its WebAssembly heap is
19.7 MB after one projection and 34.8 MB by the series' end (16.4 on the ultrasound; HTJ2K's 28.3 and
6.0), not a byte more over a second pass, and never returned: linear memory does not shrink. A
WebCodecs worker holds 5–10 MB settled but peaks at 58 (projections) and 32 MB (ultrasound) a worker
over 1 → 4 workers (88 and 76 over 1 → 2), outside its heap. **First use is HTJ2K's:** a fresh AV1 worker is ready in 28–39 ms at 1× and 84–93
at 4× (HTJ2K 30–41, 96–115), and init plus frame 0's excess over the next frames is 65–97 ms at 1×
and 200–280 at 4× against HTJ2K's 45–82 and 164–225 — 12 rounds, cold and twice cached; the cache
takes 5–11 ms off init at 1× and nothing off the frame. On a phone that is ~28 MB more for four workers on
the largest frames and a first frame about as late as HTJ2K's, both small beside the decode itself
(645 against 67 ms a projection at 1×). Desktop figures; a phone's memory is these bytes, its time is
not.

**A3 — samples above 12 bits, and signed samples.** AV1 codes at most 12 bits a sample and only
unsigned. Signed data is offset by 2^(B−1), which is reversible (*corrected 2026-10-05: what was built and
measured is an offset of −min of the series, 0 when it has no negative sample — `lab/av1/size.py` `Set.offset`,
[`item-format.md`](item-format.md) §Representation; 2^(B−1) is the shift HTJ2K's and JPEG XL's inputs get, `size.py`
`pnm()`. It needs fewer bits: the CT, stored 16-bit signed at −2048..3746, takes 13 bits offset by 2048, 16 by
2^15*); data over 12 bits (stored 16-bit)
needs a split into planes or streams. Row DEPTH measures the options against HTJ2K on the same frames.
On row DATA's sets, measured: the CT spans −2048..3746 (−1097..3746 without its pad), so it does
**not** fit 12 bits after an offset; the cone-beam volume needs 13 bits; MR, fluoroscopy and
ultrasound fit 12 or fewer.

*Measured (DEPTH; [`lab/av1`](../../lab/av1/README.md) §DEPTH, 44/44 splits exact):* the split to
use is **top11+low** — v ≫ 2 as a 12-bit stream and v & 3 as an 8-bit one, merged `top << 2 | low`.
Bytes over HTJ2K's at libaom's slowest preset: CT 0.918, cone-beam 0.997, and on the series AV1 can
code whole it beats direct coding too — MR 0.990 against 1.034, fluoroscopy 0.946 against 1.024.
Hi/lo bytes is the worst split (1.20–1.37). Two streams decode in the time of one (native dav1d,
within the spread; the merge is 0.05 ms a 512² frame); the 12-bit stream needs dav1d — WebCodecs
refuses 12-bit — while top10+low keeps every stream ≤ 10 bits at 0.994–1.071. Measured on 11- to
13-bit data, and by CONTENT on tomosynthesis: top11+low 0.943 (12-bit) and 0.946 (10-bit, against
0.977 direct); a full 16-bit series is not. *Corrected by TAXO:* the rule is **the two low bits
apart**, not top11 — on 14-bit tomosynthesis projections top12+low (v ≫ 2, v & 3) is 0.952 and 0.923
of HTJ2K, and top11+low (three low bits) 0.998 and 1.002. A split frame is two temporal units in one store entry:
the store and the wire stay opaque, but this project's AV1 frame format and `decode-av1.js` change,
which is a proposal for [`adr-unit.md`](adr-unit.md) — *built since by row WCDEC: the framing and
its fields are [`adr-unit.md`](adr-unit.md) §2, the transforms.*

*Measured (SPLIT10; [`lab/av1/split10`](../../lab/av1/split10/README.md)):* **top10+low decodes
exactly through WebCodecs** on all four series. Two `VideoDecoder`s, 10- and 8-bit 4:0:0, take the
units together and the samples are merged in the worker. 9 216/9 216 frames were exact across every
arm. Chromium 141 headless decoded the first 18 frames a series in 16 interleaved rounds at 1× and
4×. Each figure is ms a frame, bytes in to merged samples and range out, as the median of round
medians:

| series | OpenJPH | WebCodecs top10+low | dav1d-WASM top11+low | WebCodecs ÷ dav1d-WASM | WebCodecs ÷ OpenJPH |
| --- | --- | --- | --- | --- | --- |
| CT 512² | 5.2 · 19.1 | 13.5 · 38.7 | 29.2 · 121 | 0.46 · 0.32 | 2.6 · 2.1 |
| cone-beam 512² | 4.9 · 17.3 | 19.1 · 64.8 | 38.6 · 162 | 0.50 · 0.40 | 3.9 · 3.7 |
| MR 512² | 5.3 · 19.8 | 15.0 · 45.5 | 33.5 · 138 | 0.45 · 0.33 | 2.8 · 2.4 |
| fluoroscopy 768² | 10.2 · 39.9 | 36.3 · 126 | 83.4 · 351 | 0.44 · 0.36 | 3.6 · 3.2 |

Each cell gives 1× · 4×, and each ratio is the median of paired rounds. WebCodecs was faster than
dav1d-WASM in 128/128 paired rounds and slower than OpenJPH in all of them. Of the gain, the decoder
accounts for nearly all and the split for little: dav1d-WASM on top10+low is 0.89–0.97 of its
top11+low time. On these 18 frames top10+low costs 0.973–1.064 of HTJ2K's bytes and top11+low
0.904–0.998. So top10+low trades AV1's one byte win for a decoder two to three times faster, and it
still ends 2–4× slower than HTJ2K. WebCodecs ran with however many threads Chromium gives it, and
that count was not measured. The dav1d-WASM build is single-threaded. These are container figures on
4 cores with one decoder at a time, not a phone's.

*Measured (REP14; [`lab/av1/rep14`](../../lab/av1/rep14/README.md)): at 13 and 14 bits.* Two layouts
were compared on every frame of the two 14-bit tomosynthesis projection series and the CT (13 bits
after its offset). **d12** keeps the two low bits apart: v ≫ 2 as a 12-bit stream, which only dav1d
takes. **w10** codes v ≫ (b − 10) as a 10-bit stream and the 4 (or 3) low bits at 8, so WebCodecs
takes both. Both use libaom 3.15.1 with `--tune-content=screen --sb-size=64`, and every frame was
exact natively, through dav1d-WASM and through WebCodecs. Bytes over HTJ2K's at cpu0, then at the
fastest preset within 2 % of it (`--allintra` 7 for d12 and 9 for w10 on the projections, cpu6 on the CT):

| series | d12 | w10 | d12, fast | w10, fast |
| --- | --- | --- | --- | --- |
| projections, system 1, 9 × 1914×2572 | **0.953** | 0.999 | 0.953 | 1.007 |
| projections, system 2, 15 × 1280×2048 | **0.923** | 1.046 | 0.925 | 1.059 |
| CT 100 × 512² | **0.917** | 0.931 | 0.926 | 0.940 |

**The four low bits cost what d12 saved.** At 14 bits, on the sweep's first two frames, the w10 low
stream is 60–71 % of w10's bytes and 2.2× d12's two-bit one. On one projection series w10 is larger than HTJ2K. At 13 bits three low
bits cost only 1.6 % over d12. Decode in headless Chromium through the product's `decoder.js`, ms a
frame, median of 10 interleaved rounds at 1× · 4×, 9 920/9 920 frames exact:

| series | OpenJPH | d12, dav1d-WASM | w10, WebCodecs | w10, dav1d-WASM | w10 ÷ d12 |
| --- | --- | --- | --- | --- | --- |
| projections, system 1 | 93 · 396 | 622 · 2 665 | 246 · 1 023 | 586 · 2 520 | 0.39 · 0.38 |
| projections, system 2 | 53 · 216 | 294 · 1 277 | 141 · 579 | 302 · 1 315 | 0.48 · 0.45 |
| CT | 4.9 · 15.2 | 27.4 · 111 | 13.8 · 41.0 | 28.3 · 112 | 0.51 · 0.37 |

WebCodecs was faster than d12 in 60/60 paired rounds. It is still 2.6–2.8× OpenJPH, against 5.5–7.1×
for d12. The decoder accounts for the gain: dav1d-WASM on w10 takes 0.94–1.04 of its d12 time.

Total time used row TOTAL's harness: links, CPU, rig and Williams order unchanged, 12 rounds, n = 10–12
a cell, 28 of 1 080 visits `VOID` and dropped. **44 640/44 640 frames were exact.** Each HTJ2K cell gives
the median seconds to every frame on the page. Each layout cell gives the median of round-paired
ratios to HTJ2K, at 1× · 4×:

| series | arm | 5 Mbit | 20 Mbit | 50 Mbit | LTE | Wi-Fi |
| --- | --- | --- | --- | --- | --- | --- |
| CT, 13 bits | HTJ2K, s | 26.7 · 26.7 | 6.81 · 6.82 | 2.87 · 2.88 | 5.41 · 5.37 | 11.3 · 11.1 |
| | d12, dav1d | 0.92 · 0.92 | 0.92 · 0.93 | 0.93 · 1.52 | 0.94 · 1.02 | 0.90 · 0.93 |
| | w10, WebCodecs | 0.93 · 0.93 | 0.93 · **0.94** | 0.94 · **0.94** | 0.95 · **0.96** | 0.87 · 0.95 |
| projections, system 1, 14 bits | HTJ2K, s | 60.0 · 60.3 | 15.2 · 15.5 | 6.27 · 6.54 | 14.0 · 14.4 | 28.5 · 28.7 |
| | d12, dav1d | **0.96 · 0.99** | **0.99** · 1.10 | 1.04 · 1.63 | **0.95** · 1.07 | **0.98** · 1.02 |
| | w10, WebCodecs | 1.00 · 1.01 | 1.01 · 1.04 | 1.03 · 1.11 | 1.01 · 1.04 | 1.01 · 0.98 |
| projections, system 2, 14 bits | HTJ2K, s | 47.9 · 48.0 | 12.1 · 12.3 | 5.03 · 5.18 | 9.21 · 9.36 | 21.8 · 22.2 |
| | d12, dav1d | **0.93 · 0.94** | **0.95** · 1.01 | **0.97** · 1.46 | **0.94** · 1.03 | **0.95 · 0.95** |
| | w10, WebCodecs | 1.05 · 1.05 | 1.05 · 1.07 | 1.06 · 1.11 | 1.10 · 1.13 | 0.99 · 1.09 |

* **At 13 bits w10 is the layout.** It is within 1 % of d12 wherever the wire is the clock and wins
  every cell, 0.87–0.96. At 4× it holds 0.94–0.96 on 50 Mbit and LTE, where d12 takes 1.52 and 1.02.
  Its first frame comes 4–30 ms before HTJ2K's on every cell.
* **At 14 bits d12 is the layout, and only where the wire is the clock.** At 1× it wins on every link
  but system 1 at 50 Mbit (0.93–0.99). At 4× it wins at 5 Mbit (0.94–0.99) and on system 2's Wi-Fi,
  and loses 1–63 % elsewhere: HTJ2K wins those cells, but for system 1's Wi-Fi at 4×, where w10 is
  0.98. w10 carries four low bits. It is 0.98–1.11 on system 1 and 0.99–1.13 on system 2, which is
  its bytes (0.999 and 1.046). WebCodecs' faster decode does not pay back four low bits at 14 bits.
* **The first frame is HTJ2K's at 14 bits** on every cell but one: d12 is 89–572 ms behind it at 1×
  and 0.89–2.4 s at 4×, and w10 25–239 ms and 211–471 ms (16 ms ahead on system 1's LTE at 1×).
* **Saturation.** As row TOTAL found: at 4× on 50 Mbit (and on 20 Mbit for the 5-megapixel
  projections), dav1d-WASM's decode on the browser's three cores is the fill's clock. Nothing is
  claimed about a phone.

**Verdict, REP14:** at 13 bits store top10+low (w10, WebCodecs), which is 0.931 of HTJ2K's bytes and
wins or ties every cell. At 14 bits store the two low bits apart (d12, dav1d-WASM), which is 0.92–0.95
of HTJ2K's bytes and 0.93–0.99 of its fill time where the wire is the clock, and HTJ2K wherever a slow
CPU meets a link of 20 Mbit or more. w10 is the 14-bit choice on one cell only.

*Checked (SPLITOK; [`lab/av1/splitok`](../../lab/av1/splitok/README.md)): the split is exact at every depth and
layout a rule could pick.* Every b = 8…16 bits after the offset, unsigned and signed, at every k = max(0, b − 12) …
max(b − 8, 4), item format widened to match ([`item-format.md`](item-format.md) §Built): every value split and merged
back in the writer and the reader; 8 280 synthetic frames (seven geometries from 1 pixel wide to 256², ramps holding
every value, extremes, noise, a pad at the series minimum), 540 frames of 1914×2572 and 4096×5120 at the
fastest preset, and all 3 310 frames of the nine real series at each of
their k, cpu0 and the shipped preset, exact natively, in Node and in Chromium, Firefox and WebKitGTK, each decoder the
one its engine should choose — WebCodecs in Chromium wherever every stream is ≤ 10 bits, dav1d-WASM elsewhere; and 20
mutations caught. Nothing in the split stops a per-depth rule: row 44 may pick any k of this range on bytes and time.

*The breast family's depths (row BREAST, [`FIXTURES.md`](../FIXTURES.md) §AV1 data): nothing presented or
reconstructed there exceeds 12 bits* — four FFDM and four synthesized-2D series of 10–12 bits, four DBT slice series of
10–12; only the raw projections (14 bits, three systems) and a digitized film (16, a ~12-bit scan stretched) exceed
it. On a third system's projections plain, k = 2 and w10 are within 1 % (0.962–0.971 of HTJ2K,
[`lab/av1/breast`](../../lab/av1/breast/README.md)).

*Real 9-, 15- and 16-bit series and two more signed CTs (row DATA3, [`lab/av1/breast`](../../lab/av1/breast/README.md)
§Row DATA3's series): exact at every k of row 43's matrix, natively, in Node and in Chromium, Firefox and WebKitGTK.*
The best arm per series at cpu0 is k = 0 at 9 bits (0.910 of HTJ2K), k = 1, 2 or 3 at 10–13 bits (0.899–0.989), and w10
at 15 and 16 bits, where AV1 only ties (0.996, 1.001); the adopted k = 2 is best on two of nine. Plain and optimized
items refuse 15–16 bits by name, and k = 3 a 16-bit series. Row 44 ranks the arms by time.

*Rare levels mapped out (row REMAP, [`lab/av1/remap`](../../lab/av1/remap/README.md)): the map buys the decoder, not
bytes.* Two of three projection systems are 12-bit data plus one saturated level (16383: 11 % and 0.6 % of samples),
the CTs and the cone-beam 12-bit data plus 0.0003–0.02 % of rarer bright samples. Clamped into a 12-bit window with
the outliers in a deflated per-frame map (1–10 KB a series), coded as one 12-bit stream the series is 2.6–13 % larger
than the k = 2 split on all six; split at k = 2 after the map it is the split's size (−0.1…+0.05 %) with every
stream ≤ 10 bits, so WebCodecs decodes it in 0.46–0.71 of the split's dav1d-WASM time (60/60 paired rounds, Chromium
141 in the container, 1× and 4×, 1 920/1 920 frames a throttle exact against the source); against w10 it is 1.05–1.34×
the time for 5 % and 12 % fewer bytes on the projections and 1.5 % on two CTs, 4.4–4.8 % more on the third CT and
the cone-beam. A palette of high parts gives the same at k = 2; at L = 0 (histogram packing) it halves the 16-bit film,
for HTJ2K as much as for AV1 (0.576 and 0.571 of HTJ2K on the source). Proposed in [`item-format.md`](item-format.md)
§Proposed: a remapped plane; not built into the product.

*A split item's two streams through two decoders (row MIXDEC, [`lab/av1/mixdec`](../../lab/av1/mixdec/README.md)).*
Where the top is over 10 bits, dav1d-WASM decodes both streams today, and **the 8-bit low stream is 17–38 % of a
13-bit frame's decode and 34–54 % of a 14-bit one's**. Built behind decoder config `mixed` (off by default): the
low to WebCodecs, started before the top's dav1d-WASM decode, dav1d-WASM taking it wherever the `g8` probe fails
(Firefox and WebKitGTK). Exact on every frame of the six 13- and 14-bit series at every k and on row 43's synthetic
set, in all three engines, each stream from the decoder expected; 11 mutations caught. In Chromium a frame decodes
in **0.46–0.87 of today's time** (faster in 120/120 paired rounds) but **1.04–2.16× w10's**, whose streams are
both WebCodecs'; a fill at 4× on 50 Mbit takes **0.77–0.90 of today's** (131/131), 0.91–1.14 of w10's — tying or
ahead where w10's four low bits cost bytes (the 14-bit projections, 0.91–1.02) — and 0.93–1.18 of HTJ2K's, winning on
two CTs where today loses 18–23 %. Containers, not phones; whether the flag becomes the client's choice is the
owner's.

*The split per depth, by bytes, decode and total time (row SPLITTIME, [`lab/av1/splittime`](../../lab/av1/splittime/README.md)).*
Eleven real series of 9–16 bits, every arm k a rule could pick (d12 = max(0, b − 12), 2, 3, w10 = max(0, b − 10)),
every frame exact: 59 280/59 280 decoded through `decoder.js` and 246 760/246 760 filled on row TOTAL's harness.
**WebCodecs' arm decodes fastest on every series** (1.59–4.12× HTJ2K's time a frame, dav1d-WASM's 12-bit top
5.6–11.6×), and by total time the layout per depth is: **9 bits k = 0** (the samples whole, 0.93–1.01 of HTJ2K's
fill; k = 2 and 3 1.01–1.07); **10 bits k = 2** (0.95–0.99); **11 bits a tie** of k = 1–3 (0.99–1.02); **12 bits
k = 3 or 2** within 0.02 of each other (0.94–1.02); **13 bits k = 3 = w10** on every cell (0.91–0.98, first frame
within 20 ms of HTJ2K's), where k = 2 takes 1.66–1.68 at 4× on 50 Mbit; **14 bits k = 2 or 3** where the wire is
the clock (0.92–0.99) and HTJ2K where a slow CPU meets 20 Mbit or more (k = 2 1.02–1.69, w10 1.01–1.13); **15 and 16
bits HTJ2K on every cell** (w10 1.02–1.16, d12 1.08–3.11). The adopted k = 2 is the rule at 10–12 and 14 bits, and
loses only at 9 bits (to the whole samples) and at 13 (to k = 3) — adopted by row 72 as ingest's rule,
[`item-format.md`](item-format.md) §The split per depth. Containers, not phones.

**A4 — content.** The synthetic sets add independent noise to every frame
(`lab/scripts/gen_frame_pnm.py`), so an inter-frame gain measured on them is not a claim about any
modality. Row DATA brings public, freely licensed series fetched at run time (checksummed, never
committed); a size verdict names its content. They are a CT stack, an MR stack, an RGB ultrasound
cine, a 12-bit fluoroscopy run, a 16-bit cone-beam volume and, from row CONTENT, two breast
tomosynthesis volumes (12- and 10-bit), all CC BY ([`FIXTURES.md`](../FIXTURES.md) §AV1 data); no
open angiography run was found, re-checked by CONTENT.

**A5 — Preview.** The rule is that every frame ends bit-exact; a lossy picture shown first and
replaced by the exact frame keeps it. Whether a lossy first picture is acceptable in the product is
the owner's ruling, not a measurement's. *Measured (PREVIEW; [`lab/av1/preview`](../../lab/av1/preview/README.md)),
fluoroscopy and the ultrasound cine; no angiography run was available:*

* **Bytes and quality, against the source.** Lossy AV1 (libaom 3.15.1, cpu6) at G = 8:
  fluoroscopy at CRF 20 is **0.78 % of the exact HTJ2K bytes at 43.9 dB** (12-bit peak; max \|Δ\|
  433 of 4095), coded as 10-bit 4:0:0 so WebCodecs takes it; the ultrasound at CRF 32 is **7.0 % at
  34.2 dB** (max \|Δ\| 109), 4:2:0 capping any colour preview at 43.8 dB before coding. HTJ2K's own
  preview, its half-size resolution prefix, is 26 % and 32 % of the bytes at 27.6 and 26.6 dB.
* **Decode.** dav1d-WASM decodes a lossy frame 1.1–3.3× slower than OpenJPH decodes the exact one,
  and 3–11× slower than OpenJPH's half-size prefix; WebCodecs 2.4–13× faster than dav1d-WASM and
  faster than OpenJPH's exact decode on every cell (headless Chromium, this container, 1× and 4×,
  15 interleaved rounds, 68 640 frames matching their references).
* **What it buys, arithmetic over those numbers** (three decoders, frames in order; nothing serves
  a preview, so no transfer ran): on 5 Mbit/s the cine is playable **74–124× sooner on fluoroscopy
  (0.12–0.20 s against 14.8 s) and 14× sooner on the ultrasound (2.0 s against 28.8 s)**, 4–32×
  sooner than HTJ2K's prefix-first order. Every frame is exact later by the preview's share of the
  bytes: +0.8 % and +7 %. At 50 Mbit/s and 4× through dav1d-WASM the ultrasound's preview (1.21 s)
  is later than HTJ2K's prefix (0.93 s); through WebCodecs it is 0.24 s. One group for the whole
  series puts the preview on one decoder and gives most of it back (3.52 s at 4×, 50 Mbit/s);
  G = 8 is within 1–16 % of its bytes.

*Measured (EMBED; [`lab/av1/embed`](../../lab/av1/embed/README.md)), all seven sets: one intra
codestream that is a preview first and exact at its end.*

* **JPEG 2000 Part 1 with quality layers** (OpenJPEG 2.5.4, reversible 5/3, LRCP, three lossy layers
  then lossless) costs 0.09–0.19 % over a single layer, and Part 1 is 4–7 % smaller than HTJ2K, so
  the layered codestream is **0.93–0.96 of the served bytes, preview included**. Its first layer is
  **0.4–0.9 % of them at 37–43 dB** on grey (25 dB on the RGB ultrasound), and the third is 7–15 % at
  44–59 dB. It decodes in 1.0–1.4× OpenJPH's time for the exact frame. **The exact frame then
  decodes 6–12× slower than OpenJPH** in WASM, slower in 210/210 paired rounds: EBCOT, the block
  coder HTJ2K replaces, costs what dav1d-WASM does. For the same PSNR the layers take about twice
  AV1's preview bytes (fluoroscopy 44 dB: 1.7 % against 0.78 %). Those bytes are inside the exact
  frame; AV1's come on top of it.
* **Progressive lossless JPEG XL** (libjxl 0.12.0, `-p`, squeeze) draws its first picture only after
  **6–48 % of the bytes** (tomosynthesis 6 %, CT, MR and cone-beam 44–48 %), at 28–47 dB. libjxl
  pauses at no progression step in a lossless frame, so a preview is a prefix flushed. The first
  picture decodes in 1.3–2.9× OpenJPH's exact time and the whole codestream in 4.0–6.2×, and its
  bytes are 0.91–0.95 of HTJ2K's.
* So an embedded preview is free in bytes and dear in decode: JPEG 2000's is the only small one, and
  it makes every exact frame 6–12× slower to decode. Headless Chromium 141, this container, 15
  interleaved rounds at 1× and 4×; 22 680/22 680 frames matched.

*Measured (RESID; [`lab/av1/resid`](../../lab/av1/resid/README.md)), every series of rows DATA
and CONTENT:* the exact frame as **the preview plus a lossless residual** (source − preview, one
offset per series), not the preview and then the whole exact frame.

* **Bit-identical lossy output**, so the residual is exact on every decoder: dav1d-WASM and
  WebCodecs matched native dav1d on 13 440/13 440 preview frames (8-bit 4:2:0, 10-bit 4:0:0), and
  preview + residual matched the source on 16 800/16 800. The colour preview's conversion back to
  RGB must then be integer arithmetic, the same in every client.
* **Bytes: the preview is free.** Preview (G = 8, cpu6) + residual in HTJ2K is **0.947–1.002 of
  HTJ2K alone** at each series' best CRF (8 or 20; 0.947–1.021 over every CRF): −5.3 % on the
  ultrasound, −5.0 % on CT, +0.2 % on 12-bit tomosynthesis — where preview-then-HTJ2K costs +0.1 %
  to +22 %. The residual in AV1 is better only on 10-bit tomosynthesis (0.930) and worst on colour
  (1.13–1.61). So AV1's preview, too, need not come on top of the exact frame.
* **Decode: it is not.** Preview + HTJ2K residual + the add takes **1.31–1.89× HTJ2K alone's time**
  through WebCodecs at 1× (1.23–1.74× at 4×) and 2.1–3.1× through dav1d-WASM; with the residual in
  AV1, 4.9–11×. Headless Chromium, this container, first 16 frames, 15 interleaved rounds.

Serving a preview — or a residual in place of the exact frame — is a second representation of a
frame in the store and on the wire: structural, and not proposed here.

*One scalable payload instead (row SVCQ; [`lab/av1/svcq`](../../lab/av1/svcq/README.md)).* A lossy
base layer and a lossless top predicted from it, in one AV1 payload (libaom 3.15.1's real-time
encoder, two spatial layers, base half or full size at quantizer 20–55): **every top frame exact,
and the total 0.95–1.04 of single-layer lossless AV1** on fluoroscopy, MR and the ultrasound —
scalability is nearly free; a half-size base is 0.03–2.4 % of HTJ2K's bytes at q 40–55 and
decodes in 2–13 % of a lossless frame's time. But the payload carries lossless AV1's size, **1.04–1.64
of HTJ2K's**, against a separate preview plus exact HTJ2K at 1.008 and 1.07 above; and the exact
frame decodes 3–30 % slower than single-layer AV1 (dav1d-WASM, Chromium 141 and Node, 1× and 4×,
n = 15 interleaved). `decode-av1.js` opened dav1d with `all_layers` 1, which returned the base and then
failed on such a payload (*corrected by row SVCDEC:* the wrapper dropped the rest of the unit after
the first picture; it now returns the base as a preview and then the exact frame, [`adr-unit.md`](adr-unit.md) §6); WebCodecs returns the top exactly but cannot be asked for the base, only
fed its units. Row RESID's preview plus HTJ2K residual (0.947–1.002 of HTJ2K's bytes, 1.31–1.89× its
decode) beats it on both. *Bases before tops, proposed (row SVCORDER):* each frame as two
entries, layer-major — the base alone, then the whole unit — so a fill is every base and then every
exact frame with the wire, the store's format and the server unchanged, for the base's bytes twice
([`adr-unit.md`](adr-unit.md) §5).
*Which shape (row SVCSHAPE; [`lab/av1/svcshape`](../../lab/av1/svcshape/README.md)).* Over 20 shapes
on all nine series (spatial ½ and ¼, a full-size lossy base, three layers, temporal layers, base q
20–60, keyframe interval; over 12 bits the two low bits apart), every exact frame exact: **a
quarter-size base at q 40 has the least overhead everywhere** — 0.968–1.003 of single-layer lossless
AV1's bytes, the exact frame 0.97–1.10× its decode, the base 0.01–0.36 % of HTJ2K's bytes at 30 dB
(ultrasound) and 34–47 dB (grey), so a series' bases are playable in 0.01–0.11 s at 1× and 0.06–0.5 s
at 4× on 5–50 Mbit/s, decode-bound (arithmetic over measured bytes and dav1d-WASM decode, Chromium 141,
n = 10 interleaved). A full-size q 20 base is 1–5 % smaller on CT, MR, fluoroscopy and the
ultrasound, but a full-size base decodes 5–32 % slower (q 40); a third layer, temporal layers and shorter keyframe intervals
buy nothing. No shape moves the payload off lossless AV1's size: 0.94–1.59 of HTJ2K's.
*The base through WebCodecs (row WCBASE; [`lab/av1/wcbase`](../../lab/av1/wcbase/README.md)).*
WebCodecs has no operating point, but dropping the OBUs with `spatial_id` > 0 from a unit — the
unit's prefix, byte for byte the encoder's own base-only stream — makes it return **the base,
identical sample for sample to native dav1d's at operating point 1**, while a decoder fed the whole
unit returns the exact frame: 534/534 each on the ultrasound, the fluoroscopy and MR as their top
10 bits, and synthetic grey 10 and RGB 8, half- and full-size bases at q 40; 12 bits refused (row
WCAP). Flushing a unit for its picture needs G = 1, since WebCodecs wants a key chunk after every
flush (−1 to +1 % bytes on the grey series, +7–13 % on the ultrasound); past G = 1,
`optimizeForLatency` returns each base from its own unit with no flush. Against row SVCDEC's
dav1d-WASM preview, unit sent to picture in the contract: **0.65× on the ultrasound at 1× and
0.36–0.76× on every series at 4×** (faster in 87/90 paired rounds; ultrasound half-size base 12.6
against 36.5 ms), but 1.1–1.3× — slower — on the 2–4 ms grey bases at 1×. The base is 7–36 % of
WebCodecs' own exact frame (headless Chromium 141, this container, 15 interleaved rounds,
19 440/19 440 pictures matched). Not built into `decode-av1-webcodecs.js`.
*Bases first, measured (row SVC; [`lab/av1/bases`](../../lab/av1/bases/README.md)).* Row SVCORDER's
layer-major layout built in the lab — entry i the base, entry F + i the whole unit, a lab decoder
worker through the downloader's `decoderWorker` seam, the downloader, server and store unchanged —
with row SVCSHAPE's shape (a quarter-size base at q 40, one keyframe) on the fluoroscopy and the
ultrasound, row TOTAL's rig at 5/20/50 Mbit/s, 1× and 4×, 13 interleaved rounds, n = 4–13 a cell,
27 456/27 456 frames exact, 6 864/6 864 bases equal to native dav1d's at operating point 1, none
late. **Every frame is on screen 0.13–0.15 s (fluoroscopy) and 0.33 s (ultrasound) after the fill's
issue at 1×, 0.33–0.36 s and 1.0–1.1 s at 4×, at every rate** — against 1.7–15.2 s and 3.2–29.4 s
for HTJ2K's exact series, a 5–101× lead on the fluoroscopy and 2.9–90× on the ultrasound, least at
4× on 50 Mbit/s; the first picture is 68–170 ms against HTJ2K's 280–1 117. **The bases cost 0.06 %
(fluoroscopy) and 0.35 % (ultrasound) of HTJ2K's bytes again, and the exact fill 0–8 % over the
same encoder's single-layer stream** (most at 50 Mbit/s and at 4×, where decode is the clock). What
the shape costs is not the layers but its one keyframe and lossless SVC's size: the series is one
group, decoded in order on one decoder, and the payload is 1.07 and 1.59 of HTJ2K's bytes, so the
exact series lands at 1.07–1.09× (fluoroscopy) and 1.59–1.60× (ultrasound) HTJ2K's time at 5 Mbit/s and 4.5× (fluoroscopy) and 7.4×
(ultrasound) at 4× on 50 Mbit/s — where intra AV1 is 1.8× and 2.3×. Container numbers, not a phone's;
not adopted (owner, 2026-10-04). A shape with a keyframe every 8 frames would decode across
decoders; not run.

*LCEVC as the preview's enhancement (row LCEVC; [`lab/av1/lcevc`](../../lab/av1/lcevc/README.md),
answered from the decoder's source, no trial).* MPEG-5 Part 2 has no lossless mode, but at step
width 1 its dequantisation is the identity and its residuals are added at 2^−f of a sample (f = 7,
5, 3, 1 at 8–14 bits), so an exact frame is reachable in principle at 8 and 10 bits with either
transform and at 12 bits with the 2×2 (256/256 offset classes; the 4×4 not proven, 36/36 patterns
tried reachable). **At 14 bits it is not**: 128 of 256 offset classes of a 2×2 block are
unreachable, and the decoder stops at 14, so the 13-bit CT and cone-beam cannot end exact. No trial
is possible: **no open LCEVC encoder exists**, the web decoder draws 8-bit RGBA through WebGL with no
samples back, and the decoder's BSD-3-Clause-Clear licence grants no patents ([`licensing.md`](licensing.md)).

## Total time (row TOTAL, [`lab/av1/total`](../../lab/av1/total/README.md))

The measure that decided against AV1 before, now with every form this queue made exact. Each arm
fills a whole series through the downloader against the real server behind the relay. The browser
is headless Chromium 141 at 1× and 4×, with three decoders. Links are fixed 5/20/50 Mbit/s and
row PROF's LTE trace and Wi-Fi steps, without their competing flow and outage. 14 rounds ran in a
Williams order (more where `VOID` drops left a cell short), n = 10–16 a cell, and 135 of 2 257
visits were dropped. **70 022/70 022 frames were exact against the source**; the 2 520 preview
frames matched native dav1d. Each HTJ2K cell gives the median seconds to every frame on the page.
Each AV1 cell gives the median of round-paired ratios to HTJ2K, at 1× · 4×. In brackets, each
arm's bytes over HTJ2K's:

| series | arm | 5 Mbit | 20 Mbit | 50 Mbit | LTE | Wi-Fi |
| --- | --- | --- | --- | --- | --- | --- |
| fluoroscopy 18 × 768², 12-bit | HTJ2K, s | 15.2 · 15.2 | 3.93 · 3.97 | 1.73 · 1.76 | 3.43 · 3.42 | 5.85 · 5.59 |
| | AV1 intra, dav1d (1.024) | 1.03 · 1.04 | 1.04 · 1.10 | 1.07 · 1.74 | 1.04 · 1.22 | 1.04 · 1.08 |
| | top11+low, dav1d (0.946) | **0.95 · 0.97** | **0.97** · 1.03 | 1.00 · 1.74 | 0.98 · 1.17 | **0.96** · 1.01 |
| | top10+low, WebCodecs (0.999) | 1.00 · 1.01 | 1.01 · 1.03 | 1.02 · 1.10 | 1.01 · 1.03 | 1.00 · 1.02 |
| | preview, lossy, G = 8 (0.008) | 0.03 · 0.08 | 0.11 · 0.29 | 0.26 · 0.64 | 0.14 · 0.35 | 0.08 · 0.21 |
| tomosynthesis 29 × 614×1359, 12-bit | HTJ2K, s | 23.7 · 23.7 | 6.05 · 6.10 | 2.58 · 2.63 | 4.96 · 4.92 | 10.1 · 9.44 |
| | AV1 intra, dav1d (1.043) | 1.05 · 1.05 | 1.05 · 1.09 | 1.07 · 1.78 | 1.04 · 1.15 | 1.02 · 1.09 |
| | top11+low, dav1d (0.942) | **0.95 · 0.96** | **0.95** · 0.99 | 0.97 · 1.77 | 0.97 · 1.09 | **0.95** · 0.98 |
| | top10+low, WebCodecs (0.990) | 0.99 · 0.99 | 0.99 · 1.00 | 1.00 · 1.13 | 1.00 · 1.01 | 0.98 · 0.99 |
| tomosynthesis 24 × 678×1727, 10-bit | HTJ2K, s | 22.3 · 22.4 | 5.72 · 5.79 | 2.45 · 2.52 | 4.73 · 4.80 | 9.39 · 8.84 |
| | AV1 intra, dav1d (0.977) | 0.98 · 0.99 | 0.99 · 1.03 | 1.01 · 1.78 | 0.99 · 1.13 | 0.96 · 1.05 |
| | AV1 intra, WebCodecs (0.977) | 0.98 · 0.99 | 0.99 · 1.01 | 1.00 · 1.36 | 0.99 · 1.02 | 0.98 · 1.01 |
| | one group, dav1d (0.971) | **0.97 · 0.98** | 0.98 · 1.79 | 1.13 · 4.10 | 0.99 · 2.18 | 0.98 · 1.24 |
| ultrasound 70 × 760×421, RGB 8 | HTJ2K, s | 29.4 · 29.5 | 7.49 · 7.52 | 3.15 · 3.19 | 5.81 · 5.80 | 12.5 · 13.2 |
| | AV1 intra, dav1d (1.117) | 1.12 · 1.12 | 1.12 · 1.14 | 1.13 · 2.22 | 1.11 · 1.35 | 1.10 · 1.13 |
| | AV1 intra, WebCodecs (1.117) | 1.12 · 1.12 | 1.12 · 1.13 | 1.12 · 1.38 | 1.11 · 1.12 | 1.14 · 1.13 |

* **Where the link is the clock, bytes decide.** At 1× and on every link at 5 Mbit, each arm's
  total follows its bytes. On the 12-bit series top11+low is 0–5 % under HTJ2K. The 10-bit
  tomosynthesis coded whole is within 1 % of it or up to 4 % under. The ultrasound
  loses 10–14 % everywhere, which is its bytes.
* **Where the CPU is the clock, HTJ2K wins.** At 4× on 50 Mbit every intra dav1d-WASM arm
  takes 1.74–2.22× HTJ2K's time, and WebCodecs takes 1.10–1.38×. At 4× on LTE dav1d-WASM takes
  1.09–1.35×. A whole series as one group puts it on one decoder. That group needs 10.3–10.8 s at
  4× on every link of 20 Mbit or more, against HTJ2K's 2.5–8.8 s.
* **The first frame is HTJ2K's on every cell**, by 55–160 ms at 1× and by 290–470 ms at 4× through
  dav1d-WASM. Through WebCodecs the gap is 5–70 ms at 1× and 70–210 ms at 4×.
* **The preview makes the fluoroscopy playable in 0.45 s at 1× and 1.1–1.2 s at 4× on any link**,
  against 1.7–15 s for every exact frame. Its first picture arrives in 0.11–0.29 s. At 4× the
  preview's own decode through dav1d-WASM is its clock. This arm fills the preview only, and the
  exact frames would follow it by its 0.8 % of the bytes (row PREVIEW).
* **Saturation.** At 4× on 50 Mbit, AV1's decode on the browser's three cores is the fill's clock;
  HTJ2K's is not on any cell. Nothing is claimed about a phone. The Wi-Fi cells spread ±20 %
  between rounds, because the trace's steps fall at a different point in each fill; the paired
  ratios still hold.

**Verdict per series.** On the 12-bit fluoroscopy and tomosynthesis, **top11+low wins at 1× on
every link (0.95–0.98)**, except a tie on the fluoroscopy at 50 Mbit. At 4× it wins on 5 Mbit
(0.96–0.97) and is within 3 % on 20 Mbit and Wi-Fi. HTJ2K wins at 4× on LTE and 50 Mbit. top10+low through WebCodecs never loses by more than 3 % short of 4× on 50 Mbit,
where it loses 10–13 %. On the 10-bit tomosynthesis, AV1 intra through WebCodecs ties or wins
everywhere but 4× on 50 Mbit (1.36). One group gains 1 % at 5 Mbit and loses up to 4.1× at 4×. **The RGB
ultrasound is HTJ2K's on every cell.** So the measure that decided before now splits by the
clock: AV1's lossless forms win by their bytes wherever the wire is slower than the decoder. They
lose wherever a slow CPU meets a fast link, and WebCodecs halves that loss.

*Replicated (the claim's holder, 2026-10-04):* a second container ran the same harness from scratch
for 10 rounds on SVCDEC's 623 146 B dav1d-WASM build: 1 441 of 1 600 visits kept, n = 5–10 a cell,
**51 200/51 200 frames exact**. Every verdict above holds. Wherever the wire is the clock, the
round-paired ratios match the table within 0.03 (Wi-Fi within 0.07). Wherever the CPU is the clock,
AV1's loss was smaller here: at 4× on 50 Mbit, dav1d-WASM intra took 1.40–1.75× HTJ2K's time
(table: 1.74–2.22), top11+low 1.45–1.46× (1.74–1.77), WebCodecs 1.17× (1.36–1.38) and top10+low
1.02–1.05× (1.10–1.13). At 4× on LTE dav1d-WASM took 1.03–1.13× (1.13–1.35), and one group took
7.7–7.9 s (10.3–10.8). The preview was playable in 0.34–0.39 s at 1× and 0.83–0.86 s at 4×. So a
decode-bound cell moves by 15–25 % between two containers and builds, and those were not
interleaved; only the ranking is claimed, not the size of the loss.

### Row LLSIZE's codings, by total time (row TOTAL2, [`lab/av1/total`](../../lab/av1/total/README.md))

The same harness on the fixed links (5/20/50 Mbit/s, 40 ms), 1× and 4×, the arms interleaved, with
row LLSIZE's best coding of each series: the two low bits apart on grey (`--tune-content=screen
--sb-size=64`; top 10 bits on the 12-bit series, 8 on the 10-bit one, so every stream is ≤ 10 bits)
through dav1d-WASM and through WebCodecs; on the ultrasound JPEG 2000's reversible colour transform,
intra through both and in groups of 8 through WebCodecs. 12 rounds and top-ups where `VOID` drops
left a cell short: 932 of 1 022 visits kept, n = 10–15 a cell, **38 744/38 744 frames exact**. The
client undoes the transform as `rct` (`adr-unit.md` §2, the dispatch arm checks it). Cells as in the
table above, in brackets bytes over HTJ2K's on the whole series:

| series | arm | 5 Mbit | 20 Mbit | 50 Mbit |
| --- | --- | --- | --- | --- |
| fluoroscopy, 12-bit | HTJ2K, s | 15.2 · 15.2 | 3.93 · 3.96 | 1.73 · 1.75 |
| | top10+low2, dav1d (0.943) | 0.95 · 0.96 | 0.96 · 1.01 | 0.99 · 1.43 |
| | top10+low2, WebCodecs (0.943) | **0.95 · 0.95** | **0.95 · 0.97** | **0.97** · 1.02 |
| tomosynthesis, 12-bit | HTJ2K, s | 23.7 · 23.7 | 6.05 · 6.09 | 2.58 · 2.61 |
| | top10+low2, dav1d (0.942) | 0.94 · 0.95 | 0.95 · 0.99 | 0.97 · 1.48 |
| | top10+low2, WebCodecs (0.942) | **0.94 · 0.95** | **0.95 · 0.96** | **0.96 · 0.99** |
| tomosynthesis, 10-bit | HTJ2K, s | 22.3 · 22.4 | 5.71 · 5.76 | 2.44 · 2.49 |
| | top8+low2, dav1d (0.944) | 0.95 · 0.96 | 0.96 · 1.00 | 0.98 · 1.62 |
| | top8+low2, WebCodecs (0.944) | **0.95 · 0.95** | **0.95 · 0.96** | **0.96 · 0.99** |
| ultrasound, RGB 8 | HTJ2K, s | 29.4 · 29.5 | 7.49 · 7.51 | 3.15 · 3.17 |
| | RCT intra, dav1d (0.958) | 0.96 · 0.96 | 0.96 · 0.98 | 0.97 · 1.43 |
| | RCT intra, WebCodecs (0.958) | 0.96 · 0.96 | 0.96 · 0.97 | 0.97 · 1.06 |
| | RCT G = 8, WebCodecs (0.948) | **0.95 · 0.95** | **0.95 · 0.97** | **0.96** · 1.16 |

* **AV1 through WebCodecs fills first on 22 of 24 cells** (series × link × CPU). Its two losses are both at 4× on
  50 Mbit: the fluoroscopy at 1.02 (slower in 12/12 rounds) and the ultrasound at 1.06 (RCT intra)
  and 1.16 (G = 8, its group on one decoder). It ties there on both tomosynthesis volumes (0.99,
  slower in 2–3 of 10). Elsewhere it is 3–6 % under HTJ2K, which is its bytes.
* **Through dav1d-WASM the same frames lose wherever the CPU is the clock:** 1.43–1.62 at 4× on
  50 Mbit, 0.98–1.01 at 4× on 20 Mbit. It wins at 1× on every link and at 4× on 5 Mbit.
* **The ultrasound turns over.** Row TOTAL found it HTJ2K's on every cell (1.11–1.14 at 1×). With
  the transform it is AV1's on every cell but 4× on 50 Mbit. Groups of 8 over all 70 frames are
  0.948 of HTJ2K's bytes, not row LLSIZE's 0.850 on its first 8, so they gain 1 % over intra and
  cost more than that at 4×.
* **First frame.** Through WebCodecs it is within −38 to +17 ms of HTJ2K's at 1× and 2–88 ms behind
  at 4×; through dav1d-WASM 37–104 ms behind at 1× and 210–409 ms at 4×.
* **Saturation** as in row TOTAL: at 4× on 50 Mbit the decode on three cores is the clock. Nothing
  is claimed about a phone or about the LTE and Wi-Fi profiles, which this row did not run.

**Verdict.** Against row TOTAL's ranking, where HTJ2K won every cell where the CPU was the clock and
every ultrasound cell, **row LLSIZE's codings through WebCodecs fill first on every series and every
cell measured but two, both at 4× on 50 Mbit, where the better of them loses by 2–6 %**. The split now opens
WebCodecs on the 12-bit series (top10+low2 at 0.943, against row TOTAL's top10+low3 at 0.999), so
the bytes and the faster decoder no longer trade. dav1d-WASM keeps the same bytes and keeps losing
40–60 % to HTJ2K where a slow CPU meets a fast link.

### The plain control and row ENCX's changes, by total time (row TOTAL3, [`lab/av1/total`](../../lab/av1/total/README.md))

The same harness and links as row TOTAL2, four arms a series: HTJ2K; [`item-format.md`](item-format.md)'s
**plain** representation (the samples direct, RGB as G, B, R; WebCodecs where ≤ 10 bits, else
dav1d-WASM); its **optimized** one as adopted (row TOTAL2's top+low2 and RCT through WebCodecs); and
the optimized one with row ENCX's changes, **x36** — the low bits packed and raw-deflated, inflated by
`DecompressionStream`, and k = 3 on the two series whose noise σ ≥ 17 (fluoroscopy, 12-bit
tomosynthesis; k = 2 on the 10-bit volume), the top through WebCodecs. x36 is decoded by a lab worker
merging through the product's `av1-frame.js`, not by the product. The ultrasound has no x36: row ENCX's
changes are the grey split's. Plain is libaom cpu0, not the format's fastest preset within 2 % of it.
13 rounds Williams-ordered, 1 026 of 1 170 visits kept (144 `VOID`, more in the later rounds and spread
evenly over the arms), n = 5–13 a cell, **38 532/38 532 frames exact**. Every fill ÷ HTJ2K's, the
median of round-paired ratios, 1× · 4×; in brackets bytes over HTJ2K's on the whole series:

| series | arm | 5 Mbit | 20 Mbit | 50 Mbit |
| --- | --- | --- | --- | --- |
| fluoroscopy, 12-bit | HTJ2K, s | 15.2 · 15.2 | 3.93 · 3.96 | 1.73 · 1.75 |
| | plain, dav1d (1.024) | 1.03 · 1.04 | 1.04 · 1.09 | 1.06 · 1.61 |
| | optimized (0.943) | 0.95 · 0.95 | 0.95 · 0.97 | 0.97 · 1.02 |
| | x36, k = 3 (0.938) | **0.94 · 0.94** | **0.95 · 0.96** | **0.96 · 1.00** |
| tomosynthesis, 12-bit | HTJ2K, s | 23.7 · 23.7 | 6.05 · 6.09 | 2.58 · 2.62 |
| | plain, dav1d (1.043) | 1.05 · 1.05 | 1.05 · 1.08 | 1.06 · 1.65 |
| | optimized (0.942) | 0.94 · 0.95 | 0.95 · 0.96 | 0.96 · 1.01 |
| | x36, k = 3 (0.940) | **0.94 · 0.94** | **0.95 · 0.95** | **0.96 · 0.98** |
| tomosynthesis, 10-bit | HTJ2K, s | 22.3 · 22.4 | 5.71 · 5.77 | 2.44 · 2.50 |
| | plain, WebCodecs (0.977) | 0.98 · 0.99 | 0.99 · 1.01 | 1.00 · 1.19 |
| | optimized (0.944) | **0.95 · 0.95** | **0.95 · 0.96** | **0.96** · 1.00 |
| | x36, k = 2 (0.948) | 0.95 · 0.95 | 0.96 · 0.97 | 0.96 · **0.99** |
| ultrasound, RGB 8 | HTJ2K, s | 29.4 · 29.5 | 7.49 · 7.52 | 3.15 · 3.17 |
| | plain, WebCodecs (1.117) | 1.12 · 1.12 | 1.12 · 1.13 | 1.12 · 1.27 |
| | optimized (0.958) | **0.96 · 0.96** | **0.96 · 0.97** | **0.97** · 1.03 |

* **x36 over the optimized representation, round-paired:** on the two k = 3 series 0.990–0.997 where
  the wire is the clock (its bytes, 0.5 % and 0.2 % fewer; faster in 95 of 97 pairs) and **0.969–0.972 at
  4× on 50 Mbit**, where the decode is (faster in 20 of 23). On the 10-bit volume, the deflate alone:
  1.003–1.006, slower in 46 of 49 pairs, from 0.4 % more bytes, and 0.971 at 4× on 50 Mbit.
* **So row ENCX's changes buy 3 % where a slow CPU meets a fast link and ±0.5 % elsewhere**: at 4× on
  50 Mbit they take the grey series from 1.00–1.02 of HTJ2K to 0.98–1.00 (the fluoroscopy a tie, slower in
  6 of 12), the one cell row TOTAL2 left HTJ2K's; on every other cell x36 is 0.94–0.97 of HTJ2K, as the
  optimized representation is.
* **The plain control loses on every cell but the 10-bit volume's.** At 12 bits it goes through
  dav1d-WASM: 1.03–1.09, and 1.61–1.65 at 4× on 50 Mbit. On the ultrasound, through WebCodecs,
  1.12–1.13, its bytes, and 1.27 at 4× on 50 Mbit. The 10-bit volume is the one series where plain AV1's
  bytes are under HTJ2K's: 0.98–0.99 at 5 Mbit, a tie at 50 Mbit, 1.19 at 4× on 50 Mbit. Over the control
  the optimized representation is 0.61–0.84 of its fill at 4× on 50 Mbit and 0.86–0.96 elsewhere.
* **First frame.** x36 is 6–38 ms ahead of the optimized representation on the k = 3 series and 0–15 ms
  behind on the 10-bit volume. Plain is 90–170 ms behind HTJ2K at 1× and 340–420 ms at 4× through
  dav1d-WASM, 28–152 ms through WebCodecs.
* **Saturation** as in row TOTAL2: at 4× on 50 Mbit three slowed cores are the clock. Nothing is claimed
  about a phone, or about the LTE and Wi-Fi profiles, which this row did not run.

**Verdict.** Against HTJ2K, lossless AV1 as it codes out of the box fills 3–13 % slower wherever the wire
is the clock and 27–65 % slower where a slow CPU meets a fast link; only the 10-bit volume, whose plain
bytes are under HTJ2K's, ties or wins on the wire (and loses 19 % there). The
adopted representation turns that into 3–6 % faster on every cell but 4× on 50 Mbit (1.00–1.03). **Row
ENCX's changes add 3 % at 4× on 50 Mbit and almost nothing elsewhere**: on grey they close that last cell
to 0.98–1.00, and k = 3 is worth its 0.2–0.5 % of bytes; the deflate alone, at k = 2, costs 0.4 % of
bytes where the wire is the clock.

### The order frames are asked in (row ORDER, [`lab/av1/total`](../../lab/av1/total/README.md))

Does asking the frames a reader needs first shorten the time to them without costing the fill? The order is
the client's, never the server's ([`../adr/reject-server-ordering.md`](../adr/reject-server-ordering.md)):
`prio` asks the useful frames with `requestExactFrame`, most needed first, then posts the same whole-series
fill as `seq`. **Useful**, per content: on tomosynthesis the centre slice and two either side (the slice a
reader starts on is this row's premise, not a measured reading pattern); on a four-view screening
mammogram the MLO pair — IHE's mammography display test hangs all four current views at once, MLOs on the
left (IHE MESA, Image Display Mammo, test 4000), so the first full hanging needs all four and no order
shortens it; the MLO pair is the left half of that hanging. Both tomosynthesis volumes and two mammograms
(`ffdm_c`, `ffdm_a`, stored R CC, L CC, R MLO, L MLO), HTJ2K and the adopted optimized item (k = 2,
WebCodecs), row TOTAL's links at 1× and 4×; 13 rounds Williams-ordered, 1 191 of 1 248 visits kept, n =
10–13 a cell but one at 9, **19 032/19 032 frames exact**. Time to the last useful frame on the page, s,
seq → prio (the median of round-paired ratios), 1× · 4×; the HTJ2K arm — AV1's ratio is within 0.05 of it
but at 4× on 50 Mbit, below:

| series | 5 Mbit | 20 Mbit | 50 Mbit |
| --- | --- | --- | --- |
| tomosynthesis 12-bit, 29 slices | 14.1 → 4.2 (×0.30) · ×0.30 | 3.65 → 1.19 (×0.33) · ×0.33 | 1.61 → 0.63 (×0.39) · ×0.41 |
| tomosynthesis 10-bit, 24 slices | 14.0 → 4.8 (×0.34) · ×0.34 | 3.64 → 1.32 (×0.36) · ×0.37 | 1.61 → 0.69 (×0.43) · ×0.44 |
| mammogram, 4 × 1914×2294 | 12.5 → 5.8 (×0.47) · ×0.47 | 3.27 → 1.62 (×0.50) · ×0.51 | 1.48 → 0.84 (×0.57) · ×0.61 |
| mammogram, 4 × 2560×3328 | 18.8 → 11.0 (×0.58) · ×0.59 | 4.89 → 2.93 (×0.60) · ×0.62 | 2.15 → 1.38 (×0.64) · ×0.68 |

* **The useful frames arrive in 0.30–0.68 of the time**, in every pair of every cell. The centre slice
  alone: 12.9 s → 0.95 s on the 12-bit volume at 5 Mbit. The gain is the share of the series in front of
  them: on the wire, the middle five of 24–29 slices or the last two of four views come at about their
  share of the bytes. It shrinks as the link speeds up, where the round trip and the decode are a larger
  part of the time; AV1's ratio is the larger at 4× on 50 Mbit (0.51–0.77), where its decode is the clock.
* **The full fill costs a constant two round trips.** On tomosynthesis +72–113 ms in every pair (+0.4 % at
  5 Mbit, +1.5 % at 20, +4 % at 50, both codecs): the fill waits until the last ask is in, then runs as two
  contiguous runs, below and above the asked slices, with a round trip between. On the mammograms one run:
  HTJ2K +13–72 ms (+0.2–4.5 %). AV1's larger mammogram filled *faster* with `prio` at 4× (0.935–0.985 of
  seq, faster in 32 of 36 pairs) and at 1× 0.990–0.999; the smaller one within ±1 %. Why is not
  established here.
* **Saturation** as in row TOTAL3: at 4× on 50 Mbit three slowed cores are the clock. Nothing is claimed
  about a phone, the LTE and Wi-Fi profiles, or a reader's real first slice.

**Verdict.** Asking the useful frames first brings them on screen in 0.30–0.43 of the sequential fill's time
on tomosynthesis (0.51–0.52 for AV1 at 4× on 50 Mbit) and 0.47–0.77 on a mammogram's MLO pair, for two round trips on the whole fill, on HTJ2K and
AV1 alike. It needs no change to the product, the wire or the server: it is the client's ask order, which the
downloader already serves first. Nothing adopted; the two round trips are the only cost a viewer pays, and
the next step is the viewer's, which frames it asks for.

### Under loss and jitter (row LOSSLINK, [`lab/av1/total`](../../lab/av1/total/README.md))

Row TOTAL's harness with the relay adding, on top of each link, **1, 2 or 5 % loss** each way (iid on
the fixed rates; on `lte-good` its bursts of 3.5 packets at that mean) or **±5 or ±20 ms of jitter** each
way, in sequence as one radio leg delivers — `link_impair.py` in userspace, as every row before; the
container has no `tc` (iproute2 is not installed). The 10-bit tomosynthesis volume, HTJ2K against the adopted
optimized item (top + two low bits, through WebCodecs; 0.944 of HTJ2K's bytes). **Fill and ask apart**, in
one visit: frames 0–3 filled (2.3 MB), then frames 4–7 asked one at a time once the fill is on the page,
each timed from the ask to its pixels (a frame ≈ 570 kB). The server's controller is its default,
`cubic-restart`. 15 rounds Williams-ordered (13 on the loss cells), 1 201 of 1 344 visits kept (143
`VOID`, 67 of them on `lte-good`), n = 8–15 a cell and arm, **10 752/10 752 frames exact**. HTJ2K's
fill in s, AV1 ÷ HTJ2K (median of round-paired ratios), and an ask's p50 / p95 in ms, all 1× · 4×:

| link | impairment | HTJ2K fill, s | AV1 ÷ HTJ2K | ask, HTJ2K | ask, AV1 |
| --- | --- | --- | --- | --- | --- |
| 5 Mbit | none | 3.78 · 3.84 | 0.95 · 0.97 | 988/1001 · 1035/1076 | 966/979 · 1098/1161 |
| | 1 % | 5.82 · 5.60 | 1.07 · 0.94 | 1785/2214 · 1784/2407 | 1636/2183 · 1728/2206 |
| | 2 % | 8.18 · 8.69 | 0.98 · 0.96 | 2426/3035 · 2453/3284 | 2262/2892 · 2396/2991 |
| | 5 % | 14.1 · 14.3 | 0.92 · 0.89 | 3719/4233 · 3764/4421 | 3474/4211 · 3584/4148 |
| | ±20 ms | 3.83 · 3.89 | 0.95 · 0.97 | 1002/1019 · 1051/1092 | 981/1002 · 1106/1140 |
| 20 Mbit | none | 1.12 · 1.14 | 0.95 · 1.07 | 292/304 · 345/383 | 310/327 · 439/491 |
| | 1 % | 5.16 · 4.35 | 1.03 · 0.94 | 1584/2086 · 1581/2023 | 1481/1988 · 1545/2064 |
| | 2 % | 7.51 · 7.83 | 0.97 · 0.95 | 2214/2717 · 2237/2733 | 2098/2671 · 2068/2722 |
| | 5 % | 12.8 · 12.8 | 0.94 · 0.96 | 3309/4065 · 3381/4380 | 3217/3787 · 3284/3920 |
| | ±20 ms | 1.18 · 1.24 | 0.99 · 1.09 | 316/383 · 365/409 | 328/354 · 462/508 |
| 50 Mbit | none | 0.62 · 0.68 | 1.02 · 1.21 | 153/166 · 204/245 | 177/196 · 314/361 |
| | 1 % | 4.04 · 4.08 | 0.94 · 0.93 | 1527/1986 · 1508/1892 | 1366/1839 · 1412/1893 |
| | 2 % | 7.70 · 7.91 | 0.99 · 0.97 | 2146/2704 · 2230/2762 | 2084/2677 · 2091/2512 |
| | 5 % | 12.4 · 12.6 | 0.96 · 0.97 | 3311/3867 · 3318/4003 | 3108/3781 · 3124/3757 |
| | ±20 ms | 0.78 · 0.84 | 1.03 · 1.21 | 172/197 · 224/272 | 200/221 · 321/360 |
| `lte-good` | none | 1.14 · 1.20 | 0.98 · 1.09 | 274/416 · 312/435 | 289/430 · 400/557 |
| | 1 %, bursts | 1.42 · 1.71 | 0.98 · 0.99 | 1016/1572 · 991/1531 | 882/1621 · 1076/1512 |
| | 2 %, bursts | 4.49 · 6.14 | 0.97 · 0.91 | 1473/3454 · 1412/2878 | 1437/8522 · 1565/2520 |
| | 5 %, bursts | 10.9 · 11.7 | 0.73 · 1.07 | 3146/14093 · 3252/9320 | 2875/8293 · 3187/15458 |
| | ±20 ms | 1.24 · 1.42 | 0.99 · 1.07 | 310/443 · 315/461 | 332/429 · 412/547 |

±5 ms is ±20 ms's row less: within 20 ms of no jitter on every fixed-rate fill (0.1 s on `lte-good` at 4×) and 7 ms on every ask's median.

* **Under loss the transport is the clock, not the codec.** 1 % turns a 0.62 s fill at 50 Mbit into
  4.0 s and an ask's 153 ms into 1.5 s; 5 % into 12.4 s and 3.3 s, 20–22× — and the link's rate stops
  mattering: at 5 % the fill takes 14.1, 12.8 and 12.4 s at 5, 20 and 50 Mbit. That is Cubic halving on
  loss that is not congestion, the slope [`transport-conclusions.md`](../transport/transport-conclusions.md)
  §1 (CC1) and §5 (ASKL) measured, here through the whole product with both codecs.
* **AV1 is its bytes under loss, and its decode cost is hidden.** On the loss cells the optimized item is
  0.89–0.99 of HTJ2K's fill on 20 of 24 cells and ahead on an ask's median at 1× by 36–271 ms on all 12
  (at 4× by 36–194 ms on the fixed rates, behind by 85–153 ms on bursty 1–2 %); the 4× decode penalty it pays
  where a slow CPU meets a fast clean link (1.07–1.26 at 20 and 50 Mbit, none and jitter) is gone under
  any loss (0.93–0.97). Two cells read over 1: 1 % at 1× on 5 and 20 Mbit, 1.07 and 1.03, slower in 7 of
  13 and 8 of 12 pairs — a tie in a spread where one loss event is a second; its 4× pairs read 0.94.
* **Bursty loss is a tail, not a median.** On `lte-good` the medians follow the fixed links' (fewer,
  longer loss events: 1 % costs a fill 0.3 s, not 2–4 s) but an ask's p95 reaches 8–15 s at 5 % on both
  codecs, and 8.5 s once at 2 %: a burst that takes a flight's tail waits out a probe timeout. Its 0.73 at 5 % (slower in 4 of
  11) is that tail, not the codec; at 4× it reads 1.07.
* **Jitter in sequence costs little**: ±20 ms adds 0.05–0.22 s to a fill and 3–36 ms to an ask's median; the
  codecs compare as with no jitter.
* **Saturation** as in row TOTAL: at 4× on 50 Mbit three slowed cores are the clock on the clean and
  jitter cells; under loss the wire is. Nothing is claimed about a phone or a radio's own loss process.

**Verdict.** On a lossy link HTJ2K against AV1 is decided by bytes: the adopted item is 0.89–0.99 of
HTJ2K's fill on 20 of 24 loss cells (the other four within one loss event's spread, above) and its 4× decode penalty
disappears, so loss only widens AV1's lead. What 1–5 % loss costs — 1.5–20× on a fill and 1.8–22× on an
ask, the more the faster the link — is the controller's, the same for both codecs. *Proposed, not
built:* the loss cells again with `--congestion bbr`, which the server already takes (CC1: 12–19× faster
under 1–3 % random loss in a browser) and which stays opt-in for its queue cost (transport-conclusions
§1); the harness would need only a server argument per arm.

### The split per depth (row SPLITTIME, [`lab/av1/splittime`](../../lab/av1/splittime/README.md))

Row TOTAL's harness on cpu0 items of eleven real series at every arm k, HTJ2K in each cell; 13–16 bits on all
five links (12 rounds, n = 10–12 a cell but one, 204 160/204 160 frames exact), 9–12 bits on the fixed links (10
rounds, n = 8–10, 42 600/42 600). Round-paired ratios to HTJ2K's time to every frame, 1× · 4×; the best arm per
series on every cell:

| b | series | best arm | 5 Mbit | 20 Mbit | 50 Mbit | LTE | Wi-Fi |
| --- | --- | --- | --- | --- | --- | --- | --- |
| 16 | mammogram | w10 (k6) | 1.02 · 1.03 | 1.06 · 1.09 | 1.13 · 1.16 | 1.08 · 1.11 | 1.04 · 1.06 |
| 15 | PET | w10 (k5) | 1.04 · 1.04 | 1.04 · 1.04 | 1.04 · 1.16 | 1.04 · 1.04 | 1.06 · 1.03 |
| 14 | projections, system 1 | k3 | 0.95 · 0.98 | 0.98 · 1.10 | 1.04 · 1.66 | 0.94 · 1.08 | 0.97 · 1.06 |
| 14 | projections, system 2 | k2 | 0.93 · 0.95 | 0.95 · 1.02 | 0.98 · 1.53 | 0.95 · 1.04 | 0.92 · 0.98 |
| 13 | CT | k3 = w10 | 0.93 · 0.93 | 0.93 · 0.94 | 0.94 · 0.95 | 0.95 · 0.96 | 0.97 · 0.93 |
| 13 | cone-beam | k3 = w10 | 0.95 · 0.95 | 0.95 · 0.96 | 0.96 · 0.97 | 0.96 · 0.98 | 0.96 · 0.91 |
| 12 | fluoroscopy | k3 | 0.94 · 0.95 | 0.95 · 0.97 | 0.96 · 1.01 | | |
| 12 | tomosynthesis 12-bit | k3 | 0.94 · 0.94 | 0.94 · 0.95 | 0.95 · 0.97 | | |
| 11 | MR | k2 | 0.99 · 0.99 | 0.99 · 0.99 | 0.99 · 1.01 | | |
| 10 | tomosynthesis 10-bit | k2 | 0.95 · 0.95 | 0.95 · 0.96 | 0.96 · 0.99 | | |
| 9 | MR, 9 bits | k0 | 0.93 · 0.95 | 0.94 · 0.95 | 0.98 · 1.01 | | |

**Verdict, SPLITTIME:** k = 0 at 9 bits, k = 2 at 10–12 and 14, k = 3 at 13, and HTJ2K at 15 and 16 bits and
wherever a slow CPU meets 20 Mbit or more at 14. At 12 bits k = 3 is ahead by ≤ 0.02, inside one rounding of
k = 2's, so the adopted k = 2 stays there. The 14-bit cells HTJ2K wins are the ones where dav1d-WASM's decode of the
12-bit top is the fill's clock (row MIXDEC's mixed decode, not measured here, takes the low stream off it). Every
table, the decode and the bytes per preset: [`lab/av1/splittime`](../../lab/av1/splittime/README.md).

## Threads (owner, 2026-10-03)

**Focus: AV1 alone**, not combined with HTJ2K — that is what the coming real-time stack is expected to
use, and where the learning is. Active threads are queue rows 24–29 ([`queue.md`](queue.md)).

**Parked, kept for the decision later** — every result stays in its row and in §A1–A5:

* **A lossy AV1 preview plus an HTJ2K residual** (row 17): the exact frame at 0.947–1.002 of HTJ2K
  alone, the preview costing nothing in bytes; decode 1.3–1.9× HTJ2K through WebCodecs.
* **A separate lossy AV1 preview, then exact HTJ2K** (row 12): playable 14–124× sooner on 5 Mbit/s
  (arithmetic over measured bytes and decode), +0.8–7 % bytes.
* **Embedded intra codecs** (row 22): JPEG 2000 quality layers (preview inside the exact payload,
  0.93–0.96 of HTJ2K's bytes, exact decode 6–12× slower); progressive lossless JPEG XL.
* **LCEVC** (row 19): closed until an open encoder exists and the decoder returns samples; cannot end
  exact at 14 bits.

## Options to try (row SWEEP, 2026-10-03)

Read from primary sources, nothing run: the AV1 spec (`AOMediaCodec/av1-spec` `5e04f3f`), dav1d
1.5.4's source, libaom 3.15.1's, Chromium (`d84e3b8`), WebKit (`10740b3`), Android's framework
(`1cdfff5`), AV2's reference software AVM (`v1.0.0`). Options rows 24–28 already hold — palette,
intra block copy, tiles, dav1d-WASM threads, the base operating point in dav1d-WASM, the order of
layers on the wire — are not repeated.

**Worth a row** (queue rows 30–32):

* **WebCodecs' `optimizeForLatency`.** Chromium maps it to dav1d's `max_frame_delay = 1`; without
  it dav1d buffers up to ⌈√threads⌉ frames, Chromium's own comment says two before the first is out
  (`media/filters/dav1d_video_decoder.cc`). That is WCAP's "holds 2 frames until `flush()`", and
  `decode-av1-webcodecs.js` sets neither it nor anything but `prefer-software`, so it flushes every
  unit — which is why WebCodecs has no G > 1 path (row 20). Chromium also gives dav1d 2–4 tile
  threads by coded height (≥ 300, ≥ 700 rows), used only if a frame has tiles. Decides: frames out
  per unit without a flush, exact, and the time against today's flush per unit. Container: yes.
  *Measured (row WCLAT): yes, every unit, exact, 784/784 frames; 7–28 % faster a frame without the
  flush; a group now goes through WebCodecs ([`decode/README.md`](../decode/README.md) §WebCodecs
  without a flush).*
* **The base operating point through WebCodecs.** WebCodecs has no operating-point field (its AV1
  registration defines none) and Chromium opens dav1d with `all_layers = 0` at operating point 0, the
  whole stream. But each OBU's extension header carries its `spatial_id`, and dav1d at
  `all_layers = 0` outputs the highest layer it holds when the temporal unit ends or on a drain
  (`src/lib.c`, `output_picture_ready`). So a client that drops the top's OBUs should get the base
  out of a native decoder 2–3× faster than dav1d-WASM (SPLIT10). Decides: the base out, identical to
  native dav1d's at the base operating point, then the whole unit exact. Container: yes.
  *Measured (row WCBASE, §A5): exact, and 0.36–0.76× dav1d-WASM's base at 4×; slower on small grey
  bases at 1×.*
* **AV2.** AVM v1.0.0 was tagged 2026-05-27 (BSD-3-Clause-Clear) and the specification announced
  2026-06-09. Its encoder has `--lossless`, `--monochrome`, 10/12-bit coding, 1–16 operating-point
  sets and S-frames; better lossless coding is claimed in reports of the release, *not confirmed
  here* (the specification's and AOMedia's hosts are refused by this container). No browser decoder
  exists. Decides: lossless bytes against libaom 3.15.1 and HTJ2K on the same series, exact, and the
  reference decoder's time. Container: yes, natively.
  *Measured since (row AV2, [`lab/av1`](../../lab/av1/README.md) §AV2), one middle frame a series:*
  AV2 has no profile over 10 bits, so it codes 11–14-bit samples split. On grey up to 13 bits but
  CT it is the smallest coding here, 0.937–0.964 of HTJ2K and 0.4–4.7 % under libaom on the same
  planes; libaom's 12-bit split stays 3–8 % smaller on CT and the 14-bit projections. The RGB
  ultrasound is 1.648 of HTJ2K against libaom's 1.117. Encoding takes 50–110× libaom's time
  (450–11 900 s a frame), native decoding 3.1–6.5× dav1d's. All 68 cells are exact.

**Not worth a row, and why:**

* **S-frames** overwrite every reference and are meant to be decoded on *another* stream's
  references (spec, *Switch Frame*). A lossless residual is against the encoder's own prediction, so
  a frame decoded on other references is not exact. No exact switch from a lossy stream.
* **Super-resolution.** The spec's `AllLossless` needs `FrameWidth == UpscaledWidth`; with upscaling
  a frame is lossless only at its coded width, and loop restoration runs. libaom 3.15.1 turns
  super-resolution off under `--lossless`.
* **Large-scale tile** (spec Annex D) serves camera arrays rendered from uncompressed anchor frames;
  libaom writes it to IVF only and dav1d 1.5.4 does not decode it. A lossless frame's tiles already
  decode independently — every in-loop filter is off — which is row 27's lever.
* **Reference scaling** (a reference between ½ and 16× the frame's size) is what the scalable
  encoder's spatial layers already use (rows 15, 18, 25).
* **dav1d's `decode_frame_type`** (keyframes or intra frames only) and intra-only frames help a
  scrub only at G > 1, which no series' bytes justify (§A1); an intra-only frame is not a random
  access point (only a key frame resets the references).
* **WebCodecs' AV1 encoder** takes a per-frame quantizer 0–255 in the browser: not this path.
* **The order of layers on the wire** needs no AV1 parsing beyond the OBU header's `spatial_id`;
  that is row 26's input, not a row.

**Phones — blocked on devices** ([`queue.md`](queue.md) §Blocked). From source, not run: Android's
public codec API names AV1 Main profiles only (8 and 10 bits; no High, so no 4:4:4 RGB, no
Professional, so no 12-bit), and a handheld's performance class guarantees a hardware Main 10 decoder
at level 4.1, whose 2 359 296-sample picture limit is under both tomosynthesis projection sets (4.9 and
2.6 M samples need level 5.0). WebKit's in-process WebCodecs AV1 decoder is dav1d behind a wrapper
that refuses anything but 8-bit 4:2:0 — so 4:0:0 and 10 bits fail there — unless the GPU process
substitutes a hardware one, which was not traced. Whether a hardware decoder's read-back is exact is
per platform (§A2). The client asks for `prefer-software`, so Chromium on a phone should run dav1d, as
here; not checked on one.

## Prior evidence, not reproduced here

An earlier private proof of concept measured parts of this. Its numbers are **not measured in this
repository** and are recorded only so the queue tests them rather than rediscovers them:

* **Size is content-dependent, not a given win.** Exact bytes over raw on public series: one 8-bit RGB
  ultrasound clip, HTJ2K 768 KB against AV1 inter (G = 5) 1 082 KB and intra 1 693 KB; a 12-bit CT
  stack of 24, HTJ2K 4.78 MB against AV1 intra 4.79 and inter 4.95; the median over 73 series,
  HTJ2K 0.138, AV1 intra 0.124, AV1 inter 0.106 (lossless JPEG XL 0.090, for reference).
  *Not reproduced here (SIZE)*: on the three real series AV1 lossless coded whole, intra or inter,
  is 2–53 % larger than HTJ2K at libaom's slowest preset (§A1) — split (§A3), 1–8 % smaller on the
  series over 10 bits; the settings and series behind those medians are not known here.
* **libaom's lossless mode was not always lossless.** With libaom 3.8.2, inter-coded 10- and 12-bit
  grey came back wrong on P-frames (up to 38 of 6.3 M samples, |Δ| ≤ 11), the same from two
  independent decoders — so the encoder, not a decoder. Intra-only was exact up to 12 bits; 3.14.1
  passed its own lossless cases, but the failing grey clips were never re-run on it.
  *Reproduced here* with the same 3.8.2 through ffmpeg: inter (G = 8) 10- and 12-bit grey and 12-bit
  4:4:4 inexact (up to 15 904 of 1 M samples, |Δ| ≤ 11), three decoders agreeing — [`lab/av1/dav1d-wasm`](../../lab/av1/dav1d-wasm/README.md). 3.15.1
  has it too, and `--auto-alt-ref=0` cures both (§Measured here).
* **WebCodecs on Chromium returned no frames from lossless streams** (Main 4:2:0 and High 4:4:4,
  8-bit), with `isConfigSupported` answering true; whether that was the probe's packaging was not
  settled. *Not reproduced here (WCAP):* both cells decode exactly in Chromium 141. Lossless is not
  the cause; the decoder holds two frames until `flush()`, so one chunk unflushed returns nothing.
  *Corrected 2026-10-03:* this file first called that "consistent with that probe"; the probe did
  call `flush()` after every chunk of a 15-frame clip, so a missing flush does not explain it, and
  why it returned nothing is **unexplained**.
* **dav1d in WASM decoded an 8-bit 4:4:4 clip exactly** in a browser over WebTransport (dav1d 1.5.0,
  no SIMD, one thread). Nothing above 8 bits or 4:0:0 was decoded in WASM, and no WASM decode time
  was taken.
  *Superseded here*: 8/10/12-bit, 4:0:0 and 4:4:4, SIMD and threads, exact (§A2).
* **Decode cost is the risk to watch**: on a desktop, through a subprocess (pessimistic), AV1 took
  12–14 ms a frame against HTJ2K's 1.2. The fill here is decoder-bound, so a slower decoder costs
  the fill directly, whatever it saves on the wire.
  *Reproduced here in size (SPEED)*: dav1d-WASM 5.4–9.7× OpenJPH a frame in the product's
  worker, WebCodecs 4.1–4.2× (§A2).
* **Lossless AV1 about 31 % below HTJ2K on 10-bit data.** *Corrected 2026-10-07 (POCGAP):* a median over
  unpaired fixtures — the owner's local reproduction found four 10-bit fixtures coded only in HTJ2K, and paired
  fixture by fixture AV1 ÷ HTJ2K was 0.961 there (not measured here). *Measured here*, the first 4 frames of the
  two CC BY 10-bit DBT series paired, every frame exact: plain AV1 **0.976 and 0.973**, optimized
  (`low2.screen-sb64`) **0.940 and 0.943** — a 2–6 % gain, not 31 %. Each setting the gap could hide in, moved
  alone: an 8-bit copy (v ≫ 2) favours AV1 by 3.1–3.5 points, keeping the background (uncropped) by 0.5–0.8,
  libaom 3.8.2 against 3.15.1 at cpu6 by 0.5–0.7, `--threads=4` against 1 by 0.02–0.06 % a frame (so
  `--threads=1` is pinned). A ratio is compared only fixture for fixture, a median only over paired fixtures.
  The two further series the row named are not CC BY or CC0 (queue §Blocked) —
  [`lab/av1/pocgap`](../../lab/av1/pocgap/README.md).
* Signed CT there spanned −1024..2461, which fits 12 bits after a +1024 offset; it was not tried.

## Measured here

**Encoders (row TOOL, synthetic frames; [`lab/av1/README.md`](../../lab/av1/README.md)).** The
libaom fault above reproduces, and **3.15.1 has it too**: with default settings, inter-coded grey
at 10 and 12 bits came back wrong on 1–8 of 16 frames (|Δ| ≤ 2 at 10 bits, ≤ 11 at 12), never on a
keyframe, identically from dav1d and aomdec. It goes with the alt-ref frames: with
`--auto-alt-ref=0` every cell — grey 8/10/12 as 4:0:0 and RGB 8 as 4:4:4, intra and inter, both
versions, two presets — is exact. libaom 3.15.1 is pinned. SVT-AV1 v4.2.0 codes 4:2:0 at 8 and 10
bits only, and its 10-bit inter stays inexact under every setting tried; rav1e 0.7.1 has no lossless
mode. 12-bit 4:4:4 behaves alike on 3.8.2; 3.15.1's `aomenc` cannot encode it at all. Every SIZE
encode of row DATA's series re-checks exactness on real content.

**Encode cost (row ENC; [`lab/av1/README.md`](../../lab/av1/README.md) §ENC).** libaom 3.15.1
lossless on one uncontended container core: the slowest preset takes 3.0–11.1 s a frame; the fastest
intra preset within 2 % of its bytes 0.35–1.6 s (0.6–2.9 frames/s) on six sets and the slowest itself
on the RGB ultrasound (7.2 s). 30 frames/s of 512² lossless is reached only at `--allintra` 9, on MR
and CT, costing 5–19 % in bytes and landing above HTJ2K's; `ojph_compress` encodes 58–136 frames/s
into fewer bytes. Real-time inter (`--rt`, no alt-ref) is exact at 10–13 bits, and on the 10-bit
tomosynthesis it is the smallest AV1 coding, 0.94 of HTJ2K at 5.5–9.6 frames/s.

**The real-time scalable encoder (row SVC; [`lab/av1/svc`](../../lab/av1/svc/README.md)).**
libaom 3.15.1's `svc_encoder_rtc` at quantizer 0 (`--min-q=0 --max-q=0`, no hook needed) is
**exact in every cell it can encode**: grey 4:0:0 and RGB 4:4:4 at 8, 10 and 12 bits, L1T1 to L3T3
(scaled and full-size spatial layers), speeds 7 and 10, on synthetic frames and on the fluoroscopy,
MR and ultrasound series — 418 layers, 10 436 frames, each operating point decoded alone by dav1d.
The stock example encodes 8- and 10-bit 4:2:0 only; 12-bit, 4:4:4 and 4:0:0 need a patch to its
command line (the library unchanged), kept in the lab. A downscaled layer has no truth outside the
encoder and is not compared. Lossless here costs 1.07–1.58 of HTJ2K's bytes at L1T1.

**Newer tools (row VERSIONS; [`lab/av1/versions`](../../lab/av1/versions/README.md)), read 2026-10-07.** No
libaom, SVT-AV1 or dav1d release followed our pins (3.15.1, v4.2.0, 1.5.4). **libaom's head (`4cea455c`) writes
the same bytes as 3.15.1** on all 22 breast and control cells, cpu0 and the shipped preset (80/80 items
identical, every one exact). dav1d's head and emscripten 6.0.11 tie on dav1d-WASM decode (pooled 0.98–1.01,
Chromium 141 and 154, 1× and 4×). OpenJPH under emscripten 6.0.11 is 0.94–0.96 of 3.1.74's time pooled, inside
this harness's spread at 6 rounds; not adopted. OpenJPH 0.32.0 fixes a WASM decoder mask that breaks 24-bit
reversible code-blocks; ≤ 16-bit data cannot reach it (deep-bit-plane frames exact on both, 12/12). Chromium 154
still refuses 12-bit AV1 in WebCodecs, now read from its source: its key-frame check parses with a libgav1 built
for 10 bits. 8 640/8 640 frames exact. Nothing adopted, no pin changed.

**JPEG XL (row JXL, [`lab/av1/jxl`](../../lab/av1/jxl/README.md); [`decode/README.md`](../decode/README.md) §JPEG
XL).** libjxl 0.12.0 is exact at every effort 1–7 and `--faster_decoding` 0–4 from 8 to 16 bits. No setting is both
smaller and as fast as HTJ2K: e1 is 0.94–1.03 of the bytes at 1.03–1.91× OpenJPH's decode in WASM, e7 f3 0.91–0.98 at
1.56–2.45×, the default 0.81–0.96 at 5.35–10.0× (0.53 on a 16-bit film scan). Native decoding (Chromium 154 behind a
flag, Firefox 157 behind a pref, none in WebKitGTK) returns 8-bit samples only, exact on 8-bit grey and RGB. Not
adopted.

## Decided

* **Bit-exact or nothing**: a codec, depth or decoder path that does not round-trip exactly is not
  used for that series. Ground truth is the encoder's input, never a decoder under test (as for
  HTJ2K, [`decode/README.md`](../decode/README.md) §Ground truth).
* **The codec belongs to the series**, carried in its metadata; the envelope stays opaque.
* **AV1 frames are this project's own format**: DICOM defines no AV1 transfer syntax, and the store
  is not DICOM ([`licensing.md`](licensing.md) §DICOM).
* **Everything here is MIT-compatible open source** ([`licensing.md`](licensing.md)); no code from
  any other viewer or private project enters this repository.
