# The view worker's start

**Question:** How long does the view worker take from page load to the first painted frame?

*Moved 2026-11-14 from `docs/adr/frame-path.md` at `e5b20cba` (§The view worker's start, timed), word for word but for
queue-row names. A bare §N or §Name is a section of that ADR: [its map](../../adr/frame-path.md) names the file each
now lives in. Choices 1–8 are [the cache's](cache-in-opfs.md#the-choices-and-what-decides-each). The design these
findings shape is [`../design.md`](../design.md).*

## The view worker's start, timed (pre-registered 2026-10-30, before any data)

**Why.** B′'s quiet first frame is later than A's in 15 of §7's 16 cells. Read from `view-quiet.jsonl` paired by round
(rows measured; the cause below is inferred from code, not measured): B′ − A is already there at the last byte, the
same mid-fill as at the end, and last byte → frame held moves by ±4 ms. So it is a fixed delay before the first byte,
not a cost a frame. In B′ the downloader hears `start` and `dial` from the view worker, over the port, only once that
worker has booted: the page creates it once the metadata is in (`client/viewer/viewer.js`), it loads its module graph
(the consumer, the paint module, `cache.js` with the cache off, the controller), builds the controller and the WebGL2
context in `start`, and only in `connect` posts `start` and `dial`. In A the page posts both at connect. §2 counted
hops a frame in the steady state and left the start out. A short series loses one more round trip: a want shorter than
`askDepth` is not a run (§3, *The want*), so the dial carries no opening run and frame 0 is asked once it is up; A's
`fill` always rides the dial. The fill bar is a ratio, so one fixed delay reads ×1.01 on CT's 3.5 s fill and ×1.07–1.23
on the mammogram's one frame: one cause failing two criteria.

**Stamps** (lab only in use: each is one clock read, taken once a page; only the lab's ledger reads them). Epoch ms,
`performance.timeOrigin + performance.now()` in whichever thread takes it, reported from navigation:

| stamp | taken in | arm |
| --- | --- | --- |
| `metadata`: the metadata in | the page | both |
| `viewWorker`: the view worker created | the page | B′ |
| `viewEvaluated`: its module graph loaded and evaluated | the view worker, its top level | B′ |
| `viewStart`, `viewGl`, `viewConnect`: `start` received, the WebGL2 context made, `connect` received | the view worker | B′ |
| `gl`: the paint worker's context, as heard on the page | the page | A |
| `connect`: the page's connect, the fill's issue | the page | both |
| `downloaderEvaluated`, `downloaderStart`, `dialReceived`: its script run, `start` received, `dial` received | the downloader | both |
| `decodersReady`, `dial`, `sessionOpen`: every decoder up; the transport's connect called, and resolved | the downloader | both |
| `firstIn`: the first frame's last byte (the transport reports no first byte; this stands for it) | the downloader | both |
| `firstHeld`, `firstDrawn`: the first exact frame held, and drawn | the store; the paint | both |

The downloader's stamps ride the first frame it dispatches; the view worker's ride its ledger.

**Run.** A (`page`), its A/A (`pageaa`) and B′ (`worker`); the quiet page; Chromium and Firefox; §7's four series;
`r50000`; **1×**; 12 rounds, cells and arms interleaved by `run.mjs` (`lab/order.mjs`); kept as §7 keeps a visit
(relay VOID, an error or an inexact frame drops it; a cell counts the first 12 rounds in which every arm was kept).
**4×** only after every 1× cell, only in a cell whose 1× start was unsaturated by the guard, and only if the usage
window allows; otherwise not run, and said. Rows: [`lab/viewer/rows/start-quiet.jsonl`](https://github.com/dary-dc/wt-pacs/tree/643ce5597713523c308e62366624570fb1865345/lab/viewer/rows/start-quiet.jsonl) (at `claude/view-start@643ce559`, not in this tree).

**Guards.** *Saturation:* the browser's three cores' busy share from `/proc/stat`, sampled every 20 ms by the rig,
over the start (navigation → first drawn) and over the fill after it (first → last exact frame held); A's median at or
past 0.95 saturates that window, and its bar claims nothing in that cell. *VOID:* `pageaa` − `page`, median over paired
rounds, 16.7 ms or more apart on the first frame, or the fill after it outside ×0.98–1.02.

**The bars, corrected** — a new pre-registration, not a re-reading of §7's rows; read by
`node lab/viewer/start-summary.mjs`:

* **Latency is the first exact frame drawn**, from navigation: an arm's median paired Δ against A of +16.7 ms or more
  is *later*, −16.7 ms or less *sooner*, else a tie.
* **Throughput is the fill after the first frame**: the last exact frame held less the first, paired ratio against A;
  above ×1.02 *slower*, below ×0.98 *faster*, else a tie. **A one-frame series has no throughput bar.**
* **An arm ties A** when no decided bar of any cell finds it later or slower, and each engine has a cell whose latency
  is decided. Otherwise it is behind A, by name, or undecided.

**Reported:** each stamp's median per arm and cell, and B′ − A step by step: where the delay goes.

**Predicted from the code**, before data: B′'s `downloaderStart` later than A's by what remains of the view worker's
boot at connect plus two message hops; the dial and the decoders follow it by the same; the mammogram later again by
one round trip (≈ 40 ms) at `firstIn`; nothing after `firstIn` apart.

**Held by** `lab/viewer/start-summary.test.mjs` (each guard and bar on made-up rows; mutants: the busy share's sample,
the bars loosened, the fill from navigation, a one-frame fill judged, the VOID and saturation guards ignored, an
inexact visit kept — each fails it) and `client/transport/downloader.test.mjs` *theFirstFrameCarriesTheStart*
(mutants: no stamp carried, every frame carrying it, the dial or the session's open unstamped, `firstIn` wrong — each
fails it).

**Measured 2026-10-30, 1×** (rows [`lab/viewer/rows/start-quiet.jsonl`](https://github.com/dary-dc/wt-pacs/tree/643ce5597713523c308e62366624570fb1865345/lab/viewer/rows/start-quiet.jsonl), at `claude/view-start@643ce559`, run from `ba90ef5` by `THROTTLES=1 NAME=start
KINDS=quiet lab/viewer/view_run.sh`, rounds 0–15; read by `node lab/viewer/start-summary.mjs`). Headless Chromium 153
and Firefox 155 headed under Xvfb, as §7. 384 visits; every cell has 12 rounds with every arm kept after the whole
extra rounds 12–15 (the relay's VOID drops). Every frame exact. **No cell is VOID and none saturated:** the browser
cores' busy share is 0.45–0.66 over the start and 0.28–0.43 over the fill, A's median, so the fill here is the link's,
not the CPU's. Paired medians over the 12 rounds, B′ − A, ms, at each step from navigation:

| cell | page's `connect` | `downloaderStart` | `sessionOpen` | `firstIn` | first drawn: Δ, bar | fill after it | view worker: created → evaluated; `connect` → its `connect` |
| --- | --- | --- | --- | --- | --- | --- | --- |
| Chromium CT | −20 | +4 | 0 | −2 | −8, tie | ×1.000 | 47; 36 |
| Chromium US | 0 | +18 | +26 | +26 | **+35, later** | ×1.001 | 48; 38 |
| Chromium tomo | −5 | +16 | +9 | +11 | −6, tie | ×1.003 | 49; 44 |
| Chromium mammo | −1 | +22 | +25 | **+67** | **+85, later** | — | 48; 38 |
| Firefox CT | −39 | +4 | −13 | −15 | −24, sooner | ×1.000 | 81; 57 |
| Firefox US | −17 | +29 | +18 | +18 | **+29, later** | ×0.999 | 134; 61 |
| Firefox tomo | +20 | +77 | +61 | +74 | **+73, later** | ×0.996 | 167; 69 |
| Firefox mammo | +50 | +72 | +84 | **+132** | **+131, later** | — | 176; 70 |

**The verdict, by the corrected bars: B′ is behind A** on latency in five cells (US in both engines, the mammogram in
both, Firefox tomosynthesis), and ties it on throughput in all six multi-frame cells.

**Where B′'s delay goes**, as predicted: the step Δ grows between the page's `connect` and the downloader's `start` by
20–60 ms — the view worker's `connect` arrives 36–44 ms (Chromium) and 57–70 ms (Firefox) after the page's, because
it is still booting: its module graph takes 47–49 ms from creation to evaluation in Chromium and 81–176 ms in Firefox,
and it is created only once the metadata is in. From `start` on the downloader's steps move together; the WebGL2
context (9–12 ms in Chromium, 23–33 ms in Firefox) sits between the view worker's `start` and its `connect`, so on
that path too. **The mammogram adds one round trip** at `firstIn`: +42 ms over `sessionOpen` in Chromium and +48 ms in
Firefox, against the link's 40 ms, the ask after the dial. Nothing after `firstIn` adds a delay of its own; CT's
cells tie because their B′ pages reached `connect` sooner, by chance of the navigation (the page's `connect` Δ, −20 and
−39 ms), not because the boot was shorter. The fill after the first frame is the same in every arm: the delay is all
before the first byte, and §7's fill ratios were that one delay read as a ratio.

*`cache.js` imported lazily, probed (indicative, not a pre-registered cell):* the view worker's module graph from
`new Worker` to evaluation, with `cache.js` and with it imported on use, 20 visits each interleaved, a fresh context
each: Chromium 33.8 → 27.6 ms, Firefox 80.2 → 72.3 ms, medians. 6–8 ms, under the bar and off the path once the page
dials (§3, *Proposed: the page dials*), so **not built**.

**4×** was not run at this step: the guard leaves every 1× start unsaturated, so it is allowed, but the re-run's four
arms (§3) include these three at their defaults, so its 4× cells (below) stand for both.

**The fix, re-run 2026-10-30, 1×** (§3, *Proposed: the page dials*; rows [`lab/viewer/rows/startfix-quiet.jsonl`](https://github.com/dary-dc/wt-pacs/tree/643ce5597713523c308e62366624570fb1865345/lab/viewer/rows/startfix-quiet.jsonl), at `claude/view-start@643ce559`, run
from `07fd44c` by `FRAMES=lab/.av1-work/view-fix THROTTLES=1 NAME=startfix KINDS=quiet lab/viewer/view_run.sh`, the
frames made by `view_frames.py --fix`; rounds 0–17, the last six whole extra rounds for the relay's drops). Four arms:
A, A/A, B′ and B′ with the fix (`workerfix`: `pageDials`, `viewWorkerFirst`, `shortRuns`). 576 visits, every frame
exact, no cell saturated (start 0.47–0.65, fill 0.26–0.39). **Four cells are VOID**, the A/A pair 16.7 ms or more apart
on the first frame (Chromium US, Firefox CT, tomosynthesis and the mammogram): with four arms a round is longer and its
pages more spread, and the rule counts nothing there. Paired medians over 12 rounds, ms:

| cell | B′ − A, first drawn | B′+fix − A, first drawn | B′+fix − A at `downloaderStart`, `sessionOpen`, `firstIn` | fill after it, B′+fix ÷ A |
| --- | --- | --- | --- | --- |
| Chromium CT | **+24, later** | −8, tie | −15, −17, −15 | ×1.000 |
| Chromium US *(VOID)* | +37 | +20 | +16, +12, +14 | ×1.000 |
| Chromium tomo | −2.5, tie | **+21, later** | +6, +22, +19 | ×1.000 |
| Chromium mammo | **+54, later** | +8, tie | +13, +13, +15 | — |
| Firefox CT *(VOID)* | +94 | −1 | −7, 0, −6 | ×1.000 |
| Firefox US | **+29.5, later** | −9.5, tie | 0, +1, 0 | ×0.999 |
| Firefox tomo *(VOID)* | +32 | −9 | +18, +16, −8 | ×0.999 |
| Firefox mammo *(VOID)* | +81 | +13.5 | +22, +25, +21 | — |

**Verdict, by the rule written before the data: B′ with the fix does not tie A** — "behind A: Chromium tomosynthesis
1× first", +21 ms in one decided cell. It ties A in the other three decided cells, and is within the bar in seven of
eight cells counted or VOID. B′ without the fix is again behind A, in three decided cells (Chromium CT and the
mammogram, Firefox US). Throughput ties in every multi-frame cell, every arm.

*Read from the steps, not decided by the rule:* the fix removes both causes §7's timing found. The view worker's boot
is off the path — the downloader hears `start` 1–2 ms after its script has run under A and under B′+fix, medians of
each cell, against 16–51 ms under B′, waiting on the view worker; its module graph still takes 40–52 ms (Chromium)
and 107–167 ms (Firefox), now beside the dial. The mammogram's extra round trip is gone: `firstIn` − `sessionOpen` is the same in both arms
(Chromium +15 against +13; Firefox +21 against +25). Chromium tomosynthesis's +21 ms is already +22 at `sessionOpen`
and B′ without the fix ties there; nothing in the fix acts between the downloader's start and the session's opening,
so this reads as a round's noise across four arms. That reading is not measured, and the rule says what it says.
**Where the host saturates:** nowhere, by the guard, at 1× (4× below).

**The fix at 4×, re-run 2026-10-31** (rows [`lab/viewer/rows/startfix4-quiet.jsonl`](https://github.com/dary-dc/wt-pacs/tree/643ce5597713523c308e62366624570fb1865345/lab/viewer/rows/startfix4-quiet.jsonl), at `claude/view-start@643ce559`, the same command with
`THROTTLES=4 NAME=startfix4`, rounds 0–17; run after every 1× cell, as pre-registered, the guard having left every 1×
start unsaturated). 576 visits, every frame exact, none saturated (start 0.33–0.55, fill 0.32–0.49). Four cells VOID
(Chromium US and the mammogram, Firefox US and tomosynthesis). Paired medians over 12 rounds, ms, first drawn, B′ − A
/ B′+fix − A: Chromium CT +13.5 / +4.5, tomo **+33.5** / −12, Firefox CT **+43** / −1.5, Firefox mammo **+139** /
**+188**; the VOID cells B′ +64 to +329, B′+fix +17 to +69. The fill after the first frame ties in every multi-frame
cell, every arm (×0.989–1.009).

**Verdict at 4×: B′ with the fix does not tie A** — "behind A: Firefox mammogram 4× first", +188 ms; it ties A in the
three other decided cells, where B′ without it is behind in all three but Chromium CT.

*Read from the steps, not decided by the rule:* in that cell B′+fix's page reaches `connect` 105 ms after A's (paired), and
its downloader's script runs 214 ms after that connect against A's 72 ms (medians) — while the view worker, created before the
metadata, is still evaluating (it finishes 41 ms after the downloader's script). So in Firefox under the 4× throttle the
two workers' boots overlap and the downloader's is slowed, which costs more than the view worker's boot saved. Why the
overlap slows it — Firefox loading a worker's scripts through the page's main thread is the candidate — is not
measured. In the decided Chromium cells and Firefox CT, B′+fix's downloader starts as A's does and nothing apart
follows. *The `viewWorker` stamp* is taken where the page makes the `ViewWorker`, after the metadata; under
`viewWorkerFirst` the worker itself was created earlier, so that stamp is not its creation there.

**Where the host saturates:** nowhere, by the guard, at 1× or 4×. The 4× throttle is a cgroup cap a thread
(`lab/scripts/cpu_throttle.mjs`), so it leaves the cores idle by construction, and the guard cannot see it.
