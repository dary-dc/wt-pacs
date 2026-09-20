# Paint — decoded pixels to the screen

`decode/` owns turning a codestream into samples. This owns what happens to those samples next.

The question exists because a viewer built on a third-party SDK spends **15.5 ms of an asked
frame's ~27.8 ms** getting it onto the screen — the largest remaining piece. *Those two figures were
measured elsewhere, not in this repository, and nothing below depends on them.* What nobody had
measured is the other end: what the browser costs for the same pixels when nothing is in the way.
That is what this file holds.

Driver: [`../lab/paint-floor/`](../lab/paint-floor/README.md).

## The two routes

| | per painted frame |
| - | - |
| **2d** | a lookup table, every sample into a **new** RGBA `ImageData` at source size, `putImageData` onto an `OffscreenCanvas` at source size, `drawImage` onto a second one at display size, `transferToImageBitmap`, a main-thread `drawImage` |
| **gl** | the samples uploaded to an integer texture (`RGB8UI`, `R16UI`, `R16I`), window and level as shader uniforms, one draw at display size |

The 2D route is the SDK's route as it was described to us, rebuilt without the SDK — it is a
faithful stand-in for the shape, not for that SDK's code, and no number here is a measurement *of*
that SDK. The gl route exists because the decoded pixels the downloader hands on are a
`SharedArrayBuffer` (`client/downloader/decoder.js`), which can back `texImage2D` but never an
`ImageData`: the 2D route's per-frame copy is structural, not an oversight.

## Where the numbers come from

Headless Chrome 148 on the workstation, `--use-angle=gl`, which reports

```
ANGLE (Intel, Mesa Intel(R) UHD Graphics 620 (KBL GT2), OpenGL 4.6)
```

**A real GPU, and an integrated one** — which is the class of part the target runs on. Two other
rasterisers are reachable from the same box and are reported where they change the answer:
`--use-angle=vulkan` gives the discrete part through NVK, and plain headless gives SwiftShader, a
software rasteriser. Default headless is *software*; a run that does not print its renderer string
is not a GPU measurement.

Three passes of twelve paints per route per cell, **arms interleaved within every round and the
order rotated each round**, warm-up paint discarded, medians quoted with the full range. DPR is a
cell, not an arm: each device-pixel-ratio needs its own browser context, so the passes visit the
three ratios in rotating order rather than one after the other. Allocation is the median
`performance.memory.usedJSHeapSize` delta across a paint, under `--enable-precise-memory-info` —
the same instrument `decode/README.md` uses.

**This box saturates at one frame of a 60 Hz vsync, 16.7 ms.** Both numbers below are needed to
read that: main-thread time is what the paint takes from the page's thread, and `raf` is from the
end of the draw to the next animation frame. When a paint fits, `main + raf ≈ 16.7`; when it does
not, `raf` collapses toward zero and `main` is the whole story. Nothing here claims anything about
a display faster than 60 Hz.

## The floor

Smoothing off, so both routes resample by nearest and neither pays for a filter the other skips.

| set | window | DPR | display | 2d main ms | gl main ms | 2d/gl | 2d raf | gl raf | 2d kB/paint |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| `ct512` 512² signed 12-bit | identity | 1 | 512×512 | **7.55** [1.8 … 13.5] | **0.34** [0.1 … 0.5] | 22.2× | 8.8 | 16.2 | 1 028 |
| | identity | 2 | 1024×1024 | 7.58 [2.7 … 20.0] | 0.34 [0.1 … 0.5] | 22.6× | 8.9 | 16.1 | 1 028 |
| | identity | 3 | 1536×1536 | 7.48 [1.8 … 21.8] | 0.32 [0.1 … 0.4] | 23.7× | 9.1 | 16.2 | 1 028 |
| | tight | 1 | 512×512 | 7.50 [2.0 … 8.1] | 0.33 [0.1 … 0.4] | 22.9× | 8.9 | 16.1 | 1 028 |
| | tight | 2 | 1024×1024 | 7.44 [2.0 … 10.3] | 0.32 [0.1 … 0.4] | 23.4× | 9.0 | 16.1 | 1 028 |
| | tight | 3 | 1536×1536 | 7.42 [1.9 … 8.7] | 0.30 [0.1 … 0.4] | 25.2× | 9.2 | 16.2 | 1 028 |
| `cine512` 512² RGB 8-bit | identity | 1 | 512×512 | **11.14** [2.2 … 31.0] | **0.43** [0.1 … 1.2] | 25.8× | 5.2 | 16.0 | 1 025 |
| | identity | 2 | 1024×1024 | 9.67 [2.9 … 22.2] | 0.41 [0.1 … 0.6] | 23.4× | 6.5 | 16.1 | 1 025 |
| | identity | 3 | 1536×1536 | 9.84 [2.2 … 24.3] | 0.42 [0.1 … 1.2] | 23.3× | 6.7 | 16.1 | 1 025 |
| | tight | 1 | 512×512 | 9.25 [2.2 … 27.1] | 0.39 [0.1 … 0.5] | 23.4× | 7.1 | 16.0 | 1 025 |
| | tight | 2 | 1024×1024 | 9.38 [2.3 … 24.9] | 0.43 [0.1 … 0.5] | 21.9× | 7.0 | 16.0 | 1 025 |
| | tight | 3 | 1536×1536 | 9.29 [2.3 … 21.5] | 0.39 [0.1 … 0.5] | 23.7× | 7.1 | 16.1 | 1 025 |
| `big12mp` 4096×3072 16-bit | identity | 1 | 768×576 | **105.36** [88.3 … 181.0] | **5.73** [5.0 … 18.9] | 18.4× | 0.3 | 10.8 | 49 148 |
| | identity | 2 | 1536×1152 | 102.42 [88.6 … 179.4] | 5.93 [5.2 … 24.4] | 17.3× | 0.3 | 10.2 | 49 133 |
| | identity | 3 | 2304×1728 | 104.27 [89.1 … 183.4] | 6.09 [5.3 … 19.3] | 17.1× | 0.3 | 10.6 | 49 147 |
| | tight | 1 | 768×576 | 95.19 [88.0 … 122.6] | 5.49 [5.0 … 19.1] | 17.3× | 0.3 | 10.9 | 49 149 |
| | tight | 2 | 1536×1152 | 95.78 [87.9 … 122.1] | 6.78 [5.0 … 19.6] | 14.1× | 0.3 | 9.9 | 49 149 |
| | tight | 3 | 2304×1728 | 98.19 [88.7 … 121.8] | 5.82 [4.9 … 22.6] | 16.9× | 0.3 | 10.6 | 49 149 |

**The floor for a 512² frame is about a third of a millisecond, and the 2D route is 22–26× above
it.** For a 12.58 Mpx frame the floor is ~6 ms against ~100 ms, 14–18×.

**Device pixel ratio moves neither route.** Nine times the destination pixels (DPR 1 → 3) changes
the 2D route by less than its run-to-run range and the gl route by ~0.02 ms. Both costs are set by
the *source* frame, not by the display: in the 2D route the sample-by-sample map into `ImageData`
dominates and the scale step is nearly free; in the gl route the texture upload dominates and the
fragment work is not visible against it. **A hypothesis this refutes:** that a retina display is
what makes paint expensive. It is not, on either route.

**The 2D route's allocation is exactly its `ImageData`.** 1 025 kB per paint at 512² is
512·512·4 = 1 024 KiB plus the lookup table; 49 148 kB at 12.58 Mpx is 4096·3072·4 = 48 MiB. The
measurement agrees with the arithmetic, which is the point of quoting it. A 512² stack scrolled at
30 fps on this route hands the collector **31 MB/s**; the 12.58 Mpx frame hands it 48 MiB per paint,
which at the rate that route can actually paint is **~0.5 GB/s**. The gl route's median delta is
**0 kB** — it allocates nothing per paint.

**What the frame budget says.** At 512² the 2D route uses 45–67 % of a 60 Hz frame and still lands
in it (`main + raf` ≈ 16.4 ms); the gl route uses 2 %. At 12.58 Mpx the 2D route overruns by about
six frames — a fitted 12 Mpx stack scrolls at roughly 10 fps on it, and every one of those frames
blocks the main thread for ~100 ms. The gl route lands inside one frame at every size measured.

**Smoothing was not what flattered the gl route.** Re-run with `imageSmoothingEnabled` true at
DPR 1 (2 × 12 paints): 12.58 Mpx 2D route 99.71 [87.8 … 179.8] against 105.36 without, 512² CT 7.50
against 7.55. No separation — the scale step is not where the 2D route's time goes, so turning its
filter off did not help it.

## The window/level drag

Sixty successive windows over one frame, DPR 2, three passes of sixty paints per route — 180 paints
per route per cell. The 2D route has no choice: its output *is* the windowed image, so it rebuilds
the lookup table and remaps every sample. The gl route changes two uniforms; the texture is already
the right texture.

| set | 2d main ms | gl main ms | 2d/gl | 2d raf | gl raf | 2d kB | gl kB |
| --- | --- | --- | --- | --- | --- | --- | --- |
| `ct512` | 7.52 [1.8 … 14.5] | **0.08** [0.0 … 0.2] | **94×** | 8.9 | 16.4 | 1 028 | 0 |
| `cine512` | 9.31 [2.2 … 32.1] | **0.09** [0.0 … 0.5] | **110×** | 7.0 | 16.4 | 1 025 | 0 |
| `big12mp` | 97.66 [87.6 … 181.6] | **0.04** [0.0 … 0.2] | **2 170×** | 0.3 | 16.5 | 49 147 | 0 |

**A new window costs the gl route under a tenth of a millisecond at every frame size.** 0.04, 0.08
and 0.09 ms are not separated from each other at this resolution and should not be read as an
ordering; what they say together is that re-windowing does not scale with the frame, because
nothing per-sample happens. The 2D route's cost is the same as painting the frame afresh, because
for it that is what re-windowing is.

**This also decomposes the gl route's per-frame cost.** The same drag was run once before the
upload was made conditional, so the gl route re-uploaded the texture for every window; those three
cells came in at **5.74 / 0.43 / 0.32 ms** (`big12mp` / `cine512` / `ct512`) against **0.04 / 0.09 /
0.08** with the upload skipped. So for a *new* frame the gl route's time is almost entirely the
upload — 5.70 of 5.74 ms at 12.58 Mpx, which is 24 MB in 5.7 ms, ≈ 4.2 GB/s — and the draw itself
is under a tenth of a millisecond at every size measured. **If the gl route is ever too slow, the
upload is the only thing worth attacking.**

The 2D route measured 96.06 / 9.28 / 7.47 ms in that earlier run against 97.66 / 9.31 / 7.52 here:
two campaigns, hours apart, agreeing to within 2 %. That is the repeatability these cells have.

## Without a GPU

Plain headless Chrome is a software rasteriser
(`ANGLE (Google, Vulkan 1.3.0 (SwiftShader Device (Subzero)), SwiftShader driver)`). At DPR 2, two
passes of twelve paints:

| set | window | 2d main ms | gl main ms | 2d/gl | 2d raf | gl raf |
| --- | --- | --- | --- | --- | --- | --- |
| `ct512` | identity | 10.12 [5.3 … 12.3] | 0.16 [0.1 … 0.2] | 63.2× | 6.4 | **28.1** |
| `ct512` | tight | 10.44 [5.1 … 16.8] | 0.22 [0.1 … 0.3] | 46.9× | 5.6 | **37.9** |
| `cine512` | identity | 8.50 [3.8 … 15.6] | 0.24 [0.1 … 1.7] | 35.4× | 8.0 | **26.1** |
| `cine512` | tight | 10.78 [5.3 … 20.9] | 0.21 [0.1 … 0.9] | 50.7× | 5.8 | **34.6** |
| `big12mp` | identity | 95.84 [94.9 … 161.3] | 4.84 [4.6 … 6.2] | 19.8× | 2.3 | 25.2 |
| `big12mp` | tight | 95.63 [94.9 … 106.3] | 4.82 [4.5 … 5.1] | 19.8× | 2.3 | 24.6 |

**Read the `raf` column, not the ratio.** Without a GPU the gl route's *main-thread* saving gets
bigger — the draw call only queues work — but the work still has to happen, and it no longer fits
a frame. At 512² the 2D route delivers at the next vsync (`main + raf` ≈ 16 ms) while the gl route
takes two or three (26–38 ms). **On a software rasteriser the gl route frees the main thread and
delivers later.** At 12.58 Mpx it still wins outright, because 95 ms of main thread is six frames
whatever the rasteriser does.

This is 24 paints per cell at one DPR, so it is a direction, not a tight number. It matters because
a blocked GPU is a real device state, and it says the gl route's value is not one number but two:
the main thread it gives back, and the frame it hits — and those come apart when the GPU does.

## Are the two routes the same image?

Both evaluate the window in **integer** arithmetic — `(clamp(v, lo, lo+range) − lo) × 255 + range/2`
integer-divided by `range` — so the claim is bit-for-bit agreement, not agreement to a rounding
step. `run.mjs check` paints both at every display size the bench times, reads both back and
compares every sample.

| regime | result |
| --- | --- |
| 1:1, and every integer magnification (both 512² sets at DPR 1, 2, 3; the 12.58 Mpx set at 1:1) | **0 mismatches**, 119.5 M samples |
| minification (12.58 Mpx at 768×576, 1536×1152, 2304×1728) | mismatches **only on a texel edge**; **0 off one**, 37.2 M samples |

A *texel edge* is a destination pixel whose exact source coordinate `(2i+1)·src / (2·dst)` is an
integer. There canvas 2D's floating-point coordinate and the shader's exact integer legitimately
land on opposite sides. It never happens at 1:1 or at integer magnification, which is why those
regimes agree outright. The measured edge fractions — 55.6 %, 55.6 %, 21.0 % — are exactly 5/9,
5/9 and 17/81, which the ratios predict; the prediction matching is itself a check on the
classifier.

**The shader is not changed to follow canvas 2D there, and that is a decision, not a gap.** A probe
that gives each source pixel its own coordinates and reads back which one the scale picked
establishes that the shader's rule *is* Skia's nearest rule everywhere off an edge; on an edge
Skia's pick is not even self-consistent — scaling 4096×3072 to 1024×768 (exactly 4× on both axes)
it takes the lower texel vertically and the upper horizontally. Reproducing that would be
reproducing a floating-point accident.

Seven mutations were run against it. Counts below are off-edge mismatches in one 512×512 cell
(786 432 samples) unless the row says otherwise, with the worst difference in codes:

| mutation | caught |
| --- | --- |
| shader truncates where it should round | **yes** — 300 312, worst 1 |
| shader drops the y flip | **yes** — 180 094, worst 199 |
| shader swaps R and B | **yes** — 11 900, `cine512` only, worst 174 |
| shader abandons the texel-centre rule for `floor(i·s/d)` | **yes** — 440 226 of the 12.58 Mpx cell at 768×576, worst 167, and **nothing anywhere else**, which is the claim that the two rules coincide off a minification |
| 2D route's lookup indexes with `+base` (the signed path) | **yes** — all 786 432, worst 238 |
| texture upload starts one sample late | **yes** — 121 531, worst 199 |
| 2D route's level-shift base off by one | **no** — see below |

### What a differential check cannot prove

It proves the two routes *agree*, never that either is *right*. Anything they share is invisible to
it, and the last mutation above is the demonstration: shifting the 2D route's level-shift base by
one changes nothing, because the base both fills the lookup table and indexes it, so it cancels. It
is an equivalent mutant, and finding that out is worth more than a seventh green tick.

What anchors the samples themselves is a separate guard. `frames.py` checks every generated set
against `lab/scripts/gen_frame_pnm.py`'s own `.sha256` — the decode bench's ground truth, written
from the encoder's input and not by anything under test. Mutated to skip the big-endian PNM swap,
it stops at the first 16-bit set: *`ct frame 0: samples do not match the generator's checksum`*.

## What this does not answer

**Neither route filters when it minifies.** Both point-sample, so fitting a 12.58 Mpx frame into
768×576 throws away 96.5 % of its samples either way. That is an aliasing artefact in both, and the
answer to it is a resolution rung ([`adr-resolution-fitting-for-large-frames.md`](adr-resolution-fitting-for-large-frames.md))
or an area reduction, not a choice between these two routes. The gl figures for the 12.58 Mpx set
are therefore a floor for a route that point-samples; a two-pass reduction would cost more than
they show, and nothing here says how much.

**Nothing here is a viewer.** No zoom, no pan, no overlay, no stack, no colour management, no
16-bit display path. The claim is the size of the gap and where it comes from, so that a decision
about the paint path can be taken on a number instead of an intuition.

**Nothing here was measured on the target.** This is a Kaby Lake-R laptop part; the target is a
phone. What transfers is the shape — allocation per paint, whether DPR matters, what happens when
the GPU is unavailable — not the milliseconds.
