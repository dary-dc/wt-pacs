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
