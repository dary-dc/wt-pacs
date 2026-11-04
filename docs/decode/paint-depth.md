# Paint depth

* **Asked:** can a reduced-depth lossy preview be painted at its own depth, with the window scaled instead of the
  pixels, so that no CPU pass touches its samples before the paint — and are the displayed codes then the same?
* **Answer:** yes, and exactly, but not by dividing the window's centre and width by 2^k: that changes LINEAR's codes.
  The paint worker's window table is built for the preview's codes instead, each entry the full-scale entry of the
  stored value it stands for. No shader change. Built behind a frame field, `reduced`; absent, nothing changes.
* **Rests on:** the window table's construction (equal by construction, tested over every code), and a readback on
  SwiftShader: every window of `voi.test.mjs` and narrow windows swept across the range, on one frame each of
  `dbts_a1`, `dbts_b1`, `dbts_c1` and on ramps of every preview code — 0 of 7 984 (case, window) pairs differ, on either path.
* **Left:** timing, owed to a machine with a GPU (the protocol below), and the producer: the decoder handing the
  preview on at its own depth with its range from ingest, a contract change written here as design only.
* **Nothing is timed here.** This host's WebGL2 is SwiftShader, a software renderer.

## Terms

* **Stored value**: a sample as the series stores it (DICOM's stored pixel value), before the modality rescale.
* **Window**: the DICOM VOI function that maps a value after rescale to a display code 0–255, given a centre c and a
  width w (`client/paint/README.md` §The contract). The **code** is the 8-bit result the canvas shows.
* **Top N bits**: a sample v reduced to its N most significant bits, p = (v + 2^(k−1)) ≫ k with k = (stored bits − N),
  clamped to N bits (`lab/av1/delivery/residual/encode.py` `to_preview_grey`); shown at full scale as (p ≪ k) − bias,
  where bias is the series' offset (0 on every set here). **k** is that shift.
* **Reduced-depth preview** ([`../glossary.md`](../glossary.md)): a preview, a lossy picture shown before its frame's
  exact one, held at N bits. The lossy designs code it at 10 bits: the top 10 of a 12-bit series (k = 2). "The top 8 of a 10-bit
  one" (k = 2) is checked here too, though the lossy work codes 10-bit series at k = 0.
* **The paint worker**: the worker that owns the canvas and paints with WebGL2 (`client/paint/paint-worker.js`). Pass 1
  looks each sample up in a **window table** of 256 or 65 536 bytes, built on the CPU by `client/paint/voi.js`, into an
  8-bit picture; pass 2 places that picture on the canvas.
* **The CPU path**: today's way, `shown()` in `lab/av1/delivery/residual/add.js` — one JavaScript pass writing
  (p ≪ k) − bias into a new 16-bit frame and taking its range — then the paint of that full-scale frame.
* **Systems A, B, C**: the three DBT (digital breast tomosynthesis) scanners of the EA1141 dataset; A and C store
  12 bits, B 10. `dbts_a1`, `dbts_b1`, `dbts_c1` are one reconstructed volume of each (`lab/av1/data.json`).

## Why not scale the window

The idea as asked: paint p, and use centre c / 2^k and width w / 2^k. For LINEAR it is not the same function, because
the standard's LINEAR is not invariant under scaling. DICOM PS3.3 2026d §C.11.2.1.2.1 (read 2026-11-04,
<https://dicom.nema.org/medical/dicom/current/output/chtml/part03/sect_C.11.2.html>):

> if (x <= c - 0.5 - (w-1) /2), then y = y min
> else if (x > c - 0.5 + (w-1) /2), then y = y max
> else y = ((x - (c - 0.5)) / (w-1) + 0.5) * (y max - y min ) + y min

The −0.5 and the −1 are in value units and do not scale with x. Worked (*derived*, and a test in `voi.test.mjs`): c = 100,
w = 11, k = 2, p = 24 (stored 96) is code 38 on the CPU path and 55 with c = 25, w = 2.75. LINEAR_EXACT and SIGMOID
depend only on (x − c)/w and do scale in real arithmetic, but not bit for bit in float64 at a code's half-way point
(*derived*, not counted). The window is also in values after the rescale — the same section: "a linear conversion
from stored pixel values (after any Modality LUT or Rescale Slope and Intercept specified in the IOD have been applied)"
— so a scaled window would have to fold the slope, intercept and bias in too.

**What is exact instead.** The paint worker already looks every sample up in a table indexed by stored code. For a
reduced frame, entry p is built from stored value (p ≪ k) − bias, through the same rescale, the same VOI function and
the same rounding, in the same float64 order as the full-scale entry of that value. The two paths evaluate the same
expression on the same numbers, so every code is equal **by construction**; the readback below checks the GPU half
(the texture format, the index, the cache).

## What changes

| part | change | built |
| --- | --- | --- |
| **frame contract** (`client/paint/README.md` §The contract; the decoder's `picture()` in `client/decode/decoder.js`) | a frame may carry `reduced: { shift, bias }`: its samples p stand for stored values (p ≪ shift) − bias; `bits` is then the preview's depth (8 or 10), so it uploads as `R8UI` or `R16UI`. `min`/`max` stay in stored values | the painter's half; no producer sends it |
| **painter** | `voi.js` `windowTable` builds entry p from (p ≪ shift) − bias; RGB at reduced depth is refused by name. No shader change, no change to `painter.js` | yes |
| **cache** — the paint worker's table | its key gains `frame.reduced`, so a buffer repainted with another shift rebuilds the table | yes |
| **cache** — the OPFS store ([`../adr/frame-path.md`](../adr/frame-path.md), not built) | it stores only frames checked `true`, and a preview is never exact, so a reduced frame is never stored. Were that to change, an entry must keep `reduced` and its `bits`, or it reads back painted as full scale | design |
| **the range** | the CPU pass took the preview's range as it wrote. Without it the default window (used when the series has no window) needs a range from elsewhere: **the preview's own range, per frame, written at ingest** (4 bytes a frame) gives the default window today's path computes; the exact frame's range gives a different default, within the preview's max \|Δ\| of it | design |
| **producer** (design 1 of the lossy work) | `copyTo` the preview into a `SharedArrayBuffer` with the luma plane first and its stride equal to the width, and hand that buffer on with `reduced` and the ingest range; no `shown()` pass. Chroma rows behind the luma stay in the buffer, unread (the painter uploads `width × height` samples from `byteOffset`) | design |
| **check page** | `lab/paint-depth/depth.html`, driven by `depth.mjs`; `client/paint/check.mjs` is unchanged. Proposed: one reduced ramp among its exact cells, so `scripts/gate.sh` keeps the GPU half covered | the lab page |

**What the exactness check covers then.** That a reduced preview's displayed codes equal the CPU path's, at 1:1
placement, for the windows checked, on the renderer run. It does not cover: the preview's fidelity to the exact frame
(it is lossy, and has no exact claim); the fractional placements (zoom, fit, a fractional pan), where pass 2 filters
the same pass-1 picture and so should give the same output on one renderer (*derived*, not checked); the default window
when its range comes from somewhere other than the preview itself; and a GPU, until the run below.

## Paint depth, built

Built on `claude/av1-paint-depth`, 2026-11-04: `client/paint/voi.js` and the worker's table key (above), the unit tests
in `client/paint/voi.test.mjs`, and the readback check in [`lab/paint-depth/`](../../lab/paint-depth/).

```bash
node client/paint/voi.test.mjs                                                     # 15 tests, 3 new
lab/av1/fetch_data.sh dbts_a1 dbts_b1 dbts_c1
lab/av1/.venv/bin/python lab/paint-depth/frames.py lab/av1/data lab/paint-depth/frames
NODE_PATH=$(npm root -g) node lab/paint-depth/depth.mjs                            # 209 s here
NODE_PATH=$(npm root -g) node lab/paint-depth/depth.mjs --mutate shift             # must report NOT EQUAL
NODE_PATH=$(npm root -g) node lab/paint-depth/depth.mjs --mutate bias              # must report NOT EQUAL
```

**The unit tests** (no browser). For preview depths 8 and 10, k = 0, 1, 2, 4, bias 0 and 37, and seven windows (LINEAR,
LINEAR at width 1, LINEAR_EXACT at widths 10 and 0.001, SIGMOID, a rescale with intercept −1024, and a fractional
slope and intercept under MONOCHROME1), every entry p of the reduced table equals the full-scale table's entry for
(p ≪ k) − bias. A second test pins the LINEAR counterexample above; a third, RGB refused. Mutated in `voi.js`: the
shift one bit too large (11/15 pass), the bias dropped (14/15), the RGB refusal dropped (14/15) — each caught.

**The readback.** Each case is painted twice at 1:1, canvas = frame, DPR 1: at its own depth with `reduced`, and at
full scale after `shown()`. Each readback's R, G and B are compared, sample for sample, with the CPU path's codes,
the full-scale table looked up on `shown()`'s output. Windows: the ten of `voi.test.mjs` (its LINEAR, LINEAR_EXACT and
SIGMOID cases, the rescaled, the signed-centre, MONOCHROME1 and inverted ones), then narrow windows swept across the
range — centres in ≤ 16 steps across the frame's full-scale range on the DBT frames, ≤ 400 across the whole range on
the ramps, a quarter step off the grid, each at LINEAR widths 1, 2^k and 3 · 2^k, LINEAR_EXACT 2^k and SIGMOID 2^k.

Headless Chrome for Testing 153.0.8010.12 (playwright 1.63.0), ANGLE on SwiftShader (Vulkan 1.3.0, Subzero), this container
([`rows/check-swiftshader.txt`](../../lab/paint-depth/rows/check-swiftshader.txt)):

| case | frame | samples | windows | reduced ≠ CPU | full ≠ CPU |
| --- | --- | --: | --: | --: | --: |
| ramp, 10-bit, k = 2 | every code 0–1023 | 1 024 | 2 010 | 0 | 0 |
| ramp, 10-bit, k = 0 | every code | 1 024 | 1 610 | 0 | 0 |
| ramp, 8-bit, k = 2 | every code 0–255 | 256 | 2 010 | 0 | 0 |
| ramp, 10-bit, k = 2, bias 37 (full scale signed 16-bit) | every code | 1 024 | 2 010 | 0 | 0 |
| `dbts_a1`, top 10 of 12 bits | frame 28, 1142 × 1785 | 2 038 470 | 90 | 0 | 0 |
| `dbts_b1`, 10 bits, k = 0 | frame 25, 2560 × 3328 | 8 519 680 | 74 | 0 | 0 |
| `dbts_b1`, top 8 of 10 bits | frame 25 | 8 519 680 | 90 | 0 | 0 |
| `dbts_c1`, top 10 of 12 bits | frame 34, 976 × 2513 | 2 452 688 | 90 | 0 | 0 |

**Every displayed code equals the CPU path's**, in every window of every case, on SwiftShader. The DBT previews are the
source frames reduced by `encode.py`'s formula, not AV1 decodes: the claim is about the paint of any p, and the ramps
cover every p a depth has. It rests on these three volumes, one middle frame each, and on the ramps; it is claimed for
them only, and for SwiftShader only.

**Mutated in the browser** (the served `voi.js` patched for reduced frames only, so the CPU path is untouched):
one run each, the same windows ([`rows/mutate-shift.txt`](../../lab/paint-depth/rows/mutate-shift.txt),
[`rows/mutate-bias.txt`](../../lab/paint-depth/rows/mutate-bias.txt)).

| mutant | reduced ≠ CPU | full ≠ CPU |
| --- | --- | --- |
| **the scale off by one bit** (shift + 1) | 7 946 of 7 984 windows, in every case; the 38 it misses are windows that show the whole case as 0 or 255 either way | 0 |
| the bias dropped | 2 007 of 2 010 windows on the bias-37 ramp; 0 elsewhere, since every DBT set's bias is 0 | 0 |

The full-scale path stays equal under both, so the check sees the reduced path alone.

**The product's checks, after the change.** `scripts/gate.sh --quick` stopped at its prerequisites on this host (no
built `transport_wasm_bg.wasm`), so its paint steps ran by hand: `voi.test.mjs` 15/15, `check.mjs --zoom1` every 1:1
cell equal at DPR 1 and 2, `scripts/comment_budget.sh` clean. The server's tests were not run; nothing here touches them.

**Not checked.** A GPU (the protocol below runs the same check first); fractional placements; the worker's table
key: a check that repaints one buffer with a second shift would see it, and this one paints a new frame each time.
The key matters only if a producer reuses a buffer under a new `reduced`, which none does.


## GPU timing protocol, pre-registered

Written 2026-11-04, before any timing; the session that runs it changes nothing below and reports every case,
including those that miss.

**The question.** On a machine with a hardware GPU, from the preview's samples in shared memory (as `copyTo` leaves
them) to the draw executed, does painting at its own depth (**arm gpu**) take less time than `shown()` and the
full-scale paint (**arm cpu**)?

**Arms**, both through the product's `Painter` in one page, a canvas of 1024 × 1024 CSS px at DPR 1 per case, `fit`:

| arm | clock covers | off the clock |
| --- | --- | --- |
| **cpu** | `shown()` (one JS pass: shift, bias, range, a new 16-bit buffer), then `paint()` of that frame until its promise resolves | the preview copied into a new `SharedArrayBuffer` |
| **gpu** | `paint()` of the preview with `reduced` until its promise resolves | the same copy |

The promise resolves after the worker's one-pixel `readPixels`, which waits for the draw (`paint-worker.js`). A new
buffer each paint, so both arms upload. The window's centre moves by 1 each paint, so both rebuild their table:
65 536 entries in each at 10 bits, 256 in arm gpu at 8. Latency only (ms a paint, the round trip); `prep` (the CPU
pass) and the worker's own ms are reported beside it.

**Cases**: the four of `frames.py` — `dbts_a1` and `dbts_c1` at the top 10 of 12 bits, `dbts_b1` at k = 0 and at the
top 8 of 10 — one middle frame each, the frame this check ran on. Nothing is claimed for another series.

**Order and rounds.** 30 rounds after one warm-up round, discarded; inside a round the eight (case, arm) units run in
a Williams order (`lab/order.mjs`). Rows are written after every round.

**Decision rule**, per case: the median over rounds of the paired ratio gpu ÷ cpu, its range, and the rounds gpu was
faster. **Less** if the median ≤ 0.95 and gpu faster in ≥ 90 % of rounds; **more** if ≥ 1.05 and slower in ≥ 90 %;
**the same** inside 0.95–1.05; otherwise **unresolved**, said so.

**Prediction: less, with a ratio ≤ 0.5, on all four** (*derived*): arm gpu drops `shown()`'s pass, which runs on
`dbts_b1` at k = 0 too (bias and range); at 3.6–4.1 ns a sample on the lab's 4-core container (the lossy pixel work,
`lab/av1/delivery/residual/README.md` §Where the time after decode goes), that is ~7–8 ms on `a1`, 31–35 on `b1` and
9–10 on `c1`, against a GPU paint of ~0.34 ms for 512² (`client/paint/README.md` §What it costs). The upload is the same
2N bytes in both arms at 10 bits and N at 8. That the pass costs the same on the GPU machine's CPU is *unverified*.
A case outside the prediction falsifies it, and is reported as such.

**Before timing, on the same machine,** the check above must pass and its mutant must fail; if either does not, no
timing is read. The renderer line must name the hardware GPU (headless Chromium defaults to software); otherwise the
run is void.

```bash
git fetch origin && git checkout claude/av1-paint-depth
lab/av1/fetch_data.sh dbts_a1 dbts_b1 dbts_c1
lab/av1/.venv/bin/python lab/paint-depth/frames.py lab/av1/data lab/paint-depth/frames
export NODE_PATH=$(npm root -g)
node lab/paint-depth/depth.mjs --renderer gl                    # renderer line: the GPU; every window equal
node lab/paint-depth/depth.mjs --renderer gl --mutate shift     # must report NOT EQUAL
node lab/paint-depth/depth.mjs --renderer gl --bench --rounds 30 --out lab/paint-depth/rows/bench-gpu.json
```

Report the host: CPU and cores, GPU and driver, OS, the browser's version. **Saturation:** one page thread and one
paint worker, so a multi-core host is not saturated by either arm; nothing is claimed for another host, a phone, or
the fractional placements. `--bench --rounds 1` ran here once only to show the harness runs; its numbers are
SwiftShader's and are not reported.
