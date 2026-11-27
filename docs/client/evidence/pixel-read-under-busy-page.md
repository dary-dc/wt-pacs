# The pixel read under a busy page

**Question:** Does a busy page delay the paint's read-back of a frame?

*Moved 2026-11-14 from `docs/adr/frame-path.md` at `e5b20cba` (§The pixel read under a busy page), word for word but
for queue-row names. A bare §N or §Name is a section of that ADR: [its map](../../adr/frame-path.md) names the file
each now lives in. Choices 1–8 are [the cache's](cache-in-opfs.md#the-choices-and-what-decides-each). The design these
findings shape is [`../design.md`](../design.md).*

## The pixel read under a busy page (2026-10-30)

*Pre-registered 2026-10-30, before any data; the probe is [`../../lab/paint-read/`](https://github.com/dary-dc/wt-pacs/tree/0920153d2a44916c6832a9d8dd0befabc0923681/lab/paint-read/README.md).*

**Why, read from source and not yet measured.** Since Firefox 145, `ClientWebGLContext::ReadPixels` asks
`GetCanvasExtractDataPermission` after every read (`dom/canvas/ClientWebGLContext.cpp` near line 5451 at
`FIREFOX_155_0_RELEASE`; absent at `FIREFOX_140` and `FIREFOX_144`). From a worker that is
`OffscreenCanvasPermissionRunnable`, a `WorkerMainThreadRunnable` (`dom/canvas/CanvasUtils.cpp` near lines 70–125): the
worker blocks in a sync loop until the page's main thread has run it (`dom/workers/WorkerRunnable.cpp`). Presenting
does not need the main thread (`OffscreenCanvasDisplayHelper::CommitFrameToCompositor`). Our paint reads one pixel
after every draw when `settle` is set (`client/paint/paint-worker.js`), which is its default, and the page view's
`Painter` never unsets it; §7's lab run set it for the view worker too (`lab/viewer/levers.js`). **Hypothesis:** §7's
Firefox draw p99 ≈ the 200 ms task, in both arms, is that read waiting out the page's long task — our code, not
Gecko's presentation.

**The probe.** A worker holds a 512² OffscreenCanvas's WebGL2 context (the paint's attributes) and, every 20 ms, in a
task of its own, draws one full-canvas triangle and settles it by one of five variants, each call timed from the draw
to the settle's return:

* `read`, and `read′` (the A/A pair): `readPixels` of one pixel, as the paint does;
* `fence`: `fenceSync`, `flush`, then `clientWaitSync(sync, 0, 0)` polled once a task (a `MessageChannel` turn) until
  it is not `TIMEOUT_EXPIRED`, capped at 1 s (a call past the cap is counted timed out); a sync object's status changes
  only between tasks, so the poll must yield;
* `finish`: `gl.finish()`;
* `none`: the draw alone.

The page is quiet, or busy with §7's load from navigation (`lab/frame-clock/busy.js`: a 200 ms task every 500 ms, each
task's start and end kept). A visit is one variant on one page for 10 s, starting 1 s after navigation, in a fresh
navigation. A round is the ten units (5 variants × quiet, busy) in `lab/order.mjs`'s order; **12 rounds**; Chromium
(Playwright's, headless, SwiftShader) and Firefox (Playwright's build, headed under Xvfb, llvmpipe, driven over
Marionette), its version recorded from the user agent; 1× only, no CPU pinning: this probe asks whether a call waits
for another thread, not how fast it is. Rows: `lab/paint-read/rows/<engine>.jsonl`, every call's start and time (kept at `claude/paint-read@2993d8d0`, not in this tree).

**Scored** by `lab/paint-read/measure.js`, written and tested before data:

* A call is **in a task** when it starts inside one of the page's long tasks; what is **left** is that task's end less
  the call's start. A visit's call **waits** when the median in-task call lasts ≥ 0.5 × the median left.
* **Guards.** A busy visit whose shortest task is under 200 ms is dropped; a cell (engine × quiet/busy) counts its
  first 12 rounds with every variant kept, and with fewer it decides nothing. A cell is **VOID** when `read` and
  `read′` differ, median over paired rounds, by more than max(2 ms, 20 % of the larger median) — in-task medians on the
  busy page, all calls on the quiet one. A cell is **saturated** when `none`'s p99, median over rounds, passes half the
  20 ms period: the draw alone does not keep up, and nothing is claimed from the cell.
* **The rule.** In a busy cell, a variant **waits for the page** when its calls wait in ≥ 10 of 12 rounds, **does not**
  in ≤ 2, and is **mixed** between.

**Prediction.** Firefox: `read` waits for the page, its in-task calls lasting about what is left of the task (median
excess within ±20 ms); `fence`, `finish` and `none` do not. Chromium: no variant waits; `read`'s in-task median under
5 ms. `fence`'s in-task median under 5 ms on both. Quiet pages: every variant's median under 5 ms on both. If Firefox's
`read` does not wait, the hypothesis is refuted and §7's Firefox sentence stands as written.

**What follows from the probe** (steps 2–4 of this work, each written here before its data): a settle that waits for
the draw to execute without the page's thread, proved on SwiftShader and on Firefox's llvmpipe; no product paint that
reads a pixel to settle; and §7's busy cine re-measured with the old read and the new settle.

*Amended before any kept data (2026-10-30).* The first Firefox run was stopped after 8 visits of round 0: a timer
that woke early let the loop call twice in one 20 ms slot (800 calls in a 500-slot visit). The loop now counts its
slots; those 8 rows are discarded, not read for the hypothesis, and the run restarted from round 0.

**Measured 2026-10-30** (rows [`lab/paint-read/rows/`](https://github.com/dary-dc/wt-pacs/tree/2993d8d062a0db8d6ea155ccdefce60cba8b601b/lab/paint-read/rows), at `claude/paint-read@2993d8d0`, not in this tree; read there by
`node lab/paint-read/run.mjs --summary lab/paint-read/rows/<engine>.jsonl`). Firefox 155.0 (Playwright's build 1543,
llvmpipe) and Chromium 153 (SwiftShader); 12 rounds a cell, every visit kept, no cell VOID (A/A 0.0–2.0 ms) and none
saturated (`none`'s p99 0.14–0.17 ms). Medians over rounds, ms:

| variant | Firefox quiet | Firefox busy, in a task (left) | waited | Chromium quiet | Chromium busy, in a task (left) | waited |
| --- | --- | --- | --- | --- | --- | --- |
| `read` | 1.80 | **196.0** (195.3) | **12 / 12** | 1.71 | 1.90 (115.0) | 0 / 12 |
| `read′` | 1.81 | **198.6** (198.0) | **12 / 12** | 1.73 | 1.89 (113.8) | 0 / 12 |
| `fence` | 2.54 | 4.10 (100.2) | 0 / 12 | 2.35 | 3.11 (114.5) | 0 / 12 |
| `finish` | 1.35 | 1.39 (100.1) | 0 / 12 | 0.07 | 0.07 (114.5) | 0 / 12 |
| `none` | 0.06 | 0.06 (100.4) | 0 / 12 | 0.05 | 0.05 (115.0) | 0 / 12 |

**The prediction holds.** In Firefox 155 a one-pixel `readPixels` from a worker that starts inside the page's long
task lasts what is left of the task (median excess +0.6 ms; busy p99 200.8 ms against 4.2 ms quiet): the read waits
for the page's main thread. The fence, `finish` and the draw alone do not. In Chromium no variant waits (busy p99
3.7 ms). Every in-task median is under 5 ms except Firefox's read; the fence's quiet medians, 2.35–2.54 ms, are a
poll's turn past the read's. The read's figure in a task is one call a task: the call that waits out the task is the
only one of its 20 ms slots that starts inside it. Nothing here says why Firefox asks the page; the source reading
above is the reason given, unmeasured.

**A settle that needs no other thread** (step 2, `client/paint/settle.js`, `settle-check.mjs`): the fence, polled on
a 1 ms timer, waits for a draw to execute on both engines; `gl.finish()` returns early on SwiftShader and waits on
llvmpipe, so it is no settle for both. Proved with a draw of 145–250 ms: [`../../client/paint/README.md`](../../../client/paint/README.md)
§When a paint has executed, with its mutants. The probe's own fence polled once a task, the shape its protocol named;
the settle polls on a timer because a poll every task spun its thread and slowed SwiftShader's draw by a third.

**§7's cine cell again, pre-registered 2026-10-30 before any of its data.** §7's cell 2 cine visits as §7 ran them
(its series `ct_nlst`, `us_liver`, `dbt12_ea1141`; `r50000` behind the relay on core 3, the browsers on cores 0–2;
§7's busy page from navigation, the fill, then 10 s of cine at the series' rate, frame 0 due mid display interval;
late and gap p99 from the draw log against the vsync log), on the code of this branch, with five arms, each a
`lab/viewer/view_frames.py` (at `0920153d`) variant: `page` and `worker` settling by the fence, `pageaa` (A again, the A/A pair), and
`page-read` and `worker-read` settling by the one-pixel read as §7's run did (the rig's `?settle=`; §7's arms all
settled by the read). Chromium (Playwright's, headless, SwiftShader) and Firefox (Playwright's 155, headed under Xvfb,
llvmpipe); `lab/order.mjs` interleaves the cells and the arms in each round; **12 rounds kept, 1×**, then 4× only for
an engine and series whose 1× cell the saturation guard leaves unsaturated, with nothing claimed from a 4× cell the
guard saturates. Rows: [`lab/viewer/rows/settle-cine.jsonl`](https://github.com/dary-dc/wt-pacs/tree/2993d8d062a0db8d6ea155ccdefce60cba8b601b/lab/viewer/rows/settle-cine.jsonl) (at `claude/paint-read@2993d8d0`, not in this tree), §7's row format. Read by
`node lab/viewer/settle-summary.mjs lab/viewer/rows/settle-cine.jsonl`, written and tested before data.

* **Guards, §7's:** a visit is dropped if the relay's timing is VOID, it errs, it holds a frame not exact or its
  shortest long task is under 200 ms; dropped visits are re-run as whole extra rounds; a cell counts its first 12
  rounds with every arm kept. **VOID** when `pageaa` and `page` differ, median over paired rounds, by more than 2
  points of late frames or 16.7 ms of gap p99; **saturated** when `page`'s draw p99, median over rounds, passes half
  the period. A cell decides only when every frame is exact and it is neither short, VOID nor saturated.
* **Rule (a), the wait was the read**, per engine: in every decided cell `worker-read`'s draw p99 is ≥ 150 ms and
  `worker`'s ≤ half the period; "not the read" when no decided cell has it, "mixed" otherwise.
* **Rule (b), §7's cine rule on the fence arms**, per engine: where `page` is late by more than 2 points, `worker` is
  late by at most 2 with a gap p99 ≤ 2 periods ("B′ keeps cine on time where A misses"), in every such decided cell.
* **Prediction.** Firefox: (a) holds; under (b) B′ keeps cine on time, as in Chromium; `page-read` and `worker-read`
  late as §7 found (20–40 %). Chromium: (a) does not hold (neither settle waits); (b) holds as in §7. If (a) fails in
  Firefox, §7's sentence is kept and what the probe found is added beside it.

**Measured 2026-10-31, 1×** (rows [`lab/viewer/rows/settle-cine.jsonl`](https://github.com/dary-dc/wt-pacs/tree/2993d8d062a0db8d6ea155ccdefce60cba8b601b/lab/viewer/rows/settle-cine.jsonl), at `claude/paint-read@2993d8d0`, not in this tree;
read there by `node lab/viewer/settle-summary.mjs lab/viewer/rows/settle-cine.jsonl`; driven by `lab/viewer/settle_run.sh`). Headless
Chromium 153 (SwiftShader) and Firefox 155 headed under Xvfb (llvmpipe), 4 cores, no GPU. Rounds 0–11, then whole
extra rounds of the short series alone (12–13 of US and tomosynthesis, 14 of tomosynthesis) until each cell had 12
with every arm kept: 410 visits, 6 dropped, every one by the relay's timing guard. **23 270 of 23 270 frames exact.**
Medians over the 12 rounds; period 100 ms.

| cell, 1× | late %, `page` / `pageaa` / `worker` / `page-read` / `worker-read` | gap p99, ms | draw p99, ms | guards |
| --- | --- | --- | --- | --- |
| Chromium CT | 20 / 20 / **0** / 20 / 0 | 267 / 267 / 117 / 283 / 117 | 24 / 24 / 25 / 17 / 15 | decided |
| Chromium US | 22 / 21 / **0** / 20 / 0 | 317 / 317 / 133 / 308 / 133 | 50 / 50 / 33 / 36 / 25 | decided |
| Chromium tomo | 20 / 20 / **0** / 20 / 0 | 267 / 267 / 117 / 267 / 117 | 32 / 32 / 33 / 21 / 23 | decided |
| Firefox CT | 20 / 20 / **0** / 20 / 31 | 272 / 272 / 119 / 272 / 322 | 31 / 28 / 22 / 21 / **202** | decided |
| Firefox US | 21 / 21 / **0** / 22 / 20 | 322 / 322 / 136 / 339 / 339 | 41 / 41 / 37 / **218** / **201** | decided |
| Firefox tomo | 20 / 21 / 0 / 21 / 27 | 263 / 297 / 119 / 296 / 323 | 38 / 51 / 36 / 132 / 198 | *VOID* (A/A gap p99 34 ms apart) |

* **Rule (a): Firefox, "the wait was the read"** in both decided cells: settled by the read, the view worker's draw
  p99 is the task's length (201–202 ms); settled by the fence, 22–37 ms. **Chromium: "not the read"**: neither settle
  waits (15–33 ms). As predicted.
* **Rule (b): "B′ keeps cine on time where A misses", on both engines**: in every decided cell `page` is late by 20–22 %
  and `worker` by 0 %, its gap p99 117–136 ms, under 2 periods. In Firefox this was not so in §7's run, nor here with
  the read (`worker-read` 20–31 % late): the cine missed because its paint read a pixel.
* `page-read`, A's paint worker reading, has its draw p99 at the task's length in Firefox's US cell (218 ms) and not in
  CT (21 ms): a page-view read waits only when the paint worker's read lands inside a task, and A's paints, driven by
  the page's timer, mostly run between tasks. A misses either way, since its clock is the page's.
* Reproduced: `page-read` and `worker-read` are §7's arms, and their late frames are §7's (20–31 % here, 20–27 % there).
* **Where the host saturates:** every 4× cell (below); no 1× cell by the guard; `page`'s draw p99 is 22–50 ms against the 50 ms bar
  (Chromium US at the bar). From a software rasteriser and Xvfb's vsync, as the rest of §7: a GPU, a display and a phone
  are not measured.

**4×, measured 2026-10-31: every cell saturated, nothing claimed.** Rounds 0–11 of all six cells (360 visits, 5
dropped by the relay's guard; 21 000 of 21 000 frames exact): `page`'s draw p99 is 60–123 ms against the 50 ms bar
in each, and four are VOID as well. Three cells are a round or two short; no top-up rounds were run, since a
saturated cell decides nothing however many rounds it has. As read, not claimed: `worker` 0 % late in all six, and
Firefox's `worker-read` draw p99 213–228 ms against `worker`'s 39–65 ms, the 1× picture again.
