# Which view is the target: the page view or the view worker

Written 2026-11-23 by row VIEW-PAGE (`claude/work-ledger:docs/queue-2026-11-14.md`), a session that ran none of this
question's rows, from pushed results only; nothing run. Inputs at: `claude/phone-run` `d0fca3589`
(`docs/phone-rows/next-round-results.md` §Cell 3 as PHONE-READ-3D wrote it, §Cell 3 review by PHONE-READ-3D-REVIEW,
no blocker, minors m1–m3 carried below; §Which code each load ran by PHONE-READ-CODE-CHECK; PHONE-READ and its
review, fix and re-review for the round's cells 92–96); `claude/unified` at `4a2b4277` for the code
(`client/viewer/viewer.js`, `client/viewer/run_check.sh`, `lab/viewer/levers.js`); the evidence files linked below;
[`../proposals/simplify-fable.md`](../proposals/simplify-fable.md) §P5, §P6 (FABLE-SIMPLIFY, #366);
`claude/work-ledger:docs/queue/MEMORY-LEAK-TRACE.md` §Result (corrected 2026-11-23). Every row of the question is
done, so the recommendation is not provisional; the first-picture guard it leans on is an **assumption** (amendment
24), and the verdict does not turn on it.

Labels: **source** (quoted in the file named), **theory**, **derived**, **measured**; **(A)** an assumption named so a
measurement can replace it. *Page view* is `?view=page`, today's default: the page's thread holds the controller and
the frame store, a paint worker paints. *View worker* is `?view=worker`: controller, store and paint in one worker,
the page sends intents only ([`../client/design.md`](../client/design.md) §What it is). The busy page is the round's
synthetic one: 100 ms of work every 250 ms on the page's thread.

## 1 · The question

Which of the two views is the product's view: the default every reader gets, and in the end the only one? It is the
owner's: the page view stays by the owner's word of 2026-11-11, "decided after the phone runs", and taking the view
worker is structural (one of two code paths, the cache's home, half the viewer's check matrix).

## 2 · The recommendation, and the owner's yes or no

**Make the view worker the default now, with the start's fix as its one start order; keep `?view=page` as a lab arm
until PHONE-ROUND-2's cell 3 under one condition, the Safari probe and the phone's memory after worker loads are in;
then remove the page view (P5).** It serves the value statement's phone "over unreliable wireless": with the page's
thread busy, the view worker painted every cine frame due on the phone, where the page view dropped 7 in 100; it
does not make a jump faster (a tie), and it is where the cache that would cut asks to the server lives.

| # | the owner's yes or no | recommended | a yes changes | a no leaves |
| ---: | --- | --- | --- | --- |
| 1 | `?view=worker` becomes the default; `?view=page` stays as a lab arm | **yes** | one draft PR into `claude/unified`: `viewer.js`'s default (line 26), the gate's default checks, `design.md` §Decided's two view lines superseded, dated | the page view on every phone, and its busy-cine drops |
| 2 | P6: the start's one order is the code, the four settings `pageDials`, `viewWorkerFirst`, `glAfterDial`, `shortRuns` removed (all on is `run_check.sh`'s "the start's fix") | **yes** | its own draft PR, named for what it removes (~50 lines over six files, **source** P6) | the view worker starts without the fix by default, behind the page view in three decided cloud cells (§3) |
| 3 | P5: the page view removed, the view worker the one view | **no, for now**; yes once items 4 and §6's two checks are in | then its own draft PR: `client/paint/painter.js`, the `where` branches, the page arm of every check, `View` folded into `ViewWorker` ("About 250 lines, and half of `run_check.sh`'s matrix", **source** P5) | two views, the gate running every viewer check twice |
| 4 | PHONE-ROUND-2's cell 3: one condition for every load (a fresh renderer before each, load 0 included, the blank tab before each), the view worker with the start's fix, and a first-picture field in the rows | **yes** | its preparation rows (PHASE2-PLAN; a lab change, no product code: amendment 28 rule 2) | the guard's "not binding" resting mostly on pairs 8–23 (m3) |
| 5 | The view worker's open table (§5.1): none blocks item 1; each keeps its deciding run | **yes** | nothing now; each item stays with its row | — |

## 3 · The options

Phone numbers: one phone, 24 ABBA pairs, `dbts_b1-q8-g8` (`next-round-results.md` §Cell 3, **measured**; differences
worker − page, median and 97.7 % interval). Cloud numbers: headless Chromium 153 and Firefox 155, 4-core hosts.

| | A · page view default (today) | **B · view worker default, page kept as an arm** | C · view worker the one view now | D · page view the one view |
| --- | --- | --- | --- | --- |
| Cine, page busy, phone | 7 of 100 dropped, 1–16 over 24 loads (**measured**) | 0 in every load; −7 [−11, −5] frames, 24 of 24 pairs (p ≈ 1.2 × 10⁻⁷, **measured**) | as B | as A |
| Cine at 1×, page busy, cloud | 20–21.5 % late | 0 % late (**measured**, [`view-worker-under-a-busy-page.md`](../client/evidence/view-worker-under-a-busy-page.md)) | as B | as A |
| An ask inside a 200 ms long task, cloud | — | on screen 132–169 ms sooner; mean of ten asks 30–85 ms sooner (Chromium), 40–80 (Firefox) (**measured**, same file) | as B | as A |
| Frame-change, page busy, phone | 11.4 ms | 13.3 ms; +0.4 [−1.0, +3.7], no difference shown (**measured**) | as B | as A |
| Idle use, exact frame, fill, phone | — | no difference shown on each (**measured**) | as B | — |
| First picture, phone (the guard, form (a), 52 ms **(A)**) | 413.1 ms | 425.5 ms; +8.6 [−4.2, +27.1], not binding; pairs 0–7 +26.0, 8–23 +5.8 (**derived**, m3); the worker ran **without** the start's fix (the plan's URLs carry no lab setting, **derived**) | as B | — |
| First frame, quiet page, cloud | — | with the fix: ties A in five decided cells, all at 1×, both engines; no 4× cell decided. Without it: "behind A, in three decided cells (Chromium CT and the mammogram, Firefox US)" (**measured**, [`view-worker-start.md`](../client/evidence/view-worker-start.md)) | as B | — |
| Memory over same-origin loads | cloud page view 1.6 → 4.1 GiB over four loads (**measured**) | cloud flat 1.53–1.74 GiB; on the phone +1 452 and +1 528 MiB after its worker loads 26, 27, unexplained (**measured**, MEMORY-LEAK-TRACE §Result) | as B | as A |
| The cache's home | none: the page view's store has no cache (`design.md` §What it is) | the view worker, under `?writer=` (cache off: [`cache.md`](cache.md)) | as B | the decided OPFS cache moves: "it undoes a decision" (**source** P5) |
| Code | both views | both views, until item 3 | ~250 lines less (**source** P5) | ~600 lines less (**source** P5) |

## 4 · Where it holds

**Fixtures and limits.** The phone: one Android 16 phone (`hardwareConcurrency` 8), one home 5 GHz Wi-Fi (RSSI −31,
−28 dBm), one laptop serving, one evening; one series, `dbts_b1-q8-g8` (50 AV1 frames, software decode, all
`av1-webcodecs`); a synthetic busy page and dispatched key presses, not a reader's input or a real page's work; a
fresh Chrome after each load (m1: loads 0 and 16 open their runs without one, pair 8 mixed); RUN_CODE the lab-only
`f5252051`; the host's saturation not measured. The cloud: 4-core hosts without a GPU, software WebCodecs, the
cloud's fixtures (CT, a mammogram, tomosynthesis, a US series that is not breast ultrasound), a userspace relay.

**US and DBT stacks.** The win comes from where the cine clock and the paint run, not from the frames: the page
view's clock waits behind any long task on the page's thread, the view worker's does not (**theory**, §5). So it
carries to DBT stacks by that property, and to ultrasound clips at least as strongly: a clip played at its
acquisition rate, above the round's 10 frames a second **(A)**, has more frames due under each 100 ms task
(**theory**; no breast ultrasound clip was run on a phone). 8 bits or colour change the frame's bytes, not the thread a paint waits on.

**Other phones.** DEVICE-THEORY "adds nothing to the protocol's predictions" for cell 3 (`device-model.md` §2): no
model carries the result to other device classes. By the mechanism, a slower phone has longer long tasks on the
same page work, so more drops in the page view (**theory**, untested).

**Engines.** Chromium measured on the phone and in the cloud, Firefox in the cloud. Safari: "The view worker's
results (9) … **D**, never run"; paint in a worker "**S** BCD 17" ([`engines.md`](engines.md) §3). The page view is
the fallback item 3 keeps until the Safari probe.

**Links.** Both views share the downloader, decoders and wire, so a link moves both alike; the phone's fill showed no
difference (**measured**, one link).

**The predictions, misses included.** Of the protocol's eight lines six held. Busy frame-change was predicted *worker
faster* and came out *no difference shown*; the first picture was predicted *page faster by < 52 ms* and came out
*no difference shown*. The theory table's rows: busy frame-change "worker lower by ~one long task in some steps"
*missed* (129 of the worker's 480 busy steps over 50 ms against the page's 114); the first picture "worker later by
≥ 16.7 ms" *not decided* (m2).

## 5 · The mechanism

The page view's cine clock and its frame choice run on the page's thread: while that thread runs a 100 ms task, no
frame is chosen, so a frame due then is late or dropped. The view worker chooses and paints on its own thread, so the
page's work never reaches the paint. A step from a key press is different: the input event is dispatched on the
page's thread in both views, so each step waits for the task in progress in both, which is the measured tie. The
view worker's cost is at start: a worker to create and two message hops before the first want, which the start's fix
(the page dials, the worker joins) removes at 1× in the cloud. Memory: the page view holds decoded frames as
`SharedArrayBuffer`s on the page's thread, which V8 counts as 0 bytes toward collection, so after a navigation they
stay until an unrelated collection (**measured**, cloud page view only); a worker's frames go with the worker.

### 5.1 · The view worker's open table

From [`view-worker-design.md`](../client/evidence/view-worker-design.md) §Target, with where each stands. None is a
reason to keep the page view as the default: each is a choice inside the view worker.

| question | decided by | where it stands |
| --- | --- | --- |
| who writes the cache | the cache-I/O arms, arm D added | cache off ([`cache.md`](cache.md)); which store is CACHE-DESIGN's (phase 2) |
| who owns a frame's memory; K | M5 with a disk-only arm | a 256 MiB default budget for both views, PR 435 (VIEW-MEMORY-BOUND, reviewed twice, no blocker open) |
| the downloader merged into the view worker | a fill's inter-arrival p99 beside a cine of 17 MB frames | open ([`receive-loop-beside-paint.md`](../client/evidence/receive-loop-beside-paint.md)) |
| a frame clock in a dedicated worker | the clock protocol, a WebKit cell, a hidden-tab cell | no verdict, every Chromium cell saturated ([`frame-clock-in-a-worker.md`](../client/evidence/frame-clock-in-a-worker.md)) |
| misses split into one-frame runs | a fill from a half-held cache at 46 and 92 ms RTT | open; waits on the cache |
| several viewports | contexts lost and paint time at 1, 2, 4, 5 viewports | open; one viewport today |
| an AV1 group as the store's unit | decodes per index, G = 8, eviction forced | open; eviction now exists (PR 435) |
| a read-back that throws is a miss | M4 with the entry deleted | open; waits on the cache |
| a series without digests | the owner | every frame with a digest ([`frame-integrity.md`](frame-integrity.md)) |
| the decoder count on phones; per-frame stamps | D5 on a device | `min(3, hardwareConcurrency)` for every form ([`phone-decode-route.md`](phone-decode-route.md) item 5) |
| the asking patterns as wants | each pattern's run | [`asking.md`](asking.md) |
| adoption | §7's rule | this page |

## 6 · What would change the recommendation

* **The first picture on the phone.** PHONE-ROUND-2's cell 3, under one condition and with the start's fix (item 4),
  finding the view worker's first picture later than the page view's by the guard's 52 ms **(A)** would keep the
  page view the default. The interval so far reaches +27.1 ms, without the fix.
* **Safari.** The engines page's Safari probe failing paint in a worker would keep the page view as Safari's view and
  P5 not taken.
* **The phone's memory.** The +1 452 and +1 528 MiB after worker loads traced to the view worker (PHONE-ROUND-2 with
  per-load resources decides) would add a fix before item 1's PR reaches a phone round.
* **A real reader's page.** If the product's page never runs a long task while a reader works, there is nothing for
  the view worker to win; one measurement of the real page's long tasks during a reading (the Long Tasks entries over
  a scripted reading) would show it.

## 7 · What it would reopen

Two lines of `design.md` §Decided: "`?view=page` stays the default: the view worker's first frame is later by
≥ 16.7 ms in five decided cells" (2026-10-30, the rule, measured), which the start's fix answered at 1× and not at 4×;
and "The page view stays; which view is the target is decided after the phone runs" (2026-11-11, the owner), which
deferred to this page. None of the program's §Decided approaches is reopened: WebCodecs first, every exact frame
checked, the cache off and telemetry off all stand in both views.

## 8 · Rows and links

* Rows: PHONE-ROUND, PHONE-READ, PHONE-READ-REVIEW, PHONE-READ-FIX, PHONE-READ-FIX-REVIEW (client queue);
  PHONE-ROUND-3C, PHONE-ROUND-3D, PHONE-READ-CODE-CHECK, PHONE-READ-3D, PHONE-READ-3D-REVIEW, MEMORY-LEAK-TRACE and its
  fix rows, VIEW-MEMORY-BOUND and its fix rows (the program).
* `claude/phone-run:docs/phone-rows/next-round-results.md` §Cell 3, §Cell 3 review (`d0fca3589`); raw rows
  `docs/phone-rows/raw/2026-11-22-cell3d/round3d/` at `f96e38a9`; the protocol `docs/phone-rows/next-round.md` §4.
* Evidence: [`view-worker-design.md`](../client/evidence/view-worker-design.md),
  [`view-target.md`](../client/evidence/view-target.md) (the 11-11 phone run, not decided),
  [`view-worker-start.md`](../client/evidence/view-worker-start.md),
  [`view-worker-under-a-busy-page.md`](../client/evidence/view-worker-under-a-busy-page.md),
  [`page-out-of-pixel-path.md`](../client/evidence/page-out-of-pixel-path.md) §7; `navigation-memory.md` on
  `claude/memory-on-navigation` (PR 434).
* Proposals: [`../proposals/simplify-fable.md`](../proposals/simplify-fable.md) §P5, §P6. PRs 434, 435.
