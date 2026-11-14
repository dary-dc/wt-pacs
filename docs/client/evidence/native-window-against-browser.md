# The native window against the browser

**Question:** Does the native client's window, on each paint thread (`ui`, `view`, `core`), keep the reading the
native CLI gave against the browser (M2: on a clean link no gain on fill, the first frame earlier, the gain where the
client's CPU binds)?

*Folded 2026-11-14 from `claude/native-metrics:docs/native/README.md` §The interim run, pre-registered and §The interim
run: results (3ee2da30, baf46b63, d5b01b1b), word for word but for relative paths. M1–M4 are the native client's
milestones ([`native-client-milestones.md`](native-client-milestones.md)); NATIVERUN is the view-worker design run
natively, pre-registered in [`../../native/README.md`](../../native/README.md) §The comparison and never run; §6 is
that README's. The runner and rows are on that branch: `lab/native-window/run.py`, `run_test.py` and `rows.jsonl` (at
d5b01b1b). Measured, one 4-vCPU container, lavapipe and SwiftShader under Xvfb: no GPU, no vblank claim.*

## The interim run, pre-registered (2026-10-30)

*Written before any data, with its runner `lab/native-window/run.py` (at 3ee2da30) and the rule's
test on made-up rows, `run_test.py` there, each of its nine mutants failing it. A one-round smoke of the 4.4 MB
loopback cell, run under the series' generation to check the wiring, is not kept.*

**The question.** M2 (§6) timed the native client with `native-fill`, a CLI; the window has never been timed. Does the
window, on each paint thread, keep M2's reading against the browser? It is not NATIVERUN: one design question, no busy
UI, no cine.

**What the window adds for it** (lab settings, defaults unchanged): `--exit` closes the window once every frame has been
exact on the thread that paints and, with `--steps`, a step's interval after the last; `--size` sets its inner size.
At its end it prints a `visit` line: dial → first frame exact on the thread that paints, → first painted (after the
GPU's queue drained, with `--stamp-painted`), → last frame of the series exact, and the p99 of the gaps between frames'
arrivals off the wire (`Event::Frame`'s `at`, sorted). `count::tests` hold the times (five mutants, each failing them), `client/paint/window.mjs` the
end on each paint thread (seven). One survived the first form of the check — the `ui`
window ending at frame 0, unseen while its frames arrived in one burst — and the check now spaces them with the
cache's write delay.

**Protocol: M2's**, with these changes and nothing else.

* **Native arms**, one per paint thread: `native-window --paint-thread ui|view|core --exit --stamp-painted --size
  1280x691 --budget 268435456`, on one Xvfb (`-noreset`, on the client cores) and lavapipe. The budget holds either
  series decoded, so the want of `view` and `core` is the whole series and the fill runs to its end. Decoders
  `min(3, cores)` = 2 under the pinning, printed with every setting in each row.
* **Browser arm**: M2's `browser.mjs`, the viewer at the core's default, `?view=page` (its status line prints `view
  page`), Chrome for Testing 153.0.8010.12 headless, SwiftShader, canvas 1280×691.
* **Cells**: the fill only; loopback and 20 Mbit clean (`link_impair.py`, 40 ms each way, its 50-packet queue,
  `--self-timing`); the 61 MB and the 4.4 MB series (below). 4 cells × 4 arms × A and A2 = 32 visits a round, in
  `lab/scripts/order.py`'s Williams order (`lab/order.mjs` for Python), 7 rounds, 224 visits. A fresh server per visit,
  warmed by one unrecorded `native-fill` fill. Pinning M2's: server on core 0, relay on 1, every client process
  (Chromium's, the window, Xvfb) on 2–3.
* **Metrics, one per cell.** *Latency*: dial to the first exact frame on screen — the window's `first_shown_ms`, the
  browser's `firstShown` with its paint settled (`settlePaint`, `lab/viewer/levers.js`). *Throughput*: the fill after
  the first frame, dial to the last frame exact less dial to the first; the window counts a frame exact on the thread
  that paints, the browser on the page. It is quoted as a time over a fixed series, not as a rate. Printed, not judged:
  the window's inter-arrival p99 and every core's busy share.
* **Predictions**, from M2's `native-fill` (§6): (i) the first exact frame on screen is earlier — native ÷ browser
  ≤ 0.9 *and* ≥ 16.7 ms earlier, round-paired medians — in every cell (M2: 0.30–0.33 on loopback, 0.76–0.90 on the
  relay); (ii) on loopback the fill after the first frame is ≤ 0.6 × the browser's (M2's P1); (iii) at 20 Mbit it is
  within ±3 % (M2's P2).
* **`VOID`**: a visit whose relay p99 is over 1 ms; a cell, for a paint thread, where its or the browser's A2/A median
  strays past half its band — fill ±20 % on loopback and ±1.5 % at 20 Mbit (M2's), first frame ±5 % (new). Under 3
  round pairs a cell is undecided.
* **Saturation guard**: per visit, the client cores' busy share from `/proc/stat` (steal counts as busy), and the relay
  core's in the relay cells. A cell is saturated for a paint thread where its arm or the browser runs the client cores
  ≥ 0.9 busy at the median, or the relay core ≥ 0.8: its ratio is printed and nothing is claimed. M2's browser ran its
  two cores at 0.96 on loopback, so the loopback cells are expected to claim nothing.
* **Rule.** For each paint thread: **"M2's reading holds for the window"** if every decided cell — not `VOID`, not
  saturated — holds its prediction and at least one is decided; **"does not hold"**, naming the cells, if any decided
  cell fails; else **undecided**. A visit with any frame not exact is failed and not counted.
* **Not symmetric, stated:** under `ui` the dial starts as the window opens, so its first frame waits on the UI thread's
  surface and adapter set-up; under `view` and `core` the dial follows them; the browser dials after its page's load.
  Both clients render in software (lavapipe, SwiftShader): nothing here is a GPU, vblank or on-screen-on-time claim.
* *Corrected after its first round, before any visit was counted (2026-10-30):* the window refused the 61 MB series
  at its first paint ("LINEAR needs a window width ≥ 1, got NaN"): the series has no window in its metadata, and the
  window, unlike the browser and `native-fill`, had no fallback. It now windows such a frame by its decoded range
  through its rescale, as `client/view/controller.js` does (`Voi::of_range`; a drag on such a series is ignored, not
  fixed). `paint::tests` and a windowless run in `client/paint/window.mjs` hold it, |Δ| 0 at 1:1 on every paint thread;
  three mutants of the range and one dropping the fallback each fail them. Two starts are kept in `rows-aborted.jsonl`,
  not counted: a first round of 32 visits, and a restart of 29 that I stopped by mistake, which ran a build that had
  lost the fix's `window.rs` half to a mutant's restore — in each, the window's visits of the 61 MB series failed. The
  run then restarted at round 0 on the fixed build. Nothing else changed.

**The series**, made by `lab/native-fill/run.py --make-series DIR` (removed from the tip since; at 0920153d) (`lab/scripts/gen_frame_pnm.py`, OpenJPH 0.31.0's
`ojph_compress` in the served profile, `pack-series`; digests from the generated samples). The generator is seeded by
the frame's index, so the bundles are the same bytes on every run; they are not committed, and their SHA-256 is here
to check a rebuild against.

| series | frames | size, bits | content | coded | `.sbnd` SHA-256 |
| --- | ---: | --- | --- | ---: | --- |
| `large` | 37 | 1024 × 1024, 16 | `field` | 60.69 MB | `48fecc5a920dbf30fab1b779b67a16311a52fb5a1bf2b777f1bddf56d927ffca` |
| `small` | 102 | 512 × 512 RGB, 8 | `cine` | 4.42 MB | `e9116f5ba90940574d022b189904bfe1b9f03e843f318b2122742e179fa4f5c0` |
| `mammo` | 16 | 3328 × 4096, 12 of 16 | `ct` | 211.96 MB | `d0463adef52d7f7957c9c49bfe2f52d05386a2c7a416e092d9e911ff0c1cb464` |

M2's two series came out at the same coded sizes; its bundles were not kept, so byte identity with them is not shown.
`mammo` is the memory and step cells' series (436 MB decoded), 12 bits stored as the real 3328 × 4096 mammograms are
([`../../FIXTURES.md`](../../FIXTURES.md)); the generator writes `bitsStored` from the largest sample. The three took 4 min 22 s on 4 cores.

## The interim run: results (2026-10-30)

*Run on `claude/native-metrics` from the section above, 7 rounds, 224 visits, rows in
`lab/native-window/rows.jsonl` (at d5b01b1b); `python3 lab/native-window/run.py --summary --out
lab/native-window/rows.jsonl` prints all of what follows. 0 visits failed: every frame of every visit exact. 37 visits
voided by the relay's p99, all at 20 Mbit.*

**Verdict, by the rule:**

* **`view`: "M2's reading holds for the window"**, in its 2 decided cells.
* **`ui`: "M2's reading does not hold"**, in the 4.4 MB series' fill at 20 Mbit.
* **`core`: "M2's reading does not hold"**, in both fills at 20 Mbit.

| cell | metric | `ui` ÷ browser | `view` ÷ browser | `core` ÷ browser | label |
| --- | --- | --- | --- | --- | --- |
| 61 MB, loopback | first frame | 0.298 | 0.249 | 0.212 | `VOID` (browser's A/A 0.924; `core`'s 0.853) and saturated |
| 61 MB, loopback | fill after it | 0.645 | 0.486 | 0.480 | saturated |
| 61 MB, 20 Mbit | first frame | 0.862, 206 ms earlier | 0.871, 187 ms | 0.880, 174 ms | holds, n = 7 |
| 61 MB, 20 Mbit | fill after it | 1.005 | 1.005 | **1.073** | holds · holds · **fails**, n = 7 |
| 4.4 MB, loopback | first frame | 0.258 | 0.159 | 0.147 | saturated; `view`, `core` `VOID` |
| 4.4 MB, loopback | fill after it | 0.740 | 0.488 | 0.482 | saturated |
| 4.4 MB, 20 Mbit | first frame | 0.722, 161 ms earlier | 0.689 | 0.709, 167 ms | holds · undecided (n = 2) · holds |
| 4.4 MB, 20 Mbit | fill after it | **1.051** | 1.028 | **1.036** | **fails** · undecided · **fails** |

Round-paired medians; A/A within half the band unless labelled. The browser's arm runs at its default, `?view=page`.

* **Where the host saturates.** On loopback the browser holds its two client cores at 0.98 (max 0.99) in both series,
  as M2 found and the protocol expected, so no loopback cell claims anything. There the window ran 0.61–0.70 of two
  cores under `ui` and 0.84–0.89 under `view` and `core`; their ratios are printed above and claimed for nothing. At
  20 Mbit nothing is busy: clients ≤ 0.63 of two, server ≤ 0.14, relay core ≤ 0.33.
* **The first frame on screen is earlier on the relay under every paint thread**: 174–206 ms on the 61 MB series, 161–167 ms
  on the 4.4 MB, at 0.69–0.88 of the browser's — M2's 0.76–0.90 for `native-fill`.
* **The fill after the first frame at 20 Mbit is where the window departs.** `core`'s 61 MB fill is 7 % slower, and its
  inter-arrival p99 is 1 027 ms against 722–724 ms under `ui` and `view`: the receive shares the core thread with the
  paint, which is what NATIVERUN's prediction (d) names; here it costs fill on the relay, not only at loopback.
* *A reading labelled post hoc, not the rule's:* on the 4.4 MB series the two fails are 3.6–5.1 % *after the first
  frame*, and the window's first frame is 160–180 ms earlier. Measured from the dial, the whole fill is a tie: medians
  2 345 (`ui`), 2 298 (`view`), 2 329 (`core`) against the browser's 2 320 ms. The metric moves the window's earlier
  start into a longer remainder. On the 61 MB series, from the dial, `core` is 27 115 ms against 25 463–25 583 for
  the others and the browser's 25 525: its loss is real by either measure.
* **What it says for NATIVERUN.** The window under `view` reproduces M2's `native-fill` on the relay; `core`'s slower
  relay fill is a first sign against N2 replacing N1 on metric 5, which NATIVERUN decides. Not GPU, not vblank: both
  arms render in software.
