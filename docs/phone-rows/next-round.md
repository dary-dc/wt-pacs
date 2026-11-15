# The next phone round, pre-registered

*Written 2026-11-14 by the row PHONE-NEXT-PROTOCOL of `claude/work-ledger:docs/queue-client-2026-11-14.md`, by a
session that will not run it. It supersedes `docs/queue-2026-11-14.md` (at `d735c727`)'s PHONE-AMEND-3 (not started). The owner's
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

Asks from REPORT-PROTOCOL (2026-11-15; `claude/report-plan:docs/client/evidence/report-plan.md` §7.7), for a block
after cell 5 only if the round's commit carries the report arms (`claude/report-arms`) and their review; otherwise
not run, and said so. Arms: the carrier arms that pass the cloud's delivery cell D there, plus `off`. One load per arm
per ending, in Williams order (`lab/order.mjs`), each load as cloud row D's: the fill, a forced mismatch at frame 10,
three frame changes and one *Lossless* press, then the ending at fill end + 6 s, then 60 s before the sink is read.

| ending | lever (scripted from the laptop over adb, no hand) | source |
| --- | --- | --- |
| R1 screen locked | the phone session's to choose and check | none quoted here |
| R2 app switched (Chrome to the background) | the phone session's | none quoted here |
| R3 Chrome stopped | `adb shell am force-stop com.android.chrome` | developer.android.com/tools/adb: "force-stop package Force-stop everything associated with package." Not the same as a swipe from recents (I) |
| R4 Wi-Fi dropped before hide | the phone session's | none quoted here |

Recorded per load: the fill record, each delta and the safety report at the sink, or not. **No bar**: the phone cells
rank the cloud's passers on the phone's endings (Beacon §1's "the only event that is guaranteed to fire on mobile" is
what R1–R3 test) and decide nothing alone. R1, R2 and R4 end the runner's own page or its wake lock (§3): the runner
must survive them or the block runs last, after which nothing else starts; a lever that needs a hand is a departure
from amendment 5 and is not run. Budget: ~5 arms × 4 endings × ~90 s ≈ 30 min of loads, outside §6's table.
Asks of the tooling (§10): the ending levers above; the sink reachable from the phone on the laptop.

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

*PHONE-NEXT-PROTOCOL-REVIEW, 2026-11-15, by a session that wrote none of it. Read only; nothing run on a device.*
Checked: every cell's prediction against the brief, the arms against `claude/docs-client:docs/client/design.md`
§Open *The delivery comparison*, the rule's n against the budgets, the asks against the kit and the 11-11 runner
(`claude/phone-tools:lab/devices/runner.js`, `lab/phone/runner.js`). Sources re-fetched 2026-11-15: every quote in
§2–§4 from the Screen Wake Lock WD, WebTransport CR, Long Tasks draft and `proc_pid_stat(5)` is verbatim. The sign
test's thresholds in cell 3 (16 → 13 … 24 → 18) are the smallest counts with two-sided p < 0.05 (recomputed: 16 →
p 0.021, 17 → 0.049, 24 → 0.023); cell 2's 8 of 8 is p 0.0078.

**What holds.** The arms A, B, C1, C2 are `design.md`'s. Each cell writes a prediction before data, and every theory
row is labelled. Amendments 5, 6, 7, 11 and 12 are each answered where the brief asks. The view comparison reaches
its rule in one evening: the minimum, 16 pairs (32 loads), is ~37 min of loads' own time at the ~70 s a load the
protocol assumes, against cell 3's 60 min budget, so the 24 planned pairs fit with ~4 min to spare (the 70 s itself
is *derived*, not measured: cell 3's load does more than an 11-11 load did).

**Findings.** Each is marked *author* (a fix to this file, a later firing of the queue's worker) or *owner*.

1. **The wake lock does not survive a load** (*author*, a blocker for amendment 5). §3 keeps one tab "so the page the
   lock belongs to stays visible", but the lock belongs to the document, and the 11-11 runner moves between loads by
   `location.assign` (`lab/phone/runner.js:151`), a new document each load. The spec, §11.2: "When a Document
   document becomes no longer fully active, the user agent must run these steps: For each lock in
   document.[[ActiveLocks]]["screen"]: Run release a wake lock". So every load starts unlocked until its page asks
   again, and the 15 s gap runs on the system's screen timeout, counted from the one press. The fix the phone already
   offers, scripted from the laptop: the platform setting `STAY_ON_WHILE_PLUGGED_IN` ("Whether we keep the device on
   while the device is plugged in"; Android `Settings.Global`, API level 17), set by `adb` before the press and
   restored after; the phone is on its charger (§2). The wake lock stays, recorded, as the second line.
2. **Cell 3's guard is predicted to fail** (*author*). The cell predicts the first picture *page faster* and also says
   the worker is *worse* "if the page-faster rule passes on the fill or the first picture". By its own predictions the
   worker loses the comparison before frame-change latency is read. Either the guard needs a bound written now (e.g.
   the worker is worse only past a stated first-picture cost, from `view-worker-start.md`'s ≥ 16.7 ms), or the cell
   says the first picture alone can reject the worker view. Which bound is acceptable is the *owner*'s; that the rule
   must state one is the author's.
3. **Cell 2 has no margin** (*author*; amendment 7). Eight rounds is the minimum, so one round on the wrong side
   (7 of 8: p 0.070) leaves *no difference shown*. Its stated margin, the second series "pooled only if its ratios
   fall on the same side", is a choice made after the data. Pre-register one: per series only, or pooled always (16
   rounds, 13 of 16), and add rounds if the budget allows (cell 2's 64 loads use ~29 of 35 min).
4. **Cell 1 relies on cell 4 first, which runs last** (*author*). Cell 1: "cell 4 checks first that logcat names it at
   all"; §0 and cell 4: the probe runs after cells 1–3. Either one logcat check before cell 1 (no timing), or cell 1's
   route reads *not checked* until cell 4 has run.
5. **Cell 2's predictions are conditional** (*author*). B against A is predicted "faster than A if that time is under
   ~45 ms"; with the cell's own theory (26–36 ms effective at 3 decoders, cell 1) that is a committed *B faster*, and
   the rule's outcome for C2 against A + B is not predicted. Write both outcomes; C1 has a measure and no rule, which
   is fine if said ("recorded, deciding nothing").
6. **The busy lever's thread** (*author*, one line in §10 item 5). The long tasks must run on the viewer document's
   own thread (a lab lever loaded through the viewer's lab gate, as the 11-11 beacon is), not in a runner page or a
   frame of another origin, or the page view is not busy. The dispatched steps are synthetic: DOM, "Dispatches a
   synthetic event event to target", with `isTrusted` false; no client code reads `isTrusted` (`git grep` at
   `e5b20cba`), so the viewer handles them as it would a press.
7. **P1's departure, now sourced** (*author*, replace "not sourced here"). Android's Direct Boot page: "Credential
   encrypted storage, which is the default storage location and only available after the user has unlocked the
   device", and it "is available after the user has successfully unlocked the device and until the user restarts the
   device". So P1 after a reboot needs the owner's unlock, as §4 says; the second sitting stands as a departure.
8. **Still not sourced** (*author*, kept flagged): that `logcat` names the codec component Android allocated, and that
   `adb shell` can read another app's `/proc/<pid>/stat` on this Android version. Both are checked in the dry run
   before the press, or the cell's record says *not read*.
9. **Arithmetic** (*author*, minor). §6's loads' own time sums to ~104 min and the gaps to ~36 min (144 starts × 15 s),
   ~2 h 20 min with the warm-ups, not 2 h 10 min. Cell 1's three Williams rows of an 8 × 8 square do not balance
   carry-over; say so or run the full square (8 rows, ~2 min more).

Nothing here asks the phone tooling for more than §10 already lists, except finding 1's `adb` setting (the laptop's
script) and finding 6's placement. Owner: finding 2's first-picture bound; PRs 376 and 378 in the run commit (§1).
