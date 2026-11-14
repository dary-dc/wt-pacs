# How fast does the client decode the optimal-quality picture, against an HTJ2K frame?

**Question:** what does one optimal-quality frame cost to decode in the browser (WebCodecs, or dav1d-WASM after a
refusal), set against the exact frame's HTJ2K decode, and what may be said of a slow device?

*Folded 2026-11-14. Sources, each cited where used: the decode audit, adversarial toward the studies and re-running
nothing in a browser (`claude/av1-audit-decode:docs/av1/audit-decode.md`, 2026-11-10, `ea329b54`; "DA n" below is its
finding n); the corrections it led to (`claude/av1-corrections:docs/av1/corrections.md` §7, §11, 2026-11-11,
`2e4efdfc`); the protocol it pre-registered (`claude/av1-corrections:docs/av1/audit-protocols.md` §C, `664a6179`); the
profiles study's decode (`claude/av1-quality-profiles:docs/av1/README.md` §Quality profiles, `1232918d`); the tiles
measurement (`claude/proposals:docs/lines/proposals.md` §P2 and §Round 2, *Tiles at equal quality*, `5b4c3341`).
The decode route itself (WebCodecs first, dav1d-WASM after a refusal) is decided ([`../design.md`](../design.md)
§Decided, 2026-11-11); nothing here changes it, only what may be said of its speed.*

Fixtures, for every measured figure unless it names fewer: `dbts_a1` (56 × 1142 × 1785, 12-bit), `dbts_b1`
(50 × 2560 × 3328, 10-bit), `dbts_c1` (69 × 976 × 2513, 12-bit), one dataset, usually the middle or first 16 slices;
4-core cloud hosts at 2.1–2.8 GHz, headless Chromium, no GPU, `prefer-software`. No phone, no hardware decoder, no
breast ultrasound cine.

## "× an HTJ2K frame" is four units

Every ratio in the AV1 studies divides by "an HTJ2K frame", and four things carry that name (DA §The HTJ2K frame is
not one unit, findings 12, 16):

| unit | its clock spans | Chromium | used by |
| --- | --- | --- | --- |
| the product's OpenJPH build | header, decode, one `slice()` copy | 141.0.7390.37 | the profiles study's decode |
| the same build plus a JS pass | decode, then `out[k] = v[k] − shift` into a fresh array | 153.0.8010.12 | residual apart |
| `@cornerstonejs/codec-openjph` 2.4.11 | decode, copy into shared memory, a JS range pass | 153.0.8010.12 | profile carriers, SNR and SVC previews |
| the package through the decoder worker | decode, range pass, XXH3, messaging | 141.0.7390.37 | `docs/decode/README.md` §Decode time against HTJ2K |

The range pass alone is 21–31 % of a frame; the product's build was ×0.715–0.732 of the package on a cold ask. A
ratio from one row cannot be set beside one from another. The unit the product ships, its own build with the range in
the pack and a digest on the exact frame, **is timed in none of them**. So the exact ask's "1.01–1.03 HTJ2K frames"
and the view's ratio cannot be compared as `docs/lines/codecs.md` does.

## Results, as corrected

* **The view at Q 8, 1×, is about 1.55–1.81 HTJ2K frames** on `dbts_a1` and `dbts_c1` (top-10-bit stream), *derived*
  by the audit (DA 2, 13). *Corrected 2026-11-11:* the quoted "1.05–2.04 HTJ2K frames, Q 8, G 1" spans three rungs a
  set, and its lossy clock carries `back()`, a JavaScript pass over every sample whose result is discarded (3.5,
  10.6, 2.8 ms; 0.23–0.29 of the HTJ2K unit, timed in Node on another host). At Q 8 only `dbts_a1` and `dbts_c1` have
  cells (1.824, 2.040 as run); `dbts_b1`'s lowest rung is Q 16 (1.714); the 1.05 end is `dbts_a1` at Q 32. With
  `back()` off the clock the coarse rungs move to about 0.77–1.06. "1.9–4.7 through dav1d-WASM" is the 12-bit stream,
  not the view WebCodecs decodes.
* **Nothing shows WebCodecs under one HTJ2K frame on a slow device** (DA 1). The only evidence (0.81–0.97 on
  `dbts_a1` and `dbts_c1` at 4×) comes from `throttleTree` without `cores`, which caps each thread: multi-threaded
  WebCodecs gets several quarter-CPUs against single-threaded OpenJPH's one. HTJ2K slowed ×4.5, WebCodecs ×2.9. A
  slow device's speed is **unmeasured**, not favourable.
* **dav1d-WASM against WebCodecs** (DA 10): WebCodecs is 1.4–1.9× faster where it is exact (median 1.55,
  `docs/decode/README.md` §Decode time against HTJ2K). dav1d-WASM is C without assembly on one thread, Chromium's
  dav1d has assembly and threads, so the gap is mostly build and threads; and dav1d-WASM's cost rises with Q where
  WebCodecs' falls (`dbts_b1` in order: dav1d 94.8 → 163.4 ms from Q 16 to Q 56, WebCodecs 63.5 → 50.0).
* **Jumps** (DA 7–9): the profiles harness opens a new `VideoDecoder` for every jump (about 0.2–0.25 of an HTJ2K
  frame of start-up) where the product keeps one and flushes, so every jump multiple (7.6–30×) is inflated. G > 1 is
  decode-timed only on low-delay streams (`--lag-in-frames=0 --auto-alt-ref=0`), and G is compared at equal Q, not
  equal quality.
* **The flush** (DA 20): *corrected 2026-11-11:* "removing the flush measured −7 to −20 % at 1× … exact" compared arms
  that also differed in `optimizeForLatency`; the flush alone waits 1.3–2.0 ms a frame at 1×. The sentence stands
  uncorrected in `docs/decode/README.md` (§Where a G = 1 frame's time goes, predicted), as does "the fixtures are synthetic" (§What these numbers are not),
  no longer true of the AV1 timings.
* **No result rests on hardware decoding or a phone** (DA 11). "AV1 saves bytes, not decode time" holds at Q 8 at 1×
  on this host and should say so, with its rungs, stream and host.

### Superseded: the profiles study's decode figures

*Measured 2026-11-04, six 4-core hosts, 108 rounds pooled, retracted in part by the audit (DA 2–5):* a lossy frame
through WebCodecs 1.05–2.24× an HTJ2K frame at 1×; a G 16 jump through dav1d-WASM 3.8–13× a G 1 jump; the residual's
decode plus its add 1.42–1.69× an HTJ2K frame; residual apart's 0.97–1.00. Their clocks span different work (`back()`
on the lossy clock, the JS add on the residual's, a JS pass in residual apart's HTJ2K arm). Aligned, the residual's
decode alone is 1.02–1.07 HTJ2K frames and the add 0.3–0.4 more. The residual was dropped (the owner, 2026-11-09), so
these stand only as a record.

## AV1 tiles in the optimal-quality encode

*Measured 2026-11-11 on `claude/proposals`, 4-core host, headless Chromium software decode, SwiftShader; Q 8; the
three volumes.* 2 × 2 tiles: per-frame decode 0.64–0.72× of one tile; the G 16 jump on `dbts_c1-q8-g16-cut` 406 →
152 ms (0.37×, against a predicted 0.70–0.85×), but 0.99× under a 2-core `taskset` pin, where the one-tile jump itself
was 199 ms (unexplained; `navigator.hardwareConcurrency` read 2, so two decoders ran); bytes 1.0001–1.0065×; e and
e_N ÷ σ 0.997–1.002× one tile's; every frame of both arms as coded through WebCodecs (14 of 14 fills). 2 × 1 was
rejected (decode 0.84–0.94×). **Not ready by its rule** at equal quality: max |Δ| at the median frame rose by 5 source
units on `dbts_a1-q8-g8-cut` (109 → 114) against a one-unit bar, while it moved −5 to +1 elsewhere; a cut series'
code step is 4 source units, so the bar sits under one step. A bar in code steps would decide; none is proposed.
Tiles wait until after the demo (the owner, 2026-11-13).

## What would decide the open claims: protocol C (pre-registered 2026-11-11, not run)

On one Chromium and one host: arms Hp (the product's `decodeFrame` plus XXH3 and the compare, what a Lossless request
runs), Hb (the bare build, the profiles unit), Hk (the package), W (the product's WebCodecs read, one decoder kept and
flushed), Wb (W with `back()`), D (dav1d-WASM); the demo's optimal-quality form at Q 8 and the noise rule's Q, G 1,
16 frames; throttles 1×, 4× per thread, 4× with `cores` 1 and 2; Williams order, at least 15 rounds; a known-cost
mutation (a dummy JS pass over every sample in Hb must move Hb ÷ Hp by its own cost). The line then quotes the view
only as W ÷ Hp with its throttle, form, Q and host. **"WebCodecs decodes under one HTJ2K frame on a slow device" is
claimed only if W ÷ Hp has a 95 % upper bound below 1 at both `cores: 1` and `cores: 2` on all three volumes**;
otherwise the line says a core-capped host does not show it and a phone is owed. Saturation: W uses up to four
decoder threads at 1×, so the 1× figures hold for a 4-core host only; a capped cloud core is not a phone core.

## Verdict, with its scope

On three DBT volumes of one dataset and 4-core hosts with software decode: the optimal-quality view at Q 8 costs
about 1.55–1.81 HTJ2K frames (*derived*, two volumes), and no measurement shows it cheaper than the exact frame on a
slow device. The product's own HTJ2K unit is untimed. A phone or a hardware decoder is owed for any device claim.
