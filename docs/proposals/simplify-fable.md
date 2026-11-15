# The demo path, simplified: proposals

Written 2026-11-11 by a session that had read none of the earlier reviews when §1 and §2 were written; §4 compares
with them afterwards. **Proposals only: nothing here is implemented, and no removal happens without the owner's yes.**

Read at `claude/demo-fixes-1` `daee0d1d` (the demo tip; `claude/demo-fixes-2` does not exist): `client/viewer`,
`client/view`, `client/paint`, `client/decode`, `client/transport` (`consumer.js`, `downloader.js`, `ts/`),
`server/dev-server.py`, `server/` (the flags and the session's shape; `read_path.rs` and the tests were not read
line by line), `README.md` §Demo, `client/README.md` §The viewer, `docs/lines/client.md`,
`docs/lines/optimal-quality.md`.

Every path below is a path at that commit; some are not on `main` yet.

**No claim below rests on a run of mine.** Each is a reading of the code at that commit: a `grep` that shows who
uses a thing, and the name of the test that would fail if the capability went. Where a proposal needs a measurement
to decide, it says which.

## 1. Essentials: what the demo does, in one path

A presenter has to be able to say this, and no more:

1. **The page** (`viewer/index.html`, `head.js`, `viewer.js`) reads the series' metadata and the transport file,
   then starts one **downloader** worker.
2. **The downloader** (`transport/downloader.js`) owns the WebTransport session (`transport/ts/`) and a pool of
   **decoder** workers. It asks the server for frames in the order the view wants them, hands each frame's coded
   bytes to a decoder, and forgets a frame once the view has acknowledged it.
3. **A decoder** (`decode/decoder.js`) decodes one frame (AV1 through WebCodecs, dav1d-WASM if WebCodecs refuses;
   HTJ2K through OpenJPH-WASM), hashes the pixels with XXH3 when the series has digests, and posts them straight to
   the view in shared memory.
4. **The view** (`view/controller.js` over `view/store.js`) holds the frames by index, knows the current frame, and
   paints it (`paint/paint-worker.js`: WebGL2, the DICOM window as a table).
5. **The pairing**: an optimal-quality series names its exact series. The page checks the two describe one source
   (`viewer/pair.js`), opens a second downloader on the exact series' server, and on **Lossless** asks that one frame;
   the label says *Lossless* only once the frame's digest matched and it was painted.

That is five boxes and one arrow between each. The code holds that shape, and it is sound. What makes it hard to
explain is not the shape but what is threaded through it:

| what a reader meets | where | how many |
| --- | --- | --- |
| two places the view can live, chosen by URL | `?view=page`, `?view=worker` | 2 of everything the view does |
| three ways the view asks the downloader | `fill`, `ask` + `cancel`, `want` | 3 |
| three writers of a cache that is off | `?writer=store`, `decoders`, `view` | 3, none on by default |
| two cines | `View.play` (the page's timer), `clock.js` `Cine` (four tick sources) | 2, one of them lab only |
| lab and check hooks inside the product page | `viewer.js` | about 100 of 330 lines |
| settings a URL can turn | `lab/viewer/levers.js` → `?opts=` | over 20 named in the code read |
| one clock helper, written out | `at`, `abs`, `now` | 7 definitions, 3 names |

## 2. The simplest shape that keeps every capability

Written before any earlier finding was read.

**One view: the view worker.** The owner's target (2026-10-28) is that frames never return to the main thread. Then
the page is only intents and events, and these go: the page's painter (`paint/painter.js`), the paint worker's own
message handler, the controller's page branch (`#asks`, `#steps`, the cancel dance in `show`), `heldAcks` and
`port` as options (they become the only way), and the second arm of every check. `View` and `ViewWorker` become one
class. This is the largest saving and the one that needs a decision the owner has reserved for the phone runs.

**One way to ask: the want.** `want(indices)` already expresses the other two: a fill is a want of the whole series,
an on-demand step is a want of one frame. With one view, `fill`, `ask` and `cancel` stay only for the exact series'
single-frame ask and the check's protocol. Whether the exact series' ask can also be a want of one frame is a
follow-up, not a requirement.

**One cache writer, chosen by its measurement, or none in the tree until it is chosen.** The cache is a decided
capability (OPFS, no re-decoding) that is not on: no page passes `?writer=` unless the lab does. Three writers are
kept switchable for a comparison. Once the comparison names one, the other two, their plumbing in `decoder.js` and
`consumer.js`, and the `writer` argument itself go.

**The page knows nothing of the lab or the check.** `viewer.js` builds the page and exposes one handle (the view,
the event stream, the counters it already keeps). The check and the lab harness load beside it and drive that handle,
instead of the page calling `lab.started?.()`, `lab.filled?.()`, `lab.finished?.()`, tracing steps, counting
messages and polling for the fill's end.

**Start-up has one order.** `pageDials`, `viewWorkerFirst`, `glAfterDial` and `shortRuns` are four switches for one
question (what starts first). The answer becomes the code; the switches go.

**One cine.** The product's cine is a page timer; the worker's `Cine` class and its four tick sources exist for the
lab's frame-clock study. Either the worker's clock becomes the product's (the target in `docs/lines/client.md`
§Open 2) with the one source the study chose, or it lives with the lab until then.

**Layers import downwards only.** `view/controller.js` imports `viewer/pair.js`; `decode/decoder.js` imports
`view/frame-file.js`; `view/cache.js` starts `viewer/store.js` as a worker; two unrelated files are both `store.js`.
`depthCut` and `CUT_DEPTH` belong beside the payload they describe, the cache files beside each other, and one of
the two stores takes another name.

**One command starts a pair.** Two servers and a static host, with a `sed` and five flags between them, is what
`demo-check.mjs` already starts by itself. A presenter should type an ID.

What stays exactly as it is, because it is already the simplest thing that does the job: the downloader's record
and queue, the survival path (stall, re-dial, the transport file followed across a restart), the decoder's check
and second decode, the paint module's two passes, the DICOM window table, the pairing check and the label's rule,
`dev-server.py`'s headers and policy, the server's session loop. None of these has a second implementation beside
it, and each has its reason one pointer away.

## 3. Proposals

Ranked by what each saves someone who must explain the demo. **Before** means safe before 2026-11-13; **after**
means it touches code the demo runs and waits for the freeze. Sizes are counted from the files at `daee0d1d`.

| # | proposal | saves | size | when |
| --- | --- | --- | --- | --- |
| P1 | one command starts a pair | the set-up is an ID, not three terminals | +1 script, README −50 lines | before |
| P2 | three doc statements the code contradicts, corrected in place | a presenter does not repeat them | docs, ~10 lines | before |
| P3 | the page knows nothing of the lab or the check | `viewer.js` reads top to bottom | ~100 lines out of the page | after |
| P4 | one way to ask, whichever view | one asking protocol to explain, not three | ~60 lines, one behaviour change | after, measured |
| P5 | one view | "where are the frames" has one answer | 250–600 lines | after, the owner's |
| P6 | start-up has one order | four switches become none | ~50 lines | after, with its timing |
| P7 | one cache writer | two writers and their plumbing go | ~110 lines, one file | after |
| P8 | one cine | the worker's clock class leaves the product | 85 lines, 4 intents | after |
| P9 | layers import downwards; one clock helper; one `store.js` | no surprise imports | mechanical | after |
| P10 | AV1 decode: what the ≤ 10-bit rule makes unreachable | two branches a presenter can skip | ~25 lines | after |
| P11 | the server's default build lists only what a deployment sets | `--help` is the product | ~30 lines | after |

### P1. One command starts a pair — before

*What goes.* README §Demo's three-terminal block and its phone twin (two copies of two `series-server` lines, a
`sed` into `target/exact-transport.json`, `dev-server.py` with four flags, an order to start them in).
`client/viewer/demo-check.mjs` `serve()` (at `daee0d1d`, lines 50–61 and on) already runs exactly those commands,
certificate first. One starter under `scripts/`, taking the series' ID, replaces the block, and `serve()` calls it so the two cannot drift.

*No capability lost.* The servers and their flags are unchanged; only who types them changes.
`demo-check.mjs` on the 20 optimal-quality series is the check, through the same starter. The phone block needs the
laptop's address in both transport files: one variable of the starter.

*Saves.* The presenter types one ID. "Why 4434" has one answer, in one file. *Size.* One short script; README −50.
*Risk.* Low: it changes how the servers start, not what they serve. The phone block is also being edited by the
phone set-up work, so it goes in with that or after.

### P2. Three statements the code contradicts — before, docs only

A presenter repeats what the docs say. These three are not what the demo tip does:

1. `client/README.md` §The viewer, *Frames*: "each frame checked `true` is also written to OPFS by a store worker
   … and past 256 MiB the frames on disk farthest from the current one leave memory". The same section, two
   paragraphs on, says there is no cache without a writer, which is the truth: `viewer.js` passes no writer unless
   the lab names one, and nothing passes `budget` to the controller (`grep budget client/viewer/viewer.js
   client/view/view-worker.js client/view/view.js`: nothing), so `FrameStore`'s budget is `Infinity` and no frame
   ever leaves memory.
2. `docs/lines/client.md` §State now says the view worker's controller holds "the cine clock". The product's cine is
   a timer on the page (`view.js` `View.play`); `clock.js` runs only when the lab calls `play` with a source.
3. `client/view/view.js`, on `play`: "Paced from the page for now; the clock moves into the view worker in a later
   row". A comment that carries the project's history, against `CLAUDE.md` §Comments; one word of code, so it waits
   for the freeze, but the fact belongs in `docs/lines/client.md` §Open 2, where it already is.

*No capability lost.* Words only; each is corrected in place, as `CLAUDE.md` §Docs asks. *Size.* About ten lines.

### P3. The page knows nothing of the lab or the check — after

*What goes from `viewer.js`* (about 100 of its 330 lines): the `lab` object and its refusal (19–30), `booted`
(31), the `boot` stamps (34, 109, 112, 157), the check's stop hooks and `?deadline=` (56–62), `seen`,
`carriesPixels`, `watch` (95–103), `lab.started` and `firstWant` (155, 169–170), the trace and `stepped`
(215–230), `report` (295–299) and the whole tail that polls for the fill's end and runs the check or the lab's
steps, cine and ledger (301–329). From `controller.js`: `ledger` (14 lines). From `view-worker.js` and `view.js`:
the `ledger`, `cine`, `play`, `tick`, `pause` entries.

*The shape instead.* The page ends by publishing one handle: the view, the event stream it already has (`on`),
and the counters it already keeps (`progress`, `shown`, `errors`). `head.js` already decides whether a lab or a
check is present; where one is, it loads that module beside the page, and the module drives the handle. For work
that must run beside the controller in the view worker, one entry already exists: `CALLS.check` imports a module
and runs a named phase with the controller. The ledger, the lab's cine and the test frames (`hold`) are phases of
that kind, so they need no entries of their own.

*No capability lost.* `client/viewer/run_check.sh` (each view, each client, cine and on demand) and
`lab/viewer/levers.test.mjs` (both at `daee0d1d`) pass unchanged; `demo-check.mjs` opens the page as a reader and must pass on the 20
series; one lab run (`lab/av1/delivery/total-time/run.mjs`) shows the ledger still arrives. Mutant: do not load
the check module, and the page check must fail while the demo check passes.

*Saves.* The page reads metadata → pair → connect → label → keys. The web image stops shipping check code.
*Size.* ~100 lines leave the page, ~30 leave the view layer, ~15 are added. *Risk.* Medium: the gate's browser
checks hang on these hooks, so a slip blinds the rehearsal. After the freeze.

### P4. One way to ask, whichever view — after, measured

*Today.* The controller has two bodies in `show` (`controller.js` 141–168). Where the store has a downloader
(the view worker) it states a **want**, and the store sends the misses. On the page it **asks** frame by frame,
tracks `#asks` and `#steps`, and on demand **cancels** before each new ask; the series itself arrives by a
**fill** named at connect. The downloader serves all three (`fill`, `ask` with `cancel`, `want`), and
`view/check.js` has two listeners and two step protocols to test both.

*What goes.* The page branch of `show`, `#asks`, `#steps`; `fill:` at the page's connect; one of `check.js`'s two
`listen` bodies and one of `stepsOnDemand`'s. The page connects as the view worker does: `want` at the start,
`store.link(client, want)`, acks held by the store. `Controller.show` becomes three lines. `fill`, `ask` and
`cancel` stay in the downloader for the exact series' single-frame ask and for the contract's clauses.

*No capability lost — to be shown, not assumed.* The want already carries both jobs under the view worker:
`controller.test.mjs` "worker view: the misses go to the downloader in the want's order, once", "worker view: a
frame of a replaced want is kept", "a scroll through a group after a jump into it asks nothing". But the page's
on-demand rule changes: today a new step cancels the ask before it ("the newest ask alone"); under a want the frame
already asked is kept. That is a behaviour change on `?fill=0`, the demo's on-demand step. **Deciding
measurement:** on-demand latency of a jump during the fill and of three quick steps, page view, the two asking
paths interleaved, on the three DBT volumes; latency only.

*Saves.* "How does the view get a frame" has one answer on both views, and the two views then differ only in which
thread runs the same controller. This is worth doing even if P5 is never decided. *Size.* ~60 lines and half of
`check.js`'s protocol. *Risk.* It changes the demo's default path, so not before 11-13.

### P5. One view — after, and the owner's

*Today.* `?view=page` is the default and what every demo check has run; `?view=worker` is the client line's target
(the owner, 2026-10-28). Both are kept, so `viewer.js` branches on `where`, `View` wraps either, and the gate runs
every viewer check twice.

*What goes, by the answer.*

* **The view worker is the one view:** `paint/painter.js` (62 lines), `paint-worker.js`'s own message handler (17),
  the `where` branches of `viewer.js`, `heldAcks` and `port` as options, the page arm of every check, and `View`
  folds into `ViewWorker`. About 250 lines, and half of `run_check.sh`'s matrix.
* **The page is the one view:** `view-worker.js` (168), `ViewWorker` (165 lines of `view.js`), and with it the place
  the decided OPFS cache lives. About 600 lines, but it undoes a decision, so this document does not propose it.

*What decides.* Not a correctness check alone. `docs/adr/frame-path.md` §7 kept the page as default by its own
rule: the view worker's first exact frame came later, by at least 16.7 ms in five decided cells, on cloud hosts
(indicative only). The start-order change that answers it (P6) is built and not timed. So the deciding runs are
§7's protocol again with that start order, and the phone runs the owner has set aside for this.

*No capability lost.* `demo-check.mjs --view worker` passes the 20 series (`docs/reviews/view-worker-check.md` at `daee0d1d`,
2026-11-11; correctness only), and `run_check.sh`'s worker rows pass in the gate.

*Until it is decided*, a presenter says one sentence: "the frames are held on the page; a worker is the target and
is off by default."

### P6. Start-up has one order — after, with its timing

*What goes.* `pageDials`, `viewWorkerFirst`, `glAfterDial`, `shortRuns`: four lab settings for one question,
threaded through `viewer.js` (`booted`, `firstWant`), `ViewWorker.boot` and its constructor, `ViewWorker.#link`
(`dialled`, `refuseUnstartable`, `startAndDial` on the page), `view-worker.js` (the `gl` promise that defers the
painter, `dialled`, `sent`), `FrameStore.link(downloader, sent)`, `DownloaderClient.connect`'s `dialled`, and the
downloader's `whole` test in `serveWant`. `run_check.sh` already runs all four on together as "the start's fix".

*The shape instead.* The timing run names the order; that order is the code, without a switch. If the fix wins,
the page always dials and the view worker always joins; if it loses, the four leave with their result in the ADR.
Folding them into one `lab` object, as an earlier finding suggests, keeps every branch and hides the count.

*No capability lost.* `run_check.sh`'s three "fix" rows become the plain rows. *Size.* ~50 lines over six files.
*Deciding measurement.* `docs/adr/frame-path.md` §7, *The view worker's start, timed*, already pre-registered.

### P7. One cache writer — after

*Today.* The cache is off unless the lab's `?writer=` names `store`, `decoders` or `view`. The ADR names `store`
(the packed file in a store worker) as the writer the cache will use when the owner turns it on
(`docs/adr/frame-path.md` §3, *Built*: "`store` (the default …)"), and a removal of the comparison's rig is prepared on
`claude/demo-clean`, which lists it as concluded.

*What goes.* `cache.js` `files()` (20 lines), `view/frame-file.js` (38), `decoder.js`'s `cache`, `write` and its
import from `view/` (~15), `consumer.js`'s `#writes`, `#written`, `writable` and `frame.write` (~10),
`view-worker.js`'s `cache:` option, `FrameStore`'s `write: f.write`, the `writer` argument itself, two of
`run_check.sh`'s three writer rows, and three of `levers.js`'s refusals.

*No capability lost.* The cache with the `store` writer keeps its tests: `controller.test.mjs` "cache: …" (seven
tests), `client/viewer/store.test.mjs` at `daee0d1d`, `run_check.sh --writer store --tabs`. *Needs the owner:* that the
comparison is closed for `decoders` and `view`. *Size.* ~110 lines and one file.

### P8. One cine — after

*What goes from the product tree.* `view/clock.js` (85 lines: `Cine`, four tick sources) and the view worker's
`play`, `tick`, `pause`, `cine` entries. The view worker's own comment says it: "A lab's cine on a clock it names;
the product's cine is the page's." They live with the frame-clock study until its rule
(`docs/adr/frame-path.md` §A frame clock in the view worker) names the source; then the product gets that one.

*No capability lost.* The product's cine is `View.play`, checked by `check.mjs --cine`. `clock.test.mjs` moves with
the class. *Size.* 85 lines and four entries, replaced under P3 by a phase beside the controller.

### P9. Layers, one clock helper, one `store.js` — after, mechanical

* `view/controller.js` imports `CUT_DEPTH` and `depthCut` from `viewer/pair.js`: the view reaches up into the page.
  They describe the payload; they belong in `decode/` beside it, and `pair.js` imports them from there.
* `decode/decoder.js` imports `view/frame-file.js` (goes with P7).
* `view/store.js` is the frames in memory; `viewer/store.js` is the OPFS store worker, started from `view/cache.js`.
  Two files, one name, two concepts; `docs/lines/client.md` already confuses them ("the OPFS cache (`store.js`)").
  The worker moves beside `cache.js` under a name of its own, defined in `docs/glossary.md`.
* `performance.timeOrigin + performance.now()` is defined seven times under three names (`at` ×4, `abs` ×2, `now`
  ×1). One export, one name.

*No capability lost.* Moves and renames; the unit tests of each module and the gate. *Risk.* Low, but it touches
demo files, so after the freeze.

### P10. AV1 decode: what the ≤ 10-bit rule makes unreachable — after

The owner's decision of 2026-11-11: an optimal-quality series is always ≤ 10 bits, and the stored form is a lab
option. In `decode/av1.js` that leaves two things reachable only from the lab:

* `refusedDeep` and `route`'s last two lines: a lossy payload over 10 bits tried on WebCodecs with no probe. On the
  product path every optimal-quality payload is ≤ 10 bits and takes the line above.
* `cfg.mixed` and the `av1-mixed` route: a third route name the overlay could show, never without `opts.mixed`.

With the earlier findings' `onePass` (decided on) and `reuseCopyBuffer` (decided off), that is four switches whose
answers are known. *No capability lost:* `client/decode/av1.test.mjs` names each branch; the tests of the removed
arms go with them and the stored form keeps its lab series. *Needs the owner:* that the stored form's rig no longer
needs the deep route in the product module. *Size.* ~25 lines.

**A question, not a proposal.** `consumer.js` takes `onPreview`, `decoder.js` posts a scalable payload's lower layer
as a preview, `av1-dav1d.js` walks the layers for it. No product page passes `onPreview`
(`grep -rl onPreview client lab`: `consumer.js`, the contract's `dispatch-rig.ts`, one lab page). The decided
approach is "no low-resolution preview". If that covers the scalable layer too, about 15 lines and one contract
clause go; if not, it stays and a presenter should know it is off the demo path.

### P11. The server's default build — after

Read less deeply than the client: the flags and the session's shape only. `--send-window-follows-cwnd` and
`--stream-mode per-frame-asks-first` are documented "Lab only" in their own doc comments yet parse in the default
build, while four other lab flags sit behind the `lab-levers` feature. They belong with those four.
*No capability lost:* the test `the_default_build_refuses_every_lab_lever` extended to them; the lab's scripts
build with the feature. Nothing else is proposed for the server: its session loop has one path, and the congestion
options are the owner's to keep.

## 4. Against the earlier findings

Read after §1 and §2 were pushed (`cb66cb3f`): `claude/demo-simplify:docs/lines/proposals.md` §Simplify (S1–S8),
`claude/demo-understand:docs/reviews/understand/` (`clean.md`, `defaults.md`, `names.md`), and the list on
`claude/demo-clean:docs/reviews/experiments-off.md`.

**Agree.**

* S3 (one starter) is P1, and both of us find it the one thing safe before the demo.
* S1 and `clean.md` §1 (the harness out of `viewer.js`) is P3; we count the same lines within ten.
* `clean.md` §3 on `onePass` and `reuseCopyBuffer`; `defaults.md` 5 on the server's lab flags (P11; it also names
  `--reply-repeated-initial`, which I did not check).
* `defaults.md` 4: `?opts=` is spread after `digests`, so a lab URL can turn the exactness check off. Spreading it
  first is one line and worth doing with P3.
* S4 and `names.md` 2: the grey *unchecked* mark beside *Optimal quality* is two signals for one fact. The owner's.
* `names.md` 3 (`showLossy` beside the label *Optimal quality*): yes.
* S6 (WebSocket and race bundles out of the product build), S8 (the `wasm` client stays): yes.

**Disagree.**

* **S2's decider.** S2 would retire the page view "if the worker passes" the 20-series check. That check is
  correctness. The ADR's own timing rule kept the page, on first-frame time; the view decision needs that rule run
  again with the start order of P6, and the phone runs. Passing 20 series is necessary, not sufficient.
* **`clean.md` §2, one `lab` object passed through.** Five named parameters becoming one opaque object makes the
  signature shorter and the code no simpler: every branch stays, and a reader can no longer see which exist. Decide
  each setting and delete it (P6), or move the work to a phase beside the controller (P3).
* **S1's lab entry page.** A second page that "starts the same modules with hooks" is a second copy of the start
  sequence to keep true. One page that publishes a handle has no copy.
* **`names.md` 1, `requestExactFrame` → `requestFrame` before anything else.** Right about the name, but 133
  occurrences in 48 files is the largest change on the list for one word. A glossary line now; the rename when P4
  has reduced the callers.

**Further.**

* **P4** has no counterpart: the earlier findings treat the two views as one fork. They are two forks, where the
  controller runs and how it asks, and the second can close without the owner choosing a view.
* **P7 and P8.** The earlier findings list the cache writers and the clock as part of the worker half; neither asks
  whether three writers and four tick sources are still needed there.
* **P2's corrections** and **P9's layering** (the view importing from the page, two `store.js`).
* **P10's deep route**, which the decision of 2026-11-11 afternoon made unreachable on the product path after the
  earlier findings were written.

## 5. If only one thing is done before 11-13

P1 and P2: one command, and three sentences made true. Everything else changes code the rehearsal checks stand on,
and none of it is needed to give the demo. For the demo itself, §1's five boxes are the explanation; the table
under them is the list of what a presenter may say is "off by default, and being decided".

*Fixtures and limits.* Nothing here was run. The checks named as evidence use: `run_check.sh`, a three-frame 16-bit
HTJ2K series made from the contract's frame, headless Chromium; `demo-check.mjs`, the 20 optimal-quality series of
three tomosynthesis volumes from one dataset (`dbts_a1`, `dbts_b1`, `dbts_c1`); no ultrasound cine; 4-core cloud
hosts without a GPU. The ADR's timing quoted in P5 is from cloud hosts and is indicative only.
