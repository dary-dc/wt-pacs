# Review: the phone round's one-press runner (PR 400)

*RUNNER-AUTO-REVIEW, 2026-11-15, by a session that wrote none of RUNNER-AUTO. Checked against
`claude/hw-probe` `af4b6aeb` .. `claude/phone-round` `f4ad195c`, against `claude/phone-protocol:docs/phone-rows/next-round.md`
§3 and §10 items 1–5. Nothing run on a phone.*

Fixtures and limits: one 4-core cloud host, headless Chromium (the gate's), loopback, software decode, `adb` a fake on
`PATH`; the round's own synthetic 10-bit pair (64 × 48, 20 frames, Q 8 G 8), nine loads. No phone, no real `adb`, no
`podman` image, no Wi-Fi, no hidden page or screen turned off, no renderer crash.

## What was run

* As committed: `round.test.mjs` 5/5, `beacon.test.mjs` 6/6, `round_test.py` 7 OK, `server/dev-server.test.py` 15 OK,
  `client/view/controller.test.mjs` 38/38, `scripts/check_lab_absent.sh` green, `scripts/comment_budget.sh` green,
  `lab/devices/round_headless.sh` (after `ingest/tools.sh` and the WASM build): every claim holds, 30 s.
* Sixteen mutants of my own on the unit-tested parts (`round.py`, `round.mjs`, `beacon.js`, `dev-server.py`), each
  run against its test and reverted: **15 killed** (reads after a load dropped; no restore of the stay-on setting; the
  commit check always passing; `rebootAfter` ignored; a repeated ask handed nothing; no SIGTERM handler; a second
  `adb start-server`; every process's stat read; the gap bar at ≥; a page error ignored; one series only; ABAB pairs;
  the gap from the first tick; a flush before the fill; the beacon endpoint without `--beacon`). **1 survived**: the
  gap's `sleep` moved from before `load opened` to after it (into the load), because `round_test.py` runs at
  `gapS: 0` (minor 4).
* Two fault injections, each reverted: a throw at the start of cell 3's sequence on load 7 of the headless plan
  (blocker 1), and a block whose server never answers in a three-block `round_test.py` rig (blocker 2).

## Blockers

1. **A throw or a hang after the fill stops the round, and that load gets no verdict.** `round-page.js`'s
   `finished()` clears the fill's timer (`clearTimeout(late)`) first, then awaits `finished(ledger)`,
   `losslessFailure`, `viewSequence` with no `catch` and no bound of its own (`worker.cine()` and `page.ledger()`
   are unbounded awaits). Injected `throw` on load 7: the page logs the error, never calls `leave()`, never asks
   `/next`; the headless run reports `every load has its verdict (ok ok failed stopped ok ok ok none none)` and 15
   claims fail; load 7's sequence records stay queued and are never sent, load 8 never opens. §3: "A failed load
   stops nothing: it is recorded with its reason and the runner takes the next". Fix: `leave()` on any rejection of
   the post-fill work with its message as the failure, and a deadline over the whole post-fill sequence (the fill's
   timer replaced, not cleared). A headless test with the throw and one with a hang, each mutated.
2. **A block whose server never answers ends the round, and asking again reboots the phone again.** `Round.enter()`
   raises after `wait_answer`'s 60 s; the handler answers 500 "the round stopped"; the phone's tab stays there. In the
   rig: `after 0: 500 the round stopped: no answer from http://127.0.0.1:…/ in 60 s`, and a second ask repeats it with
   the events `load ended, reboot, host failed, load ended, reboot, host failed`: `next_k` is not advanced on the
   failure, so the after-reads and `adb reboot` run once per ask. The block's loads and every later block's are never
   run nor recorded. Fix: a block that cannot start is recorded (`host failed`, the reason) with each of its loads as
   failed by name, and the round goes on to the next block; the end-of-load reads and a reboot happen once per load
   and block whatever follows. A `round_test.py` case for each, mutated.
3. **§3's stopping rule is not built, and not listed as not built.** §3: "each cell has a budget (§6); a block's loads
   stop starting when the sum of its loads' own durations (open to the beacon's last record) passes the budget; time
   spent between loads, in waits for a server, or after a failure counts toward nothing." No budget appears in
   `round.py`, `round.mjs`, `round-page.js` or the README (`grep -i budget` finds nothing); the plan grammar has no
   field for it, and README §The round's *Not built* does not name it. A round run as built departs from the
   pre-registered protocol. Fix: a per-cell budget in the plan, the loads' own time summed from `load opened` to the
   load's end, the next load of that cell not started once it is passed (each skipped load recorded as *not started:
   budget*), never a started load excluded; a `round_test.py` case, mutated. Or, if the protocol's author prefers,
   the README names it as not built and the round waits on it.

## Minors (author)

1. `beacon.js` ignores `navigator.sendBeacon`'s return: a body the browser refuses is dropped with no trace. Sizes
   here, from the headless beacon file: 1.3–3.9 KB a load; cell 3's leave flush carries the cine draws (~100 bytes
   each, so ~20 KB at 10 s × 10 fps × 2 runs, *estimated*), under the 64 KiB keepalive quota for these series, but
   not checked. Record the `false` (e.g. a counter sent with the next flush) or split the flush.
2. A renderer crash or a page that never runs the hook (a failed module import) leaves the phone's tab where it is:
   only the page can ask `/next`. Blocker 1's fix does not cover it; the laptop could at least record a load whose
   `/next?after=k` never came within its deadline. Whether to reopen the tab from `adb` is the author's call (not
   sourced here).
3. Cell 3's frame-change latencies read the ledger's `painted` for each stepped frame, which is right only for frames
   never painted before (the file says so). With `steps` 20 the sequence needs `n ≥ 41` frames; `dbts_b1-q8-g8` has
   about 50 (23.2 MB at ~464 KB a frame, *derived*), so it holds, but nothing refuses a shorter series. Refuse it.
4. The surviving mutant: `round_test.py` cannot see where the gap sleeps at `gapS: 0`. A case at `gapS` > 0 that
   checks no load's open-to-end span holds the gap.
5. `server/dev-server.py` gains a lab endpoint (`POST /lab/beacon`, off unless `--beacon`). The dev server is in no
   image and the absence check is green, so this is not a leak; one line in `deploy/README.md`'s list of deliberate
   divergences from the web image would keep `check_equivalence.sh`'s readers from finding it by surprise.
6. The VOID bar counts every timer gap, the load's own work included, where §3 says "outside a load's own work". No
   load here came near it (largest gap of a passing load < 2 s); say in the README that the bar is the stricter one.

## What holds

* **One press runs the whole plan**, as committed: the headless run's nine loads, a refused load and a stall among
  them, end with `round ended`; the commit mismatch stops before load 1 with no page or `adb` call.
* **No load is dropped from the records when a fill fails or stalls**: the fill's timer leaves with the verdict,
  `flush({ leaving: true })` sends what is queued, the host notes `load opened` and `load ended` per load. Blockers 1
  and 2 are the two paths where this fails.
* **Every check's mutation fails it**, for the 15 of 16 above and the 22 PR 400 lists for the headless claims (those
  I did not redo).
* **Nothing from `lab/` reaches a product path or image**: `check_lab_absent.sh` green; the product changes are the
  seams PR 400 names (`controller.js`'s ledger fields with their test, `head.js`'s two lab parameter names).

## Verdict

Three blockers open (1–3), all *author*. By amendment 17 the queue gains RUNNER-AUTO-FIX and RUNNER-AUTO-FIX-REVIEW,
and PHONE-LEVERS waits on the re-review. Nothing here is the owner's.

## Re-review

*RUNNER-AUTO-FIX-REVIEW, 2026-11-16, by a session that wrote none of the runner, its review or the fix. Checked:
`claude/phone-round` `3b3203df` .. `2e45ee0e` (`11462dec`, `26a1ee77`, `a2f0a8a6`, `2e45ee0e`). Nothing run on a
phone.*

Fixtures and limits: one 4-core cloud host, headless Chromium, loopback, software decode, `adb` a fake on `PATH`; the
round's synthetic 10-bit pair (64 × 48, 20 frames, Q 8 G 8), twelve loads. No phone, no real `adb`, no `podman`
image, no Wi-Fi, no hidden page or screen turned off, no renderer crash.

**Run as committed:** `round_test.py` 11 OK (8.9 s); `round_headless.sh` every claim holds, the verdicts
`ok ok failed stopped ok ok ok ok ok failed failed ok`; `scripts/check_lab_absent.sh` and `scripts/comment_budget.sh`
green; `scripts/gate.sh --quick` GATE OK in 567 s, skipped by name: the decoders' rebuild and the absence checks (--quick; `check_lab_absent.sh` run on its own), the native painter and window (no lavapipe, Xvfb), the viewer's cross-codec arm and Firefox, the web host's nginx check (no nginx).

**Each fix reverted, its test kept:**

| blocker | reverted | what failed |
| --- | --- | --- |
| 1 (a throw or hang after the fill) | `round-page.js`'s `try` and `afterS` deadline removed, the `fault` lever kept | 7 claims: `every load has its verdict (… ok ok none none none)`, the throw's and the hang's, the round's end, the wake lock, the fill records, `adb`'s reads; the round never ended |
| 2 (a block that never answers; a repeated ask) | `round.py` at `3b3203df` | `test_a_block_whose_server_never_answers…` and `test_asked_again_after_a_failed_block…` error (500, the round stopped) |
| 3 (the stopping rule) | the same | `test_a_cell_budget_stops_only_loads_not_started` fails (all four loads ran); `test_time_between_loads…` passes on the old code, as it should: it guards the gap's place, a mutant, not the fix |

**Mutants of my own** on `round.py`, each run against `round_test.py` and reverted: 5, **3 killed** (the gap's
`sleep` moved after `load opened`; only a failed block's first load recorded; no memo of the answer), **2
survived**: an uncounted load's time counted toward its cell's budget (`if True:` for `counted`), and `>` as `>=`
at the budget (minor 2 below).

**Nothing else changed:** the four commits touch `lab/devices/` (`round.py`, `round_test.py`, `round-page.js`,
`round_headless.mjs`, `README.md`), `deploy/README.md` (one sentence) and `docs/lines/client.md`; no product path.

### Blockers

1. **Blocker 2 is closed only for servers ready by `ready`; a server ready by `readyLine` that never prints its line
   still stops the round, with nothing recorded.** `readyS` reaches `wait_answer` but not `wait_line`, which reads
   `proc.stdout` until the line or the process's exit. The QUIC `series-server`s are `readyLine` servers
   (`round_headless.mjs`'s `quic()`), so this is every block's main server. Shown by a probe (a `round_test.Rig` of
   three blocks, block 1's server `sleep 90` with `readyLine: "transport="`, `readyS: 1`): `/next?after=0` had no
   answer in 60 s (the client's timeout), and `round.jsonl` holds no `host failed` and no `load failed`; the phone
   would wait on that request for as long as the server lives. README §The round says "not ready within `readyS`
   … is recorded `host failed`", which does not hold for these. Fix: `readyS` bounds `wait_line` too (a reader
   thread and a deadline, or the process killed at the deadline), and a `round_test.py` case with a silent
   `readyLine` server, mutated.

### Minors

1. **Blocker 1, 3 and the repeated ask hold as their fixes claim.** Blocker 3's budget times a load from `load
   opened` to its page's `/next?after=k`, where next-round.md §3 says "open to the beacon's last record"; the page
   flushes its last record just before it asks, so the two differ by the flush, and the README states its own
   reading. No change asked; said here so the protocol's author can agree.
2. No test has an uncounted load (`counted: false`, the warm-ups) in a cell with a budget, so the survivor above
   (warm-up time eating cell 2's budget) goes unseen. A one-case test.
3. A block marked `rebootAfter` whose servers never started still reboots the phone on the next block's entry
   (`self.block` is set before readiness). Harmless to the records; one line if the author wants it.
4. The review's minors 1 and 2 stay listed as not done, as PR 400 §Fix says.

### Verdict

Blockers 1 and 3 closed; blocker 2 closed for `ready` servers and **open for `readyLine` servers** (blocker 1
above). This is the second review with a blocker open, so by amendment 17 the loop stops here: PHONE-LEVERS waits on
the owner's word on a third fix round (`readyS` bounding `wait_line`, its test).

## Re-review 2

*RUNNER-FIX-2-REVIEW, 2026-11-17, by a session that wrote none of the runner, its review, its fixes or its
re-review. Checked: `claude/phone-round` `09f86c0e` .. `13b60f19` (`2189af2c`, `13b60f19`). Nothing run on a phone.*

Fixtures and limits: one 4-core cloud host, headless Chromium, loopback, software decode, `adb` a fake on `PATH`; the
round's synthetic 10-bit pair (64 × 48, 20 frames, Q 8 G 8), twelve loads. No phone, no real `adb`, no `podman`
image, no Wi-Fi, no hidden page or screen turned off.

**Run as committed:** `round_test.py` 13 OK (11 s); `round_headless.sh` three times: twice every claim holds
(`ok ok failed stopped ok ok ok ok ok failed failed ok`), once one claim failed (minor 2 below);
`scripts/check_lab_absent.sh` and `scripts/comment_budget.sh` green. `scripts/gate.sh` not run: the change is
`lab/devices/` and the line doc, and the author's `--quick` run stands.

**The fix reverted, its tests kept** (`round.py` at `2189af2c^`): `test_a_block_whose_server_never_prints_its_ready_line…`
errors (the client's 60 s timeout, the run 70 s), as the re-review's probe did. `test_a_server_that_exits_before_its_ready_line…`
passes on the old code, as PR 400 §Fix 2 says: it guards a mutant, not the fix.

**Mutants of my own** on `round.py`, each run against `round_test.py` and reverted: 4, **3 killed** (the exited
check removed; `readyS` not passed to `wait_line`; every line taken as the match), **1 survived**: the reader
returning at the match, so the server's output is no longer drained (minor 1).

**Nothing else changed:** the two commits touch `lab/devices/round.py`, `round_test.py`, `README.md` (one sentence)
and `docs/lines/client.md`; no product path.

### Blockers

None. The re-review's blocker is closed: `readyS` bounds `wait_line`, a silent `readyLine` server is recorded
`host failed`, its loads `load failed` by name, and the round goes on.

### Minors

1. **The drain after the match is untested.** Nothing fails if the reader stops at the ready line; a `series-server`
   that then logs more than a pipe's buffer (64 KiB on Linux) would block on its writes mid-round. The code drains
   (as the code before the fix did, by its own thread, also untested); a test whose `readyLine` server prints past
   the buffer after its line and must still answer would kill the mutant.
2. **A flake in `round_headless.mjs`, not in this fix:** cell 3's claim asks every step's latency `> 0`; one run of
   three measured a worker-view step at 0 ms (`3 1 1 1 0 83 ms`) and failed the claim. A step painted in the tick it
   was due is a valid 0; `>= 0` (or a bound on the timer's resolution) is the claim meant.
3. Carried, not done: no test has an uncounted load in a budgeted cell; a `rebootAfter` block that never started
   still reboots on the next entry; the first review's minors 1 and 2.

### Verdict

No blocker open. PHONE-LEVERS' need (the runner's re-review with no blocker open) is met; the minors are the
author's, none blocks it.
