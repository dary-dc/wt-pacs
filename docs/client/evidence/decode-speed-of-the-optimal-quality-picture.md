# How fast does the client decode the optimal-quality picture, against an HTJ2K frame?

**Question:** what does one optimal-quality frame cost to decode in the browser (WebCodecs, or dav1d-WASM after a
refusal), set against the exact frame's HTJ2K decode, and what may be said of a slow device?

*Folded 2026-11-14. Sources, each cited where used: the decode audit, adversarial toward the studies and re-running
nothing in a browser (`claude/av1-audit-decode:docs/av1/audit-decode.md`, 2026-11-10, `ea329b54`; "DA n" below is its
finding n); the corrections it led to (`claude/av1-corrections:docs/av1/corrections.md` §7, §11, 2026-11-11,
`2e4efdfc`); the protocol it pre-registered (`claude/av1-corrections:docs/av1/audit-protocols.md` §C, `664a6179`); the
profiles study's decode (`claude/av1-quality-profiles:docs/av1/README.md` §Quality profiles, `1232918d`); that
protocol's run (`claude/audit-measure:docs/av1/audit-protocols.md` §C · amendment 1 and §C · measured, 2026-11-12,
by a session that wrote none of it, `2d180dcd`; rows `claude/audit-measure:lab/av1/audit/rows/c.jsonl`); the tiles
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
and the view's ratio cannot be compared as `docs/lines/codecs.md` does. *Since 2026-11-12* that unit (Hp below) is
timed: 19.8, 57.1 and 20.1 ms a frame at 1× on `dbts_a1`, `dbts_b1`, `dbts_c1`; Hp = 1.03–1.08 of the bare build and
the package = 1.26–1.52 Hp, the factors for restating earlier ratios (*derived*).

## Results, as corrected

* **The view at Q 8, 1×, is 1.24, 1.74 and 1.36 of the product's HTJ2K frame** on `dbts_a1` (cut), `dbts_b1`, `dbts_c1`
  (cut), measured 2026-11-12 (§Protocol C, measured, below). *Corrected 2026-11-14:* this file first quoted the audit's
  *derived* 1.55–1.81 on `dbts_a1` and `dbts_c1`; measured on one unit, both came in below that band. *Corrected 2026-11-11:* the quoted "1.05–2.04 HTJ2K frames, Q 8, G 1" spans three rungs a
  set, and its lossy clock carries `back()`, a JavaScript pass over every sample whose result is discarded (3.5,
  10.6, 2.8 ms; 0.23–0.29 of the HTJ2K unit, timed in Node on another host). At Q 8 only `dbts_a1` and `dbts_c1` have
  cells (1.824, 2.040 as run); `dbts_b1`'s lowest rung is Q 16 (1.714); the 1.05 end is `dbts_a1` at Q 32. With
  `back()` off the clock the coarse rungs move to about 0.77–1.06. "1.9–4.7 through dav1d-WASM" is the 12-bit stream,
  not the view WebCodecs decodes.
* **Nothing shows WebCodecs under one HTJ2K frame on a slow device** (DA 1). The only evidence (0.81–0.97 on
  `dbts_a1` and `dbts_c1` at 4×) comes from `throttleTree` without `cores`, which caps each thread: multi-threaded
  WebCodecs gets several quarter-CPUs against single-threaded OpenJPH's one. HTJ2K slowed ×4.5, WebCodecs ×2.9. A
  slow device's speed was **unmeasured**, not favourable; with `cores` capped (below) it is still not shown under one
  frame.
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

## Protocol C: decode on one HTJ2K unit, on a core-capped host

*Pre-registered 2026-11-11 (`claude/av1-corrections:docs/av1/audit-protocols.md` §C), run 2026-11-12 under an amendment
written before any decode was timed (`claude/audit-measure`, `2d180dcd`).* Arms, each one decoder in its own worker,
one frame in flight: Hp (the product's `decodeFrame` plus XXH3 and the compare, what a Lossless request runs), Hb (the
bare build), Hk (the package), W (the product's WebCodecs read, one decoder kept and flushed), Wb (W with `back()`),
D (dav1d-WASM, one thread). Streams: the demo's form at Q 8 and at the noise rule's Q (`dbts_a1` Q 6, `dbts_b1` Q 11,
`dbts_c1` Q 7), G 1, the middle 16 frames. Throttles 1×, 4× per thread, 4× with `cores` 2 and 1. 15 rounds, Williams
order, the demo tip `18d2d1ff`, Chromium 153.0.8010.12, one 4-core cloud host without a GPU, `prefer-software`.

**Checks held:** no hash miss, no void round; A/A Hp′ ÷ Hp 0.96–1.02; the known-cost mutation moved Hb by its own cost
within the A/A half-width in all 12 (volume, throttle); the cores lever read 4.11×, 8.14× and 15.51× against 4, 8, 16.

W ÷ Hp, mean over 15 rounds (t 95 % interval):

| stream | 1× | 4× | 4×, `cores: 2` | 4×, `cores: 1` |
| --- | --- | --- | --- | --- |
| `dbts_a1` Q 8 | 1.24 (1.18–1.30) | 0.68 (0.63–0.72) | 0.74 (0.69–0.78) | 1.16 (1.10–1.23) |
| `dbts_a1` Q 6 | 1.72 (1.63–1.80) | 1.12 (1.04–1.20) | 1.12 (1.06–1.18) | 1.56 (1.49–1.63) |
| `dbts_b1` Q 8 | 1.74 (1.66–1.81) | 1.06 (1.02–1.09) | 1.07 (1.02–1.11) | 1.58 (1.50–1.66) |
| `dbts_b1` Q 11 | 1.29 (1.24–1.34) | 0.69 (0.65–0.74) | 0.74 (0.72–0.76) | 1.21 (1.15–1.27) |
| `dbts_c1` Q 8 | 1.36 (1.27–1.45) | 0.70 (0.66–0.74) | 0.75 (0.71–0.80) | 1.23 (1.15–1.31) |
| `dbts_c1` Q 7 | 1.53 (1.43–1.62) | 0.86 (0.78–0.94) | 0.89 (0.83–0.95) | 1.39 (1.31–1.47) |

* **By the decision rule, no claim:** W ÷ Hp's upper bound is above 1 at `cores: 1` on all three volumes (1.23–1.66)
  and at `cores: 2` on `dbts_a1` Q 6 and `dbts_b1` Q 8. "WebCodecs decodes under one HTJ2K frame on a slow device" is
  not claimed; a core-capped host does not show it, and a phone is owed. With four or two slowed cores, the Q 8 and
  rule-Q streams `a1` Q 8, `b1` Q 11, `c1` Q 8 and Q 7 decode in 0.68–0.89 of the product's HTJ2K frame.
* Uncapped 4× takes 0.52–0.68 off W ÷ Hp on every stream, which is the thread count, as the audit said; `cores: 2`
  lies within 0.00–0.06 of uncapped 4×. W ÷ Hp rises as Q falls (more bytes to entropy-decode).
* `back()` on the clock, (Wb − W) ÷ Hb: 0.26–0.37. D ÷ Hp (dav1d-WASM): 1.86–2.89 on every stream and throttle.
* **Saturation:** at 1× W uses up to four cores and the others one, so the 1× ratios hold for a 4-core host only; at
  `cores` 1 and 2 the cap is the limit. A capped cloud core is not a phone core; nothing speaks for G > 1, hardware
  decode or concurrent decodes.

## Verdict, with its scope

On three DBT volumes of one dataset, G 1, one 4-core host with software decode: the optimal-quality view at Q 8 costs
1.24–1.74 of the product's HTJ2K frame at 1× (measured 2026-11-12), and on a host capped to one slowed core it is
still 1.16–1.58, so no measurement shows it cheaper than the exact frame on a slow device. A phone or a hardware
decoder is owed for any device claim.
