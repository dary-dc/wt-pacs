# Memory a navigation leaves behind

**Question:** why did one Chrome renderer on the phone keep about one series of memory per same-origin load (PHONE-ROUND,
2026-11-22: RSS+swap after loads 23–28 1 040, 1 783, 3 360, 4 600, 6 052, 7 580 MiB, the growth starting at load 24,
cell 2's first viewer load; loads 22 and 23 did not grow), and what of ours keeps it?

*Row MEMORY-LEAK-TRACE of `claude/work-ledger:docs/queue-2026-11-14.md`, 2026-11-23. Findings, no fix: the fixes in
reach are either a structural change or a default an unrun experiment decides (§4).*

## 1. Answer

**Measured, in the cloud only**: the page view (`?view=page`, the default) holds every decoded frame on the page's thread as a
`SharedArrayBuffer`. After the page navigates away, those buffers stay resident in the renderer until something else
makes the page's thread collect, which a new load of the viewer does not do: one renderer grew 0.8–0.9 GiB a load,
1.6 → 4.1 GiB over four loads, in both rounds, before a collection fired. The view worker (`?view=worker`) holds the
frames in a worker that ends with the document, and stays flat in the cloud. **The phone's rows do not follow this
(§1.1)**: the cause is established for the page view in headless Chromium in the cloud, not for the phone's growth.

**Not the cause**: the back/forward cache. With it on (as on the phone) or off, the growth is the same, and every
viewer document's `pagehide` reported `persisted: false`.

**The engine's half** (*source*): V8, `src/objects/backing-store.h`, at
[`0b60d2b0`](https://github.com/v8/v8/blob/0b60d2b01800d7ba2c6eeb5e51ecd95f6dab44c7/src/objects/backing-store.h#L200-L208)
(the `v8_revision` of Chromium 153.0.8010.12's `DEPS`, the browser of §2), lines 200–208, and the same text at main
`4f01bdeb` (2026-11-23), lines 204–212:

> // Returns the size of the external memory owned by this backing store.
> // It is used for triggering GCs based on the external memory pressure.
> size_t PerIsolateAccountingLength() {
> ...
>     if (has_flag(kIsShared)) return 0;

The phone ran Chrome 157 (its user agent); that its V8 carries the line is *derived* (present at 153 and at main
after it), not fetched. The minimal page of §3 shows the same with none of the product.

### 1.1 The phone's rows (*measured*, PHONE-ROUND)

`claude/phone-run:docs/phone-rows/raw/2026-11-22/round/`: RSS + VmSwap of renderer `SandboxedProcessService0:85` in
each `after-k` snapshot of `resources.jsonl`; each load's view from `beacon.jsonl`; arm A's URL from `plan.json`
(`?overlay=1&view=page|worker`, series `dbts_b1-q8-g8`, no other option).

| load | cell, arm | view (the URL's) | RSS + swap (MiB) | change |
| --- | --- | --- | --- | --- |
| 23 | 1, view-3 | page | 1 040 | |
| 24 | 2, A | page | 1 783 | +743 |
| 25 | 2, A | page | 3 360 | +1 577 |
| 26 | 2, A | worker | 4 600 | +1 240 |
| 27 | 2, A | worker | 6 052 | +1 452 |
| 28 | 2, A | page | 7 580 | +1 528 |

Under the cloud's cause a worker-view load leaves nothing behind once its document ends, so loads 27 and 28 would
add about 0 (§2.1 measures that order: +7 and −43 MiB; load 26 adds one series, its own frames beside the page
loads' uncollected ones). The phone grew +1 452 and +1 528 there, and every step is larger than one decoded series
(812.5 MiB, §2). Open explanations, none checked:

* the `view` field is the URL's request (`claude/phone-run:lab/devices/beacon.js` line 58, `q.get("view") ?? "page"`), not proof that the
  view worker ran; PHONE-READ-CODE-CHECK, which checks the code each load ran, is not done;
* the phone decoded the view in hardware (`c2.qti.av1.decoder` in its logcat), the cloud in software: buffers the
  hardware path holds are not the page's `SharedArrayBuffer`s;
* the measures differ: the phone's is one process's RSS + swap, the cloud's PSS (`smaps_rollup`), and the phone's
  worker loads began with loads 24 and 25's frames still held, which a collection during them would have freed.

§2.1 runs the phone's order on its fixture in the cloud: there loads 27 and 28 add about nothing, so the phone's
growth at those loads is not the cloud's cause.

## 2. The rows (*measured*)

Fixtures and limits: `dbts_b1-q8-g16` (AV1, Q 8, G 16) with its exact series `dbts_b1` (50 frames, 2560×3328,
10-bit; ~850 MB decoded at 2 bytes a sample), served by `scripts/demo-pair.sh` on loopback (the phone's arm A served `dbts_b1-q8-g8`, G 8, not G 16: §2.1 runs that one); headless Chromium 153
(Chrome for Testing 153.0.8010.12) under Playwright 1.63.0, software WebCodecs, no GPU; one 4-core cloud container with
15 GiB. Not a phone: the growth per load carries (the same buffers), the point where a collection fires does not.

The rig, `lab/viewer/navigation-memory.mjs`, leaves each load as the round's runner does: the viewer navigates to
`GET /next` on a same-site origin, which answers 302 back to the viewer. A row is taken 1 s after each load's fill: each
renderer's PSS from `/proc/<pid>/smaps_rollup`. The arms ran in blocks of six loads, one browser per arm, in the order page, worker,
transfer, and the second round repeated that order (ABCABC); not interleaved load by load
(`lab/viewer/rows/navigation-memory.jsonl`):

| arm | load 0 | 1 | 2 | 3 | 4 | 5 (MiB) |
| --- | --- | --- | --- | --- | --- | --- |
| page, round 1 | 1 597 | 2 495 | 3 218 | 4 136 | 1 608 | 2 426 |
| page, round 2 | 1 574 | 2 425 | 3 195 | 4 113 | 1 664 | 2 410 |
| worker, round 1 | 1 573 | 1 608 | 1 588 | 1 574 | 1 634 | 1 660 |
| worker, round 2 | 1 598 | 1 534 | 1 738 | 1 617 | 1 677 | 1 656 |
| page with `pixels: "transfer"`, round 1 | 1 555 | 1 563 | 1 564 | 1 567 | 1 568 | 1 571 |
| page with `pixels: "transfer"`, round 2 | 1 554 | 1 559 | 1 562 | 1 561 | 1 566 | 1 566 |

The third arm is not a product setting: `lab/viewer/levers.js` refuses `pixels` under the page view, and the rows were
taken with that refusal lifted in the working tree only, then restored (§4). Before the counted rows, one run each with
the back/forward cache off (Playwright's default) matched the page arm (1 596, 2 470, 3 290, 4 085 MiB), and a forced
collection after each row (`HeapProfiler.collectGarbage` over CDP) brought the page arm back to one load
(1 673, 1 570, 1 577, 1 726 MiB). *Corrected 2026-11-23 (PR 434's review, m3):* those two runs' rows were not kept;
the numbers are as noted at the time. §2.1 repeats both, kept.

### 2.1 The phone's order on the phone's fixture, in the cloud (*measured*, MEMORY-LEAK-TRACE-FIX)

Fixtures and limits: `dbts_b1-q8-g8` (AV1, Q 8, G 8: the phone's arm A, `plan.json`) with `dbts_b1`, built in this
container by `scripts/demo-series.sh`'s two lines for them; the rest as §2 (headless Chromium 153, software decode,
one 4-core/15 GiB container, loopback; not a phone, no hardware decode). Each arm six loads in one browser, two
rounds, the arm order reversed in the second (ABCD DCBA), not interleaved load by load
(`lab/viewer/rows/navigation-memory-g8.jsonl`). PSS of the one renderer, MiB:

| arm | load 0 | 1 | 2 | 3 | 4 | 5 |
| --- | --- | --- | --- | --- | --- | --- |
| the phone's order (page, page, worker, worker, page, page), round 1 | 1 549 | 2 395 | 3 240 | 3 247 | 3 204 | 1 564 |
| the same, round 2 | 1 621 | 2 397 | 3 242 | 3 177 | 3 180 | 1 610 |
| worker, round 1 | 1 597 | 1 682 | 1 544 | 1 598 | 1 627 | 1 587 |
| worker, round 2 | 1 551 | 1 558 | 1 592 | 1 598 | 1 600 | 1 632 |
| page, back/forward cache off, round 1 | 1 574 | 2 448 | 3 165 | 3 986 | 4 830 | 1 611 |
| page, back/forward cache off, round 2 | 1 474 | 2 397 | 3 240 | 4 036 | 4 852 | 5 648 |
| page, after a forced collection, round 1 | 1 525 | 1 601 | 1 603 | 1 558 | 1 580 | 1 605 |
| page, after a forced collection, round 2 | 1 598 | 1 651 | 1 604 | 1 579 | 1 629 | 1 606 |

(The forced-collection rows are each load's `afterGc`; before it they read 2 377–2 470 MiB from load 1 on: the
current load plus the one before, which the collection frees.) Every `pagehide` reported `persisted: false`.

Read against the phone's steps of §1.1 (24–28: +743, +1 577, +1 240, +1 452, +1 528):

* **The cloud's order steps** +846, +845, +7, −43 MiB (round 1; round 2 +776, +845, −65, +3). The first worker load
  grows by one series because the snapshot holds that load's own frames, in its live worker, beside the page loads'
  shared frames not yet collected; the second worker load and the page load after it add about nothing. (PR 434's
  review expected about 0 at 26 too; the cause predicts one series there.)
* **The phone grew +1 452 and +1 528 at 27 and 28**, where the cause predicts about 0. That growth is not explained by
  the cloud's cause, which leaves §1.1's open explanations; the next phone round's snapshots, with a fresh renderer
  per load (amendment 28 item 8) or the same order kept, tell them apart.
* The back/forward cache off grows as §2's page arm, past 5.6 GiB over six loads in round 2 before any collection.

## 3. The minimal page (*measured*)

`lab/viewer/navigation-memory-minimal.mjs`: a cross-origin isolated page whose worker makes 50 buffers of 17 MB, held
by the page (`main`) or kept by the worker (`worker`); the page then navigates to itself through a 302. The renderer's
PSS after each of five loads, two rounds alike to the MiB (`lab/viewer/rows/navigation-memory-minimal.txt`):

| buffers | held by | MiB after loads 1–5 |
| --- | --- | --- |
| `SharedArrayBuffer` | the page | 863, 1 677, 2 490, 3 303, 4 116 |
| `ArrayBuffer`, transferred | the page | 868, 870, 1 682, 873, 1 684 |
| `SharedArrayBuffer` | the worker | 863, 866, 868, 870, 872 |
| `ArrayBuffer` | the worker | 865, 868, 870, 872, 874 |

A transferred `ArrayBuffer` is counted where it lands and collected: at most one earlier load's worth stays (every
other load holds two, 1 682 and 1 684 MiB). *Corrected 2026-11-23 (PR 434's review, m2):* this read "collected
within a load", which the rows do not show. A shared one held by the page's thread is not collected; anything a
worker holds goes with the worker.

## 4. What would release it, and why none is built here

* **The view worker by default.** Measured flat in the cloud (§2); the phone's two worker-view loads were not (§1.1),
  so on the phone it is not shown to release anything. Which view is the product's is the view-target page's question
  (`claude/reviews-2026-11-28:docs/decisions/view-target.md`, row VIEW-PAGE), not this row's.
* **Transferred buffers on the page view.** Measured flat in the cloud (§2), but the page's painter posts each frame to its paint
  worker with no transfer list (`client/paint/painter.js`), so an `ArrayBuffer` there is copied on every paint
  (`lab/viewer/levers.js`: "Settings the page view would ignore, or under `pixels` copy each paint"); and
  `transfer` as a default is what [`transferred-buffer-per-frame.md`](transferred-buffer-per-frame.md)'s pre-registered
  cells T and W decide, not yet run.
* **Dropping the page's references at `pagehide`.** *Derived*, not measured: it should release nothing by itself,
  since the references die with the document anyway and unreferenced shared buffers are exactly what stays (§3).

**For VIEW-MEMORY-BOUND**: a `FrameStore` budget on the page view lets frames go from the store, but a shared frame let
go is still resident until a collection, within a load as across loads (`cache-in-opfs.md` M2: the window bounded
nothing on Chromium). The bound's effect on the phone's memory needs transferred buffers, or a collection, behind it.

**For any later phone round**: amendment 28 item 8's fresh renderer per load removes the confound whatever the view.

## 5. Sources

* The back/forward cache, web.dev, "Back/forward cache", last updated 2026-10-16 (https://web.dev/articles/bfcache):
  "bfcache is a snapshot of the entire page in memory, including the JavaScript heap"; "The `pagehide` event fires
  either when a page unloads or when the browser tries to put it in the bfcache."
* Playwright 1.63.0 launches Chromium with the cache off: `playwright-core/lib/coreBundle.js`, `chromiumSwitches`,
  `"--disable-back-forward-cache", // Avoids surprises like main request not being intercepted during page.goBack().`
  The rig's `--bfcache on` (its default) drops that switch with `ignoreDefaultArgs`.
* Chromium enables the cache by default: `content/public/common/content_features.cc`,
  `BASE_FEATURE(kBackForwardCache, base::FEATURE_ENABLED_BY_DEFAULT);` (main as fetched 2026-11-23 from the GitHub
  mirror; the revision is not pinned). Why no viewer document entered it is not established here.

## 6. Reproduce

```bash
scripts/demo-pair.sh demo-series dbts_b1-q8-g16      # after scripts/demo-series.sh, or its dbts_b1 lines alone
NODE_PATH=$(npm root -g) node lab/viewer/navigation-memory.mjs 6 [--view worker] [--gc] [--bfcache off] [--json]
NODE_PATH=$(npm root -g) node lab/viewer/navigation-memory.mjs 6 --view page,page,worker,worker,page,page --json   # §2.1, on dbts_b1-q8-g8
NODE_PATH=$(npm root -g) node lab/viewer/navigation-memory-minimal.mjs sab main
```
