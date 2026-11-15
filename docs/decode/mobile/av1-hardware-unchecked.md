# AV1 in hardware, unchecked, on a phone's browser

*Queue row MOBILE-OPT-AV1-HW-UNCHECKED, 2026-11-15, option 2 of MOBILE-DECODE-OPTIONS' brief
(`claude/work-ledger:docs/queue-client-2026-11-14.md`, amendments 19 and 20), with the owner's question in full: "is
window level, zooming, panning, and other transformations even possible or functional in the path 2?" Worked out as
its advocate, then its disadvantages. Theory and sources; nothing run on a device, a GPU or a coder. Every choice
stays the owner's.*

Labels, as [`new-options.md`](new-options.md): **(S)** a source quoted verbatim, listed in §10 with its revision;
**(R)** a result of this repository, by its file; **(D)** derived here, the arithmetic written out; **(T)** theory,
not measured. Fixtures behind every (R): three timed DBT volumes of one dataset (`dbts_a1`, `dbts_b1`, `dbts_c1`),
19 DBT volumes for bytes and noise; no ultrasound cine; 4-core cloud hosts without a GPU, headless Chromium,
software decode; one Android 16 phone (Chrome 157), one home link, one evening.

## 1. What it shows

* **Yes: every transform the owner names works on this path, at 8 bits.** Zoom, pan, rotate, flip and invert are
  geometry or a table on a texture and lose nothing (§3.1). Window/level works too: a 256-entry table over the
  8-bit picture, rebuilt for each window, exact for whatever window the reader sets (§3.2). What the path loses is
  precision, not the tools.
* **What 8 bits costs at the readers' windows** (§3.2, D): one input step is 4.01 view codes, so at `dbts_b1`'s header
  window (512) a step is 2.0 display levels where the 10-bit view gives 0.5. On the 12-bit volumes (550–1093 source
  units) a step is 3.7–7.4 levels where today's view gives 0.93–1.85. At a narrow window of 100 source units on a
  12-bit volume, 6 grey levels are left.
* **The 8-bit rounding happens after the decode, so the quantizer cannot absorb it** (§3.2, D): at today's Q the
  picture on screen exceeds the noise rule's bar, worst frame e_N/σ 1.02–1.05 on the 10-bit volumes and 1.05–1.09
  on the 12-bit ones. Meeting the bar on screen takes a lower Q, at a byte cost nobody has computed.
* **The range must be signalled full** (§3.3). With neutral chroma every matrix gives R = G = B, a function of luma
  alone, monotonic in theory. A studio-range stream would clip a 10-bit series' samples below 64 and above 940.
  WebCodecs lets the page set the colour space against the stream's: "If colorSpace exists, the provided values will
  override any in-band values from the bitsream." Whether Android's conversion obeys it is a device fact.
* **The pixel value is reported as an interval** (§3.4): ±2.0 source units on a 10-bit series, ±8.0 on a 12-bit
  one, with the coding error on top. Distances and angles are unchanged; an ROI's standard deviation is inflated.
* **Frames must be copied out and closed at once** (§4). Chromium's Android image reader holds 2, 3 or 5 images.
  The store holds `R8` textures: `dbts_b1` whole is 406 MiB, against 812.5 MiB as today's 16-bit samples. The
  client cache gets no checked samples from this path.
* **Whether the phone can run this path at all is not known** (§5). The Galaxy S23's own brief lists no AV1. No phone
  vendor document read here lists 4:0:0, Main 10 or a maximum size. `dbts_b1` (2560 × 3328) needs level 5.0 and is
  taller than 4K UHD's 2160.
* **Its best version, theory** (§6): today's 10-bit view coded as 4:2:0 with constant chroma at full range, one
  stream for both paths. Hardware paints while the reader moves, at 8 bits and unchecked. The frame the reader
  stops on is decoded again in software and checked, and the exact frame stays one press away. Checking the coded
  bytes before the decode leaves only the decoder and its conversion unchecked.

## 2. The route

**Decode.** WebCodecs `VideoDecoder` with `hardwareAcceleration: "prefer-hardware"`. On Chrome Android that is
MediaCodec or nothing (R, `hardware.md` §12 on `claude/hw-decode`, Chromium 157 `video_decoder_broker.cc:200–216`).
A conformant decoder's output equals the software decoder's: "When film_grain_params_present is equal to 0, decoders
shall produce output frames that are identical in all respects and have the same output order as those produced by
the decoding process specified herein." (S1, §7.2). So before conversion, the hardware decoder's samples are the
view's samples, in theory. Nothing on this path shows the page whether they were.

**The frame as the page gets it.** On Android, Chromium wraps every MediaCodec output as `ABGR` behind an external
sampler. It reads MediaCodec through an `AImageReader` of `AIMAGE_FORMAT_PRIVATE`, which has no planes (R,
`hardware.md` §12; `hardware-10bit.md` §7 on `claude/hw10-routes`). So the frame reaches a shader as RGB, 8 bits a
channel, after the device's YUV-to-RGB conversion. Its samples never reach it.

**The paint, two APIs** (each takes a `VideoFrame`):

| | WebGL2 | WebGPU |
| --- | --- | --- |
| call | `texImage2D(…, VideoFrame)`: "source of type HTMLVideoElement or VideoFrame [WEBCODECS] The width and height of the texture are set to the width and height of the uploaded frame of the video in pixels." (S3) | `importExternalTexture({source: VideoFrame})`, or `copyExternalImageToTexture` into a texture the page owns (S4, §6.4, §19.2) |
| into one channel | yes: WebGL 2.0's conversion table, "Color (3 channels) … RED … R = sourceRed", and `R8 RED UNSIGNED_BYTE` is a listed combination (S3, WebGL 2.0 `texImage2D`) | yes: the destination "must be a plain color format supporting RENDER_ATTACHMENT and be a unorm/unorm-srgb or float/ufloat format" (S4, §19.2 `copyExternalImageToTexture`), which admits `r8unorm` |
| what a shader reads | 8 bits a channel on every path traced (R, `hardware-10bit.md` §6) | 8 bits: "High bit depth formats should also use F16, but do not yet." (R, `hardware-10bit.md` §5.1, Chromium 157 `external_texture_helper.cc:400–401`) |
| the conversion | "The precise conversions may be specific to both the browser and file type." (R, `hardware.md` §18.2 a, WebGL 1.0 §Pixel Storage Parameters) | "The configuration used internally by an implementation may be inconsistent across time, systems, user agents, media sources, or even frames within a single video source" (R, `hardware.md` §18.2 a, WebGPU §6.4) |

## 3. The owner's question: what each transform needs and keeps

| transform | what it needs | on this path |
| --- | --- | --- |
| zoom | texture coordinates and a filter, nearest or linear | **works, nothing lost** (§3.1) |
| pan | texture coordinates | **works, nothing lost** |
| rotate 90°/180°, flip | texture coordinates; `copyExternalImageToTexture` also has `flipY` (S4) | **works, nothing lost** |
| invert | `255 − v`, or the window table read backwards | **works, nothing lost** |
| window/level | a table from the input value to a display level | **works, at 8 bits of input** (§3.2) |
| the colour the browser applies | range, matrix, transfer | **must be pinned: full range, or samples clip** (§3.3) |
| pixel value readout | the sample at a point | **an interval, not a value** (§3.4) |
| measurements (distance, angle, ROI) | geometry and the pixel spacing; ROI statistics over samples | geometry works; **ROI statistics are biased** (§3.4) |

### 3.1 Geometry: zoom, pan, rotate, flip, invert

All five read the same texels and change only where or how they are drawn (D). Two notes:

* **Sampling an external texture directly** leaves the order of filter and conversion to the browser: "It is
  implementation-dependent whether, for any given external texture, the sampler (and filtering) is applied before or
  after conversion" (R, `hardware.md` §18.2 a, WebGPU §6.5). For grey at full range the conversion is
  `v = a·y + b` on each channel (§3.3), and an affine map commutes with linear interpolation, so the order changes
  the result by rounding only (D). Copying first into an `r8unorm` texture removes the question: the copy happens
  once, and every later zoom samples plain texels (D).
* **Invert** is a 256-entry table like the window, read backwards. It loses nothing beyond what the window loses (D).

### 3.2 Window/level on 8-bit values

**The window**, DICOM's linear function: "if (x <= c - 0.5 - (w-1) /2), then y = ymin else if (x > c - 0.5 + (w-1)
/2), then y = ymax else y = ((x - (c - 0.5)) / (w-1) + 0.5) * (ymax- ymin) + ymin" (S5, PS3.3 2026d C.11.2.1.2).
On this path the input x takes at most 256 values. So the whole window is a 256-entry table: entry v holds y at the
source value that v stands for (§3.4). It is exact for any c and w, and costs 256 evaluations per window change (D).
The shader is not the obstacle; the input's precision is, as `hardware.md` §13 already said for 8 bits.

**One input step in source units** (D, at full range and a conversion that scales, `v = round(y · 255 ÷ 1023)`):

* a 10-bit view code: 1023 ÷ 255 = **4.012** codes a step (4 under a conversion that truncates, `y >> 2`);
* a 10-bit series (`dbts_b1`): the view code is the source sample, so **4.012** source units;
* a 12-bit series (`dbts_a1`, `dbts_c1`): the view is the depth cut, one view code = 4 source units, so
  4 × 4.012 = **16.05** source units.

**Distinct inputs inside a window of width W, and display levels per step** (D, W in source units, 256 display
levels, so 255 steps across the window):

| series | W | full precision on screen (today's view) | this path |
| --- | --- | --- | --- |
| 10-bit, header window | 512 | 512 codes; 255 ÷ 512 = 0.50 level a code | 512 ÷ 4.012 = 127.6 inputs; 255 ÷ 127.6 = **2.0 levels a step** |
| 10-bit, narrow | 64 | 64 codes; 3.98 levels a code | 64 ÷ 4.012 = 16.0 inputs; **16.0 levels a step** |
| 12-bit, widest header window | 1093 | the cut: 1093 ÷ 4 = 273 codes; 0.93 level a code | 1093 ÷ 16.05 = 68.1 inputs; **3.7 levels a step** |
| 12-bit, narrowest header window | 550 | 137.5 codes; 1.85 levels a code | 550 ÷ 16.05 = 34.3 inputs; **7.4 levels a step** |
| 12-bit, narrow | 100 | 25 codes; 10.2 levels a code | 100 ÷ 16.05 = 6.2 inputs; **41 levels a step: 6 grey levels** |

The header widths are the series rows' `windows` (R, `claude/depth8:docs/av1/depth-cut-8.md` §3.5: "550–1093" on the
12-bit volumes, "512" on the 10-bit ones). Its step column for the 8-bit cut, "3.7–7.4" and "2.0", is the same
arithmetic. The narrow rows are illustrations, not windows read from a reader.

**Where banding appears** (D): a step is wider than one display level whenever W < 255 × step, that is **below 1023
source units on a 10-bit series and below 4092 on a 12-bit one**: every header window above. The depth-cut file's
reading holds here too: the volume's noise, σ_min 2.8–6.9 levels at the 12-bit header windows and 1.7–2.8 at the
10-bit one, dithers those steps, and no contouring is predicted at the header windows (R, `depth-cut-8.md` §3.5).
Inside a region smoother than σ_min, or at a window narrower than the header's, the steps show (T).

**The noise rule on screen** (D, the independent model of `depth-cut-8.md` §3.2). Here the rounding to 8 bits comes
after the decode, so the quantizer cannot remove it: the two errors add in quadrature. The cut alone's RMS against
σ_min is "0.31–0.44 of σ_min on the 12-bit volumes and 0.20–0.33 on the 10-bit ones" (R, `depth-cut-8.md`
§Verdict). This path rounds the same 10-bit codes to the same 8-bit step, so the ratio is the same (D). A frame at
today's bar, e_c = σ, therefore shows on screen e/σ = √(1 + r²):

* 10-bit volumes: √(1 + 0.20²) = 1.020 to √(1 + 0.33²) = 1.053;
* 12-bit volumes: √(1 + 0.31²) = 1.047 to √(1 + 0.44²) = 1.093.

To meet the bar on screen, the coding error must fall to √(1 − r²) of σ: 0.944–0.980 on 10-bit volumes and
0.898–0.951 on 12-bit ones. That means a lower Q. Its bytes are not computed here; DEPTH8-MEASURE's 8-bit cut, a
different stream, measured 1.14–1.86 × today's bytes (R, `depth-cut-8.md` §9 P4). A cloud cell can settle it with no
phone: decode today's view, round to 8 bits as above, measure e_N (§9).

### 3.3 The colour matrix and range the browser applies

**Grey in 4:2:0 with neutral chroma comes back R = G = B.** Every YCbCr matrix weights E′R, E′G and E′B by three
weights that sum to one (R, `new-options.md` §3 step 2, H.273 eq. 45). So with both colour differences zero, the
inverse gives each of R, G and B equal to luma, under any matrix (D). Which matrix the stream names does not matter
for grey.

**The range does matter.** "color range equal to 0 shall be referred to as the studio swing representation and color
range equal to 1 shall be referred to as the full swing representation" (S1, §6.4.2). At studio swing a 10-bit luma
spans 64–940, and a conversion expands that span to 0–255 (D, H.273's studio scaling). `dbts_b1` holds 0..1023
(`docs/FIXTURES.md`), so every sample below 64 shows as black and every sample above 940 as white: **a clip, not a
rounding** (D). This was measured on a software path: Firefox's RGB copy of 8-bit grey 4:2:0 is "`BGRX`, off by ≤ 20"
at studio range and "**exact, `BGRX`**" once "**tagged full range**" (R, `docs/decode/README.md` §Why, and what would
make it exact, row XENGINE). The ingest already writes 4:2:0 grey at full range: `XCOLORRANGE=FULL` for every 4:2:0
layout (R, `ingest/coded-frames/ingest.py` `write_y4m`).

**The page can pin it.** `VideoDecoderConfig.colorSpace`: "Configures the VideoFrame.colorSpace for VideoFrames
associated with this VideoDecoderConfig. If colorSpace exists, the provided values will override any in-band values
from the bitsream." (S2, §7.6; the typo is the spec's). `VideoColorSpaceInit` has `fullRange` and `transfer`, whose
values include `"iec61966-2-1"`, the sRGB transfer (S2, §9.9). So the page could ask for full range, BT.709
primaries and the sRGB transfer, and a canvas in sRGB would then need no tone curve (T). Whether Chromium's Android
path applies the override to the external sampler's conversion is not read in its source. That is a device fact
(§9).

**Monotonic?** With full range and neutral chroma, the ideal conversion is `v = round(y · 255 ÷ 1023)`, which never
decreases (D). Real conversions run in fixed point or on the GPU, and their rounding is the implementation's (the
WebGPU and WebGL quotes in §2). One may also tone-map if the frame's transfer differs from the canvas's (T). So
whether the measured table is monotonic, and the same across engines and devices, cannot be settled from the
sources. It is settled per device by the probe's `ramp10` cell (R, `hardware.md` §17), extended in §9 to record the
whole table. Firefox's and Safari's hardware frames do not reach WebGL as more than an RGB picture either (R,
`hardware.md` §4.2–4.3), so the same cell applies to them.

### 3.4 Pixel value readout and measurements

**What value can be reported** (D). The page reads v back (`readPixels` from the `R8` texture) and knows the inverse
interval of its conversion. On a 10-bit series that is about v × 4.012 ± 2.0 source units, on a 12-bit series about
v × 16.05 ± 8.0, and the coding error comes on top (today's view already carries it). A viewer must show it as an
approximation, with no other label to tell the reader. The glossary's `valueAt` reads a sample (R,
`hardware.md` §13); on this path there is no sample to read.

**Measurements** (D):

* distances, angles and areas depend on the pixel grid and the pixel spacing, not on values, so they are unchanged;
* an ROI mean is unbiased to first order, since the rounding error has mean ~0 over a region;
* an ROI standard deviation grows to √(σ² + step²/12): with step²/12 = 1.158² on a 10-bit series and 4.63² on a
  12-bit one, in source units.

## 4. Frames held, the frame store and the cache

**Frames must be closed at once.** The spec warns: "The underlying media resources are owned by the VideoDecoder and
failing to release them (or waiting for garbage collection) can cause decoding to stall." (S2, §4.5 `decode()`). It
also treats the count as hidden: "retaining VideoFrame instances until decoding stalls can reveal hardware or driver
buffer pool sizes" (S2, §13). WebGPU repeats it: "An external texture created from a VideoFrame expires (is
destroyed) when, and only when, the source VideoFrame is closed", and "authors should call close() on output
VideoFrames to avoid decoder stalls" (S4, §6.4.1).

**How many, on Chrome Android** (S6): the image reader's `NumRequiredMaxImages` returns 5 for SurfaceControl modes
with `IncreaseBufferCountForHighFrameRate`, 3 for the other SurfaceControl modes, else "`LimitAImageReaderMaxSizeToOne()`
? 1 : 2". Its comment reads: "This should be as small as possible to limit the memory usage." Which mode WebCodecs
takes was not traced. So at most 1 to 5 frames can be held (D), and a DBT series of 50–69 frames cannot be. Each
frame is copied into a texture the page owns and closed: one GPU-to-GPU copy a frame, unmeasured.

**The frame store without samples** (D). One channel is enough, since R = G = B. An `R8` texture holds `dbts_b1`'s
frame in 2560 × 3328 = 8 519 680 bytes. The whole series is 50 × 8 519 680 = 425 984 000 B = **406 MiB**. As `RGBA8`
it would be 4× that, **1.59 GiB**. Today's 16-bit samples are 812.5 MiB. The memory window still bounds what is held.
GPU memory on the phone is shared with the system and unmeasured.

**The client cache** holds "the page's frames in OPFS, decoded and checked" (R, `docs/glossary.md` §client cache), and
"no re-decoding" is decided (R, `docs/queue-2026-11-14.md` §Decided approaches). This path gives it nothing it may
hold as decided: there are no samples and no check. Two ways remain, each the owner's call (T):

* (a) cache the 8-bit picture, read back from the `R8` texture: 1 B a sample, unchecked, a new kind of cache entry;
* (b) cache only coded bytes and decode again in hardware on a revisit, which reopens "no re-decoding".

## 5. Does the phone have the decoder at all?

**The Galaxy S23.** Its SoC's brief lists "Hardware-accelerated H.265 and VP9 decoder", no AV1. A republication of
Qualcomm's launch release says AV1 up to 8K60, and the SoC itself is not named by a Samsung source read so far (R,
`hardware.md` §15 on `claude/hw-decode`, both brief revisions). **Unsettled; the phone answers it.**

**Other common phones, by their vendors' pages** (S7): Qualcomm's Snapdragon 8 Gen 3 page lists "AV1 video playback";
MediaTek's Dimensity 9300 lists "Video Playback H.264 HEVC Vp-9 AV1". The Snapdragon 8 Elite brief, the Dimensity
9200 page and Apple's A17 Pro announcement already say AV1 (R, `hardware.md` §15). **None of these documents names
4:0:0, Main 10, a level or a maximum frame size.**

**4:0:0 needs 4:2:0.** Android's API has no monochrome AV1 profile ("AV1 Main profile 4:2:0 8-bit", "… 10-bit"; R,
`hardware.md` §12), so the best version codes 4:2:0 with constant chroma. The cost was measured at 8 bits: "the bytes
cost +0.01–0.12 %" with "every decoded chroma sample … 128" (R, `depth-cut-8.md` §9 P5). At 10 bits it is not
measured (T: the same order, the chroma planes being constant either way).

**The frame's size** (D, S1 Annex A.3). The table rows read: 4.0 and 4.1 at `MaxPicSize` 2359296, `MaxHSize` 6144,
`MaxVSize` 3456; 5.0 and 5.1 at 8912896, 8192, 4352. `dbts_b1` is 2560 × 3328 = 8 519 680 samples. That is above
level 4.x and within 5.x by (8 912 896 − 8 519 680) ÷ 8 912 896 = 4.4 %. Android asks a hardware AV1 decoder for no
more than level 4.1 (R, `new-options.md` §2.1, the CDD). And 3328 is taller than 4K UHD's 2160. A decoder whose
largest size is 3840 × 2160 fails `dbts_b1` in either orientation: 2560 and 3328 both exceed 2160 (D). The same holds
for `dbts_c1`'s 2513. Android publishes the codec's limits per width: `getSupportedHeightsFor(int width)`, "Returns
the range of supported video heights for a video width" (S8). The probe reads them (§9).

**Decode rate, if the level holds** (D, S1 Annex A.3 `MaxDecodeRate`): "A level X.Y compliant decoder must be able to
decode all bitstreams … that conform to that level", at up to 273 715 200 samples a second for 5.0 and 547 430 400
for 5.1. For a 8 519 680-sample frame that is 32.1 and 64.3 frames a second, 31.1 and 15.6 ms a frame. Software does
133–135 ms on the phone (R, `av1-software.md` §1, FILL-SPLIT). These are a floor that a compliant decoder must meet,
not a measurement. Android's own estimate per size, `getAchievableFrameRatesFor`, is "a performance estimate provided
by the device manufacturer … not suitable for comparing different devices" (S8).

## 6. Its best case (theory)

1. **One stream for both paths.** Today's 10-bit view, coded as 4:2:0 with constant chroma at full range
   (+0.01–0.12 % bytes measured at 8 bits, §5). It still decodes in software to its 10-bit samples, so nothing of
   the checked path is given up.
2. **Hardware while the reader moves.** Scrolling, cine and the fill paint through the hardware path: 8 bits,
   unchecked, labelled so. If a level-5.0 decoder takes the frame, it decodes at the level's floor, 31 ms a frame or
   less (§5), against software's 135.
3. **Software where the reader stops.** The frame the reader dwells on is decoded again in software, checked, and
   painted at 10 bits. With groups of 8 that is up to 8 frames, 8 × 135 ms ≈ 1.1 s at worst on the phone (D, from
   FILL-SPLIT's rate). The exact frame stays one press away.
4. **The coded bytes checked before the decode** (amendment 9's candidate, a second digest over the coded bytes,
   checked before decoding). That leaves unchecked only the decoder's output and the browser's conversion. AV1 makes
   the first exact by conformance (§2); the second is the device's.
5. **Window/level as a 256-entry table** on an `R8` texture (§3.2), with the colour space pinned by
   `VideoDecoderConfig.colorSpace` (§3.3) and the device's table measured once by the probe (§9).

## 7. Its disadvantages

* **Unchecked.** Amendment 1: "A path that paints but cannot be checked does not serve the view." As specified it
  fails the product's rule. Only a mixed design (§6.3) or the inverted check of
  [`new-options.md`](new-options.md) §3 (row MOBILE-OPT-HW-INVERTED) brings a check back.
* **8 bits on screen** at every window: 2.0 to 7.4 display levels a step at the header windows (§3.2), and above the
  noise rule's bar at today's Q (1.02–1.09).
* **Values are intervals**: a readout of ±2 or ±8 source units, and ROI statistics inflated (§3.4).
* **The cache's rule breaks** (§4): no checked samples to keep.
* **The device decides everything that matters**, and nothing documents it: whether the S23 has the decoder,
  whether it takes 2560 × 3328, whether it takes 4:0:0 or 10 bits, the conversion's table, how many frames it holds
  (§5, §4).
* **Two decodes of the dwelled frame** in the best case, and two decoders alive at once on the phone (T).
* **It touches two decisions**: "no reduced-depth (8-bit) preview" (the owner's, 2026-11-10, R, `depth-cut-8.md`
  §Verdict), and "no low-resolution preview", whose spirit an 8-bit moving picture tests (R,
  `docs/queue-2026-11-14.md` §Decided approaches).

## 8. The comparison's columns

| column | this option |
| --- | --- |
| decode time on a phone | **unknown**; a level-5.0 floor of 31.1 ms a `dbts_b1` frame if the decoder exists and takes the size (D, §5); software 133–135 ms (R) |
| bytes | today's view +0.01–0.12 % as 4:2:0 (R at 8 bits; T at 10). More to meet the noise rule on screen (§3.2), not computed |
| precision on screen | **8 bits**: 4.01 source units a step (10-bit series), 16.05 (12-bit series); 2.0–7.4 display levels a step at the header windows |
| checked | **no** (a display path); the coded bytes can be checked before the decode (§6.4) |
| window/level and tools functional | **yes**, all of them; window/level at 8-bit input (§3); values as intervals (§3.4) |
| ships today | the APIs ship (WebCodecs, WebGL2, WebGPU on Chrome Android); whether the S23 has the decoder and takes the frame is **unknown** |

## 9. What a phone cell must measure

Asks for the next phone round (one line each in `claude/phone-protocol:docs/phone-rows/next-round.md`, by
MOBILE-DECODE-COMPARE):

1. The AV1 codec list from a shell, as HW10-ROUTES asks, plus per codec `getSupportedHeightsFor(2560)`,
   `getSupportedHeightsFor(976)` and `getAchievableFrameRatesFor(2560, 3328)`.
2. `prefer-hardware` on a `dbts_b1` unit coded 4:2:0, constant chroma, full range, at 8 and at 10 bits, and as 4:0:0:
   configure, decode, the frame's `format`, and the codec named by `logcat`.
3. `ramp10`, extended: the whole table from the 1024 luma codes to the red channel read back, through WebGL2 `R8`
   and WebGPU `r8unorm`. Recorded with the stream's colour description and with `VideoDecoderConfig.colorSpace`
   overriding it, at full and studio range. It shows monotonic or not, and clip or not.
4. Hardware decode time a frame, against `prefer-software` on the same units, interleaved, with the copy to `R8` timed
   apart.
5. How many frames can be held open before `decode` stops producing output, recorded and not exceeded in the product.

One cloud cell, no phone: today's view decoded, rounded to 8 bits by `round(y · 255 ÷ 1023)`, e_N ÷ σ on the 19
volumes (§3.2's prediction 1.02–1.09 at today's Q), and the Q at which it meets the bar.

## 10. Sources

Read 2026-11-15. Each SHA-256 prefix is of the copy read.

* **S1** AV1 Bitstream & Decoding Process Specification, source at `github.com/AOMediaCodec/av1-spec`
  `5e04f3f75e73a5898d7616c47c52f032144b8f80` (2023-06-12): `07.bitstream.semantics.md` §6.4.2 Color config semantics
  (`color_range`, lines 431–433); `08.decoding.process.md` §7.2 General
  decoding process (line 17); `annex.a.levels.md` §A.3 Levels (lines 76–89) and §Decoder Conformance (308–311).
* **S2** W3C WebCodecs, Working Draft 9 November 2026, `https://www.w3.org/TR/webcodecs/` (`0fa152953edb`): §4.5
  `decode()` note; §7.6 `VideoDecoderConfig` (`colorSpace`); §9.9 `VideoColorSpace`; §13
  Privacy considerations.
* **S3** WebGL registry `KhronosGroup/WebGL` `39443210`: `specs/latest/1.0/index.html` (`0735f489eba0`),
  `texImage2D` and `TexImageSource`; `specs/latest/2.0/index.html` (`05da9e8c2110`), `texImage2D` conversion and
  internal-format tables.
* **S4** W3C WebGPU, Candidate Recommendation Draft 15 September 2026,
  `https://www.w3.org/TR/2026/CRD-webgpu-20260915/` (`7c6768143075`): §6.4 GPUExternalTexture, §6.4.1 importing,
  `GPUExternalTextureDescriptor` (`colorSpace = "srgb"`), `copyExternalImageToTexture` and
  `GPUCopyExternalImageDestInfo` (§11.2.4); §19.2 `GPUQueue.copyExternalImageToTexture`.
* **S5** DICOM PS3.3 2026d, `https://dicom.nema.org/medical/dicom/current/output/chtml/part03/sect_C.11.2.html`
  (`34b38bf4249d`), C.11.2.1.2 Window Center and Window Width.
* **S6** Chromium 157.0.8103.79, `chromium.googlesource.com/chromium/src/+/refs/tags/157.0.8103.79/`:
  `gpu/command_buffer/service/image_reader_gl_owner.cc` (`737011356556`) lines 52–73;
  `media/gpu/android/video_frame_factory_impl.cc` (`fb4bc6c5fb50`) lines 35–47.
* **S7** Qualcomm, Snapdragon 8 Gen 3 Mobile Platform product page (`30c9860744f4`); MediaTek, Dimensity 9300 product
  page, `https://www.mediatek.com/products/smartphones-2/mediatek-dimensity-9300` (`97a027c2db2d`). Both pages change
  bytes without notice; the quotes are the check.
* **S8** Android, `developer.android.com/reference/android/media/MediaCodecInfo.VideoCapabilities`
  (`839972c8a9ab`), "Last updated 2026-08-03 UTC": `getSupportedHeightsFor`, `getAchievableFrameRatesFor`.

Results of this repository cited (R): `claude/hw-decode:docs/decode/hardware.md` §12–§18 (`b631179a`);
`claude/hw10-routes:docs/decode/hardware-10bit.md` §5–§7 (`6c6b9f15`); `claude/depth8:docs/av1/depth-cut-8.md` §3.2,
§3.5, §9 (`ddd3ec0e`); [`new-options.md`](new-options.md) §2.1, §3; [`av1-software.md`](av1-software.md) §1;
`docs/decode/README.md` §Why, and what would make it exact; `ingest/coded-frames/ingest.py`; `docs/FIXTURES.md`;
`docs/glossary.md`.
