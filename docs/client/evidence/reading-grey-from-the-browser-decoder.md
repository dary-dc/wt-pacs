# Can the client read a grey AV1 frame from the browser's decoder as luma alone?

**Question:** a grey (4:0:0) AV1 frame comes back from WebCodecs as `I420`/`I420P10` with mid-grey chroma, which the
client copies and discards. Can it read the luma plane alone, exactly, and do the two copy-side levers (skipping the
chroma check on a `mono_chrome` stream; reusing one copy buffer) pay on a stream that is not split?

*Folded 2026-11-14 from `claude/av1-grey-path:docs/decode/README.md` §Grey path protocol, pre-registered (theory and
exploratory profiles, 2026-11-04) and §Grey path, measured (by a separate session given only the protocol,
2026-11-04), `a47b4f02`; harness and rows `claude/av1-grey-path:lab/av1/decode/grey-path/`.*

## Sources (theory, read 2026-11-04)

No browser API hands over the luma plane alone, exactly:

* `copyTo` cannot drop a plane: no `VideoPixelFormat` holds luma alone; `layout` must cover every plane ("If layout
  is not undefined and its length does not equal numPlanes, throw a TypeError"); `format` converts only to 8-bit RGB.
  What `layout` does allow is a destination larger than the planes: luma at offset 0 with stride = width, the chroma
  behind it.
* The GPU routes (WebGL, WebGPU) convert to RGB, and no specification makes that exact.
* The one decoder that returns grey alone is dav1d-WASM, already the fallback, at 1.6–2.0× WebCodecs' time a frame.

On a split frame the chroma is a third of `copyTo`'s bytes, about 1.0–2.5 % of the frame (*derived*). A variant that
placed an unsplit picture by a native copy tied the existing `place()` (*exploratory*, node 22), so it was built,
profiled and removed.

## Results (measured)

Arms: W (`onePass` off), W′ (its A/A), W2 (the default, which skips the chroma check on a `mono_chrome` stream: the
skip), R (one kept copy buffer per stream: the reuse). Fixtures: `usb_cine` frames 24–39 lossless and at Q 10; the
middle 16 slices of `dbts_b1` (17–32) and `dbts_b3` (23–38) at Q 10; each one unsplit 4:0:0 stream at G 1, decoded one
at a time. Chromium 141.0.7390.37, 4 vCPUs (Xeon 2.10 GHz), 148 rounds at 1×, 40 at 4×.

* **48 128 of 48 128 frames exact** the first time on WebCodecs, none rescued by the fallback; every mutant (a
  flipped sample, `neutral()` one off, `copyTo` skipped on a reused buffer) caught.
* **The chroma-check skip** is a speed-up in 5 of 8 cells (both lossy DBT cells at both throttles, `usb_cine_q10` at
  1×), not resolved in 3, a cost in none (W2 ÷ W 0.930–0.968 where resolved).
* **The reused buffer** is a speed-up in 6 of 8 cells, for example `dbts_b1_q10` 135.6 → 116.2 ms a frame at 1× (R ÷ W2
  0.883 [0.877–0.896]) and 0.860 at 4×; not resolved in both `usb_cine` cells at 4×.
* The A/A missed in 1 cell of 8 (`dbts_b1_q10` at 1×, lower end 1.003), which the protocol allows.
* **Firefox 157.0.1**, untimed: all 68 frames went to dav1d-WASM, exact, none on WebCodecs.
* **The host did not saturate:** a browser kept 29–32 % of the 4 CPUs busy at 1× (busiest second 40 %), 15–20 % at
  4×; where it saturates was not measured, so nothing is claimed for fills, concurrency or phones.

## Verdict, with its scope

Reading grey alone is not possible through any browser API; the copy of the mid-grey chroma stays. On three
lossless-or-Q 10 grey sets at G 1 in one Chromium, both levers sped the decode or tied it. The protocol changed no
default. The reused buffer was later retired with other levers (`docs/decode/README.md` records its retirement on
2026-11-11) without this result beside it; whether it returns is the owner's.
