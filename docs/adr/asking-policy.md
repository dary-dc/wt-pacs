# ADR: what a view asks for, per series and device — the asking policy

**Status:** proposed, theory only · **Date:** 2026-11-02 · **Tags:** client, delivery, viewer

*Nothing here was built or run. Every number is quoted from this repository's docs with its source, or is labelled
**(D)**, arithmetic on quoted numbers; **estimate**, arithmetic on an assumed input; **prediction**; or **assumed**.
Written for the owner's review before anything is built or measured.*

**The question.** The owner, 2026-11-02: *"We haven't formally designed for the asking pattern that a real app will
have. Possibly fill for relatively small series, possibly latency for heavier modalities."* The downloader can fill
(the server pushes a run in index order, for throughput) and ask (one frame served next, for latency), and an ask
jumps ahead of a running fill ([`../WIRE.md`](../WIRE.md) §An ask during a fill). What should a view want, of which
series, in what order, and how many frames of it — on a phone first and a desktop second?

**The answer, short.** One rule, not two modes: a view wants the **memory window** around its current frame, ascending
from it, and the window is as many frames as the device's budget for that view holds: **W = min(n, ⌊M_v ÷ s_d⌋)**,
`n` the series' frames, `s_d` one decoded frame, `M_v` the view's share of the budget. A series that fits is filled
whole, as today; one that does not is filled only around the reader, and the window moves with the reader. The
modality does not enter the rule; its frame size does. Link rate does not choose the window; it sets the depth
already built ([`client-window-depth.md`](client-window-depth.md)), and the wait an ask has behind a fill is the
server's to shorten (§4, *What the rule leaves to the transport*). Two things gate it: a frame memory that is freed
when the store lets a frame go (today it is not, §2), and the page view sending a want (today only `?view=worker`
does, §2).

## 1 · The usage it must serve

From requirements.md (on `origin/claude/line-viewer` at `aba1adc`, not on this branch; R a requirement, N\* a
*should* taken as a target), with what each reader action needs. **Assumed** marks what no source states.

| series shape | the fixture that stands for it ([`../FIXTURES.md`](../FIXTURES.md) §AV1 data, sizes from [`disk-access.md`](disk-access.md) §6 and [`frame-path.md`](frame-path.md) §4) | what the reader does | sourced | what it needs to feel instant |
| --- | --- | --- | --- | --- |
| four-view FFDM, current and prior | `ffdm_d` 4 × 3328×4096, 4 808 kB coded a frame; `ffdm_a` 4 × 2560×3328, 68 MB decoded | open the whole hanging at once; zoom and pan; compare with the prior beside it | R: "displaying simultaneously a set of current and prior conventional four view screening mammogram images"; R: hanging protocols by attributes; N\*: "not more than 3 seconds to retrieve an image from online local storage and display it" | the hanging is complete only when all of its frames are here, so the clock is the last frame's (ORDER: "the first full hanging needs all four and no order shortens it", [`../av1/README.md`](../av1/README.md) §The order frames are asked in) |
| DBT volume, current and prior, up to eight viewports | `dbt12_ea1141` 29 × 614×1359, 499 kB coded, 48 MB decoded; `dbts_b1` 50 × 2560×3328, 812.5 MiB decoded, the largest set named | open at a slice; scroll; cine; toggle a view between slices, slabs and synthesized 2D in place | R: manual and cine scroll "shall not skip slices", in spatial order; R: cine speed control, loop, sweep or stop; R: eight viewports, current against prior; N\*: "at least 25 frames per second for an entire 5 MP display is desirable" | a step to a held frame within one display period, 16.7 ms (this repository's bar, [`frame-path.md`](frame-path.md) §Experiment 2); a drilling reader moves a sawtooth over a third of the stack at 25 slices/s (MAP, quoted in [`frame-path.md`](frame-path.md) §Experiment 2, *Review*, Diaz et al. 2015, abstract only) |
| US cine | `us_liver` 70 × 760×421 RGB, 257 kB coded ([`frame-path.md`](frame-path.md) §Experiment 1), 67 MB decoded; `usb_cine` 64 × 512², 25 frames/s | play at the acquisition rate; pause; scrub | R: "A cine with a rate control, whose default rate comes from the image" | every frame on time at the series' rate. **Assumed:** cine starts at once and never stalls once started |
| CT, MR, PET stack | `ct_lidc` 100 × 512², 164 kB coded, 52 MB decoded (D: 100 × 0.52 MB); `pt15_cptac` 335 × 256², 31 kB | scroll; jump through a localizer line; two series side by side with linked scrolling in one Frame of Reference | R: localizer lines; R: "at least two FrameSets … compared side by side"; R: scrolling linked across one Frame of Reference; R: "Scrolling shall not loop around" | the drilling sawtooth as for DBT; a jump to a far frame. **Assumed:** a jump may take one miss's time, a scroll may not |
| priors beside any of the above | as above | open after the current; scroll linked to the current | R (ACR): "Current and prior examinations must be retrievable in a time frame appropriate to the clinical needs"; N\*: "fast and easy navigation between old and new studies" | the current first; the prior before the reader turns to it. **Assumed:** a reader looks at the current first |
| any series on a phone | — | review, not primary mammography reading | R: "A mobile or uncleared display is labelled as not for primary mammography reading"; N: "Handheld devices may not have enough resources to hold all the slices … just-in-time basis and later purged" (AAPM 260 §3.6, §6); N: "no persistent data on the mobile device" | memory bounded by the device, not by the series |

requirements.md's own §Open records "**Not found:** … a latency target other than the ACR's 3 s". So beyond the 3 s,
the 25 frames/s and *never skip*, every latency target here is this repository's (the 16.7 ms display period) or
assumed.

## 2 · What the client and server can do today

Read from `claude/core` at `0920153`.

| capability | where | what it does, and its limit |
| --- | --- | --- |
| a whole-series fill at open | `client/viewer/viewer.js:31`, `:121` | the product's page opens with `fill: all` unless `?fill=0`; the only choice a page makes is fill everything or nothing |
| on demand | `client/viewer/viewer.js:153`; `client/view/controller.js:135–139` | `?fill=0`: the current frame alone; under the page view a step cancels the previous ask |
| the want | `client/view/controller.js:16–22`, `:150–152`; `client/view/store.js:61–70` | an ordered list of misses that replaces the last; nearest-first by default (c, c+1, c−1, …), every frame of the series when filling |
| …but only under `?view=worker` | `client/view/controller.js:126–129` against `:130–147` | the page view (`?view=page`, the default by §7's run, [`frame-path.md`](frame-path.md) §The core, assembled) sends no want: it fills at connect and asks per step |
| a run or asks, from the want | `client/transport/downloader.js:244–274` | the want's head goes out as one run where it ascends `askDepth` (4) frames with nothing owed, else as up to `askDepth` asks; once two asks are owed no run starts again ([`frame-path.md`](frame-path.md) §Experiment 2, *Asks that never yield*) |
| `waitAhead` | `client/transport/downloader.js:253`; `client/view/controller.js:18` | the want ascends from the current frame and a head within the run's next k is waited for. Experiment 2: "**k\* = 8, adopt k = 8**", the default left to the owner (§Experiment 2, *Run*, *The default*) |
| asks before fill frames | `client/transport/downloader.js:123` | one decode queue, two priorities |
| an ask ends a running fill | `server/src/transport/planner.rs:69`, test `:201`; `client/transport/downloader.js:282–314` | no saved position; the downloader re-issues the rest on the asked frame's envelope head (`refill: "head"`) |
| cancel | `client/transport/downloader.js:664–680` | drops queued work by generation; an ask on the wire stays owed |
| the store's budget and eviction | `client/view/store.js:30–33`, `:52`, `:127–132` | a budget in frames, farthest-first eviction around `near`. **No caller passes one** (`client/view/view-worker.js:54`, `client/viewer/viewer.js:88`): the budget is `Infinity` |
| …and eviction frees nothing | [`../ARCHITECTURE.md`](../ARCHITECTURE.md) §Open, the cache seam; [`frame-path.md`](frame-path.md) §Proposed, *How the ring works* | "the window still bounds nothing, the decoder workers holding each frame"; a fresh `SharedArrayBuffer` per frame that V8 counts as 0 bytes: 2 748 MiB for `today` against 580 MiB for M5's ring, which is not built in |
| depth | `client/transport/downloader.js:23`; [`client-window-depth.md`](client-window-depth.md) | `askDepth` 4, fixed; the ADR's `D_min = ⌈U(1 + RTT/Tf)⌉` is not computed by the browser client |
| `span` | `client/transport/downloader.js:347–354` | a run may cross held frames; "not run; `span` stays 0" ([`frame-path.md`](frame-path.md) §Experiment 1: not run) |
| cine | `client/view/view.js:41–45` | a page `setInterval` that steps whether or not the frame was painted, so it can skip, which DBT forbids (requirements.md, *no slice skipped*: "not proved") |
| more than one series | glossary *series*; `client/viewer/viewer.js` | one series a server process, one session a page, one viewport. No second viewport, no prior, no arbitration between sessions |
| server depth | `server/src/transport/planner.rs:7`, `server/src/media/read_path.rs:26` | `ASKS_AHEAD` 8 asks planned, `TILE_SLOTS` 4 reads at once; a fill reads one frame ahead |
| the send window | `server/src/transport/server.rs:58`, `:146–151` | `--send-window-follows-cwnd`, a lab flag, off |

So the policy space already built is: fill all or nothing at open; a want under the worker view only; asks over a
run; an ordering lever measured and not yet the default; an eviction rule with no budget and no memory it can free.

## 3 · The policy space

Costs are quoted where measured and labelled otherwise. "Breaks" is where the policy fails a requirement or the device.

| policy | what it wants | costs | where it breaks |
| --- | --- | --- | --- |
| **P1 fill everything** (today) | the whole series, nearest-first | the series' decoded size held: "the page's memory **is** the series' decoded size, and the ceiling is whatever the device allows" ([`frame-path.md`](frame-path.md) §Background); every coded byte sent whether or not the reader looks; an ask waits behind the fill in flight, **6 MiB ÷ R + one RTT** in Chromium (the *drain*): 2.8 s at 18 Mbit/s, 0.49 at 103, 0.23 at 218 ([`../transport/link-conditions.md`](../transport/link-conditions.md) item 9) | a series larger than the phone's memory (`dbts_b1` 812.5 MiB; eight DBT viewports ~5–6 GB decoded, D on `dbts_b2`–`b5`'s sizes); a metered link; nothing on a phone is measured |
| **P2 on demand** (`?fill=0`) | the current frame alone, up to `askDepth` asks | every step to an unseen frame is a miss: Experiment 2's on-demand cell, the time a step's frame was missing, 10 ms median at 20 Mbit/s 92 ms on 164 kB frames, where the forward step in a fill waited 230–571 ms (§Experiment 2, *Run*). On larger frames a miss is at least one frame's link time, 1.9 s for a 4.8 MB mammogram at 20 Mbit/s (D) | cine and a fast scroll: nothing ahead is held, so cine at the image's rate stalls on every frame whose link time exceeds its period (D: 164 kB at 25 frames/s needs 33 Mbit/s); priors are never ready |
| **P3 a memory window** (W frames around the current one) | the window, ascending from the current frame, re-centred on each step | bytes and memory bounded by W; a jump outside the window is a miss, as P2; frames left behind are fetched again if the reader returns | needs eviction that frees memory (§2), else it bounds bytes but not memory; a window shorter than a cine's look-ahead stalls cine |
| **P4 the useful frames first, then P1 or P3** | named frames (DBT's centre slices, the MLO pair) asked, then the rest | the useful frames in **0.30–0.68** of the sequential fill's time, the whole fill **+2 round trips** (+72–113 ms over 40 ms) ([`../av1/README.md`](../av1/README.md) §The order frames are asked in) | none; it is an order, and needs the viewer to name the frames (a hanging protocol's job) |
| **P5 coarse to fine** (every 8th, 4th, …) | the series in a stride order | every 8th frame in hand at 1 043 ms against 5 688, the fill 5 826 against 6 032 ([`../transport/transport-conclusions.md`](../transport/transport-conclusions.md) §The fill's order) | a reader may not skip slices (DBT, R), so a scrubbable but gapped stack still waits at each gap; [`stride-is-bandwidth-conservation.md`](stride-is-bandwidth-conservation.md) argues the opposite and predates the requirement (§7, question 6) |
| **P6 background as paced asks** (no runs; asks at `D_min`) | as P1 or P3, asked frame by frame at the depth that saturates | an ask waits behind at most `D_min` frames, not 6 MiB: `D_min` = 1 where `Tf ≫ RTT` ([`client-window-depth.md`](client-window-depth.md)); the per-ask cost and the lost run read-ahead are not measured in a browser ("its win there was never measured", same ADR) | throughput: Experiment 2's alternating asks are the case the run was built to avoid; untested |
| **hybrids by input** | choose among P1–P6 by series size, frame size, link rate, memory and device class | — | each input below |

**The inputs, one by one.**

* **Series decoded size against the memory budget** decides whether P1 is possible at all. It is the one input that
  breaks a policy rather than slowing it: a tab over a phone's limit is killed (which limit, resident or heap, "is not
  measured", [`../ARCHITECTURE.md`](../ARCHITECTURE.md) §Resources).
* **Frame size** sets `Tf`, and so the miss cost and `D_min`. It enters through `s_d` in the rule and through depth.
* **Link rate** moves every time but not the order of preference: with asks first, a fill takes only the link the
  asks leave ([`client-window-depth.md`](client-window-depth.md): "background fill occupies whatever depth the
  foreground is not using"). Its one cost to latency is the drain, the fill already written to quinn, which no client
  policy short of P6 removes. The phone's link: ~100 Mbit/s median on cellular (p10 18), ~220 on Wi-Fi, loaded round
  trips 0.7–0.8 s median on cellular ([`../transport/transport-conclusions.md`](../transport/transport-conclusions.md)
  §The target, *Corrected 2026-10-13*).
* **Device class** enters only as the memory budget and the decoder count (`min(3, hardwareConcurrency)`,
  [`../ARCHITECTURE.md`](../ARCHITECTURE.md) §Resources). A phone's decode is not measured; the container's 4× stand-in
  is "for a device" ([`../devices.md`](../devices.md) D1). The slowest decode measured is 355 ms a frame, the
  mammogram at 4× ([`../ARCHITECTURE.md`](../ARCHITECTURE.md) §The downloader, `decodeMs`).
* **The radio and the meter.** Every byte of P1 the reader never looks at is energy and data cap; energy is D5's,
  unmeasured. `navigator.connection` (and its `saveData`) is Chromium's only; WebKit declined it
  ([`../CLIENTS.md`](../CLIENTS.md) §On WebKit).

**A second viewport or a prior.** Each series is its own server process, so each viewport is its own session, and two
sessions filling at once are two congestion controllers on one bottleneck. **Prediction:** each takes about half the
link, so the focused series' fill takes about twice as long while a prior fills beside it (assumed: per-flow fairness
between two Cubic flows; not measured here). The options:

* **(a) every session fills at once** — the simplest, and it halves the focused fill (prediction above);
* **(b) one fill at a time across the page's sessions**, in the hanging's order (the focused viewport, then the rest
  of the current, then the priors), each session's asks still going at once — a client arbiter above the downloaders,
  no wire change;
* **(c) one session carrying several series** — a series field in every FoD message and envelope, and a server that
  opens more than one bundle: a wire and server change.

Recommended for when the viewer has viewports: (b). It keeps the wire, and it is the hanging protocol's order made
into the link's. The budget splits among visible viewports; how is question 3 (§7). Not designed further here: the
viewer has one viewport and "isn't even designed" for more ([`frame-path.md`](frame-path.md) §The core, assembled).

**What changes on a phone.** Memory: the budget is small and unknown (no phone measured). Radio: loaded round trips
of 0.7–0.8 s make the drain, the wait behind a fill, the dominant latency cost; the 16 MB WebKit flow-control stall forces a
recycle on iOS ([`../CLIENTS.md`](../CLIENTS.md) §On WebKit). CPU: decoders on efficiency cores; two-core devices get
two decoders. Lifecycle: a backgrounded tab freezes, and a fill outlasts a screen lock only as §Session survival says.

## 4 · The recommended policy

**The rule.** For each series a view shows:

```
s_d = width × height × components × (bits ≤ 8 ? 1 : 2)    decoded bytes a frame, from the series' metadata
M_v = M ÷ (visible viewports)                              the view's share of the device's budget M
W   = min(n, max(W_min, ⌊M_v ÷ s_d⌋))                     the memory window, in frames
want = the W frames from the current frame, ascending, then the ones behind it nearest-first
store budget = W frames
```

* **W = n: the whole series**, ascending from the current frame with `waitAhead` k = 8 — today's fill with
  Experiment 2's ordering. The rule chooses it for every series in §1 but the largest DBT volumes, on any budget
  ≥ 128 MiB (D: 52, 48 and 67 MB decoded, a four-view mammogram 68–109 MB).
* **W < n: a window**, re-wanted on every step, the store evicting farthest-first (`client/view/store.js:127–132`, as
  built). The forward three quarters of the window lie in the direction of the last step (**assumed**; a sawtooth reader
  turns at the ends, and `waitAhead`'s ascending want already wraps forward).
* **`W_min` = 8**, so the window covers k = 8 ahead whatever the budget (**assumed**, from Experiment 2's k).
* **The useful frames first** (P4): the want's head is the frame the viewer opens on, which the hanging protocol names.
  No new mechanism: it is the head of the want.
* **Depth stays `askDepth` 4**; computing `D_min` from the link is not part of this rule.

**M, the budget.** **Assumed**, for the owner (question 1): `navigator.deviceMemory × 128 MiB` where the browser offers
it (Chromium; 8 GB → 1 GiB, 4 GB → 512 MiB, 2 GB → 256 MiB), else 256 MiB — the budget M5 carved its ring from
([`frame-path.md`](frame-path.md) §Proposed, *How the ring works*); a deployment setting overrides it. That puts
Firefox and Safari desktops at 256 MiB until the owner sets otherwise, the conservative choice. Under it:

| series | s_d (D) | W at 256 MiB | W at 1 GiB |
| --- | ---: | ---: | ---: |
| `ct_lidc` | 0.52 MB | n = 100 | n |
| `dbt12_ea1141` | 1.67 MB | n = 29 | n |
| `us_liver` | 0.96 MB | n = 70 | n |
| `ffdm_d` four views (one series) | 27.3 MB | n = 4; current + prior, two viewports, 128 MiB each: 4 each | n |
| `dbts_b1` | 17.0 MB | **15** | **63 ≥ n = 50** |
| `dbts_b2` (71 × 1890×2457) | 9.3 MB | **28** | n |

**Cine** plays from held frames and waits on a frame not yet held, never skipping (R). **Prediction (D):** the rate a
cine can sustain past the window is R ÷ (8 × coded bytes a frame): 25 frames/s needs 33 Mbit/s on `ct_lidc`, 100 on
`dbt12_ea1141`, 51 on `us_liver`; on `dbts_b1`, whose coded size is not in the docs (**estimate** ~5 MB a frame, from
`dbt12_ea1141`'s 1.67 MB : 499 kB), ~2.4 frames/s at 100 Mbit/s. So on a phone a large DBT volume plays cine only over
its window: 15 frames, 0.6 s at 25 frames/s (D).

**Why this rule.**

* **It is the owner's hypothesis made exact.** "Fill for relatively small series" is W = n; "latency for heavier
  modalities" is W < n, a window in which steps are held and outside which a step is a miss. The line between them is
  where the series stops fitting the device, not a modality: a long CT on a 2 GB phone crosses it, a DBT volume on a
  desktop does not.
* **It is what AAPM 260 asks of a handheld**, "brought over only in a just-in-time basis and later purged", and it
  leaves a desktop exactly as today.
* **It adds one number to what is built.** The want, the ascending order, the store's budget and farthest-first
  eviction exist (§2). The rule computes W and passes it.
* **Link rate stays out**, because choosing the window by it would trade memory, which kills a tab, for a latency the
  transport can fix instead (below), and because a phone's rate moves under it.

**What the rule leaves to the transport.** The wait of an ask behind the fill already written to quinn — the drain, 6 MiB ÷ R
in Chromium — is the same whether the client fills a series or a window. Two server levers already shorten it and
are pre-registered elsewhere: `--send-window-follows-cwnd` (row 211: "the ask ×0.25–0.83 of `shared` in all nine cells,
the fill within `shared`'s spread in each") and row 249's one queue ([`../WIRE.md`](../WIRE.md) §Proposed: one queue).
P6, background as paced asks, is the client's alternative, kept as an arm (§5) only if neither server lever is adopted.

**What it does not decide.** Whether the window lives in memory alone or memory over an OPFS cache (question 4); how
viewports share M (question 3); the hanging protocol's head frame.

## 5 · Predictions, and the protocol that decides

**Predictions per scenario.** "Today" is P1 under `?view=worker` with `waitAhead` off, the arm Experiment 2 called
`off`. Link times are coded bytes × 8 ÷ rate, a floor that leaves out round trips, slow start and decode (D).

| scenario | today | the rule | source or basis |
| --- | --- | --- | --- |
| CT, `ct_lidc`, drilling sawtooth, 20 Mbit/s | forward step waits 230–571 ms (medians by cell and engine) | W = n: Experiment 2's k = 8, −88 to −248 ms in the decided 20 Mbit/s cells, fill ×0.92–0.95 | measured, [`frame-path.md`](frame-path.md) §Experiment 2, *Run* |
| CT, whole fill | 6.6 s at 20 Mbit/s, 1.3 s at 100 (D) | the same (W = n) | prediction: a tie |
| DBT `dbt12_ea1141`, open on the centre slices | 3.65 s to the centre five at 20 Mbit/s | 1.19 s | measured, ORDER, [`../av1/README.md`](../av1/README.md) |
| FFDM `ffdm_d`, the hanging complete | 7.7 s at 20 Mbit/s, 1.5 s at 100 (D on 19.2 MB) | the same; with a prior beside it under (b), the current's hanging at the same time and the prior's after | prediction; (a) would make the current's ~2× later (prediction, §3) |
| DBT `dbts_b1` on a 256 MiB phone | the page tries to hold 812.5 MiB; on a phone, not measured | 15 frames held; resident memory ≤ M + overhead **only with a freeing frame memory** (M5's ring); a step inside the window within a display period of today's; a jump outside it one miss, ~RTT + 0.4 s at 100 Mbit/s (estimate) | prediction |
| DBT `dbts_b1` on a desktop at 1 GiB | as today | W = n, as today | prediction: identical |
| the same series, bytes on the radio | the series, ~254 MB (estimate) whatever the reader looks at | the window plus what the reader visits | prediction |
| an ask during a fill on a loaded cellular link | the drain, 6 MiB ÷ R + RTT: 0.49 s at 103 Mbit/s | the same | measured model, link-conditions item 9; the rule does not move it |

**The protocol, pre-registered** (its own row; amended only before its round 0).

* **Arms**, one build, one setting each, `?view=worker`: **A** today (P1, nearest-first); **A′** A again, the A/A
  arm; **B** the rule (W from M, ascending, k = 8); **C** on demand (`?fill=0`), the latency floor, reported not judged.
  P6 joins as **D** only if row 249 and `--send-window-follows-cwnd` are both rejected.
* **The budget is a test lever**, set to 256 MiB in every arm's metadata on the container to stand for a phone; never
  the browser's own memory pressure (CLAUDE.md, *Page-cache eviction is not a test lever*: the same reasoning).
* **Cells.** Series `ct_lidc`, `us_liver`, `dbt12_ea1141`, `ffdm_d`, `dbts_b1`; links `r20000rtt46`, `r100000rtt46`,
  `n103000` (the 650 ms FIFO, ~0.7 s loaded round trip) and `lte-good` (`lab/av1/delivery/total-time/run.mjs`); CPU 1×
  and 4× (`lab/scripts/cpu_throttle.mjs`); Chromium and Firefox.
* **Traces**, from frame 0 on screen: *open* (navigation → first exact frame held); *sawtooth*
  (`lab/viewer/trace.js`, Experiment 2's); *jump* (to ⌊n/2⌋, then n − 1, then 0, 2 s apart); *cine* at 25 frames/s for
  5 s, counting frames shown late and checking none skipped.
* **One measure a claim.** Latency: the open, the mean forward step wait to held, the jump wait. Memory: the renderer's
  peak PSS less its value before the dial (`lab/scripts/proc_sampler.mjs`). Bytes: coded bytes received. The fill's time
  only as must-not-regress on W = n cells. Throughput and latency are not both quoted for one cell.
* **Interleaving.** Arms in a Williams order inside each cell, cells in a Williams order each round (`lab/order.mjs`);
  12 rounds. `--mutate sample` before round 0 turns every arm to 0 exact.
* **Guards.** *VOID:* a visit whose relay's p99 lateness is over 1 ms is re-run at its round's end; a cell under 10 of
  12 visits an arm claims nothing. *A/A:* A′ − A beyond ±8 ms on a wait, or a fill outside ×0.98–1.02, leaves the cell
  undecided. *Live:* a W < n cell where A's peak memory stays under 256 MiB + 160 MiB tests nothing and is said so.
  *Saturation:* the 4-core container is CPU-bound at 4× by design and its memory cgroup allowed 13 679 MiB (row 273,
  [`../ARCHITECTURE.md`](../ARCHITECTURE.md) §Open); nothing past it is claimed, and nothing for a phone.
* **Mutants, before data:** the budget ignored (B's memory bar must fail on `dbts_b1`); the window ignored (B's bytes
  must equal A's); W_min ignored (B's sawtooth on a 15-frame window must regress).
* **Rule.**
  * On every decided W = n cell, B is no later than A by 16.7 ms in ≥ 9 of 12 rounds on any latency measure, and its
    fill's paired median is ≤ ×1.02 of A's. (Experiment 2 already measured this for CT; a tie with its result is
    expected.)
  * On every live W < n cell, B's peak memory is ≤ 256 + 160 MiB in every round, the bar M2 set
    ([`frame-path.md`](frame-path.md) §Measurement owed, M2), its frames exact, and its in-window steps no later than A's
    by 16.7 ms in ≥ 9 of 12 rounds.
  * Both hold: **B is adopted as the rule**, and the jump waits on W < n cells (expected worse than A's, which held the
    whole series) are recorded as its price. Memory fails: the frame memory does not free (the ring is not in) and the
    rule waits for it. Latency fails on W = n: B is not adopted and its cells are the reason.
* **What needs a phone** (a D2-style row, [`../devices.md`](../devices.md)): the Samsung on Android 16, Chrome and
  Firefox, Wi-Fi and cellular as they come; A and B on `dbt12_ea1141`, `ffdm_d` and `dbts_b1`; the same measures, plus
  whether the tab survives (`adb`, its PSS); n ≥ 10 rounds interleaved. A tab killed under A and not under B adopts B on
  the phone whatever its jump waits. The real budget M a phone can hold is read there, not assumed.

## 6 · Implementation plan

Each step is one reviewable change; *structural* ones go to the owner first (CLAUDE.md).

| # | step | changes | structural |
| --- | --- | --- | --- |
| 1 | `waitAhead` k = 8 as the default | client: `downloader.js` and `controller.js` defaults, their tests | no — the owner's pending merge ([`frame-path.md`](frame-path.md) §The core, assembled, *Waiting on the owner* 1) |
| 2 | the page view sends a want, as the worker view does: the store links the downloader, and a step re-wants instead of asking | client: `controller.js` `show`, `viewer.js`'s connect | **yes** — it changes the default view's asking path; an A/A of today's `?view=page` against itself, then against the change, before it lands |
| 3 | a frame memory the store frees: M5's ring, or a fix of the per-frame `SharedArrayBuffer`'s collection | client: `store.js`, `client/decode/frame-buffer.js`, the decoders | **yes** — the owner's lever 2 ([`frame-path.md`](frame-path.md) §The core, assembled, *Waiting on the owner* 2) |
| 4 | the rule: `s_d`, `M`, W; the want limited to the window; the store's budget set to W | client: `controller.js` `wantFrom`, the controller's constructor; one setting for M | no, once 2 and 3 are in; the default M is the owner's (question 1) |
| 5 | cine waits for a held frame and never skips | client: `view.js` `play`, the controller | no — the cine fix (#251) redone on the core's controller ([`frame-path.md`](frame-path.md) §The core, assembled, *Waiting on the owner* 6) |
| 6 | the measurement of §5, then the phone row | lab only: the budget lever, the jump and cine traces in `lab/viewer/trace.js`, a summary like `lab/viewer/wait-ahead-summary.mjs` | no |
| 7 | the arbiter across sessions, (b) of §3 | client: above the downloader | **yes**, and only once the viewer has viewports |
| 8 | the wait behind a fill: `--send-window-follows-cwnd` or row 249 | server | **yes**; already pre-registered ([`../WIRE.md`](../WIRE.md) §Proposed: one queue) |

No step changes the wire. Steps 1–6 serve one viewport; 7 and 8 are independent of the rule and of each other.

## 7 · Open questions for the owner

1. **The budget M.** `deviceMemory × 128 MiB`, else 256 MiB, is assumed. Is a deployment setting enough, or should
   the page read the device? Firefox and Safari offer no `deviceMemory`, so they get the default.
2. **Mobile mammography.** If a phone is review-only for breast imaging (requirement 16), a 15-frame DBT window with a
   miss outside it is acceptable; if a phone must scroll a whole DBT volume, no budget a phone has holds `dbts_b1`, and
   only the OPFS cache (question 4) or a smaller resolution ([`resolution-fitting-for-large-frames.md`](resolution-fitting-for-large-frames.md))
   does.
3. **Viewports sharing M and the link.** Equal shares of M among visible viewports, and one fill at a time in the
   hanging's order (§3 (b)) — or the focused viewport first in memory too?
4. **The window over an OPFS cache.** With the cache on, a window in memory could sit over the whole series on disk
   (fill to disk, hold W), at the price of AAPM 260's "no persistent data" (requirements.md §Open). Off by default
   today; is that still the owner's line on a phone?
5. **A metered link.** Should `saveData` (Chromium only) shrink W to the window even where the series fits?
6. **Stride against *never skip*.** [`stride-is-bandwidth-conservation.md`](stride-is-bandwidth-conservation.md) accepts
   skipping frames under a fast scroll; IHE DBT says the display "shall not skip slices during manual or automatic
   scrolling". This ADR follows the requirement (cine and steps wait). Should the stride ADR be corrected in place?
7. **The head frame.** The first frame or the centre slice for DBT is the hanging protocol's; ORDER's centre slice is
   "this measurement's premise, not a measured reading pattern". Who decides it before a viewer exists?
8. **Order of work.** Steps 2 and 3 are structural and gate step 4. Proceed with 1 and 5 now, and propose 2 and 3?

## Sources

All in this repository at `0920153` unless named: [`../ARCHITECTURE.md`](../ARCHITECTURE.md) (§The downloader,
§Resources, §The viewer, §Open), [`../WIRE.md`](../WIRE.md), [`../CLIENTS.md`](../CLIENTS.md),
[`frame-path.md`](frame-path.md) (§The core, assembled; §Experiment 1, 2; §Proposed, *How the ring works*; §4; §6),
[`client-window-depth.md`](client-window-depth.md), [`stride-is-bandwidth-conservation.md`](stride-is-bandwidth-conservation.md),
[`../transport/transport-conclusions.md`](../transport/transport-conclusions.md),
[`../transport/link-conditions.md`](../transport/link-conditions.md), [`../FIXTURES.md`](../FIXTURES.md),
[`disk-access.md`](disk-access.md) §6, [`../av1/README.md`](../av1/README.md), [`../devices.md`](../devices.md); and
requirements.md on `origin/claude/line-viewer` at `aba1adc`, whose sources were read by its author on 2026-10-27.
