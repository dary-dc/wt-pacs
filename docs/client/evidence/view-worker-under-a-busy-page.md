# The view worker under a busy page

**Question:** When the page thread runs long tasks, does the view worker (B′) take an ask to the screen and keep cine
on time sooner than the page view (A)?

*Folded 2026-11-14 from `claude/core-busy2:docs/adr/frame-path.md` §The busy page, asks on the mean (f5858688,
48346d09, 477c0fe3, 3acecc90), word for word. A bare §N or §Name is a section of `docs/adr/frame-path.md`: [its
map](../../adr/frame-path.md) names the file each now lives in (§7 and §2 are [the page in the pixel
path](page-out-of-pixel-path.md), the start fix [the view worker's start](view-worker-start.md), the fence settle [the
pixel read](pixel-read-under-busy-page.md)). The rows are on that branch. Measured, Chromium 153 and Firefox 155, one
4-vCPU container, a software rasteriser. It amends §7's asks rule before its data and leaves §7's verdict, and the
`?view=` default, as run. The design these findings shape is [`../design.md`](../design.md).*

## The busy page, asks on the mean (2026-11-02)

**Verdict, both engines (2026-11-03): "B′ wins the busy page" in Chromium and in Firefox, so on both.** B′, with
#276's start fix and settled by the fence, beats A on both engines in every decided cell. When an ask lands inside a
200 ms long task, B′ puts it on screen 132–169 ms sooner. Over all ten asks, its mean is 30–85 ms sooner in Chromium
and 40–80 ms sooner in Firefox. Its cine at 1× is 0 % late, against A's 20–21.5 %. The `?view=` default does not move,
as pre-registered: §7's quiet-page clause still fails. The cells are below, Chromium's and then Firefox's.

*Pre-registered 2026-11-02, before any data. Scored by `lab/viewer/busy-summary.mjs`, written and tested with its
mutants before data; driven by `lab/viewer/busy_run.sh` (both at f5858688 on `claude/core-busy2`).*

**Why, an amendment to §7's asks rule; §7's verdict stands as run.** §7 adopts B′ only if B′'s *median* of ten asks'
arrival → screen is ≥ 16.7 ms below A's in ≥ 9 of 12 rounds. §2 predicts a gain only for an ask handed off inside a
long task: A waits out the rest of the task, B′ does not. An ask handed off between tasks takes the same quiet path in
both arms. A 200 ms task every 500 ms puts about a third of the asks in a task: in §7's rows (`view-asks.jsonl`), A's
asks over 40 ms are 28–41 % of the asks at 1× and 34–72 % at 4×. With fewer than half of its ten asks in a task, a
visit's median is a quiet-path ask in both arms, so the bar could not show §2's prediction even where it held
(Chromium's means: A 59–110 ms, B′ 12–34). The bar is restated here on what §2 predicts: the mean, and the asks
handed off in a task.

**Firefox, read from source first** (Gecko at `FIREFOX_155_0_RELEASE`, the tag in `mozilla-firefox/firefox`).
These are the calls the view worker's timed paint makes (`client/paint/paint-worker.js`, `settle.js`), and where each
one waits:

* **`readPixels`, `getBufferSubData`: on the page.** After the read, `ImageExtractionResult` asks
  `GetCanvasExtractDataPermission` (`dom/canvas/ClientWebGLContext.cpp` near lines 3677 and 5450). From a worker that
  is a `WorkerMainThreadRunnable` (`dom/canvas/CanvasUtils.cpp` near lines 70–125): §*The pixel read under a busy
  page*. The timed paint makes neither call since #275. The viewer check's `read` makes it (`client/view/check.js` at f5858688), and
  so does the lab's `settle=read`; neither runs here.
* **`getParameter`, `getShaderParameter`, `getProgramParameter`, `getError`, `finish`, a `clientWaitSync` with a
  timeout, the command queue's `SyncPing`: on the WebGL parent.** These are sync messages of `PWebGL`
  (`dom/canvas/PWebGL.ipdl`: `GetNumber`, `GetCompileResult`, `GetLinkResult`, `GetError`, `Finish`, `ClientWaitSync`,
  `SyncPing`) to the context's host, which is not the page's main thread. The paint calls the first three only at the
  start and on a program's first use, and the rest never on a timed paint.
* **Uploads, draws, uniforms: no wait.** They are queued in the command buffer and sent asynchronously
  (`DispatchCommands`).
* **The fence: on the worker's own thread.** `fenceSync` posts its `AvailabilityRunnable` and the deferred flush to the
  current thread (`NS_DispatchToCurrentThread`: `dom/canvas/WebGLContext.cpp` near line 2250,
  `ClientWebGLContext.h` near line 1137). `clientWaitSync(sync, 0, 0)` turns `ALREADY_SIGNALED` once the host's
  `OnSyncComplete` reaches the worker's actor (`dom/canvas/WebGLChild.cpp` near line 164).
* **Presentation, and a resize: on the worker.** `QueueCommitToCompositor` runs on the current thread
  (`dom/canvas/OffscreenCanvas.cpp` near line 313), and `CommitFrameToCompositor` hands the frame to the ImageBridge's
  asynchronous `ImageContainer`. Its one main-thread step, `MaybeQueueInvalidateElement`, is posted and not waited on
  (`dom/canvas/OffscreenCanvasDisplayHelper.cpp` near lines 202–360).

**So the read is the only call that waits on the page, and the fence removes it.** No probe is added. The paint-read
probe already timed `fence`, `finish` and the draw alone inside the page's task in Firefox 155, and none waited
(0 of 12 rounds), which covers the fence's thread and a sync message to the host. *Not read:* how the content
process schedules a worker's thread while its main thread spins, on cores the decoders also want. That is the host's
side, and the guards below are what see it.

**Hypothesis.** Settled by the fence, B′ takes an ask handed off in a long task to the screen on its quiet path on
both engines, while A waits out what is left of the task. §2's mean gain follows from that.

**Arms.** `page` (A), `pageaa` (A again, the A/A pair), and `workerfix`: B′ (`?view=worker`) with #276's fix,
`pageDials`, `viewWorkerFirst` and `shortRuns` (`view_frames.py --fix`). All three settle by the fence, the rig's
default since #275. The fix changes only what comes before the first byte (§*The view worker's start, timed*), and the
asks start once frame 0 is shown, so the fix is not predicted to move them.

**Cells.** §7's busy page (`lab/frame-clock/busy.js`, a 200 ms task every 500 ms from navigation) and its three
multi-frame series, `ct_nlst`, `us_liver` and `dbt12_ea1141`. Chromium (Playwright 1.63's headless shell, SwiftShader)
and Firefox 155 (headed under Xvfb, llvmpipe, Marionette). `r50000` behind the relay, the rig on core 3, the browsers
on cores 0–2. Asks (§7's: frame 0, then frames 1–10 one at a time) at 1× and 4×. Cine (§7's, 10 s at the series' rate)
at 1×, and at 4× only for an engine and series whose 1× cell the guard leaves unsaturated. 12 kept rounds a cell.
`lab/order.mjs` interleaves the cells and the arms in each round, and `busy_run.sh` rotates the two kinds by round.
Rows: `busy-asks.jsonl` and `busy-cine.jsonl` under
[`rows/core-busy2`'s rows directory](https://github.com/dary-dc/wt-pacs/tree/rows/core-busy2/lab/viewer/rows), the tag
pushed when the run ends.

**How the rows know a long task.** The page's busy loop keeps each task's start and end (`busy.js`, on the page's
epoch clock, `performance.timeOrigin + performance.now()`). The rig now posts them as `spans`, and with each ask its
`handoff`: the decoder's `decodeEnd`, on the decoder's epoch clock (`client/decode/decoder.js`). An ask is **in a
task** when start ≤ hand-off < end, and what is **left** is the end less the hand-off. The two clocks agree to within
the engines' timer resolution, which is not measured here. The hand-off happens before either arm's own path starts,
so the same rule sorts both arms' asks.

**Scored per visit:** the mean of the ten asks' arrival → screen (§7's span, the decoder's hand-off to the frame's
first draw); the **in-task** median; the **quiet path**, the median of the other asks; and A's **excess**, the median
over its in-task asks of the arrival → screen less what was left. §2's model makes A's excess its quiet path.

**Guards.**

* §7's drops: the relay's timing VOID, an error, a long task under 200 ms, or an ask without its hand-off. A dropped
  visit is re-run as part of a whole extra round. A cell counts its first 12 rounds with every arm kept and decides
  nothing with fewer.
* **VOID, asks:** `pageaa` and `page` differ, median over paired rounds, by 8 ms or more (§7's asks bar), on the quiet
  path or on the excess. The bar is not on the mean because a visit's mean mixes the two paths in a share set by where
  the hand-offs land, which is chance in both arms and not the rig's noise. One more ask of ten in a task moves a mean
  by 10–20 ms, so an A/A bar on the mean would VOID cells for the landing alone. The A/A pair must agree on the
  model's two parts.
* **Saturated, asks:** A's quiet path, median over rounds, longer than 50 ms, three 60 Hz frames. §7's quiet paths
  were 11–34 ms. Past 50 ms the browser's cores are behind with no task in the way, and a gain could be the host's.
* **Cine:** §7's guards. VOID when `pageaa` and `page` differ by more than 2 points of late frames or 16.7 ms of gap
  p99; saturated when `page`'s draw p99 passes half the period.

**The rule.** An asks cell passes when B′ wins both of the following in ≥ 9 of 12 paired rounds (§7's 9 of 12):

* **(i) the mean:** B′'s mean arrival → screen is ≥ 16.7 ms below A's;
* **(ii) in a task:** B′'s in-task median is ≥ 16.7 ms below A's. A round in which either arm had no in-task ask is
  not a win.

A cine cell passes as in §7: where A is late by more than 2 points, B′ is late by at most 2, with a gap p99 of at
most 2 periods. **Per engine:** "B′ wins the busy page" when every frame is exact, every decided cell passes and an
asks cell is decided; "B′ does not win" when a decided cell fails; "undecided" otherwise. A claim for both engines
needs both. The bar is §7's 16.7 ms, one 60 Hz frame. On the mean, a single in-task ask with 167 ms or more left
clears it alone.

**What this decides.** §7's busy-page clause (2), re-measured on what §2 predicts. The `?view=` default does not move
on this run whatever it finds. §7's verdict stands on its quiet-page clause (1), and B′ with the fix still does not tie
A's start (§*The view worker's start, timed*).

**Predictions**, from §2's model, with §7's rows read as the prior (A's asks over 40 ms stand in for its in-task asks).
In ms; *won* counts the rounds of 12:

| cell | A mean | B′ mean | A in task | B′ in task | won (i) / (ii) | asks in a task |
| --- | --- | --- | --- | --- | --- | --- |
| Chromium 1×, CT / US / tomo | 63 / 59 / 90–110 | 12 / 17 / 18 | 165–210 | B′'s quiet path ±10 (11–17) | ≥ 10 / 12 | 28–41 % |
| Chromium 4×, CT / US / tomo | 73 / 95–110 / 90 | 18 / 33 / 35 | 140–200 | ≤ 50 | ≥ 10 / 12 | 37–57 % |
| Firefox 1×, CT / US / tomo | 61 / 62 / 104 | 11 / 13 / 17 | 170–205 | B′'s quiet path ±10 | ≥ 10 / 12 | 29–50 % |
| Firefox 4×, CT / US / tomo | 68 / 114 / 90 | 19 / 28 / 34 | 120–200 | ≤ 50 | ≥ 10 / 12 | 34–72 % |

* A's excess is within ±10 ms of its quiet path in every cell (§2's model), and the quiet paths of A and B′ are within
  8 ms of each other.
* No asks cell is saturated, since A's quiet paths ran 11–34 ms in §7. Every asks cell passes, on both engines.
* In Firefox, B′'s in-task asks in §7 (a median of 156–205 ms, the read's wait) drop to its quiet path.
* Cine at 1×: A 20–22 % late and B′ 0 %, with B′'s gap p99 117–136 ms, as in the settle's re-run; pass on both
  engines. At 4× every cell is saturated, as the settle's 4× run found (`page`'s draw p99 60–123 ms against 50), and
  nothing is claimed.
* **Refuted** for an engine if its decided asks cells fail (ii) with B′'s in-task median near A's. Then something
  other than the read waits on the page, the source reading above is incomplete, and a probe in the style of
  `lab/paint-read` (at 0920153d) follows.

**Firefox in this container, recorded before any data.** Playwright's Firefox build cannot be fetched here: the
environment's network policy refuses `cdn.playwright.dev` and `playwright.download.prss.microsoft.com`. Running a
Firefox 155.0 from conda-forge, checked against its published SHA-256, was refused by this session's permissions. So the
Firefox cells stay pre-registered and are **not run**, and Firefox's verdict is "undecided: not run". Nothing below
claims anything for Firefox. *Superseded 2026-11-03:* Firefox was run in a later container, under the amendment
that follows.

**Amended 2026-11-02, before any Firefox data, for the Firefox cells' run.** A later container's policy allows the
Playwright hosts, so the cells run as written above with three changes the rig forces, none to the arms, the cells or
the rule. (a) *The browser* is Playwright 1.63's Firefox, `firefox-1543`, which reports `Firefox 155.0`
(build `20260902122356`): Gecko 155.0 with Playwright's driver patches, which stay inert unless the browser is started
with `-juggler`, and it is not. The source reading above stands for it, since the pin is the same version; the
patches are not read. (b) *No driver:* the rig starts the binary itself with the visit's URL and reads the rows back
over HTTP (`lab/av1/delivery/total-time/run.mjs`), so "Marionette" above is struck for this subsection. (c) *The
rows* go to this branch's tracked `lab/viewer/rows/` (on `claude/core-busy2`, 3acecc90), appended to the same two files, and are cited by branch and
commit: a tag push is refused here, so the `rows/core-busy2` tag named above is not made.

**Measured 2026-11-02, Chromium alone** (rows
[`busy-asks.jsonl`](https://github.com/dary-dc/wt-pacs/tree/24e86432ead423e7d6e8074b540b953bae140a88/lab/viewer/rows/busy-asks.jsonl) and
[`busy-cine.jsonl`](https://github.com/dary-dc/wt-pacs/tree/24e86432ead423e7d6e8074b540b953bae140a88/lab/viewer/rows/busy-cine.jsonl), read by
`node lab/viewer/busy-summary.mjs lab/viewer/rows/busy-{asks,cine}.jsonl`; `claude/core-busy2@24e86432`; the tag was refused, amendment (c)).
Headless Chromium (Playwright 1.63's shell, SwiftShader), 4 cores, no GPU. Asks: rounds 0–11, then whole extra
rounds until every cell had 12 rounds with all three arms kept: to round 35 for all six cells, then rounds 36–39 of
CT at 4× alone. 660 visits, of which 169 were dropped, every one by the relay's timing guard. Cine: rounds 0–14 at 1×
and 0–12 at 4×, 261 visits, 10 dropped by the same guard. No error, no long task under 200 ms. **6 600 of 6 600
asked frames and 15 225 of 15 225 cine frames exact.** Medians over the 12 rounds, in ms. A smoke visit of each arm
was run first to check the rows, then discarded (not committed, not scored).

| asks cell | mean A / A′ / B′ | won (i) | in a task A / A′ / B′ (asks a visit) | won (ii) | quiet path A / B′ | A's excess | guards |
| --- | --- | --- | --- | --- | --- | --- | --- |
| CT 1× | 64.7 / 63.4 / **20.7** | 12 / 12 | 180.9 / 174.0 / **23.4** (3) | 12 / 12 | 19.3 / 19.6 | 18.2 | decided |
| US 1× | 54.9 / 59.5 / **24.8** | 12 / 12 | 160.1 / 166.7 / **27.8** (2–3) | 12 / 12 | 23.3 / 22.9 | 22.6 | decided |
| tomo 1× | 111.4 / 112.4 / **26.8** | 12 / 12 | 198.3 / 195.1 / **30.3** (2–5) | 12 / 12 | 24.9 / 25.1 | 24.7 | decided |
| CT 4× | 81.5 / 74.5 / **42.9** | 11 / 12 | 180.6 / 178.9 / **39.9** (3) | 12 / 12 | 39.8 / 42.0 | 41.5 | decided |
| US 4× | 125.9 / 118.6 / 54.9 | 12 / 12 | 196.3 / 198.6 / 56.0 | 12 / 12 | 54.5 / 53.2 | 57.8 | *saturated* |
| tomo 4× | 102.1 / 97.7 / 58.4 | 12 / 12 | 149.7 / 135.1 / 56.6 | 12 / 12 | 57.6 / 55.6 | 60.8 | *saturated* |

| cine cell | late A / A′ / B′, % | gap p99 A / A′ / B′, ms (period 100) | A's draw p99, ms | guards |
| --- | --- | --- | --- | --- |
| CT 1× | 20 / 20 / **0** | 267 / 283 / 117 | 26 | decided |
| US 1× | 21.5 / 21.5 / **0** | 317 / 317 / 142 | 49 | decided |
| tomo 1× | 20 / 20 / **0** | 267 / 275 / 117 | 34 | decided |
| CT, US, tomo 4× | 20.5–42 / 20–31 / 0–2.9 | 292–425 / 267–392 / 133–300 | 73–197 | *VOID and saturated*, each |

**The rule's verdict, Chromium: "B′ wins the busy page."** Every decided cell passes: four asks cells (CT, US and
tomosynthesis at 1×, CT at 4×) and the three 1× cine cells. On the mean, B′ hands the asked frame to the screen
30–85 ms sooner than A. On an ask handed off inside a long task it is 132–168 ms sooner: B′ takes its quiet path
(23–40 ms), while A waits out the rest of the task. **Firefox: "undecided: not run"**, as recorded before any data.
The claim is Chromium's alone, and nothing here says B′ wins on both engines. *Superseded 2026-11-03:* Firefox's
cells, run below, give "B′ wins the busy page" too, so the claim now holds on both engines.

**Against the predictions.**

* **Held: §2's model.** A's excess past what was left of the task is its quiet path to within 3.3 ms in every cell
  (18–61 ms against 19–58), so A waits out exactly the task's remainder. B′'s in-task median is within 5.2 ms of
  its quiet path. The two arms' quiet paths agree within 3 ms. The A/A pair agrees within 8 ms on both parts of the model in
  every cell, so no asks cell is VOID. Its *means* differ by up to 7 ms (CT 4×), which is what the bar on the mean
  was kept off.
* **Held: the rounds won.** 12 of 12, and 11 of 12 on CT 4×'s mean. Cine at 1× is 20–21.5 % late under A and 0 %
  under B′. Every 4× cine cell is saturated, and nothing is claimed from it.
* **Off: the quiet paths are slower than §7's** (19–25 ms at 1× against 11–17), in both arms alike. So B′'s mean is
  20.7–26.8 ms against the 12–18 predicted, and tomosynthesis's A mean is 111.4 against ≤ 110.
* **Off: 4×.** US and tomosynthesis are saturated by the asks guard (A's quiet path 55–58 ms), where none was
  predicted to be. Their figures are printed and not claimed.
* **Off: the share of asks in a task.** It is 20–50 % at 1× against 28–41 %: tomosynthesis puts half its asks in one.
* **US 1× cine:** B′'s gap p99 is 142 ms against the 117–136 predicted, still under the 200 ms bar.

**What it decides.** §7's busy-page clause (2), measured on what §2 predicts, holds in Chromium with the fence
settle and the start's fix. It does not move the `?view=` default, as pre-registered. §7's verdict stands on (1): on a
quiet page B′'s first frame is later, and with the fix it still does not tie A (§*The view worker's start, timed*).
For the owner, the trade is now measured on both sides in Chromium: on a busy page B′ is up to a task's remainder
sooner, and on a quiet one it is later at the start.

**Where the host saturates:** the asks at 4× on US and tomosynthesis, and every cine cell at 4× (A's draw p99 73–197 ms
against 50). Nothing is claimed past those cells. A quarter of the asks visits were dropped by the relay's 1 ms timing
guard, the container's scheduling noise on the relay's core, as in §7. Everything is from SwiftShader and Xvfb's
synthetic vsync, so a GPU, a display and a phone are not measured.

**Measured 2026-11-03, Firefox** (rows appended to the same two files, at
[`claude/core-busy2@c260e4a1`](https://github.com/dary-dc/wt-pacs/tree/c260e4a140471696ec1693b2e3729231b0fb1125/lab/viewer/rows); same reader). Playwright's Firefox 155.0 (`firefox-1543`), headed under Xvfb,
llvmpipe, 4 cores, no GPU, under the amendment above. Asks: rounds 0–29, all six cells in every round (whole extra
rounds from round 12, until every cell had 12 rounds with all three arms kept). 540 visits, of which 51 were dropped,
every one by the relay's timing guard. Cine at 1×: rounds 0–14. Cine at 4×: rounds 15–29, since the guard left every
1× cell unsaturated (A's draw p99 36–49 ms against 50). 270 cine visits, 7 dropped by the same guard. No error, no long
task under 200 ms. **5 400 of 5 400 asked frames and 15 750 of 15 750 cine frames exact.** A container restart cut
round 11's cine pass after four visits. Those four rows were never committed: they were discarded and round 11 was
re-run whole. One smoke visit of each arm was run first and discarded, as in Chromium. Medians over the 12 rounds,
in ms.

| asks cell | mean A / A′ / B′ | won (i) | in a task A / A′ / B′ (asks a visit) | won (ii) | quiet path A / B′ | A's excess | guards |
| --- | --- | --- | --- | --- | --- | --- | --- |
| CT 1× | 66.7 / 64.8 / **16.5** | 12 / 12 | 179.4 / 189.4 / **17.1** (3) | 12 / 12 | 17.5 / 15.8 | 17.1 | decided |
| US 1× | 58.9 / 54.3 / **18.4** | 12 / 12 | 176.0 / 164.1 / **19.5** (3) | 12 / 12 | 19.4 / 16.4 | 19.2 | decided |
| tomo 1× | 103.7 / 106.5 / **23.9** | 12 / 12 | 192.8 / 199.6 / **24.3** (4–5) | 12 / 12 | 23.8 / 22.5 | 22.9 | decided |
| CT 4× | 77.4 / 73.6 / **22.0** | 11 / 12 | 170.3 / 175.4 / **21.1** (3) | 12 / 12 | 23.9 / 22.0 | 26.3 | decided |
| US 4× | 95.7 / 98.0 / **34.4** | 12 / 12 | 181.6 / 167.8 / **35.5** (3–4) | 12 / 12 | 32.8 / 33.0 | 34.1 | decided |
| tomo 4× | 93.0 / 91.3 / 53.0 | 12 / 12 | 142.1 / 138.3 / 50.8 (5) | 12 / 12 | 51.9 / 51.2 | 56.1 | *saturated* |

| cine cell | late A / A′ / B′, % | gap p99 A / A′ / B′, ms (period 100) | A's draw p99, ms | guards |
| --- | --- | --- | --- | --- |
| CT 1× | 20 / 20 / 0 | 272 / 271 / 119 | 36 | *VOID* |
| US 1× | 20.9 / 20.9 / **0** | 322 / 322 / 136 | 48 | decided |
| tomo 1× | 20 / 20 / 0 | 255 / 272 / 135 | 49 | *VOID* |
| CT, US, tomo 4× | 20–25 / 20–29.5 / 0 | 272–347 / 272–381 / 135–169 | 63–121 | *VOID and saturated*, each |

**The rule's verdict, Firefox: "B′ wins the busy page."** All six decided cells pass: five asks cells (CT, US and
tomosynthesis at 1×, CT and US at 4×) and US's 1× cine. On the mean, B′ is 40–80 ms sooner than A. On an ask
handed off inside a long task, it is 146–169 ms sooner: B′ takes its quiet path (17–36 ms), while A waits out the
rest of the task. **Both engines: "B′ wins the busy page"**, which is the claim the rule allows only when each engine
has it.

**Against the predictions.**

* **Held: the source reading.** In §7, Firefox's B′ in-task asks waited on the read (156–205 ms). Settled by the
  fence, they now take its quiet path: B′'s in-task median is within 3.1 ms of its quiet path in every decided cell.
  Nothing else in the timed paint waits on the page, so the refutation clause does not fire and no probe follows.
* **Held: §2's model.** A's excess past what was left of the task is its quiet path to within 2.4 ms (17–34 ms
  against 18–33). The two arms' quiet paths agree within 3.0 ms, and the A/A pair within 8 ms on both parts, so no
  asks cell is VOID.
* **Held: the rounds won** (12 of 12, and 11 of 12 on CT 4×'s mean), A's means at 1× (59–104 against 61–104
  predicted), and A's in-task medians (170–193 against 120–205). Cine at 1× is 20–20.9 % late under A and 0 % under
  B′, with B′'s gap p99 119–136 ms, within the 117–136 predicted. Every 4× cine cell is saturated, as predicted.
* **Off: B′'s means are slower** (16.5–23.9 ms at 1× against 11–17), from quiet paths of 16–24 ms against §7's 11–17,
  as in Chromium.
* **Off: tomosynthesis at 4× is saturated** by the asks guard (A's quiet path 51.9 ms against 50), where none was
  predicted. Its figures are printed and not claimed.
* **Off: two 1× cine cells are VOID**, CT and tomosynthesis. A's medians agree with the A/A pair's to within 1 point
  of late frames and 17 ms of gap p99, but the median per-round gap-p99 difference is 16.7 ms or more. A 10 s cine's
  p99 is about its single longest gap, so one stall moves it a whole task. As run, those two cells decide nothing.
* **Off: the share of asks in a task** is 27–41 % on average at 1× and 30–47 % at 4×, below the 29–50 % and 34–72 %
  predicted.

**Where the host saturates, Firefox:** the asks at 4× on tomosynthesis, and every cine cell at 4× (A's draw p99
63–121 ms against 50). Nothing is claimed past those cells. As in Chromium, everything is from a software rasteriser
(llvmpipe) and Xvfb's synthetic vsync.

