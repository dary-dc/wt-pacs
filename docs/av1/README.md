# AV1 — a second lossless codec beside HTJ2K

The phase's goal: a study can be served as lossless AV1 as well as lossless HTJ2K, the codec chosen
per series, and **every frame on screen is bit-exact with the source**, whichever codec carried it.
This file owns the phase: what is decided, what is open and the measurement that decides each. The
work itself is queued in [`queue.md`](queue.md); licences are in [`licensing.md`](licensing.md).

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

*Measured (SIZE, libaom 3.15.1, every coding exact; [`lab/av1`](../../lab/av1/README.md) §SIZE):*
**inter coding does not pay on any real series here**, and coded whole, AV1 does not beat HTJ2K —
*corrected by DEPTH (§A3): coded as two streams, the two low bits apart, it does on every series
over 10 bits, 0.918–0.997*. Bytes over
HTJ2K's at the slowest preset, intra → whole series: fluoroscopy (12-bit, 2 frames/s) 1.024 → 1.027,
MR (11-bit, 3.5 mm) 1.034 → 1.062, ultrasound cine (RGB 8) 1.117 → 1.534; at a practical preset
1.04–1.75. The smallest G that collects most of the gain is **G = 1**: there is no gain to collect
(fluoroscopy's best group, G = 2, is 0.04 % under intra). Lossless JPEG XL, for reference, is
0.83–0.93 of HTJ2K. CT and the cone-beam set need 13 bits — row DEPTH. Bytes therefore give G > 1
no reason; the content measured is three series, none of them a contrast angiography run.
*Tomosynthesis since (row CONTENT, [`lab/av1`](../../lab/av1/README.md) §SIZE): inter still does
not pay.* Two reconstructed volumes, 1 mm slices — the content where neighbours share most: the best
group is 1.2 % larger than intra on the 12-bit volume and 0.6 % smaller on the 10-bit one (1.8 % at
cpu6), against the fifth `adr-unit.md` §4 asks. Coded whole, AV1 is 1.043 of HTJ2K on the 12-bit
volume and **0.977 on the 10-bit one — the first series where AV1 coded whole is smaller**; split
top11+low, 0.943 and 0.946. Still no contrast angiography run: none is open.
*Tomosynthesis projections since (row TAXO, [`lab/av1`](../../lab/av1/README.md) §SIZE): inter
does not pay there either.* The raw views of two vendors' systems, 9 and 15 a series, 14 bits
stored: on top11+low the best group is 0.3 % under intra on one and 0.2–0.8 % over it on the other.
Split top12+low they are 0.952 and 0.923 of HTJ2K (§A3). No breast ultrasound cine, automated breast
ultrasound or angiography run is reachable ([`queue.md`](queue.md) §Blocked).

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
WebCodecs 2.6–3.9×.

**A3 — samples above 12 bits, and signed samples.** AV1 codes at most 12 bits a sample and only
unsigned. Signed data is offset by 2^(B−1), which is reversible; data over 12 bits (stored 16-bit)
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
n = 15 interleaved). `decode-av1.js` opens dav1d with `all_layers` 1, which returns the base and then
fails on such a payload; WebCodecs returns the top exactly but cannot be asked for the base, only
fed its units. Row RESID's preview plus HTJ2K residual (0.947–1.002 of HTJ2K's bytes, 1.31–1.89× its
decode) beats it on both.

*LCEVC as the preview's enhancement (row LCEVC; [`lab/av1/lcevc`](../../lab/av1/lcevc/README.md),
answered from the decoder's source, no trial).* MPEG-5 Part 2 has no lossless mode, but at step
width 1 its dequantisation is the identity and its residuals are added at 2^−f of a sample (f = 7,
5, 3, 1 at 8–14 bits), so an exact frame is reachable in principle at 8 and 10 bits with either
transform and at 12 bits with the 2×2 (256/256 offset classes; the 4×4 not proven, 36/36 patterns
tried reachable). **At 14 bits it is not**: 128 of 256 offset classes of a 2×2 block are
unreachable, and the decoder stops at 14, so the 13-bit CT and cone-beam cannot end exact. No trial
is possible: **no open LCEVC encoder exists**, the web decoder draws 8-bit RGBA through WebGL with no
samples back, and the decoder's BSD-3-Clause-Clear licence grants no patents ([`licensing.md`](licensing.md)).

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

## Decided

* **Bit-exact or nothing**: a codec, depth or decoder path that does not round-trip exactly is not
  used for that series. Ground truth is the encoder's input, never a decoder under test (as for
  HTJ2K, [`decode/README.md`](../decode/README.md) §Ground truth).
* **The codec belongs to the series**, carried in its metadata; the envelope stays opaque.
* **AV1 frames are this project's own format**: DICOM defines no AV1 transfer syntax, and the store
  is not DICOM ([`licensing.md`](licensing.md) §DICOM).
* **Everything here is MIT-compatible open source** ([`licensing.md`](licensing.md)); no code from
  any other viewer or private project enters this repository.
