# The next phone round, pre-registered

*Written 2026-11-14 by the row PHONE-NEXT-PROTOCOL of `claude/work-ledger:docs/queue-client-2026-11-14.md`, by a
session that will not run it. It supersedes `docs/queue-2026-11-14.md`'s PHONE-AMEND-3 (not started). The owner's
phone session runs it with its runner; no cloud session does. Every number below is labelled* measured *(with the file
that holds it),* theory *or* derived*. Amendments 5, 6, 7, 11 and 12 of the queue file bind it.*

**Sources quoted here**, fetched 2026-11-14: W3C Screen Wake Lock API, Working Draft 2026-11-11
(`https://www.w3.org/TR/2026/WD-screen-wake-lock-20261111/`); W3C WebTransport, Candidate Recommendation 2026-07-30
(`https://www.w3.org/TR/2026/CR-webtransport-20260730/`); W3C Long Tasks API, Discontinued Draft 2026-10-20
(`https://www.w3.org/TR/2026/DISC-longtasks-1-20261020/`; quoted for its definition only); Linux man-pages 6.19
(2026-02-08), `proc_pid_stat(5)`. The codec and cache facts are quoted where they live
(`claude/hw-decode:docs/decode/hardware.md`, `claude/cache-plan:docs/client/evidence/cache-plan.md`).

## 0 · The round in one screen

| cell | what | link | counted? | decides |
| --- | --- | --- | --- | --- |
| 1 | decode per frame: HTJ2K (OpenJPH-WASM) and the view (WebCodecs), same source, 1–4 decoders | none (in memory) | yes | the phone's decode floor per codec; where the decoders saturate |
| 2 | the delivery arms A, B, C1, C2 | Wi-Fi | yes | per arm on this link: wire, decode floor, rest, route, bytes, CPU |
| 3 | the view comparison, page against worker, `cubic-restart` only | Wi-Fi | yes | frame-change, exact-frame and cine latency, idle and busy; the first picture; the fill |
| 4 | the hardware-decode probe (`lab/devices/`, `claude/hw-probe`) | none | no, exploratory | nothing; it records what the phone's decoders take |
| 5 | the cache: P2 the sustained write, then P1 the cold read | none | yes, if built | the cold read + XXH3 against ~45 ms a frame |

One press starts cells 1–5 in that order (§3). Expected wall-clock about 2 h 10 min of loads (§6). The fixtures and
their limits are §9; the asks of the phone session's tooling, without which a cell waits, are §10.

## 1 · The commit

* **The run commit** is the tip of `claude/unified-client` (or the branch that then carries the unified client) on the
  day of the round, written into the round's first record. Before load 1 the laptop's script checks, and the runner
  stops on any difference: `git rev-parse HEAD` of the served tree; each server image's OCI `revision` label; the
  `commit` the page reads from the served tree. A verdict carries only to that commit.
* **The two phone failures must be fixed in it**, or their failure mode is excluded by name:
  * *a lost exact ask* (load 6 of 11-11): PR 378's re-ask (or its successor) in the commit. Without it a load whose
    exact ask fails is **failed**, counted as a correctness result, never rerun, and cells 2–3's exact-frame latency
    reports it as a failure, not a long time;
  * *a hidden page loses its decoder* (load 13): PR 376's late deadline (or its successor) in the commit. Without it,
    a load during which `document.visibilityState` was ever `"hidden"` is **VOID** by name (it ran under conditions
    the protocol excludes), recorded and reported, not pooled. With the fix it counts.
  * Today (2026-11-14) neither is in `claude/unified-client` (`e5b20cba`; `git merge-base --is-ancestor` on both
    branches is false). Merging them is the owner's.
* **The tools** (runner, beacon, probe) come from the device kit `lab/devices/` (amendment 15) at the same commit; the
  11-11 runner `claude/phone-tools:lab/phone/` is the starting point of RUNNER-AUTO, not a second runner.

## 2 · Links and place

* **Counted cells run on Wi-Fi**: the phone on the home access point, the laptop (servers) wired to the same router.
  Recorded before cell 1 and after cell 5, never during a timed load: the band (2.4, 5 or 6 GHz), the channel and its
  width, the link speed and RSSI the phone reports (`adb shell dumpsys wifi`, by the laptop's script), and the
  distance to the access point in metres with walls between (the owner's one line in the round's notes, written
  before the press). The phone stays at that place, on a charger, screen up, for the whole round.
* **The tether** only for cells that do not touch the wire (1, 4, 5): those load their units once over any link
  before timing starts, so the link does not enter their numbers; USB stays connected for `adb` (below) and power.
* **`adb` during the round** (the 11-11 rule was "no adb in a timed load", because adb rode the tether's cable and
  loaded that arm alone): with no counted cell on the tether, adb may read between loads, never during one. What it
  reads: `/proc/<pid>/stat` for each Chrome process before and after each load (CPU time; §4 cell 2), `logcat`'s
  buffer after each load (which codec component Android allocated; §4 cell 1), `dumpsys battery` (temperature) per
  block. `proc_pid_stat(5)`: "(14) utime %lu Amount of time that this process has been scheduled in user mode,
  measured in clock ticks" (and (15) `stime` the same in kernel mode).
* **No DevTools, trace or Performance recording** in any counted cell (unchanged from 11-11).

## 3 · Automation (amendment 5)

**What the owner does:** unlock the phone, open the runner's bookmarked URL, press **Start** once. Nothing else until
the round's end banner. Anything that would need a hand mid-round is designed out or is a departure named here (one:
P1's cold read, §4 cell 5).

* **The runner page drives every load, press and wait**: it opens each load's URL, waits for the fill's end mark,
  presses the controls the reader would (frame steps, *Lossless*, cine), waits the gap, and goes on. A failed load
  stops nothing: it is recorded with its reason and the runner takes the next (the 11-11 runner stopped on any
  failure, which needed a hand to resume).
* **Server arms switch from the laptop**: one laptop script holds the plan, starts and stops the servers for each
  block (arm B's and C2's exact-only servers, the long-task lever's page, the probe's static host), and answers the
  runner's `GET /next` with the next load's URL only once its servers answer. The runner never needs to know the
  servers' ports.
* **The screen stays on and the page visible.** Screen Wake Lock: "A screen wake lock prevents the screen from
  turning off." Its limits, quoted, are why the runner re-acquires and records: "UAs (and the underlying OS) may time
  limit a wake lock given the battery status … or even disallow wake locks in the case a power saving mode is
  activated"; "If document's visibility state is "hidden", return a promise rejected with "NotAllowedError""; and
  "screen wake locks are released when a document loses visibility". So the runner requests `navigator.wakeLock`
  `"screen"` on Start, again on every `visibilitychange` to visible and on every `release` event, and records each
  acquire, release and refusal with its time; because "failure to acquire a lock … is indistinguishable from a
  successful lock acquisition", the runner also records the gap between its own timers (a gap over 2 s outside a
  load's own work marks the load **VOID: stopped**). The phone is on its charger and out of power-saving mode (the
  owner's one check before the press). Each load opens in the **same tab** (no new window, no reload of the runner
  between loads), so the page the lock belongs to stays visible.
* **The stopping rule counts wall-clock time loads ran**, never time stopped after a failure: each cell has a budget
  (§6); a block's loads stop starting when the sum of its loads' own durations (open to the beacon's last record)
  passes the budget; time spent between loads, in waits for a server, or after a failure counts toward nothing.
  **No load that ran under the protocol's conditions is ever excluded** (amendment 11): a VOID load is reported by id
  with its reason, and a budget stops only loads not yet started.

## 4 · The cells

Each with its arms, what it records, its prediction (written before any data) and its rule. The view is
`dbts_b1-q8-g8` unless a cell says otherwise; its exact series is `dbts_b1`'s HTJ2K.

### Cell 1 · Decode per frame, per codec, per decoder count

* **Arms:** {HTJ2K by OpenJPH-WASM, the view by WebCodecs} × decoders {1, 2, 3, 4}; the same 50 frames, coded bytes
  held in memory before timing (no wire). Each frame timed in its decoder worker from the chunk handed to the decoder
  to the decoded samples ready (the time the product's decoder worker logs), and the effective time a frame
  (the 50 frames' span ÷ 50). Three repetitions each, the eight arms in a Williams order per repetition; the
  1- and 3-decoder arms run again at the round's end (the drift check). `navigator.hardwareConcurrency` recorded.
* **The route taken:** after each arm, the laptop reads `logcat` for the codec component Android allocated (Codec2 or
  MediaCodec component names, e.g. a `c2.android.av1…` software component against a vendor's): *expected, not
  sourced*; cell 4 checks first that logcat names it at all. The decoder's own report is recorded beside it
  (`VideoDecoder` gives none, so the configure's `hardwareAcceleration` is what the page can record).
* **Predictions.** *Measured* (`fill-bound-on-phone.md`): the view 133–135 ms a frame per decoder at 3 decoders,
  ~45 ms effective. *Theory:* HTJ2K at 76–107 ms a frame per decoder (the view's 133 ms ÷ the cloud's 1.24–1.74,
  `decode-speed-of-the-optimal-quality-picture.md`), 26–36 ms effective at 3 — a cloud ratio carried to a phone, no
  band claimed. Effective time falls with decoders up to the number of fast cores the phone gives a tab, then stops
  falling (where is unknown: no source read gives this phone's core layout; *assumption*).
* **Rule.** Per codec, the *saturation point* is the smallest count whose effective time is within 10 % of the next
  count's. Drift: the end's arms more than 15 % slower than the start's → the cell reports *thermal drift* beside its
  numbers. The HTJ2K effective time at 3 decoders is the number LINK-TARGETS owes (`link-profiles.md`).

### Cell 2 · The delivery arms

* **Arms** (`docs/client/design.md` §Open, *The delivery comparison*): **A** the optimal-quality view only; **B** the
  exact HTJ2K series only (the viewer pointed at the exact series, no pair); **C1** the view's fill, then one exact
  frame on request (an on-demand latency); **C2** the view's fill, then the whole exact series, measured, not summed.
  `cubic-restart`, the page view. Two series: `dbts_b1-q8-g8` and the show list's first, `dbts_a1-q8-g8-cut` (where
  the start weighs most; `PHONE-RUN.md`). Eight rounds × four arms × two series = 64 loads, each round a Williams row
  of the four arms, the series alternating by round.
* **Records per load:** the fill (the beacon's `fillFrom` → `fillTo`), the wire time (the server's first to last byte
  sent for the session), the decode floor (the sum of per-frame decode times ÷ decoders), the rest (fill − max(wire,
  floor)), the route per frame, bytes on the wire, per-frame arrival times (the downloader's), WebTransport's
  `getStats()` at the fill's end ("Gathers stats for this WebTransport’s underlying connection"; `smoothedRtt`,
  `minRtt`, `packetsLost`, `bytesReceived`; recorded *where available*: Chrome 157's support is not checked here),
  CPU per Chrome process (§2), server egress and CPU. C1: exact-frame latency (§Names). C2: the second fill's span.
* **Predictions** (*derived*, `link-profiles.md` §2, the measured home Wi-Fi ≥ 600 Mbit/s, ~2 ms):
  A decode-bound, fill ≈ 2.25 s + rest 0.22–0.35 s (*measured* 2.4–3.3 s on 11-11); B's wire 1.43 s against a decode
  of 50 × cell 1's HTJ2K effective time: B faster than A if that time is under ~45 ms; C1 = A's fill, then the ask in
  ~0.04 s plus one HTJ2K decode; C2's fill ≥ A's + B's wire. `dbts_a1-q8-g8-cut`: the same order (length moves bytes,
  not the regime; §3 there).
* **Rule.** Per series, B against A and C2 against A + B by the ratio within each round: *faster* when the sign test
  passes (two-sided p < 0.05; with 8 rounds all 8 below 1) and the median ratio ≤ 0.95; otherwise *no difference
  shown*. Every load's regime (wire or decode bound: which of wire and floor is larger) is reported against its
  prediction. Eight rounds per series is the cell's minimum; the margin is the second series, which is pooled only if
  its ratios fall on the same side.

### Cell 3 · The view comparison (amendments 6, 7, 12)

**What the views differ on, from theory** (each a prediction, labelled theory; `docs/client/design.md`): in the page
view the controller, the store and the paint run on the page's thread; in the worker view on the view worker's. Both
views receive input on the page's thread, and both decode in the same decoder workers.

| measure | prediction (theory) | why |
| --- | --- | --- |
| (a) frame-change latency, page idle | equal within 5 ms | both paint the next rAF after the input |
| (a) frame-change latency, busy (below) | worker lower by ~one long task in some steps | both wait for the task in progress before the input; the page view may then wait a second task before its paint, the worker does not |
| (a) cine pacing and dropped frames, busy | worker drops fewer | the worker's clock and paint do not wait for the page's tasks |
| (a) exact-frame latency, idle and busy | equal within the HTJ2K decode's spread | bound by the round trips and one HTJ2K decode, both views alike |
| (b) the first picture | worker later by ≥ 16.7 ms | the view worker's start (*measured* in the cloud, `view-worker-start.md`) |
| (c) the fill | equal | decode-bound in both, unless a busy page delays the acks so the credits pause the wire |
| (d) memory, page and workers | worker higher by the view worker's heap | frames are held in either one place |
| (e) messages and hops per frame | worker more by one hop per paint | counted from the code at the run commit, then by the runner's counters |

**Which decides the view:** frame-change latency and cine drops with the page's thread busy, since they are where the
theory says the views differ and what a reader feels; the fill and the first picture are guards (the worker must not
be worse by the rule below). Memory and hops are recorded, deciding nothing.

* **Busy page:** the runner's page posts fixed long tasks on the page's thread, 100 ms of busy work every 250 ms (40 %
  of the thread). The Long Tasks API's definition is the anchor: "Long task refers to any of the following
  occurrences whose duration exceeds 50ms"; and "A website without these tasks should respond to user input in under
  100ms". The lever is the same in both views.
* **Per load:** the fill, then 20 frame-change steps page idle, 20 busy (the runner's input is a dispatched event
  scheduled at a random 0–250 ms phase; a dispatched event is not a real input, and the browser may schedule them
  differently, not traced here: the same in both views), 10 s of cine idle and 10 s busy (frames painted against
  frames due), one exact frame idle and one busy (different frames). Times are epoch ms on
  `performance.timeOrigin + performance.now()` in each thread, from the input's dispatch to the call that painted
  that frame returning (not the display's scan-out).
* **Arms:** page and worker, `cubic-restart` only (the controller factor dropped: `cubic-restart` is the decided
  default). Pairs of loads in ABBA order (page, worker, worker, page, …); one ratio per pair per measure (the worker's
  median over the page's).
* **The rule's n.** Two-sided sign test, p < 0.05: *worker faster* when at least the threshold of the pairs left is
  below 1 **and** the median ratio ≤ 0.95; *page faster* the mirror; otherwise *no difference shown*. Thresholds by
  pairs left: 16 → 13, 17 → 13, 18 → 14, 19 → 15, 20 → 15, 21 → 16, 22 → 17, 23 → 17, 24 → 18; under 16 pairs the
  measure is *not decided*. **Planned 24 pairs (48 loads), a margin of 8 over the minimum 16** (amendment 7). The
  guards: the worker is *worse* if the page-faster rule passes on the fill or the first picture.
* **Prediction for the rule:** frame-change busy and cine busy: *worker faster*; idle and the fill: *no difference
  shown*; first picture: *page faster*.

### Cell 4 · The hardware-decode probe (exploratory, deciding nothing)

`claude/hw-decode:docs/decode/hardware.md` §17 as written there, by the kit's probe (`claude/hw-probe:lab/devices/`,
`hwdecode.js`; HW-PROBE-PAGE): forms `g8`, `g10`, `g8f`, `g10f`, `ramp10` at 16 × 16 and 256 × 256 ×
`hardwareAcceleration` {`no-preference`, `prefer-hardware`, `prefer-software`}; per cell `isConfigSupported`, the
decode's outcome or exact error, the frame's `format`, `copyTo` per format and its samples' XXH3 against the unit's,
the WebGL2 and WebGPU levels for `ramp10`. §17's predictions stand as the cell's predictions. `chrome://media-internals`
needs a hand: in its place the laptop records `logcat`'s codec allocations for each cell (and the hand-read is left
for any later session, outside this round). A hang is an outcome, recorded with its cell. Runs after cells 1–3, so a
blocked thread cannot stop the counted cells; its time (about 10 min) counts in no budget.

### Cell 5 · The cache (P2, then P1; only if the arms are built)

`claude/cache-plan:docs/client/evidence/cache-plan.md` §6: **P1, the cold read** ("In a new browser process, a series
written in an earlier one and not read since: the first read + XXH3 of each frame by OPFS-SYNC's sync handle in a
dedicated worker, then a second read of the same frames beside it. Against ~45 ms a frame") and **P2, the sustained
write** ("A fill of `dbts_b1-q8-g8` with three decoders writing through OPFS-SYNC's design, against the ~358 MB/s the
decode rate asks; the store's backlog and the tab's memory through the fill"). P3 ("the other survivors, only those
that pass the cloud cells") runs only if CACHE-RUN has passed one by the round's commit.

* **Runs only if** CACHE-BUILD-OPFS-SYNC and its review are in the run commit; otherwise the cell waits and nothing
  else changes.
* **Order:** P2 last in the round (three loads, the series written in full each time, one copy kept), then the laptop
  runs `adb reboot`. **P1** opens the next sitting on the rebooted phone: unlock, open, press (the same three acts as
  any round). Cold is reached by the reboot, never by evicting the page cache (`CLAUDE.md` §Measurement), and checked
  by the first read against the second: the first must be slower than the second or the cell is VOID (*not cold*).
* **Departure from amendment 5, named:** P1 needs a second sitting, because Android keeps a browser profile's data in
  credential-encrypted storage until the first unlock after a reboot (*not sourced here; the review should source it
  or correct it*). The owner's alternative, in one line: P1 in a new browser process without a reboot
  (`am force-stop` then `am start` from the laptop), labelled *new process, cold not shown*.
* **Predictions** (*theory*, `cache-plan.md` §6): P1's first read + XXH3 of a 17 MB frame under ~45 ms needs ≥ ~0.4
  GB/s cold from the phone's flash (UFS, unmeasured here); P2's writer keeps up with ~358 MB/s or its backlog grows
  through the fill. **Rule:** P1 passes when the median first read + XXH3 a frame is under 45 ms; P2 when the backlog
  at `fillTo` is under one frame and the fill's ratio to cell 2's A is ≤ 1.05.

### Report cells

REPORT-PROTOCOL appends its phone cells (§4 of `claude/report-plan:docs/client/evidence/report-plan.md`) here as asks,
under this heading, when it is written; none are here yet.

## 5 · Interleaving, warm-ups, saturation

* **Warm-ups:** two loads of A and two of the worker view before cell 2, not counted.
* **Interleaving:** inside every cell as written (Williams rows, ABBA pairs); cells run in the order of §0, since
  each answers its own question and none is compared across cells.
* **Where the phone saturates:** cell 1's decoder sweep gives the decode's; the battery temperature per block and the
  drift check give thermal throttling; a fill whose CPU per process (§2) reaches the phone's cores × the wall time is
  saturated and says so. Nothing is claimed past a saturated arm.
* **Where the laptop saturates:** its CPU per server process per load, and its NIC's counters; a cell whose server
  CPU reaches one core is reported as host-bound.

## 6 · Time and budgets (*derived* from 11-11's ~40 s a load and this round's per-load work)

| cell | loads | per load | budget (loads' own time) |
| --- | --- | --- | --- |
| 1 | 8 arms × 3 + 4 | ~15 s | 10 min |
| 2 | 64 | ~25 s (C2 ~35 s) | 35 min |
| 3 | 48 | ~70 s | 60 min |
| 4 | 1 | ~10 min | none |
| 5 | 3 + P1 | ~30 s | 5 min |

Gaps of 15 s between loads add ~30 min: about 2 h 10 min in all. A budget stops only loads not started (§3).

## 7 · What each cell can and cannot decide

* Cell 1 decides the phone's decode floor per codec and decoder count on this phone, at its temperature; not another
  phone, not hardware decode unless logcat names a hardware component.
* Cell 2 decides the arms' order on this one link (a best case of the target: `link-profiles.md`); not on LTE, 5G or
  enterprise Wi-Fi, which the sweep in `design.md` §Open owes.
* Cell 3 decides the views on this phone with a synthetic busy page; not with a real reader's input or a real page's
  work.
* Cell 4 decides nothing. Cell 5 decides OPFS-SYNC's cold read on this phone's flash only.

## 8 · The 11-11 run's octets (amendments 7, 11)

The 11-11 run's **six-octet reading is the reading of record**; the four-octet reading (what the Second amendment's
10-minute rule gives) stays beside it, labelled so. This round's rule (§3) has a margin over its minimum n and counts
the time loads ran, so it cannot cut a run as that rule did.

## 9 · Fixtures and limits

One phone (Android, Chrome; the version is recorded), one home access point at one distance and band, one laptop
serving, one evening; `dbts_b1-q8-g8` and `dbts_a1-q8-g8-cut` with their exact series (two DBT volumes of one dataset);
no breast ultrasound cine; software decode unless cell 1's logcat says otherwise; a synthetic busy page; no radio but
the home Wi-Fi.

## 10 · Asks for the phone session's tooling (RUNNER-AUTO; this protocol changes none of it)

1. One press: the runner reads its plan from the laptop's `GET /next`, opens each load in the same tab, records a
   failed load and goes on.
2. Screen Wake Lock, re-acquired on `visibilitychange` and `release`, every acquire, release, refusal and timer gap
   in the records.
3. The laptop's script: servers per block, the run-commit check (§1), adb reads between loads (§2), `adb reboot`
   after P2.
4. The beacon: per-frame arrival and decode times, the configure's `hardwareAcceleration`, `getStats()` at the
   fill's end, `visibilityState` changes (PR 377's records), the long-task lever's on/off, the input-to-paint times.
5. The busy-page lever (100 ms every 250 ms), the dispatched steps, the cine run and its due-against-painted count.
6. Builds the client lacks today, each behind a lab lever: arm C2 (the whole exact series after the view's fill);
   the decoder count per load; cell 1's in-memory decode bench; cell 5's arms (CACHE-BUILD rows).

What waits on each: cell 3 on 1, 2, 4, 5; cell 2 on 1–4 and C2's build (A, B, C1 can run without C2); cell 1 on the
bench; cell 4 on HW-PROBE-PAGE being green; cell 5 on its builds.

## Names, proposed for the glossary (amendment 12)

* **frame-change latency**: from a reader's input to another frame, to that frame painted.
* **exact-frame latency**: from the *Lossless* control pressed, to the exact frame painted with *✓ Lossless*.
* **cine drop**: a frame due by the cine clock whose paint never happened before the next was due.

The owner picks; until then these are used here and nowhere else.

## Review

*(For PHONE-NEXT-PROTOCOL-REVIEW, by a session that wrote none of it.)*
