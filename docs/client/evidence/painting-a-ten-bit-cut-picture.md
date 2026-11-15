# Can the client paint a reduced-depth picture at its own depth and show the same codes?

**Question:** the depth cut sends a D > 10 series as 10-bit codes. Can the paint take those codes as they are, with
the window built for them, and put on screen exactly the codes that shifting to full depth and then windowing would?

*Folded 2026-11-14 from `claude/av1-paint-depth:docs/decode/paint-depth.md` §Why not scale the window, §What changes,
§Paint depth built, §GPU timing protocol (measured on SwiftShader, 2026-11-04, `1e96552d`). The product's form of the
answer, the window table at c · 2^(D−10) and its unit test, is
[`../../av1/payload-format.md`](../../av1/payload-format.md) §Depth cut and `client/paint/voi.test.mjs`; it cites this
study and is not repeated here.*

## Why not scale the window (theory, a counterexample)

DICOM's LINEAR (PS3.3 §C.11.2.1.2.1) has a −0.5 and a −1 in value units that do not scale with x, so dividing the
window's centre and width by 2^k changes the codes. Worked: c 100, w 11, k 2, code 24 (stored 96) is 38 on the CPU path
and 55 with c 25, w 2.75. LINEAR_EXACT and SIGMOID scale in real arithmetic but not bit for bit in float64 at a code's
half-way point (*derived*, not counted). What is exact instead: the paint already looks every sample up in a table by
code, so entry p is built from the stored value it stands for, through the same rescale, VOI function and rounding in
the same float64 order. Equal by construction; the readback checks the GPU half.

## Results (measured, SwiftShader)

Headless Chrome for Testing 153.0.8010.12, ANGLE on SwiftShader; each case painted at 1:1 at its own depth and at full
scale, every displayed code compared with the CPU path's. Cases: ramps of every code (10-bit at k 0 and 2, 8-bit at k
2, a bias-37 ramp) and one middle frame each of `dbts_a1` (top 10 of 12 bits), `dbts_b1` (10 bits; top 8 of 10),
`dbts_c1` (top 10 of 12). Windows: the ten of `voi.test.mjs`, then narrow windows swept across the range.

* **0 of 7 984 (case, window) pairs differ**, on either path.
* **Mutants:** the shift one bit too large differs in **7 946 of 7 984** windows (the 38 it misses show the whole case
  as 0 or 255 either way); the bias dropped, 2 007 of 2 010 on the bias ramp (0 elsewhere, every DBT bias being 0). The
  full-scale path stays equal under both. In the unit tests each of three mutants is caught.
* The DBT cases are the source frames reduced by the encoder's formula, not AV1 decodes: the claim is about painting
  any code, and the ramps cover every code a depth has.

Not checked: a GPU; fractional placements (zoom, fit, a fractional pan); the table cache key under a reused buffer.
Nothing was timed: this host's WebGL2 is a software renderer.

## Proposed, not built

* **A `reduced: { shift, bias }` frame field** and a producer handing the picture on at its own depth, `copyTo` into
  shared memory with the luma first and no CPU pass, the default window's range written at ingest (4 bytes a frame).
  The product took another shape: the depth cut's codes painted through `windowTable` at c · 2^(D−10), no `reduced`
  field. The OPFS store keeps only frames checked `true`, so a reduced frame is never stored; were that to change, an
  entry must keep its depth or it reads back painted as full scale.
* **GPU timing, pre-registered 2026-11-04, not run:** arm gpu (paint at its own depth) against arm cpu (the shift pass,
  then the full-scale paint), the four DBT cases, 30 rounds in a Williams order after a discarded warm-up; *less* if
  the median gpu ÷ cpu ≤ 0.95 and gpu faster in ≥ 90 % of rounds. Predicted ≤ 0.5 on all four (the pass is about 7–8,
  31–35 and 9–10 ms against a GPU paint of about 0.34 ms for 512², *derived*). Owed to a machine with a hardware GPU,
  whose renderer line must name it.

## Verdict, with its scope

On SwiftShader, three DBT frames and ramps of every code: painting reduced codes through a table built for them shows
exactly the full-depth path's codes; scaling the window does not. A GPU and its timing are owed.
