# The phone round of 2026-11-22, read

*PHONE-READ (`claude/work-ledger:docs/queue-client-2026-11-14.md`), 2026-11-22, by a session that wrote none of
[`next-round.md`](next-round.md), the tools or the run branch. Read from the raw rows only:
`raw/2026-11-22/` at `618dd9cd` (the round) and `raw/2026-11-22-cell3/` at `85326fd3` (cell 3 alone). Each cell is
read by `next-round.md` §4's rule and §7's limits, with its two pre-registered predictions beside it: the protocol's
(§4) and DEVICE-THEORY's (`claude/device-theory:docs/decode/mobile/device-model.md` §2 at `cf9f0b43`, pushed
2026-11-20 03:19 UTC). A prediction is* held *when the measured median is inside its band,* missed *otherwise.
Labels:* measured *(this round's rows),* derived *(arithmetic on them, written out),* theory*. Owner decisions last.*

## Fixtures and limits

One phone (Android 16, Chrome 157.0.8103.78, `hardwareConcurrency` 8, DEVICE-THEORY's 8 **held**; `deviceMemory` 8), on one home Wi-Fi in one
room (RSSI −29 dBm before the round and −22 after, −27 before the dry run: `round-wifi-*.txt`; `round-notes.txt`
calls the dry run's −27 the round's), through a repeater wired to the serving laptop (`round-notes.txt`), one
laptop serving, one evening. Two DBT volumes of one dataset: `dbts_b1` (50 frames) and `dbts_a1`'s cut (56), each as
the view (`-q8-g8`, AV1) and as its exact HTJ2K series. No breast ultrasound; no other phone, link or engine. Run
commit `3dbe295a3` (RUN_CODE `a8927df1`); which code each load ran: §Which code each load ran. Software decode throughout cells 1–2 (no AV1 component in any load's
`logcat`). The thermal status read 0 through load 28 and 1 from load 29 to the end (`resources.jsonl`). The server's
first and last byte were not recorded, so no load has a measured wire time; *G* below is a lower bound.

## The round as run

* **Cell 1**: 24 loads (8 arms × 3 repetitions) and the drift check's 4 (steps 0–3 of `plan-rest.json`, after cell 3
  had stopped): all `ok`.
* **Cell 2**: 4 warm-ups and 64 counted loads; 62 `ok`. **VOID by name**: load 28 (A, `dbts_b1`, "the runner's
  timers stopped 4636 ms") and load 29 (B, `dbts_b1`, 2041 ms), both in round 0. The renderer then held
  7.6 GB (RSS + swap) after load 28, grown from 1.1 GB over loads 22–28 of one origin (`resources.jsonl`): the
  stall is the memory pressure's, read from the rows, not traced.
* **Cell 3**: loads 92–95 sent their fill record and labels, never their end batch (no verdict); load 96's renderer
  died; loads 97–139 were not run. Run again alone the same evening (PHONE-ROUND-3C): its two loads (0 and 1) in a
  fresh Chrome lost the end batch too. **Not decided**: 0 pairs of the 16 the rule needs. Run again with the beacon fix
  (PHONE-ROUND-3D, 48 loads): read in §Cell 3.
* **Cell 4**: one row (`probe/rows/`, quick mode). **Cell 5**, the report cells and M1–M22 were not in the run
  commit (`SATURDAY.md`) and did not run.

## Which code each load ran

*PHONE-READ-CODE-CHECK, 2026-11-23, by a session that wrote none of this file, the tools or the run branch. Owed
because Chrome's HTTP cache served older lab code than the served tree in PHONE-ROUND-3D, and `round.py`'s `HEAD`
check reaches the server, not the page. Read from `raw/2026-11-22/round/beacon{,-rest}.jsonl` at `618dd9cd` and
`raw/2026-11-22-cell3/cell3-run/beacon-cell3.jsonl` at `85326fd3`, against the 2026-11-11 round's run commit
`962226e8`.*

**Every load ran code newer than the 11-11 round's, and none is set apart.** 101 loads of the round (steps 0–96 and
the rest plan's 140–143) and PHONE-ROUND-3C's 2 each carry all four markers that apply to them; no result above
changes (*measured*). The markers are fields that only the named commit's code writes:

| marker | written by, from | loads that carry it |
| --- | --- | --- |
| `decoders` and `cores` on every record | `round-page.js` and `beacon.js`, `def86ef44` (11-18), each file's last change before `3dbe295a3` | 103 of 103 |
| each frame's `route` (the 11-11 code names it `path`), in `bench`, `load` and `exactFill` frames | `decoder.js`, `htj2k.js`, `av1.js` and, for `load` frames, `controller.js`'s `about()`, `a5c086a4e` (11-12) | 103 of 103 that have frames |
| each `bench` frame's `start` | `bench.js`, `4a3606285` (11-18), its last change | 28 of 28 cell-1 loads |
| a `lossless` record on every C1 load | `round.mjs`, `95f7d3709` (11-18), its last change | 16 of 16 |

So `beacon.js`, `round-page.js`, `bench.js` and `round.mjs` ran exactly as at `3dbe295a3`. `decoder.js`, `htj2k.js`,
`av1.js` and `controller.js` ran code from `a5c086a4e` or later, and `lab/viewer/levers.js` code from `4e15708be`
(11-15) or later, since every record has its `step` and `cell`. None of these is the 11-11 code, though the rows
cannot tell those versions from later ones. *Derived* from the page's module graph at `3dbe295a3` (40 files, from
`client/viewer/index.html` through every import and worker): 22 differ from `962226e8` and 7 are new. Of these 29,
9 are covered above. `check-page.js` and `check-view.js` run only under `?check`, which the round did not use. The
other 18 leave no field in the rows, so their version is **not established**: `viewer.js`, `head.js`, `screen.js`,
`pair.js`, `client/viewer/store.js` (removed since, `1dd8e78b2`), `view.js`, `view-worker.js`, `cache.js`, `painter.js`, `paint-worker.js`,
`voi.js`, `consumer.js`, `downloader.js`, `ts/dist/session.js`, `av1-webcodecs.js`, `av1-frame.js`, `av1-payload.js`
and `lab/viewer/hooks.js`. `index.html` and the JSON files cannot be stale: the dev
server sends `Cache-Control: no-cache` for `text/html` and `application/json` (`server/dev-server.py` at
`3dbe295a3`, `REVALIDATED`). JavaScript gets no such header.

Check, repeatable from the rows: each marker is tested per load id; four mutants of the rows (one load's `route`
renamed `path`; one load's `decoders` removed; one bench load's `start` removed; C1's `lossless` records dropped) each
fail the check. Limits: one phone, one evening's loads; a marker shows that a module's code ran at or after its
commit, not that every module did.

## Cell 1 · decode per frame (`dbts_b1`, 50 frames in memory)

Per arm, the three repetitions (median of the 50 frames' own times; effective = span ÷ 50), *measured*:

| arm | a frame, per decoder (ms) | effective (ms) | protocol | DEVICE-THEORY |
| --- | --- | --- | --- | --- |
| HTJ2K × 1 | 40.8, 40.4, 40.2 | 41.9, 41.1, 41.0 | — | 37–59 / 37–59: **held** |
| HTJ2K × 2 | 42.0, 41.6, 42.1 | 25.5, 25.5, 25.4 | — | 41–64 / 20–32: **held** |
| HTJ2K × 3 | 58.9, 58.3, 59.4 | 18.9, 18.8, 19.0 | 76–107 / 26–36: **missed** (faster) | 43–66 / 14–22: **held** |
| HTJ2K × 4 | 60.4, 60.7, 60.7 | 15.5, 15.5, 15.4 | — | 43–67 / 11–17: **held** |
| view × 1 | 180.8, 171.5, 176.7 | 185.5, 178.3, 181.0 | — | 85–125 / 85–125: **missed** (slower) |
| view × 2 | 123.4, 135.4, 115.1 | 65.5, 75.1, 69.8 | — | 104–136 held / 52–68: **missed** (69.8) |
| view × 3 | 115.1, 110.2, 108.9 | 46.3, 42.1, 40.2 | 133–135 / ~45: per frame **missed** (faster), effective held | 125–145 **missed** / 42–48 held |
| view × 4 | 118.8, 117.6, 119.9 | 37.8, 46.2, 50.8 | — | 140–175 **missed** / 35–44: **missed** (46.2) |

* **Saturation** (the smallest count within 10 % of the next, on the repetitions' median): HTJ2K none within four
  (25.5 → 18.9 is −26 %, 18.9 → 15.5 −18 %; *derived*), as DEVICE-THEORY predicted (**held**); its gains of 29–33 %
  and 22–25 % for those steps **missed** (25.7 % and 18.1 %). The view saturates at **3**: its fourth decoder is slower, 42.1 → 46.2 ms (+10 %),
  where DEVICE-THEORY predicted a gain of 8–17 % (**missed**; "3 or none" **held**).
* **The ratio** the view ÷ HTJ2K a frame per decoder at three decoders: 110.2 ÷ 58.9 = **1.87** (*derived*), against
  DEVICE-THEORY's 2.0–3.1 (**missed**, just below) and the cloud's 1.24–1.74 the protocol carried. Effective,
  42.1 ÷ 18.9 = 2.23.
* **The refutation line**: HTJ2K effective at three decoders over 26 ms would refute the model. It is 18.9 ms: the
  model stands and the protocol's carry of the cloud ratio does not. **The number LINK-TARGETS owes: 18.9 ms**
  (`dbts_b1`, three decoders, this phone).
* **Drift**: the end's arms against the start's (first repetition): HTJ2K × 1 41.9 → 43.6 (+4 %), × 3 18.9 → 19.9
  (+5 %), view × 1 185.5 → 183.0 (−1 %), view × 3 46.3 → 45.2 (−2 %): under 15 %, **no thermal drift** (both held).
  The end's arms ran after cell 3's renderer had died, in a fresh one.
* **Not explained**: one view decoder takes ~176 ms a frame, three take ~110 ms each. A single decoder's frames are
  slower than any of three decoders' frames. *Hypotheses, not checked*: the scheduler keeps a lone decoder's threads
  off the prime core, or its clocks low (DVFS) under a lighter load; `optimizeForLatency` serialising one decoder.
  It is where the model's single-decoder band fails, and M12/M13 would read it.
* **Route**: no AV1 or HTJ2K codec component in any load's `logcat` (only `c2.qti.vp9.decoder`, in loads 0, 81, 82,
  84–87, 92 and 95 and before the round, and audio decoders: from outside the page, not checked); the decode is software in
  Chrome's process, as the bench records (`av1-webcodecs`, `htj2k`).

## Cell 2 · the delivery arms (three decoders, the product's default)

Fill = the beacon's `fillMs`; floor = the sum of the frames' decode times ÷ 3; rest = fill − floor. Medians over the
`ok` loads (`dbts_b1`: 7 of A and B, 8 of C1 and C2; `dbts_a1`: 8 each), *measured* and *derived*:

| | `dbts_b1-q8-g8` | `dbts_a1-q8-g8-cut` |
| --- | --- | --- |
| A, fill | **3.68 s** (3.15–4.42) | **1.20 s** (1.13–1.46) |
| A, rest | 0.25 s | 0.28 s |
| B, fill | **1.74 s** (1.51–2.54) | **0.96 s** (0.91–1.03) |
| B, floor; rest | 1.29 s; 0.45 s (0.28–1.46) | 0.62 s; 0.34 s |
| C1, exact-frame latency (the press to *✓ Lossless*) | **216.5 ms** (203–269) | **126.5 ms** (101–152) |
| C2, the view's fill + the exact series' span | 3.34 + 1.86 s | 1.36 + 1.02 s |
| C2, the gap: the exact series asked after the view's fill ended (`issuedAt − fillTo`) | 1.20–1.65 s | 0.36–0.59 s |

**The rule (pooled, pre-registered).** With round 0 VOID, 15 ratios a measure (`next-round.md` §4 fixes 13 of 16;
at 15 the sign test's two-sided p < 0.05 needs 12, a threshold chosen here after the data, though at 15 of 15 no
threshold matters):

| measure | `dbts_b1` | `dbts_a1` | pooled | verdict |
| --- | --- | --- | --- | --- |
| B ÷ A | 7 of 7 below 1, median 0.513 | 8 of 8, median 0.771 | **15 of 15**, p = 2⁻¹⁴ ≈ 0.00006, median **0.705** | **B faster** |
| C2 ÷ (A + B), summed (the view's fill + the span) | 4 of 7, median 0.985 | 2 of 8, median 1.033 | 6 of 15, p = 0.61, median 1.031 | **no difference shown** |
| C2 ÷ (A + B), end to end (`fillFrom` to the last exact frame) | 6 of 7 above 1, median 1.270 | 8 of 8 above 1, median 1.226 | 14 of 15 above 1, p ≈ 0.001, median **1.236** | **C2 slower** |

The ratios: B ÷ A 0.513, 0.689, 0.475, 0.526, 0.439, 0.456, 0.618 (`dbts_b1`) and 0.845, 0.766, 0.875, 0.833, 0.777,
0.722, 0.705, 0.712 (`dbts_a1`). Amendment 11: round 0's VOID pair, were it counted, gives B ÷ A 0.382 and
C2 ÷ (A + B) 0.592 (summed); neither verdict moves.

**C2's two readings** (*measured*, *derived*). The protocol assumed "C2's second fill starts at the first's end"; on
the phone the exact series was asked 0.36–1.65 s after the view's fill ended (the table's gap). The gap is the
harness's: `lab/devices/round-page.js` (at `3dbe295a3`) awaits `finished(ledger)`, the fault hook and two metadata
fetches before `exactFill` stamps `issuedAt` (not traced further). The summed reading leaves the gap out, as the
protocol's record ("C2: the second fill's span") does, and shows no difference; end to end, with the gap, C2 is
slower than A + B. The *no difference* verdict holds for the summed reading only: the delivery page must not read
"C2 ≈ A + B" as an end-to-end result of this harness.

**Against the predictions.**

| line | protocol | DEVICE-THEORY | measured |
| --- | --- | --- | --- |
| A, `dbts_b1` fill | 2.47–2.6 s **missed** | 2.4–3.3 s **missed** | 3.68 s, slower |
| A, `dbts_a1` fill | — | 0.79–1.21 s **held** | 1.20 s |
| B, `dbts_b1` decode floor | 1.3–1.8 s **missed** (1.29) | 0.71–1.10 s **missed** | 1.29 s |
| B, `dbts_a1` floor | — | 0.27–0.43 s **missed** | 0.62 s |
| B, fill | — | 1.65–1.78 **held**; 1.13–1.25 s **missed** | 1.74; 0.96 s |
| B ÷ A, `dbts_b1` | — | 0.50–0.74, 8 of 8 **held** | 0.513, 7 of 7 |
| B ÷ A, `dbts_a1` | — | 0.93–1.58, 0–2 of 8 **missed** | 0.771, 8 of 8 |
| B ÷ A, pooled median | — | 0.72–1.16 **missed** | 0.705 |
| B against A, pooled | *B faster* **held** | *no difference shown*, 8–10 of 16 **missed** | *B faster*, 15 of 15 |
| B, regime | wire-bound: **not read** | wire-bound: **not read** | no wire time recorded |
| C2 against A + B | *no difference*: **held** summed, **missed** end to end | *no difference*: **held** summed, **missed** end to end | *no difference shown* summed; *C2 slower* end to end |
| C1's exact-frame latency, `dbts_b1` | ~0.04 s + one HTJ2K decode (no band) | 80–130 ms **missed** | 216.5 ms |

* **Where the model missed** (*derived*): A on `dbts_a1` over A on `dbts_b1` is 1.20 ÷ 3.68 = 0.33 measured, where the
  model carried the cloud's work ratio 0.247 (and on 11-11's `dbts_b1` fill, 2.4–3.3 s, not this evening's 3.68 s).
  With A on `dbts_a1` at 1.2 s, B wins there once its wire is under ~0.9 s: 542.5 Mbit ÷ (1.20 − 0.29) s ≈ 596 Mbit/s
  (631 with B's measured rest on `dbts_a1`, 0.34 s), which this link gave. The model's threshold of 760–800 Mbit/s assumed A's middle, 1.0 s.
* **In a fill HTJ2K decodes slower than in memory**: B's frames take 52–114 ms (medians a load) on `dbts_b1` against
  the bench's 58.9 ms, and the floor is 1.29 s against 50 × 18.9 = 0.95 s. *Hypothesis, not checked*: the receive
  path and the page share the cores with the decoders.
* **The link, a lower bound** (*derived*): the whole exact series arrived within B's fastest fills, so the goodput
  over the fill was at least 859.3 Mbit ÷ 1.512 s = 568 Mbit/s (`dbts_b1`) and 542.5 ÷ 0.912 = 595 Mbit/s (`dbts_a1`).
* **Regime**: A's rest, 0.25–0.28 s, is inside the 0.22–0.35 s band: decode-bound, as predicted. B's rest on
  `dbts_b1` is 0.45 s (0.28–1.46): something past the floor binds, the wire or the receive path; which is *not read*
  (no wire time).
* **Saturation**: on the loads whose processes were read before and after, Chrome's CPU summed to at most 2.73 of the
  8 cores over the span of the stat reads (load 85), 3.32 over the load's opened → ended (load 42) (*derived* from `/proc/<pid>/stat`, `utime + stime`, assuming 100 ticks a
  second); the renderer is often a new process within a load, so the sum is partial. No fill shown saturated.
* **A grows over the round**: `dbts_b1`'s A fills were 2.27–3.74 s in the warm-ups and 3.15–4.42 s counted, with the
  renderer's memory carried between same-origin loads (MEMORY-LEAK-TRACE). The B ÷ A ratios are within a round, so
  they pair loads of like state; A's absolute fill is this evening's, not the product's floor.

§7: this decides the arms' order on this one link (a best case of the target), not on LTE, 5G or enterprise Wi-Fi.

## Cell 3 · the view comparison

*As first read (PHONE-READ): not decided, since no load of the round (92–95) or of PHONE-ROUND-3C sent its end batch.
That reading stands for those rows. Cell 3 was then run again alone, PHONE-ROUND-3D (below).*

*PHONE-READ-3D (`claude/work-ledger:docs/queue-2026-11-14.md` amendment 28), 2026-11-23, by a session that wrote
none of `next-round.md`, the tools or the run. Read from the raw rows only: `raw/2026-11-22-cell3d/round3d/` at
`f96e38a9` (`beacon-cell3.jsonl` steps 0–15 = plan loads 0–15, `beacon-cell3-rest.jsonl` steps 0–31 = loads 16–47,
`plan-cell3*.json`, `relaunch-cell3*.jsonl`, `resources-cell3*.jsonl`); incidents from
`claude/work-ledger:docs/queue/PHONE-ROUND-3D.md`. Read with short scripts over those files, the way PHONE-READ and
its review read the round. Labels as above. The aborted starts (`aborted-start*/`) and their 500 `TEST-curl`
records are not data and are not read.*

**Which code each load ran** (*measured*). Each of the 48 loads has exactly one `drain` record, and every one has
`path: "post"`. Only the fixed beacon (`f5252051`) writes that record. No load is without it, so all 48 ran the fixed
code and none is set apart. `plan-cell3-rest.json` equals the last 32 loads of `plan-cell3.json` (URLs aside). Both
carry commit `f5252051`. Every load ended `ok`, its largest ticker gap was at most 1.47 s (under the 2 s VOID bar) and
it received 50 of 50 frames, all `av1-webcodecs`, with no errors. One load id per step.

**The loads** (*measured*). 48 loads in 24 ABBA pairs (page, worker, worker, page, …), all `dbts_b1-q8-g8` and
`cubic-restart`. Each load had 20 steps idle and 20 busy, 100 frames due in each cine half, and one exact frame idle
and one busy. 24 pairs, so the rule's threshold is **18 of 24**. Thermal status read 0 in all 50 resource snapshots.
48 relaunches, one before each load.

**Reductions** (*derived*). Per load: frame-change is the median of the 20 steps' `ms` (from due to the paint). Cine
drops are `due − painted`, floored at 0, because the worker painted 101 of 100 in 7 halves, a window-edge frame. Exact
frame is the record's `ms`. The fill is `fillMs`. The rows hold no first-picture field. The first picture is
therefore read as the first quality label minus the page's first record (the wake lock at script start), which takes
in the view worker's start. A second reading, from the dial, leaves that start out and is shown beside it.

Each pair gives a ratio, worker ÷ page. For cine, a page with 0 drops and a worker with 0 drops counts as a tie at 1.
The intervals are for the median paired difference (worker − page): order statistics 7 and 18 of 24, distribution
free, 97.7 % coverage.

| measure | below 1 / above / ties | median ratio | median page · worker | difference (w − p), 97.7 % | rule | protocol's prediction |
| --- | --- | ---: | --- | --- | --- | --- |
| frame-change, idle | 10 / 14 / 0 | 1.010 | 10.5 · 10.7 ms | +0.1 [−0.1, +0.3] ms | no difference shown | no difference: **held** |
| **frame-change, busy** | 10 / 14 / 0 | 1.038 | 11.4 · 13.3 ms | +0.4 [−1.0, +3.7] ms | **no difference shown** | worker faster: **missed** |
| cine drops, idle | 0 / 0 / 24 | 1 | 0 · 0 of 100 | 0 [0, 0] | no difference shown | no difference: **held** |
| **cine drops, busy** | **24 / 0 / 0** (p = 2⁻²³ ≈ 1.2 × 10⁻⁷) | 0 | 7 · 0 of 100 | −7 [−11, −5] frames | **worker faster** | worker faster: **held** |
| exact frame, idle | 14 / 10 / 0 | 0.990 | 201.3 · 196.4 ms | −2.0 [−12.3, +10.6] ms | no difference shown | equal: **held** |
| exact frame, busy | 12 / 12 / 0 | 1.000 | 120.1 · 120.6 ms | +0.1 [−5.1, +10.1] ms | no difference shown | equal: **held** |
| fill (guard) | 16 / 8 / 0 | 0.988 | 2206 · 2146 ms | −28 [−121, +45] ms | no difference shown | no difference: **held** |
| first picture from page start (guard) | 7 / 17 / 0 | 1.021 | 413.1 · 425.5 ms | +8.6 [−4.2, +27.1] ms | no difference shown | page faster by < 52 ms: **missed** |
| first picture from the dial | 15 / 9 / 0 | 0.970 | 363.1 · 352.2 ms | −11.7 [−17.9, +7.1] ms | no difference shown | (not the guard's reading) |

**Verdict, by §4's rule** (*measured*, the rule applied):

* **Cine with the page's thread busy: worker faster.** 24 of 24 pairs below 1, against the 18 needed (p ≈ 1.2 × 10⁻⁷).
  The median ratio is 0, which is ≤ 0.95. The worker dropped no frame in any busy cine half. The page dropped a median
  of 7 of 100 (1–16 across its 24 loads). The paired difference is −7 frames of 100 [−11, −5], with 97.7 % coverage.
* **Frame-change with the page's thread busy: no difference shown.** 10 of 24 pairs below 1, and the median ratio is
  1.038. Both views wait for the long task in progress before the input: 114 of the page's 480 busy steps and 129 of
  the worker's took over 50 ms. The worker never saved the second task the theory gave it.
* **Guards: the worker is not worse.** The page-faster rule passes on neither the fill nor the first picture (17 of 24
  above 1 against 18, with a median ratio of 1.021). Under form (a), the owner's (`SATURDAY.md`), the 52 ms bound is
  therefore not reached. The +8.6 ms median [−4.2, +27.1] is reported beside it. Form (b) would not reject the worker
  either. **The guard is an *assumption*.** Its 52 ms is a cloud number carried to a phone, and the first-picture
  reading is this read's choice, since the protocol names no record for it. The verdict does not turn on the guard:
  no reading of it passes the page-faster rule.
* **Everything else: no difference shown.** That covers idle frame-change, idle cine, the exact frame idle and busy,
  and the fill. Memory and hops were not read; by §4 they decide nothing.

**Against the predictions.** The protocol's held on six lines and missed on two. Frame-change busy was predicted
*worker faster* and came out *no difference shown*. The first picture was predicted *page faster* and came out *no
difference shown*. DEVICE-THEORY's §2 (`device-model.md` at `cf9f0b43`) "adds nothing to the protocol's predictions"
for cell 3. It has no line to hold or miss.

**What limits it** (deviations, from `PHONE-ROUND-3D.md` and the rows):

1. **A fresh Chrome before every load** (48 relaunches: force-stop, relaunch on `/next?after=k`). The protocol's round
   ran loads in one Chrome. Every load here starts from a new renderer (~1.5 GB, per PHONE-ROUND-3D), so this
   reads the views with no state carried between loads. That is the same for both arms, but not the main round's
   condition.
2. **RUN_CODE moved for cell 3 only.** The run code is the lab-only `f5252051` (the drain POSTs the last batch).
   PHONE-ROUND-3D found the plan regenerated there equal to the round's in every load, gap, fill, after, budget and
   server. No product code changed, but the run is not at the round's run commit.
3. **The restart at K=16, the cell budget from zero.** adb dropped after step 15. The rest (loads 16–47) ran as a
   second run with its own plan. The pairs are not split: pair 7 ends at load 15 and pair 8 starts at load 16. The
   budget stops only loads not started, and none was stopped.
4. **The blank tab from step 16.** From load 16, each relaunch blanked the tab 1.5 s before the force-stop. The
   relaunch records show `stopAt − quietAt` ≈ 1.6 s in the rest, against ≈ 2 ms before. That changes what precedes
   a load, not the load itself, and it falls on both arms alike (pairs 8–23). It was not read pair by pair against
   pairs 0–7.
5. DevTools was attached to load 0 of the counted run, to check the code (PHONE-ROUND-3D item 5). That load is page
   view, pair 0, and it is kept.
6. The phone was held awake with `stay_on` 7 between runs. The cache was cleared once (`Network.clearBrowserCache`)
   before the counted run.

**Fixtures and limits.** One phone (Android 16, `hardwareConcurrency` 8; Chrome's version is not in these rows, and
the main round's was 157 the same evening). One home Wi-Fi, 5 GHz 11ac, RSSI −31 dBm before and −28 after
(`cell3d-wifi-*.txt`). One laptop serving, one evening. One series, `dbts_b1-q8-g8` (50 AV1 frames, software decode
unless the rows say otherwise; no `logcat` was read here). A synthetic busy page (100 ms of work every 250 ms) and
dispatched key presses, not a reader's input. Thermal status was 0 throughout. The host's saturation was not
measured, and no laptop CPU was read. §7: this decides the views on this phone with a synthetic busy page, not with a
real reader's input or a real page's work.

**For the owner.** The worker view won on the measure where a reader sees a difference. With the page's thread busy,
cine in the worker view painted every frame due, in all 24 pairs. The page view dropped a median of 7 frames in 100
(between 5 and 11 more than the worker, at 97.7 %). Moving through frames with a busy page was a tie, around 11–13
ms in both views. So was everything else: idle use, the exact frame, the fill and the first picture. The guard
against a slower start did not bind, but its 52 ms bound is an assumption. This holds for one phone on a fast home
Wi-Fi, one 50-frame AV1 series, one evening, with a fresh Chrome before every load and a synthetic busy page. Another
phone, link or real page workload is untested.

### Cell 3 review

*PHONE-READ-3D-REVIEW, 2026-11-23, by a session that wrote none of this file, `next-round.md`, the tools, the run or
PHONE-READ-3D. Every number of §Cell 3 recomputed from `raw/2026-11-22-cell3d/round3d/` at `f96e38a9` with one short
script over `beacon-cell3*.jsonl`, `relaunch-cell3*.jsonl`, `resources-cell3*.jsonl` and `plan-cell3*.json`; the
rule checked against `next-round.md` §4 cell 3; `device-model.md` §2 read at `cf9f0b43`; the reductions checked
against `lab/devices/round-page.js` at `f5252051` (line 98: a step's `ms` is `painted − due`). Labels as above.
Fixtures and limits: the read's, as its §Fixtures and limits states; this review measured nothing.*

**Verdict: no blocker.** Every cell of the table reproduces to its printed digit: the counts below / above / ties,
the median ratios, the medians per view, the paired differences and their intervals (order statistics 7 and 18 of
24; coverage 1 − 2·P(Bin(24, ½) ≤ 6) = 97.73 %, *derived*), and p = 2·2⁻²⁴ = 2⁻²³ ≈ 1.19 × 10⁻⁷ for 24 of 24. So do
the code check (48 loads, one `drain` each, path `post`; one load id per step), 48 `ok` verdicts with the largest
gap 1 467 ms, 50 of 50 frames `av1-webcodecs` and no error in every load, 20 + 20 steps and 100 + 100 frames due per
load, 7 halves where the worker painted 101 of 100, 114 of 480 and 129 of 480 busy steps over 50 ms, the page's busy
drops 1–16, the first record being the wake lock in all 48 loads, thermal status 0 in all 50 snapshots, both plans at
`f5252051` with the rest's 32 loads equal to the last 32 of `plan-cell3.json` (every field, URLs included),
`stopAt − quietAt` 1–2 ms in the first run and 1 586–1 617 ms in the rest, and the Wi-Fi lines (5 GHz, 11ac, RSSI
−31 and −28). The verdicts follow from §4's rule at 24 pairs (threshold 18). The DEVICE-THEORY quote holds: "this
model adds nothing to the protocol's predictions".

* **m1. The relaunches are after each load, not before.** Each record carries `after: k`, 0–15 and 0–31: 48
  relaunches, one after every load, so loads 1–15 and 17–47 start in a fresh Chrome, and loads 0 and 16 open their
  runs with no relaunch record of their run before them (load 0 with DevTools attached and the cache cleared; load 16
  after run one's relaunch past load 15, then adb's drop and the restart, so its start state is not in the rows). The
  blank tab likewise precedes loads 17–47, not 16, so pair 8 is mixed (its page load 16 without, its worker load 17
  with), and "both arms alike" holds for pairs 9–23. Deviations 1 and 4 and the fixtures line want that wording. No
  verdict moves: without pairs 0 and 8 (22 pairs, threshold 17), busy cine is 22 of 22, *worker faster*; every other
  measure, both guards included, stays *no difference shown* (*derived*).
* **m2. §Against the predictions reads the rule's prediction line only.** The theory table's rows can be set
  against too: (a) busy frame-change, "worker lower by ~one long task in some steps": *missed* (the worker's steps
  over 50 ms are 129 to the page's 114, and its median is higher); (b) the first picture, "worker later by ≥ 16.7
  ms": +8.6 [−4.2, +27.1] ms neither shows nor excludes it, *not decided*. One line each.
* **m3. Deviation 4, read pair by pair** (here, post hoc, deciding nothing; *derived*). Pairs 0–7 against 8–23,
  median paired difference: first picture +26.0 against +5.8 ms (1 of 8 below 1 against 6 of 16), busy cine −7.5
  against −6.5 frames, fill −81 against −13 ms, busy frame-change −0.4 against +1.3 ms. Eight pairs are under the
  rule's 16, so nothing is decided by them; but the guard's "not binding" rests mostly on pairs 8–23, read after
  the blank tab and the restart. Say so beside deviation 4, and let PHONE-ROUND-2 run its cell 3 under one condition
  throughout.
* **n1.** "The worker never saved the second task the theory gave it" is an aggregate: 10 of 24 pairs are below 1.
  "did not, in the median or in the steps over 50 ms" says what was measured.
* **n2.** The fill is read from `fillMs` (the dial to the last frame); `statusFillMs` gives 15 / 9 / 0, ratio
  0.997, the same verdict. Name the field in §Reductions.

VIEW-PAGE may use §Cell 3 as read: the busy-cine verdict holds on every subset tried here; the first-picture guard
stays an *assumption*, now with m3 beside it.

## Cell 4 · the hardware-decode probe (exploratory, deciding nothing)

*Measured*, one row; the forms of `claude/hw-decode:docs/decode/hardware.md` §17 at 16 × 16 and 256 × 256:

| form | `no-preference` / `prefer-software` | `prefer-hardware`, 16 × 16 | `prefer-hardware`, 256 × 256 |
| --- | --- | --- | --- |
| `g8`, `g10` (4:0:0) | a frame, `I420` / `I420P10`, exact | unsupported (`OperationError`) | supported, decode fails: `EncodingError` "Error during flush." |
| `g8f` (8-bit, full range) | exact | unsupported | a frame, `RGBA`; R, G and B each equal the luma, 256 distinct, exact |
| `g10f`, `ramp10` (10-bit, full range) | exact | unsupported (`ramp10` has no 16 × 16 unit) | a frame, `RGBA`, 8 bits: off by one on 19 480–45 706 of 65 536 samples a channel through `copyTo` with a format (`g10f` R and B 45 706, G 19 480; `ramp10` R and B 40 192, G 24 960), 20 905–49 002 through the default `copyTo` |

* `logcat` names `c2.qti.av1.decoder` (302 lines) during the probe: the hardware decoder was allocated.
* `ramp10` painted: WebGL2 `RGBA16F` **1024 distinct** values (`g10f` 1021), 0 of 65 536 exact, max difference 2.61
  codes; WebGL2 `RGBA32F`, the same frames, 255 (896 exact, max 4.53); WebGPU 261 (3 968 exact, max 4.33). More than
  256 values reached a WebGL2 shader from a hardware frame on the `RGBA16F` upload only. The 8-bit `g8f` frame painted
  exact on both APIs (65 536 of 65 536).
* §17's predictions: `g8f` and `g10f` decode in hardware **held**; "come back `BGRX`" **missed** (`RGBA`; `copyTo`
  gives `RGBA`, `RGBX`, `BGRA`, `BGRX` alike); `g8`, `g10` unknown → they fail at flush; `ramp10` "at most 256 values
  on both APIs" **missed** (WebGL2 `RGBA16F` 1024, WebGPU 261; `RGBA32F` 255). The 16 × 16 refusal matches the codec list's minimum, 96 × 96.
* DEVICE-THEORY's "a hardware AV1 decoder is listed" **held**: `codecs.xml`'s sections from lines 1325 and 1838
  list `c2.qti.av1.decoder`, size
  96 × 96 to 8192 × 8192, 138 240 blocks, 7 776 000 blocks a second, performance points to 7680 × 4320 at 60.
  `dbts_b1`'s 2560 × 3328 is 33 280 blocks: inside the declared limits (declared, not decoded at that size).
* WebGPU: an adapter (`adreno-7xx`), `subgroups` and `shader-f16` among its features; limits not recorded.

## The decode-option asks M1–M22

Written into each option file's phone section on `claude/mobile-decode` (PR 397). None ran as asked; what the round
measured toward each:

| ask | measured this round |
| --- | --- |
| M1, M5 (forms and sizes through `prefer-hardware`) | only cell 4's 256 × 256 units; not at a volume's size, not HEVC, VP9 or H.264 |
| M2, M3, M6, M7 (the picture one-to-one; a frame inverted and checked) | not run; cell 4: an 8-bit full-range grey frame came back as `RGBA` equal to its luma at 256 × 256 |
| M4 (codec lists and sizes) | the list read (`probe-shell/codecs.xml`, several `media_codecs*.xml` files concatenated without their names). The device's live list (`probe-shell/media.player.txt`, lines 70–75) names `c2.qti.av1.decoder`; the two sections that list it (from lines 1325 and 1838) declare AV1 `c2.qti.av1.decoder` and HEVC `c2.qti.hevc.decoder` 96 × 96 to 8192 × 8192 (36–138 240 blocks), VP9 `c2.qti.vp9.decoder` 96 × 96 to 4096 × 4096 (36–36 864): `dbts_b1`'s 2560 × 3328 (33 280 blocks) fits all three in either orientation (*derived*; declared, not decoded). That the device loads these sections is *inferred* from the live list, not read. The first section (lines 1–314), which lists no AV1 decoder, declares HEVC and VP9 to 4096 × 2176. Android's software AV1 to 1920 × 1080; the `getSupported…` calls not run. Next round: the shell read records each file's path |
| M8–M11, M13–M19, M21, M22 | not run |
| M12 (decoders to `hardwareConcurrency`) | `hardwareConcurrency` 8; cell 1 to four only: the view saturates at three |
| M20 (the WebGPU decoder) | the adapter and `subgroups` only; no decode |

## Octets (amendments 7, 11)

The 11-11 run's six-octet reading stays the reading of record. This round's rule counts time loads ran and stopped
no load: cell 2's budget was not reached, round 0's two VOID loads are reported above with the verdict unchanged by
them, and cell 3's lost loads ran but returned no measure.

## Owner decisions

1. **The delivery on fast Wi-Fi.** On this phone and link the exact series alone (B) filled faster than the view (A)
   in 15 of 15 rounds, median 0.705, on both volumes; DEVICE-THEORY predicted a tie. The question belongs to the
   delivery page (`delivery-per-link`): whether B is the route above a goodput this round bounds at ≥ 568–595 Mbit/s.
   A yes queues the per-link sweep `docs/client/design.md` §Open owes; a no keeps the view first everywhere. Nothing
   is decided here.
2. **The device model.** HTJ2K's bands held at every decoder count; the view's missed at one and four decoders, and
   the cell-2 outcome missed. Recalibrating the model's view (AV1) speed and its `dbts_a1` work ratio from this
   round is ROUTE-POLICY's input: the owner's yes is to the page that uses it, not here.
3. **Cell 3 is open.** The view comparison needs a round whose end batch arrives (BEACON-LOSS) and a fresh renderer
   per load (amendment 28 item 8); the guard form (a), 52 ms, stays as chosen.
   *Corrected 2026-11-23 (PHONE-READ-3D):* PHONE-ROUND-3D ran it, and §Cell 3 reads it. The worker view is faster on
   busy cine, 24 of 24 pairs. Busy frame-change shows no difference, and guard (a) does not bind. Choosing the view
   is VIEW-PAGE's to put to the owner, not this file's.

## Review

*PHONE-READ-REVIEW, 2026-11-22, by a session that wrote none of this file, `next-round.md`, the tools or the run
branch. Every number above recomputed from the raw rows (`raw/2026-11-22/` at `618dd9cd`, `raw/2026-11-22-cell3/`
at `85326fd3`) with short scripts over `beacon.jsonl`, `beacon-rest.jsonl`, `resources.jsonl`, `out/adb/`,
`probe/rows/`, `probe-shell/`; the bands checked against `next-round.md` §4 and `device-model.md` §2 at `cf9f0b43`
(committed 2026-11-20 03:19:46 UTC). Labels as above. Fixtures and limits: the round's, as §Fixtures and limits
states; this review measured nothing.*

**Verdict: two blockers (B1, B2); amendment 17's fix loop.**

**Recomputed and matching** (*derived*): cell 1's 24 + 4 benches (per-decoder medians, effective times, the
repetitions' medians 41.1, 25.5, 18.9, 15.5 and 181.0, 69.8, 42.1, 46.1 ms; steps −38.0, −25.7, −18.1 % and
−61.5, −39.6, +9.5 %; the ratios 1.87 and 2.23; the drift); every cell-1 held/missed against both sources; cell 2's
fills, ranges, floors (Σ `decodeMs` ÷ 3), rests, B's 52–114 ms frame medians, all 30 within-round ratios, the counts
15 of 15 and 6 of 15, p = 2⁻¹⁴ and 0.607, the medians 0.513, 0.771, 0.705, 0.985, 1.033, 1.031, round 0's 0.382 and
0.592; the goodput bounds 568 and 595 Mbit/s (859.3 and 542.5 Mbit; a valid lower bound, since `fillFrom` is the
downloader's dial, `lab/devices/beacon.js:26` at `3dbe295a3`); C1's 16 latencies; 96 verdicts, 2 VOID by name;
thermal 0 to load 28, 1 after; the renderer 1 070 → 7 580 MiB (RSS + swap) over loads 22–28; cell 4's forms,
outcomes and the AV1 decoder's declared limits; 33 280 blocks.

**B1 · M4's HEVC and VP9 limits are read from the wrong vendor file.** `probe-shell/codecs.xml` is several
`media_codecs*.xml` files concatenated, without their names. The HEVC and VP9 limits quoted (4096 × 2176) come
from the first (lines 1–314), which lists no AV1 decoder. The device's live list (`probe-shell/media.player.txt`,
lines 70–75) names `c2.qti.av1.decoder`. The two files that list it (from lines 1325 and 1838) declare
`c2.qti.hevc.decoder` 96 × 96 to 8192 × 8192 (block count 36–138 240) and `c2.qti.vp9.decoder` 96 × 96 to
4096 × 4096 (36–36 864). `dbts_b1`'s 2560 × 3328 (33 280 blocks) fits inside both, in either orientation
(*derived*; declared, not decoded). Which file the device loads is *inferred* from the live list, not read. So
"`dbts_b1` exceeds them in both orientations" is unsupported. It stands in §M4 here and in
`claude/mobile-decode:docs/decode/mobile/other-codecs.md` (`7b2e0013`), which MOBILE-DECODE-REJUDGE reads. Fix:
correct both in place, name the section the figures come from, and add an ask for the next round's shell read to
record each file's path.

**B2 · C2 leaves out a gap the protocol assumed was zero.** The prediction says "C2's second fill starts at the
first's end". On the phone, the exact series was asked 0.36–1.65 s after the view's fill ended (`issuedAt − fillTo`:
1.20–1.65 s on `dbts_b1`, 0.36–0.59 s on `dbts_a1`; *measured*). The gap is the harness's: `round-page.js` awaits
`finished(ledger)`, the fault hook and two metadata fetches before `exactFill` stamps `issuedAt`. Not traced
further. The read compares the view's fill + the span (the protocol's record, "C2: the second fill's span") with
A + B, and calls both predictions held. Measured end to end instead (`fillFrom` to the last exact frame),
C2 ÷ (A + B) is above 1 in 14 of 15, median 1.236, p ≈ 0.001: *C2 slower* by the same rule (*derived*). Fix: state
the gap and both readings. The held verdict belongs to the summed reading only, and the delivery page must not read
"C2 ≈ A + B" as an end-to-end result of this harness.

**Minor.**
* m1 · The 10-bit hardware frames' off-by-one counts are 19 480–45 706 of 65 536 a channel (`g10f`: R and B 45 706,
  G 19 480; `ramp10`: R and B 40 192, G 24 960), not "19–49 k". The same figure is in
  `claude/mobile-decode:docs/decode/mobile/hw-inverted.md`.
* m2 · Only WebGL2's `RGBA16F` target gave more than 256 values (`ramp10` 1024, `g10f` 1021; max difference 2.61).
  Its `RGBA32F` target, painting the same hardware frames, gave 255 (max difference 4.53). So "more than 256 values
  reached a WebGL2 shader" holds on one upload path, and the read should say both. Also missing: the 8-bit hardware
  frame painted exact on both APIs (`g8f`, 65 536 of 65 536).
* m3 · Chrome's CPU "at most 2.8 of the 8 cores" depends on which wall time is used. Over the span of the stat reads
  the maximum is 2.73 (load 85). Over the load's opened → ended it is 3.32 (load 42). Name the wall time; no load
  saturates on either.
* m4 · Some DEVICE-THEORY lines are not named held or missed. The pooled median 0.72–1.16 was *missed* (0.705).
  The HTJ2K gains 29–33 % and 22–25 % were *missed* (25.7 %, 18.1 %). B wire-bound is *not read* (no wire time).
  `hardwareConcurrency` 8 was *held*.
* m5 · The 15-ratio threshold (12) is not the pre-registered 13 of 16. Say that it was chosen after the data,
  although at 15 of 15 no threshold matters.

**Nits.** `logcat` has 302 lines naming `c2.qti.av1.decoder` (`grep -c`), not 292. `c2.qti.vp9.decoder` appears in
loads 0, 81, 82, 84–87, 92 and 95 (not 83). RSSI −27 dBm was read before the dry run; before the round it was −29,
after −22 (`round-wifi-*.txt`), and `round-notes.txt` mislabels it the same way. C1's medians are 216.5 and
126.5 ms (even counts), rounded in opposite directions. PHONE-ROUND-3C ran two loads (0 and 1), neither with an end
batch. "542.5 ÷ (1.20 − 0.29) ≈ 600" is 596; with B's measured rest on `dbts_a1` (0.34 s) it is 631.

Unchanged by any finding: B faster than A (15 of 15), cell 1's numbers and the 18.9 ms LINK-TARGETS owes, cell 3
not decided, the owner decisions as written.

## Fix

*PHONE-READ-FIX, 2026-11-22, by a session that wrote none of the read or its review. Each finding re-derived from
the raw rows above and corrected in place: B1 in the M4 row and cell 4's codec-list line; B2 as C2's gap row, the
end-to-end row of the rule and its paragraph, and the predictions table; m1–m5 and the nits where they stand. One
correction to the review: m1's 19 480–45 706 counts the `copyTo` calls that name a format; the default `copyTo`
(no format, `RGBA`) gives 20 905–49 002 (`g10f` R 38 407, G 20 905, B 49 002; `ramp10` 34 368, 25 920, 43 584),
so the read's 19–49 k was the range over both, and both are now stated. Also corrected under m2: "none exact" held
for `RGBA16F` only (`RGBA32F` 896, WebGPU 3 968 of 65 536 exact). `round-notes.txt` is a raw row and is left as
written. Docs only; nothing measured.*

## Re-review

*PHONE-READ-FIX-REVIEW, 2026-11-22, by a session that wrote none of the read, the review or the fix. Each blocker
re-derived from the raw rows (`raw/2026-11-22/` at `618dd9cd`) with short scripts; the fix's diff read in full
(`8fe185c7..e6fff19b` here, `7b2e0013..78f0a307` on `claude/mobile-decode`). Fixtures and limits: the round's, as
§Fixtures and limits states; this re-review measured nothing.*

**Verdict: both blockers closed; no blocker open.** MOBILE-DECODE-REJUDGE may run.

* **B1 closed.** `probe-shell/codecs.xml` holds 15 concatenated files (an `<?xml` header at lines 1, 315, …, 1325,
  1838, …). The sections from 1325 and 1838 list `c2.qti.av1.decoder` (lines 1604, 2117) and declare
  `c2.qti.hevc.decoder` `size` 96x96–8192x8192, `block-count` 36–138240 (1505, 2018) and `c2.qti.vp9.decoder`
  96x96–4096x4096, 36–36864 (1557, 2070); the first section (1–314) declares both 4096x2176, 36–34816 (144, 193). The
  two later sections that update these codecs (from 2313 and 2574, `update="true"`) carry only
  `measured-frame-rate` limits, no `size`. `media.player.txt` lines 70–75 name `c2.qti.av1.decoder`. 2560 × 3328 is
  160 × 208 = 33 280 blocks of 16 × 16, both sides ≤ 4096 (*derived*): the corrected line holds, here and in
  `other-codecs.md`; the inference is labelled and the next round's path ask is in the M4 row.
* **B2 closed.** Over the 15 counted rounds with A, B and C2 `ok` (round 0 of `dbts_b1` VOID): `issuedAt − fillTo`
  355–590 ms (`dbts_a1`) and 1 201–1 651 ms (`dbts_b1`); end to end (`fillFrom` to the last exact frame's `at`, equal
  to `issuedAt + spanMs`) over A + B, 8 of 8 and 6 of 7 above 1, medians 1.226 and 1.270, pooled 14 of 15, median
  1.236, two-sided sign test p = 0.0010; summed, medians 1.033, 0.985, 1.031, p = 0.607 (*derived*). The gap's cause
  as stated: `round-page.js` at `3dbe295a3` lines 49–55 await `finished(ledger)`, `fault()` and the metadata before
  `exactFill`, whose `issuedAt` (`bench.js` line 106) follows two more fetches. The held verdict is now confined to
  the summed reading, in the rule, its paragraph and the predictions table.
* **The fix's correction to m1 holds**: per channel, `copyTo` with a format gives 45 706 / 19 480 / 45 706 (`g10f`)
  and 40 192 / 24 960 / 40 192 (`ramp10`); without one 38 407 / 20 905 / 49 002 and 34 368 / 25 920 / 43 584. m2's
  paints match the probe row (`ramp10` `RGBA16F` 1 024 distinct, 0 exact, 2.61; `RGBA32F` 255, 896, 4.53; WebGPU 261,
  3 968, 4.33; `g8f` 65 536 exact on all three). m3–m5 and the nits are in place as the review worded them; m3's
  2.73 and 3.32 were not recomputed here.
* **Nothing else changed**: the diff touches only the findings' lines, §Fix and the line doc's entry.

**Nit (not a blocker).** The summed C2 row counts ratios *below* 1 ("4 of 7", "2 of 8", "6 of 15") without saying
so, beside the end-to-end row that counts *above* 1: read with the direction named, both are right.
