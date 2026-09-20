# What the platform can do with a decoded frame

A viewer built on a third-party SDK spends **15.5 ms of an asked frame's ~27.8 ms** putting it on
the screen — *measured elsewhere, not in this repository, and nothing here depends on it*. Nobody
had measured the other end: what the browser costs for the same pixels with nothing in the way.
This page measures that floor.

**An instrument and a target number, not a renderer.** It does the least that makes the two routes
comparable, and nothing a viewer would need.
[`../../docs/paint-floor.md`](../../docs/paint-floor.md) holds every number and every reason.

```bash
python3 lab/paint-floor/frames.py                          # sample sets, ~10 s, gitignored
export NODE_PATH=$(npm root -g) CHROME_PATH=/path/to/google-chrome
node lab/paint-floor/run.mjs check                         # are the two routes the same image?
node lab/paint-floor/run.mjs bench                         # what each costs, DPR 1/2/3
node lab/paint-floor/run.mjs drag --passes 3 --paints 60 --dprs 2
node lab/paint-floor/run.mjs bench --renderer swiftshader  # the same without a GPU
```

`--renderer gl|vulkan|swiftshader` picks the rasteriser and the run prints the renderer string it
actually got before anything else — **default headless is software, so a run that does not print
its renderer is not a GPU measurement.** `--quick` drops the 1:1 12 Mpx cell from the check, which
is what makes a mutation run bearable; `--passes`, `--paints` and `--dprs` size the rest.

## The two routes

| | what it does per painted frame |
| - | - |
| **2d** | builds a lookup table, maps every sample into a **new** RGBA `ImageData` at source size, `putImageData` onto an `OffscreenCanvas` at source size, `drawImage` onto a second one at display size, `transferToImageBitmap`, main-thread `drawImage` |
| **gl** | uploads the samples to an integer texture (`RGB8UI`, `R16UI`, `R16I`), window and level as shader uniforms, one draw at display size |

The 2D route is the SDK's route as it was described to us, rebuilt without the SDK. The decoded
pixels the downloader produces are a `SharedArrayBuffer` (`client/downloader/decoder.js`), which
can back `texImage2D` but never an `ImageData` — so the 2D route's per-frame copy is not an
implementation detail it could drop.

## The sample sets

`frames.py` runs `lab/scripts/gen_frame_pnm.py`, the decode bench's generator, and keeps its
output. The serving profile is reversible, so those samples *are* what the decoder emits; adding
an encoder and a decoder to prove it would only add dependencies to a bench about paint. Each set
is checked against the generator's `.sha256` before the signed level shift, so a wrong endianness
or a wrong PNM parse cannot pass.

| set | | window at identity | CSS box | DPR 1 / 2 / 3 |
| --- | - | --- | --- | --- |
| `cine512` | 512×512 RGB 8-bit, ultrasound | 0 … 255 | 512×512 | 1:1, ×2, ×3 |
| `ct512` | 512×512 **signed** 12-bit, CT | −2048 … 2047 | 512×512 | 1:1, ×2, ×3 |
| `big12mp` | 4096×3072 16-bit, 12.58 Mpx | 0 … 65535 | 768×576 | ÷5.33, ÷2.67, ÷1.78 |

Two windows per set: identity, and a `tight` one taken from the frame's own range (level at 45 %
of the span, width 12 % of it) that clips at both ends. The 512² sets magnify, the 12 Mpx set
minifies — the two regimes a viewer actually has, and they do not behave alike.

## Equality

Both routes evaluate the window in **integer** arithmetic:

```
code(v) = (clamp(v, lo, lo + range) − lo) × 255 + range/2, integer-divided by range
```

so the claim is bit-for-bit agreement rather than agreement to within a rounding step. The shader
divides integers too, and emits `float(code)/255.0`, whose round trip through the 8-bit framebuffer
is exact.

`check` paints both routes at each display size the bench times, reads both back and compares every
sample. It classifies each destination pixel by whether its exact source coordinate
`(2i+1)·src / (2·dst)` is an **integer** — a texel edge, where canvas 2D's floating-point coordinate
and the shader's exact integer legitimately pick opposite sides. That never happens at 1:1 or at any
integer magnification, and it is where the two routes differ under minification.

## Fairness

Choices made in the 2D route's favour, so the gap is not an artefact of the harness:

* both `OffscreenCanvas`es are created once and only resized, never created per paint;
* the lookup table covers the full stored-value range, so the inner loop is one indexed read with
  no clamp — cheaper than clamping per sample;
* `imageSmoothingEnabled` is **false**, so the scale step is a nearest sample in both routes and
  neither pays for a filter the other skips.

## The drag

`drag` holds one frame and sweeps the level across 60 successive windows, which is what a reader's
pointer does. It is the one place the two routes differ in *kind* rather than in cost: the 2D route
must rebuild the lookup table and remap every sample, because its output is the windowed image,
while the gl route changes two uniforms — the texture is already the right texture. So the gl route
skips the upload when the frame has not changed. On a new frame it always uploads, which is every
paint of `bench` (the frame cycles each round).

## What this does not answer

Neither route filters when it minifies: both point-sample, so a 12 Mpx frame fitted to 768×576
throws away 96.5 % of its samples in either route. Fitting wants a resolution rung
([`../../docs/adr-resolution-fitting-for-large-frames.md`](../../docs/adr-resolution-fitting-for-large-frames.md))
or an area reduction, and that is a renderer's decision, not a floor.
