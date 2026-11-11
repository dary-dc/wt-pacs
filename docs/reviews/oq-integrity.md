# Review: the optimal-quality frame's integrity and coding error (PR 368)

*Row OQ-INTEGRITY-REVIEW, 2026-11-11, by a session that wrote neither the theory
(`claude/oq-integrity:docs/lines/proposals.md` §Integrity, `39a7bdd3`) nor the build (`claude/oq-integrity-build`,
`08bf659e`). What was checked: each change reverted with its test kept; mutants of my own beside the PR's; every path
that sets the label; the committed rows against I1's pre-registered protocol. Fixed nothing.*

*Host and limits: one 4-core cloud host without a GPU. The node and Python tests ran here, on `ingest/tools.sh`'s
build (aomenc 3.15.1, dav1d 1.5.4). The Chromium protocol was **not** re-run: the rows are read as committed, and the
findings on them come from the rows and the code. Fixtures as the build's: three DBT volumes (`dbts_a1`, `dbts_b1`,
`dbts_c1`) of one dataset; no hardware AV1 decoder in any cell.*

## Verdict

The check never marks a frame as coded unless a digest matched, and every frame-level test fails without its change.
Three gaps remain before the owner's decision:

1. On a refused frame the screen still shows the previous frame's green mark (finding 1).
2. The gate does not hold the mended frame (finding 2).
3. The gate does not hold the page's wiring (finding 3).

The cost rows match the protocol and its rule. One mutant row does not show what the protocol asked of it
(finding 5).

## Each test fails without its change

The source file was reverted to `claude/source-fingerprint` and the new test run against it.

| change reverted | test | result |
| --- | --- | --- |
| `client/decode/av1.js` | `av1.test.mjs` | fails: `av1.decodeAgain is not a function` |
| `client/decode/decoder.js` | `decoder.test.mjs` | fails: 4 claims |
| `client/view/controller.js` | `controller.test.mjs` | fails: both new tests |
| `client/viewer/screen.js` | `screen.test.mjs` | fails: no `integrityText` export |
| `ingest/coded-frames/ingest.py` + `lab/av1/tools/ingest_coded.py` | `lossy_test.py` | fails: `--integrity` unknown |
| `ingest/coded-frames/coding_error.py` | `coding_error_test.py` | fails: no module |
| `client/transport/downloader.js`, `client/viewer/viewer.js`, `client/viewer/index.html` | every `client/**/*.test.mjs` | **all pass**: see finding 3 |

The I2 mutants the protocol names were each killed:

* σ without the rounding term;
* e against the code c rather than c · 2^(D−10);
* the error, and the digest, of frame i written at i + 1;
* the digest over the rescaled cut.

## Findings

**1. On a refused frame the label still shows the last painted frame's ✓.** `client/view/controller.js` `take`
refuses a frame with `asCoded === false` (`store.failed`). `show(i)` then waits on `store.arrival(i)`, which resolves
on the failure without a repaint. No `shown` event follows. `viewer.js` sets the label only on `shown`, so
**Optimal quality ✓** (green) stays on screen from the previous frame. Meanwhile the status line reads `frame i+1 of n`
and `error: frame i: not as coded: …`.

Reproduced on the controller test's rig: frame 0 was taken as coded and painted, frame 1 was taken with
`asCoded: false`, then `show(1)` ran. `current` is 1, no new `shown` event fires, and the last `shown` is
`{i: 0, quality: "asCoded"}`. The canvas still holds frame 0, so strictly the label describes what is painted, but
the reader has stepped to a frame whose check failed and sees a green mark.

I3's table asks for **Optimal quality — not as coded** in this case, and that was not built. The behaviour is the
same as today's for any refused frame (a cut at the wrong depth, a decode failure). The difference is that here the
stale label carries a check mark.

*Smallest fix:* on a frame-scope `failed` for `current`, emit a `shown`-like state that names the refusal, or clear
the label. Add a controller test, then mutate it.

**2. The gate does not hold the mended frame.** Mutants of `client/decode/decoder.js`'s second-decode success line
all survive `decoder.test.mjs` and every other client test:

* M2: `verdict(false)` in place of `verdict(true)`;
* M3: return the first route's picture `r` with `asCoded: true` in place of `again`;
* M4: drop `mismatchOn`.

M3 is the one that matters. It would label as coded the very samples whose digest failed. Only the Chromium row
`webcodecs-copy-55` (`paths: av1-webcodecs 55, av1-dav1d 1`) shows the right picture was used, and that row is not
in the gate.

The PR says its survivor is "not observable with the stand-in dav1d, since that cannot be the second route". That is
true of `decoder.test.mjs` as written, but `av1.test.mjs` already stubs a WebCodecs route. A decoder test with a stub
codec whose first route returns wrong samples and whose `decodeAgain` returns the right ones would kill M2–M4 and the
PR's own survivor (the group not reset at a keyframe, my M1).

*Smallest fix:* that test.

**3. The gate does not hold the page's wiring.** Reverting the build's changes to three files leaves every client
test green:

* `downloader.js`, which passes `reconstruction` to the decoder worker;
* `viewer.js`, which reads `meta.lossy.reconstruction`, holds the label text `Optimal quality ✓`, the status line's
  `as coded N` and the overlay's `integrityText` call;
* `index.html`, which makes `#quality.asCoded` green.

Dropping `reconstruction` there fails safe: no check, label *Optimal quality*. But the gate also would not see a
label string or class that claims more, for instance `asCoded: "Lossless"`.

I3 named the holder: "a `demo-check.mjs` check per state, each mutated". No `demo-check.mjs` change is on the branch.
Only `lab/oq-integrity/run.mjs`, which is outside the gate, exercises the wiring.

*Smallest fix:* `demo-check.mjs` reads the label for one series with the check, as coded and refused, under `?view=page`
and `?view=worker`.

**4. A `coding_error.py` mutant survives.** σ taken from the reconstruction in place of the source
(`s = sigma(reconstruction)`) passes `coding_error_test.py`, because the synthetic reconstruction carries the same
noise. The protocol defines e_N ÷ σ against "the frame's own noise", the source's. A check whose reconstruction is
denoised (the source's noise removed, as a coder at high Q does) would kill it.

The swapped sign of Δ also survives, but it is equivalent: RMS, \|Δ\| and the band's RMS are all symmetric.

**5. The inter-unit byte-flip row does not show the digest at work.** In `mutants.jsonl` the rows `unit-byte-50` and
`unit-byte-50-dav1d` read `received 50, asCoded 50`. Their only error is
`frame 55 unavailable: undecodable: frame 54 was not decoded before it here`. That is the continuity check in
`client/decode/av1-payload.js` `continues`, raised when the frame before failed to decode, not a digest mismatch.

What the row shows is that a frame of 50–54 failed to decode on both routes. It does not show the protocol's case:
a wrong unit that decodes to wrong samples, caught by the digest, and not mended by the group's re-decode. The
outcome the protocol asks for holds (none of 50–55 shown as coded), but by the decoder's failure.

`run.mjs` keeps only the status line's last error and stops at the first one, so the per-frame reasons are lost.
This is inferred from the error text; not re-run here.

*Smallest fix:* keep every `error:` the page writes in the row, and flip a byte that decodes. Its group then fails
with `not as coded` on both routes.

**6. Cost rows against I1's protocol.** Recomputed from `cost.jsonl`, and they match the PR:

* **Cells and rounds:** the 18 series × on/off × 1×/4× × 7 rounds = 504 fills, none with an error, every `on` fill
  as coded in full.
* **Fill:** the median of per-series Δ is +3.7 % at 1× (−3.5 to +7.5 %) and +1.9 % at 4× (−0.7 to +7.8 %). The
  rule's bar, ≤ 10 % at 4×, holds in every series.
* **Workers:** the downloader's default, `min(3, hardwareConcurrency)`, gives three on this 4-core host.
* **Correctness:** `correct.jsonl` holds 36 fills, 18 on each route, every frame as coded.

Deviations, none of which changes the rule's outcome:

* **First picture is measured but not weighed.** The protocol asks for "fill and first picture". The median per-series
  Δ first picture is +7.8 % at 1× (−7.7 to +12.9 %) and +3.5 % at 4× (−1.9 to +11.3 %). §Integrity in
  `docs/av1/payload-format.md` says "+0 to +13 %", but four cells are negative. The first picture pays the hash before
  its paint, and the fill hides it behind other workers, so it is the reading closer to an on-demand step.
* **The interleave is unbalanced.** `order.mjs` over four cells in seven rounds puts `off 4×` first in 18
  series-rounds against 36 for each other cell.
* **The arms differ by origin.** On is served from :8765 and off from :8766, so each arm keeps its own HTTP and code
  caches. After round 0 both are warm.
* **The 4× throttle barely reaches the decoder workers.** The PR says so itself (the fill moves about a tenth). The
  rule's "≤ 10 % at 4× on this host" therefore says little about a phone. The protocol's phone row is still owed.

**7. Smaller points.**

* **Both kinds of digest present.** `decoder.js` `checked` uses `digests ?? reconstruction`, so a series carrying both
  would be judged against the frame digests and made `exact`. No ingest path writes both (`ingest_coded.py` writes
  `digests` only without `--lossy`), so the mutant `reconstruction ?? digests` is equivalent today. A line in
  `docs/glossary.md`'s reconstruction-digest row that the two never coexist would keep it so.
* **The group kept at G 1.** `groupBefore` returns null at G < 2. A mutant that keeps the group at G 1 survives;
  it costs memory, not correctness.
* **A table's indent.** The per-series table in `payload-format.md` §Integrity has its header at column 0 and its
  rows indented four spaces, so it may not render as one table.

## What the design leaves open

The PR names five choices. To them:

* **Choice 1, the label without a digest, decides finding 1 too.** Whatever an unchecked frame shows, a refused
  frame needs its own state; today it inherits the last one.
* **Choice 3 (re-decode on dav1d only) and choice 5 (O(G²)) meet on a phone.** If a phone's hardware WebCodecs
  decoder is consistently off by one sample, every inter frame mismatches. Each then re-decodes its group from the
  keyframe: about G²/2 dav1d decodes a group, 135 at G 16, on the device least able to pay them. The fill would still
  be correct, but slower than taking dav1d for the rest of the group. Switching the group's route after its first
  mismatch is the alternative; the phone row decides whether the case occurs.
* **Choice 4, the mask.** The formulas in `coding_error.py` match the study's `sigma` and `noise_band` term for term
  (Laplacian ÷ 6, Sobel edge share 0.10, Sheppard's 1/12). So the mask is the one difference that remains for the
  noise-band ratio's 1.25–2.35, as the PR says. I2's protocol, not run, decides it.
* **No hostile server, no painting.** As the theory states, the digest rides the same session as the frames, and
  nothing checks the canvas. The label's ✓ means "the decoder worker's samples are dav1d's for these units", not
  "what you see is right".

Owner decisions are the PR's own; this review adds none.
