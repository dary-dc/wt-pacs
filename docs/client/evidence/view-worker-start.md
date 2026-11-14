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
1× first", +21 ms in one decided cell. *Superseded in part 2026-11-02:* the +21 ms did not reproduce (+14, a tie; §The start, levers split, below). It ties A in the other three decided cells, and is within the bar in seven of
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

**Verdict at 4×: B′ with the fix does not tie A** — "behind A: Firefox mammogram 4× first", +188 ms (*superseded in
part 2026-11-03:* re-run, the cell is VOID by its A/A, +104 ms inside +107.5, so not re-decided; §The start, levers split); it ties A in the
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

## The start, levers split (2026-11-02 to 2026-11-03)

*Folded 2026-11-14 from `claude/core-start2:docs/adr/frame-path.md` §The start, levers split (5f737209, bf9d6fb1,
a8243eca), word for word; the bare §N rules above apply. It supersedes in part the verdict of the section above:
there B′ with the fix did not tie A (Chromium tomosynthesis 1× +21 ms, Firefox mammogram 4× +188 ms); here, newer, it
ties A in every decided cell, all at 1×, and no 4× cell is decided on either engine.*


*Theory and pre-registration written 2026-11-02, before any data.* #276's fix ties A in most cells but, by its rule, not
in two: Chromium tomosynthesis 1× (+21 ms, already there at `sessionOpen`) and Firefox mammogram 4× (+188 ms, the
downloader's script running 214 ms after the page's connect against A's 72 ms while the early view worker is still
evaluating). The question: is there a start for B′ that ties A in every decided cell, both engines, 1× and 4×, or a
reason none can.

**How Gecko loads a dedicated worker's scripts** — read at `FIREFOX_155_0_RELEASE` (the Firefox major #276 ran),
paths under `dom/workers/`; read from source, not measured:

* `new Worker` builds the worker on the page's main thread and opens the top-level script's channel there, at once
  (`WorkerPrivate.cpp`: the constructor calls `GetLoadInfo` near line 3228, which calls
  `ChannelFromScriptURLMainThread` near line 3756).
* Every script fetch after that, the top level's and each module's, is sent back from the worker thread to the main
  thread: `WorkerModuleLoader::StartFetch` (`loader/WorkerModuleLoader.cpp` line 139) →
  `WorkerScriptLoader::DispatchLoadScript` → `DispatchLoadScripts`, which `NS_DispatchToMainThread`s a
  `ScriptLoaderRunnable` (`ScriptLoader.cpp` near lines 750–790); its `Run` asserts the main thread and opens each
  load (near line 1460).
* The response is read and decoded to text on the main thread: `NetworkLoadHandler::OnStreamComplete` →
  `DataReceivedFromNetwork`, which asserts the main thread and runs the `ScriptDecoder` (`loader/NetworkLoadHandler.cpp`
  lines 51–203). Only then is a `ScriptExecutorRunnable` dispatched to the worker (`ScriptLoader.cpp` near line 1665),
  which compiles there (`WorkerModuleLoader::CompileFetchedModule`, line 146) and, once the graph is in, evaluates.
* A module's imports are known only once it is parsed on the worker, so a graph costs one main-thread round per level.
  Nothing else serialises two workers: each has its own thread, and the per-domain queue (`RuntimeService.cpp` near
  line 1266) acts only past `dom.workers.maxPerDomain`, 512 (`modules/libpref/init/all.js` line 117).

So in Firefox both workers' loading shares one queue, the page's main thread, with the page's own tasks; their
compiling does not. The view worker's graph is 11 modules over 4 levels (`view-worker.js` → `consumer.js`,
`paint-worker.js`, `cache.js`, `controller.js` → …, 63 KB); the downloader's is one module (27 KB). Each costs main-thread
turns: a channel opened, and a stream completed and decoded, per module. Created before the metadata
(`viewWorkerFirst`), the view worker's later levels fall in the window where the page reaches `connect` and the
downloader's single load waits its turn. At 1× a turn is short and #276 saw the cost under the bar. Under the 4×
throttle every thread gets a quarter of a CPU (`lab/scripts/cpu_throttle.mjs`), so the main thread's queue drains a
quarter as fast, and the busy-core guard, which reads the cores, cannot see one thread at its cap. That fits #276's
Firefox mammogram 4× steps (medians; it does not prove the mechanism): under B′+fix the page itself reaches `connect`
96 ms after A's, its downloader's script runs 214 ms after that connect against 72 ms, and the view worker, made
before the metadata, evaluates *later* (1088 ms) than B′'s made after it (930 ms). **`viewWorkerFirst` can therefore
delay the downloader's boot**, in Firefox, by the main-thread turns of the view worker's graph that land ahead of it.

*Chromium, not read here:* its dedicated workers fetch their scripts off the page's main thread (the top level by the
browser process, imports by the worker's own fetch context), so this mechanism predicts no such overlap cost there.
That is from Chromium's design as remembered, not cited to a line.

**What the theory names: the view worker made once the downloader has its start** (lab setting
`viewWorkerAfterDownloader`, in `?opts=`, default off). Under `pageDials` the page creates the downloader, posts
`start` and `dial`, and asks the downloader (`tellPage` on `start`) to post it `running` once `start` has arrived,
which is after its script has run; only then does the page make the view worker, post its `start` and join it to the
downloader (`client/view/view.js`). No load of the view worker's can then be queued ahead of the downloader's. Its
boot moves after the dial, beside the session's opening and the first frame's flight; it is off the first frame's
path when it ends before `firstIn`. #276's steps give the room: `downloaderStart` → `firstIn` is 291–776 ms, A's medians over its 16
cells, the view worker's boot (made → evaluated, then the WebGL2 context) 60–70 ms in Chromium at 1×, ≈ 120 ms at 4×,
110–200 ms in Firefox at 1× and ≈ 480 ms at 4×, against 368–409 ms of room in Firefox's 4× CT, US and
tomosynthesis. Its risks, named before data: there the boot outlasts the room; and in Firefox the boot now shares the main
thread with the decoders' loads, which the downloader starts at `start`. Refused under `?view=page`, without
`pageDials` (the view worker would start the downloader it waits for), and with `viewWorkerFirst`
(`lab/viewer/levers.js`). *The `viewWorker` stamp* is now taken where the worker is made, in every arm, so under
`viewWorkerFirst` it is its creation before the metadata, which #276's was not.

**Held by** `client/view/view.test.mjs` (*after the downloader, the view worker is made once the downloader runs*; *by
default the downloader is not asked to say it runs*; *after the downloader, a downloader that does not load fails
connect*), `client/transport/downloader.test.mjs` (*aStartToldSaysRunning*) and `lab/viewer/levers.test.mjs` (the
three refusals). Mutants, each fails a test: the view worker made at once; `tellPage` never or always sent; the wait
for `running` dropped, or not ended by a downloader that does not load; the creation unstamped; `tellPage: false` sent
by default; `running` never or always said, or said before the stamp moved; each refusal removed.

**Arms**, each a `variants.json` entry from `lab/viewer/view_frames.py --split`:

| arm | `?view=` | lab settings |
| --- | --- | --- |
| A, `page` | `page` | none |
| A/A, `pageaa` | `page` | none |
| B′+fix, `workerfix` | `worker` | `pageDials`, `viewWorkerFirst`, `shortRuns` (#276's) |
| B′+dials, `workerdials` | `worker` | `pageDials`, `shortRuns` |
| B′+after, `workerafter` | `worker` | `pageDials`, `shortRuns`, `viewWorkerAfterDownloader` |

**Cells.** §7's four series, the quiet page, `r50000`, 1× and 4× (`lab/scripts/cpu_throttle.mjs`), Chromium and
Firefox; arms and cells interleaved by `run.mjs` (`lab/order.mjs`); 12 kept rounds a cell, whole rounds topped up for
drops as #276 did. **Guards and bars:** #276's, unchanged — the A/A VOID at 16.7 ms on the first frame (or the fill
after it outside ×0.98–1.02), the saturation guard at a 0.95 busy share of the browser's cores, latency the first exact
frame drawn (±16.7 ms), throughput the fill after it (×0.98–1.02), read by `lab/viewer/start-summary.mjs`. **An arm
ties A** when the summary's verdict for it is "ties A": no decided bar later or slower, and a decided latency on each
engine run. **The goal is met** when one arm ties A with both engines run.

**Firefox cannot be run in this session**, found before any data: Playwright's Firefox download is refused by the
environment's network policy (`cdn.playwright.dev`, `playwright.download.prss.microsoft.com`), and the session's
permission policy refuses running a Firefox fetched from conda-forge. So only the Chromium cells are run; the Firefox
predictions below stand unrun, and no arm can meet the goal here. The rule is applied to the Chromium rows as written,
and its verdict is read as Chromium's alone. *2026-11-03: Firefox run in a later session (the policy now allows
Playwright's download), as written, nothing amended; below, after Chromium's.*

**Predictions**, first frame drawn, paired Δ against A (✓ a tie by the bar, ✗ later):

| cell | B′+fix | B′+dials | B′+after |
| --- | --- | --- | --- |
| Chromium, each series, 1× | ✓ | ✓ | ✓ |
| Chromium, each series, 4× | ✓ | ✓ | ✓ |
| Firefox CT, US, tomo, 1× | ✓ | ✓ | ✓ |
| Firefox mammogram, 1× | ✓ (#276: +13.5, VOID) | ✓ | ✓ |
| Firefox CT, US, tomo, 4× | ✓ | ✓ | ✗, ≈ +50–110: the boot outlasts `downloaderStart` → `firstIn` |
| Firefox mammogram, 4× | ✗, ≈ +150–190 (the overlap) | ✗ or ✓: the view worker made at the metadata still loads at `connect` (#276's B′: the downloader's script +99 ms after it against A's 72), so ≈ +30–80 | ✓: the downloader's script as soon after `connect` as A's (± 10 ms) |

and by step: no fix arm moves `downloaderStart` − `connect` against A's by more than 10 ms in Chromium; the fill after
the first frame ties in every multi-frame cell, every arm. **Chromium tomosynthesis 1×'s +21 ms does not reproduce**
(B′+fix within ±16.7 ms): the fix does not act between the downloader's start and the session's opening, so it was a
round's noise. If it does reproduce at `sessionOpen` again, that reading is wrong and is said so.

**Decision, written before data.** If B′+after ties A on Chromium and B′+fix does not, B′+after is the candidate start,
owed its Firefox cells before anything is changed. If all three tie A on Chromium, Chromium does not separate them
and Firefox is owed. If B′+after is behind A where B′+fix is not, the boot after the dial is on the first frame's path
and the step stamps say where. By these predictions no arm ties A in every Firefox 4× cell —
B′+fix behind on the mammogram, B′+after on the other three, B′+dials uncertain — because the view worker's boot,
through the throttled main thread, is longer than the room in some cells and costs the downloader in others. Should
Firefox confirm that, the start left to try is the view worker made at `connect` just after the downloader, in the
same task: its loads queue behind the downloader's single one and start ≈ 100 ms sooner than B′+after's. It is named
here, not built. No default changes on this run.

**Measured 2026-11-02, Chromium, 1× and 4×** (rows:
[`lab/viewer/rows/split-quiet.jsonl`](https://github.com/dary-dc/wt-pacs/blob/836b6150/lab/viewer/rows/split-quiet.jsonl), `claude/core-start2@836b6150`,
run from `5f737209` by `FRAMES=lab/.av1-work/view-split THROTTLES=1,4 NAME=split KINDS=quiet ENGINES=chromium
VARIANTS=page,pageaa,workerfix,workerdials,workerafter xvfb-run -a lab/viewer/view_run.sh`, the frames made by
`view_frames.py --split`; rounds 0–24, of which 13–24 whole top-up rounds for the relay's drops; a round 17 cut
short by the session's command limit was discarded unread and run again whole; read by
`node lab/viewer/start-summary.mjs`). Headless Chromium 153 as #276. 1000 visits, 59 dropped by the relay's VOID, none
for an error, every kept frame exact; every cell has its 12 rounds. **No cell saturated** by the guard (A's busy share
0.39–0.67 over the start, 0.33–0.42 over the fill). **All four 4× cells are VOID**, the A/A pair 17.5–68.5 ms apart,
so the rule decides only the four 1× cells. Paired medians over each cell's 12 rounds, ms; steps are each arm's
median less A's (B′+fix / B′+dials / B′+after):

| cell | A/A, first drawn | first drawn | downloader's script after `connect` (A) | `sessionOpen` | `firstIn` | B′+after's view worker: made → evaluated, → `connect`; its `connect` before `firstIn` | made → evaluated, B′+fix / B′+dials |
| --- | --- | --- | --- | --- | --- | --- | --- |
| CT 1× | −15 | +12.5 / −12 / +4.5 | 24 / 22 / 18 (16) | −13 / −1 / +1 | −7 / −1 / −1 | 87, 27; 199 | 79 / 99 |
| US 1× | +14 | −11 / −11.5 / −5 | 20 / 25 / 17 (19) | +11 / +5 / +6 | +13 / +2 / −1 | 100, 19; 201 | 82 / 77 |
| tomo 1× | −5.5 | +14 / +11 / +6.5 | 30 / 20 / 16 (18) | +12 / +15 / −4 | +17 / +10 / −7 | 87, 27; 240 | 67 / 80 |
| mammo 1× | +10 | +16.5 / **+30, later** / +1 | 31 / 16 / 15 (19) | +31 / +9 / −5 | +30 / +13 / −6 | 98, 24; 560 | 85 / 82 |
| CT 4× *(VOID)* | +17.5 | −37 / +6.5 / −28 | 32 / 38 / 22 (29) | −5 / +6 / +4 | −7 / −3 / −6 | 171, 22; 166 | 111 / 147 |
| US 4× *(VOID)* | +28.5 | +7.5 / +50.5 / +24 | 31 / 39 / 28 (23) | +23 / +32 / +19 | +30 / +40 / +23 | 178, 44; 138 | 86 / 117 |
| tomo 4× *(VOID)* | −21 | +25.5 / +37.5 / −7 | 31 / 32 / 38 (24) | +43 / +28 / +16 | +38 / +25 / +14 | 173, 30; 188 | 73 / 143 |
| mammo 4× *(VOID)* | −68.5 | −18.5 / +46 / +3 | 47 / 35 / 28 (35) | +16 / +15 / +12 | +24 / +20 / +15 | 176, 30; 530 | 82 / 137 |

The fill after the first frame ties in every multi-frame cell, every arm (×0.997–1.007).

**Verdict, by the rule written before the data, Chromium's alone: B′+after ties A; B′+fix ties A; B′+dials does
not** — "behind A: chromium ffdm_a-0 1x first", +30 ms. Firefox was not run, so **the goal is not met**: no arm is shown
to tie A on both engines, and the Firefox mammogram 4× that #276 found behind is not re-measured here. By the decision
written before data — B′+after and B′+fix both tie on Chromium — Chromium does not separate the two candidates, and
**Firefox is owed**; B′+after is the one the Gecko reading favours there and B′+fix the one #276 found behind.
*2026-11-03: Firefox has since been run; the verdict over both engines is below.*

*Read from the steps, not decided by the rule:*

* **Chromium tomosynthesis 1×'s +21 ms did not reproduce**, as predicted: B′+fix +14 ms, a tie. But the same kind of
  spread came back elsewhere: B′+fix's mammogram 1× is +16.5 ms, already +31 at `sessionOpen`, with its downloader's
  script 31 ms after `connect` against A's 19. Between the downloader's start and the session's opening no lever of
  the fix acts, so this reads as noise of the order of the bar — one more reason a 16.7 ms bar on single cells needs
  its A/A, which at 4× was wider than the bar in every cell.
* **B′+after's boot is off the first frame's path in every cell, 1× and 4×:** its view worker joins the downloader
  138–560 ms before `firstIn`. Made beside the downloader's start, the boot is slower than made earlier — 87–100 ms
  from creation to evaluation at 1× against B′+fix's 67–85, 171–178 ms at 4× against 73–111 — which Chromium too
  spends on something the overlap shares (the decoders' boots, inferred, not measured); it costs nothing on the path
  because the room left is 138 ms or more.
* **No arm moved the downloader's script** after `connect` against A's by more than 12 ms at 1×, as predicted for
  Chromium; at 4× B′+dials' by up to 15 ms. B′+dials' later mammogram 1× is not at the downloader (16 ms against A's 19)
  nor at `sessionOpen` (+9), and its step medians stay +13 from `firstIn` to drawn (its WebGL2 context is up 620 ms
  before `firstIn`). The paired +30 is larger than any step median shows, so no step locates it: read as the
  round-to-round spread the A/A shows, not as a cause.
* **Where the host saturates:** nowhere by the guard. As said above, the 4× throttle caps each thread, which a
  busy-core guard cannot see; nothing is claimed from the 4× cells, which are VOID by the A/A in any case.

**Measured 2026-11-03, Firefox, 1× and 4×** (rows:
[`lab/viewer/rows/splitff-quiet.jsonl`](https://github.com/dary-dc/wt-pacs/blob/d49cc58/lab/viewer/rows/splitff-quiet.jsonl),
`claude/core-start2@d49cc58`, run from `bf9d6fb` by `FRAMES=lab/.av1-work/view-split THROTTLES=1,4 NAME=splitff
KINDS=quiet ENGINES=firefox VARIANTS=page,pageaa,workerfix,workerdials,workerafter xvfb-run -a lab/viewer/view_run.sh`,
the same frames; a docs-only commit, `6ce06b3`, landed between rounds 3 and 4; rounds 0–16, of which 12–16 whole
top-up rounds for the relay's drops; read by `node lab/viewer/start-summary.mjs`). Playwright's Firefox 155.0, the major
#276 ran, headed under `xvfb-run` (headless, its worker has no WebGL2). 680 visits, 10 dropped by the relay's VOID,
none for an error, every kept frame exact; every cell has its 12 rounds. **No cell saturated** by the guard (A's busy
share 0.43–0.63 over the start, 0.31–0.47 over the fill). **Seven of eight cells are VOID**, the A/A pair 17.5–107.5 ms
apart; only US 1× is decided (A/A +3). Same columns as Chromium's:

| cell | A/A, first drawn | first drawn | downloader's script after `connect` (A) | `sessionOpen` | `firstIn` | B′+after's view worker: made → evaluated, → `connect`; its `connect` before `firstIn` | made → evaluated, B′+fix / B′+dials |
| --- | --- | --- | --- | --- | --- | --- | --- |
| CT 1× *(VOID)* | +47.5 | −3 / −0.5 / −6 | 39 / 47 / 20 (26) | 0 / +43 / +11 | 0 / +40 / +7 | 77, 33; 202 | 208 / 117 |
| US 1× | +3 | −9 / −19.5, sooner / **−48, sooner** | 36 / 23 / 20 (21) | −13 / −12 / −38 | −14 / −15 / −34 | 81, 30; 216 | 176 / 120 |
| tomo 1× *(VOID)* | −23.5 | +17.5 / −35 / −4 | 40 / 34 / 31 (28) | +14 / −16 / −2 | +26 / −5 / −17 | 72, 44; 234 | 177 / 170 |
| mammo 1× *(VOID)* | +26 | −19 / +10 / −15 | 44 / 38 / 32 (23) | +6 / +35 / −1 | +3 / +36 / +5 | 74, 33; 576 | 164 / 149 |
| CT 4× *(VOID)* | +28 | +126 / +88.5 / +100.5 | 77 / 67 / 58 (40) | +99 / +58 / +64 | +112 / +49 / +65 | 233, 70; 77 | 329 / 179 |
| US 4× *(VOID)* | +17.5 | +18 / −6.5 / +4 | 67 / 69 / 96 (60) | 0 / +10 / +58 | −5 / 0 / +55 | 231, 85; 77 | 245 / 192 |
| tomo 4× *(VOID)* | −89 | −17.5 / −27 / +15 | 127 / 81 / 135 (170) | −38 / −85 / −99 | −35 / −139 / −97 | 261, 84; 74 | 457 / 255 |
| mammo 4× *(VOID)* | +107.5 | +104 / −35.5 / +193.5 | 66 / 72 / 193 (75; A/A 188) | +43 / +24 / +225 | +34 / +17 / +215 | 223, 85; 411 | 355 / 260 |

The fill after the first frame ties in every multi-frame cell, every arm (×0.994–1.003). B′+fix's made → evaluated
starts before the metadata, so it holds the metadata's fetch as well.

**Verdict on Firefox, by the rule: all three arms tie A**, on its one decided cell. **Over both engines**
(`start-summary.mjs` over both files): **B′+fix ties A; B′+after ties A; B′+dials does not** ("behind A: chromium
ffdm_a-0 1x first"). So the goal, as written, is met twice — but on five decided cells, every one at 1×: Chromium's
four and Firefox US. **No 4× cell is decided on either engine**, so neither arm is shown to tie A at 4×, and **the
Firefox mammogram 4× is not re-decided**: there B′+fix is +104 ms (#276: +188), B′+after +193.5 and B′+dials −35.5,
inside an A/A of +107.5, where the rule counts nothing. The question this section asked — a start that ties A in every
decided cell, both engines, 1× and 4× — is answered at 1× and not at 4×, because at 4× this rig's A/A is wider than
the bar on both engines (17.5–107.5 ms).

**The predictions:** at 1× they held (every Firefox 1× cell within the bar or sooner, every arm). At 4× none of
Firefox's can be scored by the rule; read against the A/A, the mammogram's order came out the reverse of the one
predicted (B′+after the latest, B′+fix between, B′+dials the soonest), and B′+after's predicted +50–110 in CT, US and
tomosynthesis showed only in CT (+100.5), where B′+fix and B′+dials are as late.

**The Gecko reading of worker loading, step by step from the stamps** (Firefox 4×, each arm's median):

1. *`viewWorkerFirst` delays the downloader's script after `connect`.* **Did not hold.** B′+fix's script runs 66–127 ms
   after `connect` against A's 40–170: in the mammogram 66 against A's 75 (#276: 214 against 72). Where it is later,
   CT (+37), it is inside the spread A/A shows in the same step (−90 to +113).
2. *B′+after's downloader script follows `connect` as soon as A's (±10 ms) in the mammogram.* **Did not hold**: 193
   against A's 75. Its view worker is made only after that script has run, so nothing of the view worker's is queued
   ahead of it; and A/A's own is 188. So this step moves by ≈ 100 ms between rounds with no view worker present, and
   #276's 214 against 72, the step the reading was written to explain, sits inside that spread.
3. *The view worker made first is slower to evaluate, its loads sharing the main thread with the page's start.*
   **Consistent, not shown:** made before the metadata, it evaluates later than made at the metadata in three of four
   4× cells (CT +69, tomo +164, mammo +58 ms; US −21), as #276's 1088 against 930. That is the cost the reading names,
   but it lands on the view worker, not on the downloader (step 1).
4. *B′+after's boot outlasts the room at 4×* (predicted ≈ 480 ms, 368–409 ms of room). **Did not hold:** made →
   `connect` is 303–345 ms, and it joins the downloader 74–77 ms before `firstIn` in CT, US and tomosynthesis, 411 in the
   mammogram, so the boot itself is off the first frame's path by these medians. Where B′+after is later (CT, the
   mammogram) it is already later at `sessionOpen`, while its boot is still running, so step 5 is not ruled out.
5. *Its boot shares the main thread with the decoders' loads.* **Not separated:** B′+after's decoders are ready
   +5 to +205 ms after A's at 4×, B′+fix's −23 to +160.

So the source reading stands as a reading — every script load of a Firefox worker passes the page's main thread — but
the cost it predicts for the downloader was not seen: the step it explained moves as much between A and A/A.

**Recommendation, plainly: keep B′+fix** (`pageDials`, `viewWorkerFirst`, `shortRuns`), **and remove the lab setting
`viewWorkerAfterDownloader`**, with the downloader's `tellPage` → `running` reply that only it uses and its three
refusals (not removed in this run). Both tie A by the rule on both engines; at a tie the simpler code wins, and
B′+fix is #276's existing levers while B′+after adds a message to the downloader and an order between the two workers.
Neither the Gecko reading's mechanism nor its 4× prediction gives B′+after a measured reason to stay; in the one cell
the question named, B′+after is the further behind (both VOID). B′+dials needs nothing removed — it is B′+fix without
`viewWorkerFirst` — and is behind A once, on Chromium. **Owed before any default changes:** a 4× answer on both engines,
which needs a rig whose A/A at 4× is under the bar (at 1× it is in five of eight cells over both engines); this rig's is
not.

**Where the host saturates:** nowhere by the guard on Firefox either; the 4× cells are VOID, so nothing is claimed
from them past the reading above.


