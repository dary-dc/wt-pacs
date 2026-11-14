# Is the optimal-quality frame painted as it was coded, and what does checking it cost?

**Question:** an optimal-quality frame is never exact, so it arrives `unchecked`. Can the client still check that the
samples it hands to paint are the frame's reconstruction (what the AV1 decoding process gives for its units), say
how far that reconstruction is from the source, and at what cost?

*Folded 2026-11-14 from four sources, each cited where used: the theory and pre-registered protocols
(`claude/oq-integrity:docs/lines/proposals.md` §Integrity, 2026-11-11, `39a7bdd3`); the build and its run
(`claude/oq-integrity-build:docs/av1/payload-format.md` §Optimal quality, *Integrity*, 2026-11-11, `08bf659e`; draft
PR 368, off by default); its review by a session that wrote neither
(`claude/oq-integrity-build:docs/reviews/oq-integrity.md`, `dc989114`); and the red team's cost correction
(`claude/proposals:docs/lines/proposals.md` §Red team, *Corrections to §Integrity*, `5b4c3341`). Where a frame can be
corrupted at all, and what a failure report may carry, is [`frame-integrity.md`](frame-integrity.md); it is not
repeated here. Whether to take the check is the owner's ([`../design.md`](../design.md) §Decided, 2026-11-11: a
proposal).*

## Two claims, one check each (theory)

* **Integrity:** the painted samples are the reconstruction, bit for bit. AV1 §7.2: "When film_grain_params_present
  is equal to 0, decoders shall produce output frames that are identical in all respects", and the ingest codes with
  no film grain (`--denoise-noise-level=0`). So dav1d at the ingest, Chromium's dav1d behind WebCodecs and
  dav1d-WASM must agree, or one is wrong. WebCodecs' `hardwareAcceleration` values are hints (WebCodecs §7.9), so the
  client cannot know which decoder ran; a hardware decoder is the case the check exists for, and no lab host has one.
  That decoders do agree on these bytes is measured: [`decoders-agree-on-the-same-av1-bytes.md`](decoders-agree-on-the-same-av1-bytes.md).
* **Quality:** how far the reconstruction is from the source, measured once at the ingest, where both are in hand.
  Integrity is what lets the client repeat that number for the frame it paints.

The mechanism (the build): the ingest writes `lossy.reconstruction` (`{"algorithm": "xxh3-64", "frames": [...]}`,
the **reconstruction digest**: XXH3-64 of each frame as dav1d decodes it from its keyframe's unit, two bytes a sample
above 8 bits, for a depth cut over the 10-bit codes) and `lossy.codingError` (`rms`, `max`, `noiseBandRatio`, in
source units, a cut's code c counted as c · 2^(D−10)). It is not `digests`: a frame digest makes a frame `exact`, and
this one never does. The client checks it in the decoder worker's `checked()`, as an exact frame's: matched, the label
reads **Optimal quality ✓**; not matched, decoded once more on the other route (a frame inside a group: the group
again on dav1d-WASM from its keyframe, `av1.js` `decodeAgain`); a second mismatch is refused by name and not painted.

## Results

*Measured, 2026-11-11, `lab/oq-integrity/run.mjs` on `claude/oq-integrity-build`.* Fixtures: the 18 series of
`INTEGRITY=1 scripts/demo-series.sh` (`dbts_a1`, `dbts_b1`, `dbts_c1` of one dataset; Q 8 and 24; G 1, 8, 16; the
depth cut on `dbts_a1` and `dbts_c1`); one 4-core cloud host without a GPU, headless Chromium on SwiftShader, page
view, three decoder workers, loopback. No hardware AV1 decoder in any cell, so only the check's plumbing and cost
are exercised, not the case it exists for.

* **Correct:** every frame of the 18 series as coded through WebCodecs, and through dav1d-WASM with WebCodecs'
  probes made to fail (36 fills).
* **Mutants,** on `dbts_a1-q8-g8-cut`: a wrong digest at keyframe 0 and at inter frame 55, refused on both routes;
  one sample of frame 55 flipped on every route, refused; one sample of inter frame 55 flipped in the WebCodecs copy
  only, **mended** by the group's re-decode on dav1d (454 ms for its group of 8). The review found that the row
  flipping a byte of inter unit 50 was caught by the decoder's continuity check (`frame 54 was not decoded before
  it`), not by the digest: the outcome holds (none of 50–55 shown as coded), the digest's case (a wrong unit that
  decodes to wrong samples) is not shown.
* **Cost**, check on against off, interleaved per round with the throttle, 7 rounds, 504 fills: median Δ fill
  **+3.7 % at 1×** (−3.5 to +7.5 % across series) and **+1.9 % at 4×** (−0.7 to +7.8 %). The pre-registered rule
  (both routes match everywhere, every mutant fails, ≤ 10 % at 4×) holds: *adopt, every frame checked*. The first
  picture, measured and not weighed by the build: median Δ +7.8 % at 1× (−7.7 to +12.9 %) and +3.5 % at 4× (−1.9 to
  +11.3 %), recomputed by the review; the build's "+0 to +13 %" omits four negative cells. Per-series rows:
  `claude/oq-integrity-build:docs/av1/payload-format.md` §Integrity, raw rows `lab/oq-integrity/rows/` there.
* **Where the host saturates:** the fill is decode-bound on three workers of 4 cores. Chromium's 4× throttle moved
  the fill by about a tenth (1182 → 1295 ms on `dbts_a1-q24-g1-cut`), so it reached the page's thread and hardly the
  decoder workers: it is no stand-in for a phone. The spread between series (±4 %) is the size of the effect, so a
  single cell's sign means nothing. The review adds: the interleave is unbalanced (`off 4×` first in 18
  series-rounds against 36 for each other cell), and the arms were served from two origins.
* **The hash's share of a decode**, *corrected 2026-11-11 by the red team*: the theory read it as 1–2 %, dividing by
  a fill's wall time per frame. Against a measured decode through the product's `av1.js` (32–35, 131–133, 36–37 ms,
  4 cores, one tile) a hash of 1.2, 5.2 and 1.5 ms is **3.6–4.2 %** here. A phone's share is unmeasured (*theory*:
  1–10 %).

### The coding error, as built

* **`noiseBandRatio` reads 1.25–2.35 on every demo series**, Q 8 included, which the quality study chose by this
  ratio. `coding_error.py` takes σ over every sample of the frame; the study took it over in-window samples, and a
  DBT frame's flat background outside the breast pulls σ down. The review checked that the formulas otherwise match
  the study's term for term, so the mask is the one difference. Not comparable with the study's figures until the
  coding error's own protocol (its values against the study's rows) runs; not run. The tiles measurement read the same
  quantity by the study's code on the demo's Q 8 series: e_N ÷ σ 1.27–1.94 at the median and maximum frame
  (`claude/proposals:docs/lines/proposals.md` §Round 2, *Tiles at equal quality*).
* The three numbers are frame-pooled and stated, never a verdict: no reader test has shown any of them visually
  lossless on DBT ([`which-quality-is-visually-lossless.md`](which-quality-is-visually-lossless.md)).

## The review's findings, unfixed (2026-11-11)

Every frame-level test fails without its change, and the check never marks a frame as coded unless a digest matched.
Open:

1. **A refused frame keeps the previous frame's green ✓.** `controller.js` refuses a frame with `asCoded === false`;
   no `shown` follows, and `viewer.js` sets the label only on `shown`. The theory's label table asked for
   *Optimal quality — not as coded*; not built.
2. **The gate does not hold the mended frame:** `decoder.js` mutants survive every client test, among them one that
   returns the first route's (wrong) picture marked as coded. A decoder test with a stub codec whose first route is
   wrong would kill them.
3. **The gate does not hold the page's wiring:** reverting the changes to `downloader.js`, `viewer.js` and
   `index.html` leaves every client test green. No `demo-check.mjs` check per label state exists.
4. **A `coding_error.py` mutant survives:** σ taken from the reconstruction in place of the source passes, since the
   synthetic reconstruction carries the same noise.
5. The byte-flip row shows the continuity check, not the digest (above), and `run.mjs` keeps only the last error.
6. The first picture's cost is recorded but not weighed (above).

## What it guarantees, and not (theory)

The samples the decoder worker hands on are those dav1d gave at the ingest for the same units. It does not cover the
paint (window, GPU, display), a hostile server (the digest rides the same session as the frames), or quality: a
perfect reconstruction of a Q 63 stream passes it. Not proposed: a digest of the painted canvas, signed digests, a
per-frame quality gate at the ingest. Sampling (checking some frames) is not proposed: inside a group a fault in frame
k reaches every later frame; if a phone's cost forced one, the order is "the shown frame always, the fill's other
frames at a rate".

## Verdict, with its scope

On the 18 demo series of three DBT volumes, on one 4-core host with software decode: the check is correct on both
routes and costs +1.9 to +3.7 % of the fill (median), which meets its rule. A phone, a hardware AV1 decoder and the
review's six findings are owed before the owner decides. Two choices the review names meet on a phone: a hardware
decoder consistently off by one sample makes every inter frame mismatch and re-decode its group (about G²/2 dav1d
decodes a group, 135 at G 16); switching the group's route after its first mismatch is the alternative. The open
question and its options belong in [`../design.md`](../design.md) §Open.
