# PHONE-ROUND-2: the plan

Written 2026-11-24 by PHONE-ROUND-2-PREP (`claude/work-ledger:docs/queue-2026-11-24.md`), in the cloud, no phone. Run
by the owner's local phone session once PHONE-ROUND-2-PREP-REVIEW is done with no blocker open. Its rules are
[`next-round.md`](next-round.md)'s unless this file says otherwise; its read is [`next-round-results.md`](next-round-results.md)'s
§Cell 3 *Reductions*. Times are UTC.

## 0 · On one screen

* **What runs:** cell 3 again, all 48 loads under one condition, then cell M (eight loads on one renderer). One press,
  then nothing until "round done". Length about **1 h 21 min** (*derived*: PHONE-ROUND-3D ran cell 3's 48 loads with a
  fresh Chrome before each in 72 min of wall clock, a restart included; cell M adds 8 loads of about 70 s, 9 min 20 s;
  corrected 2026-11-25 from "1 h 15 min", §Review m2).
* **The code:** `claude/phone-run-2` (§1), the run commit its tip when the round starts; `round.py` refuses any other.
* **What it answers:** `view-target` item 4 (cell 3 under one condition, the worker with the start's fix, a
  first-picture field); the memory bound's size at two values and the phone's memory after worker loads (cell M);
  `MAX_TEXTURE_SIZE` and `navigator.deviceMemory` (every load). What it does not: §5.

## 1 · The round's code

`claude/phone-run-2`, created from `origin/claude/phone-run` `8d77ba2b4` (nothing pushed to `claude/phone-run`; PR 436
stays open, unmerged):

| commit | what | conflicts, each resolved in its merge commit |
| --- | --- | --- |
| `c914c7a76` | `--no-ff` merge of `origin/claude/unified` `b059388b6` (after UNIFIED-SYNC-1124: PRs 434, 435, 437 as it merged them) | `client/view/controller.js`, `client/view/controller.test.mjs`, `server/dev-server.py`: both sides kept; unified's memory bound, `exactClient` and `now()`, with phone-run's one re-ask of a lost exact ask (PR 378 as the 11-22 run commit carried it) |
| `9180c0542` | `--no-ff` merge of `origin/claude/beacon-loss` `783674e01` (PR 436; BEACON-LOSS-REVIEW done, no blocker) | `lab/devices/README.md`: both sides kept |
| `313ad1b55` and after | the round's harness (§2), lab only but for one seam | — |

What landed, by the brief's four rows:

| row | landed | its commit on this branch |
| --- | --- | --- |
| MEMORY-LEAK-TRACE (PR 434) | yes: findings and its rigs, no product fix (its §Result: none in the row's bounds) | in `c914c7a76` |
| VIEW-MEMORY-BOUND (PR 435) | yes: the 256 MiB default window, the page view's fill cut to it with no cache | in `c914c7a76` |
| BEACON-LOSS (PR 436) | yes: the drain's post, its fallback in 16 KiB beacons newest first, `resources.sh` | `9180c0542` |
| STALE-CODE (PR 437) | yes: `dev-server.py --revalidate`, now passed to every dev server by `round_plan.mjs` (`313ad1b55`); `devtools.mjs`'s cache clear and first-page check (DEVICEKIT-TOOLS) | in `c914c7a76`, `313ad1b55` |
| WINDOW-WHOLE-GROUPS (PR 446, draft into `claude/unified`) | **no**: WINDOW-WHOLE-GROUPS-MEASURE and a sync row are still owed (PR 446 open, not merged, 2026-11-25 01:30) | — |

**PR 446 and cell M** (added 2026-11-25, §Review B1). On this branch the window is a count of frames centred on the one
in view; PR 446 found it defective where a series in groups is over its window (its product test on `b059388b6`, 50
frames, G = 8, W = 15: 268 frames on the wire for one forward pass, 280 for one back, a sawtooth refetching two groups
on every turn), which is cell M's *w* arms on `dbts_b1-q8-g8` (15 frames, G = 8, *theory*). What the round does:

* **If a sync row has merged PR 446 into `claude/unified` before the round**: merge `origin/claude/unified` into this
  branch again (`--no-ff`, each conflicted file named), take the round page's `held` from the same rule as the store
  (PR 446 raises the store's budget to max(*W*, 2*G*): 16 frames on `dbts_b1-q8-g8`, else every *w* load fails its fill
  by the check of §2), re-run `round_headless.sh --round2` and the gate, and name the merge here; the run commit is the
  new tip.
* **Else** the round runs as written, and the read labels cell M's *w* arms **before PR 446**: they measure the window
  and memory of the defective bound, and their steps may put refetched groups on the phone's link. They cannot answer
  the memory the shipped window holds (16 frames, 260 MiB, PR 446's body) nor a step's time at its edge; the 2*w* arms
  (30 frames, nearly four whole groups) are less exposed but not free of it, and are labelled the same.

Not landed: a record of the code each load ran. With `--revalidate` every response carries `Cache-Control: no-cache`,
so the browser asks the server before reusing a cached module, and `round.py` refuses a served tree whose `HEAD` is
not the plan's commit: each load runs the plan's code by construction (*derived*, not checked per load; the first
load is checked by `devtools.mjs`).

**The seam.** `?budget=N` (lab, `lab/viewer/levers.js`) reaches the `Controller` through `client/viewer/viewer.js`,
`client/view/view.js` and `client/view/view-worker.js` as `lab.budget`; without the parameter it is `undefined` and
the controller's default holds, so the product is unchanged.

## 2 · What the harness adds (`313ad1b55` and after)

* `round_plan.mjs --cells 3,M`: the loads of the cells named. Every dev server runs with `--revalidate`.
* **Cell 3:** each load `budget=` its series' frames, so the store holds the whole series as on 2026-11-22: under the
  256 MiB default `dbts_b1-q8-g8` would hold a window (15 frames, `view-target.md` §6, *theory*), its fill would fail
  `fillFailure` and a step past the window would be a miss, not the held frame 11-22 measured. Its worker loads carry
  the start's fix, `opts={"pageDials":true,"viewWorkerFirst":true,"glAfterDial":true,"shortRuns":true}`.
* **Cell M:** eight loads of `dbts_b1-q8-g8` on one renderer: worker at the default window *w*, worker at 2*w*, page at
  2*w*, page at *w*, twice (worker first, as loads 26 and 27 of 2026-11-22). Each load fills to what it holds and
  steps within it (steps = min(20, ⌊(held − 1)/2⌋)). Its loads after the first carry `sameRenderer`, so `round.py`'s
  `--fresh-chrome` relaunches Chrome only before the first. `round.py`'s per-load resource snapshot reads the memory.
* **Every load** records `memory`: `budget`, `window` (the frames the load expects the store to hold: `?budget`, else
  `memoryWindow`), `received` (the frames the fill delivered), `deviceMemory`, `maxTextureSize`; and `firstPicture`,
  `ms` from the navigation's start to the first quality label (the reading 11-22 had to derive). A fill that receives
  more than `window` fails (`round.mjs` `fillFailure`, as one short of it does), so a view that dropped its budget is
  not recorded as honoured (§Review m1; `c1a88f1dc`).

## 3 · Before the press (the laptop; any state)

[`SATURDAY.md`](SATURDAY.md) §0 (preflight: the servers built at the run commit, `demo-series`, the certificate, `adb
reverse`) holds, on this branch instead of `claude/phone-run`. Then:

```bash
git fetch origin && git checkout claude/phone-run-2 && git pull --ff-only && git status --short   # clean
LAPTOP_IP=$(ip -4 route get 192.0.2.1 | sed -n 's/.* src \([0-9.]*\).*/\1/p'); test -n "$LAPTOP_IP"
node lab/devices/round_plan.mjs demo-series target/round2 --dial "$LAPTOP_IP" --cells 3,M
adb forward tcp:9222 localabstract:chrome_devtools_remote
node lab/devices/devtools.mjs . --port 9222 > target/round2/devtools.jsonl &
python3 lab/devices/round.py target/round2/plan.json target/round2/out --bind 127.0.0.1 --host http://127.0.0.1:8780 \
  --fresh-chrome --beacon target/round2/beacon.jsonl &
until curl -sf http://127.0.0.1:8780/ >/dev/null; do sleep 1; done
adb shell am force-stop com.android.chrome      # load 0 starts in a fresh renderer too
adb shell am start -a android.intent.action.VIEW -d http://127.0.0.1:8780/ \
  -e com.android.browser.application_id wtpacs.round com.android.chrome
wait %2                                         # round.py, until "round done"
```

The phone: **Start**, once. A stop mid-round restarts as `SATURDAY.md` §3 says (the rest plan from `K`, its beacon
apart). Raw rows go under `docs/phone-rows/raw/<date>/` through `raw_rows.py`, as `SATURDAY.md` §Where rows go.

## 4 · The dry run in the cloud (`round_headless.sh --round2`)

The same plan shape on the synthetic 10-bit pair (64 × 48, 20 frames), two pairs of cell 3 and cell M, at the round's
10 s cine and the most steps 20 frames allow (9), with `--fresh-chrome` against a fake `adb`, headless Chromium. Its
claims: every load ok; a relaunch after each load but before a `sameRenderer` one; each load's `memory` record; its
steps and cine idle and busy; every last batch posted (BEACON-LOSS-REVIEW's open (3)); one `firstPicture`; the start's
fix on cell 3's worker loads only. Its result is in §6.

BEACON-LOSS-REVIEW's open items, read against this branch: (1) a timed-out post sent again by the fallback is a
duplicate field for field, so the read keeps one record per (`load`, `kind`, `at`); (2) the fallback sends the drain
record with its count first, then 16 KiB beacons newest first until one is refused, so a refused one is recorded by the
count; (3) `round_headless.mjs` and `--round2` assert every load's drain has path `post`.

**Read rule added:** before any number, drop duplicate records by (`load`, `kind`, `at`) (BEACON-LOSS-REVIEW m2).

**The adb lead (not established).** PHONE-ROUND-3D logged "timeout expired while flushing socket" once per relaunch and
lost `adb` once after step 15. Recorded here; the round's notes keep `adb`'s output per relaunch, and a drop restarts
from `K` as above.

## 5 · Cells a page asks for that this round does not carry

Each needs a build first; none is improvised on the evening.

| ask | page | why not here | what it needs |
| --- | --- | --- | --- |
| M17, lossy against lossless HTJ2K in memory | `phone-decode-route` item 7 | no lossy HTJ2K series in `demo-series`; cell 1's bench has no lossy arm | the 16 `dbts_b1` frames at Δ 16 (`ojph_compress`), a bench arm, interleaved |
| M5 at a volume's size, the 4:2:0 form | `phone-decode-route` item 7 | `hw-units.json` holds 16² and 256² units only; `make_hw_units.py` at 2048² stops in `ingest.decode` (`av1 decode failed (-2)`, *measured* here) | a unit at the frame's size from a real `dbts_b1` frame, or the decode's size limit raised |
| P1 and P2, D against D+T3 | `exact-frame-layout` item 3 | no Lossless-request arm with strips in the runner | the arms of `lab/htj2k-tiles/improve/stage3/` behind the round page |
| the cache's P2 and P1 | `cache` | no cache arms in the runner, and CACHE-DESIGN-1124 has chosen no store (no output on any branch at 13:20) | its choice, then its arms |
| a cause for the exact frame's 216.5 ms | `phone-decode-route` §8.1 ("no cell asks it") | no cell of this round times the exact frame's parts (fetch, decode, check, paint) | a split of the exact frame's time on the phone, a lab stamp per part (added 2026-11-25, §Review n1) |

## 6 · Results of the preparation

All in one 4-core cloud container, headless Chromium, no GPU, no phone; fixtures: the synthetic 10-bit pair (64 × 48,
20 frames) and unit tests on synthetic metadata.

* **The gate** at `f2de84d70`: `scripts/gate.sh`, full, **GATE OK in 1027 s**. Skipped, as it names them: the pair's
  invariants (no writer), the native painter and window (no lavapipe, Xvfb), the viewer's cross-codec arm and Firefox
  (no DICOM bundles, no GL display), the web host's check (no nginx). `round_headless.sh` (the default claims) ran
  inside it and passed.
* **The dry run**, `round_headless.sh --round2` at the tip: **every claim holds**, 12 loads (4 of cell 3, 8 of cell M)
  in about 7 min 40 s; relaunches after loads 0–3 and none inside cell M. Two mutants killed (round.py relaunching
  before a `sameRenderer` load; no `firstPicture` record).
* **Unit tests:** `round.test.mjs` 8/8 (round 2's shape; five mutants killed: no start's fix, no cell-3 budget, cell M's
  renderer flag shifted, its budgets swapped, `--cells` ignored); `round_test.py` 23 OK (the `sameRenderer` skip; its
  mutant killed); `levers.test.mjs` ok (`?budget`; two mutants killed); `beacon.test.mjs` 11/11; `controller.test.mjs`
  52/52 and `dev-server.test.py` 16 OK after the first merge.
* **Not tried:** a phone, `adb` itself, Chrome's VIEW intent, DevTools over `adb forward`; the window's size on
  `dbts_b1-q8-g8` (15 frames, *theory*) is not exercised by the synthetic pair, whose 20 frames all fit.

## Middle-band phone (cell 1, through a real-device cloud; the owner's account)

`phone-decode-route` item 8: cell 1 on one middle-band phone (two fast cores), so the class table's middle row stops
being only *derived*. The owner opens the account; nothing here signs up for anything.

* **What runs:** cell 1's bench as [`next-round.md`](next-round.md) §4 defines it (HTJ2K and the view, 1–4 decoders,
  50 frames held in memory, each timed in its decoder worker), and the arm `route-policy.md` §6 adds (the view at three
  decoders with HTJ2K at one and two decoding together). Order and repetitions as cell 1's: three repetitions, Williams
  order, the drift arms last.
* **How it reaches the phone:** a device cloud cannot dial the laptop, so the bench runs from static HTTPS: the page,
  its modules and WASM, and the coded frames of `dbts_b1` and `dbts_b1-q8-g8` fetched whole before the clock starts
  (public fixtures, no patient data). **Not built:** the bench today reads its frames over WebTransport from the round's
  servers; a static form of it (frames by `fetch`) is a lab build of its own, with its review, before this runs.
* **What is recorded:** the device's model class (not its serial), Chrome's version, `hardwareConcurrency`,
  `deviceMemory`, each frame's decode time, the thermal state where the cloud offers it; nothing else leaves the device.
* **Read by** cell 1's rules against DEVICE-THEORY's middle-band prediction (`device-model.md` §4), held or missed.

## Review (PHONE-ROUND-2-PREP-REVIEW, 2026-11-25)

By a session that wrote none of this file or its harness (`by:` in its status file), 00:08–00:45 UTC. Read: this file at
`21c8102b0`; `git diff 9180c0542 21c8102b0` (the harness and the `?budget` seam); the merge `c914c7a76` against
`origin/claude/unified` `b059388b6`; `claude/reviews-2026-11-28`'s pages `view-target`, `phone-decode-route`,
`exact-frame-layout`, `cache`, `non-cine-series` and `README.md`; PR 446's status file (WINDOW-WHOLE-GROUPS). Run, in one
4-core cloud container, headless Chromium, no GPU, no phone, on the synthetic 10-bit pair (64 × 48, 20 frames, Q 8 G 8):
`round.test.mjs` 8/8, `round_test.py` OK, `levers.test.mjs` ok; `round_headless.sh --round2` (**every claim holds**, 12
loads, 6 min 14 s); a variant of it with cell M's window under the series and four mutants (below). The variant's two
scripts are on `claude/work-ledger:docs/queue/PHONE-ROUND-2-PREP-REVIEW/`. The gate not re-run (§6's run cited).

**What holds.** The round's code is `claude/unified`'s tip: unified has not moved since `b059388b6`, and the merge's
`client/view/controller.js` differs from it only by PR 378's one re-ask of a lost exact ask and the frame's `about(info)`
(r2-m1 of the queue's §Re-review 2: unified's side of PRs 434, 435 and 437 kept). PR 436 open, `claude/phone-run`
untouched. BEACON-LOSS-REVIEW's open (2) matches `beacon.js` `drain()` (the drain record with its count, then 16 KiB
chunks newest first until one is refused); (3) is asserted and held in the re-run. Each cell traced to the page that asks
it:

| what the round records | asked by | carried |
| --- | --- | --- |
| cell 3, one condition, the start's fix, `firstPicture` | `view-target` §2 item 4, §6 *The first picture on the phone* | yes |
| cell M, memory after worker loads | `view-target` §2 (P5's condition), §6 *The phone's memory* | yes |
| cell M, the window at *w* and 2*w*; `deviceMemory` | amendment 28's VIEW-MEMORY-BOUND ("the per-device-class size a measurement of phase 2"); no page item | yes |
| `maxTextureSize` | `non-cine-series` item 4 and §4 ("the phone's `MAX_TEXTURE_SIZE`"); `decisions/README.md` *the phone's cells* | yes |
| M17, M5 at a volume's size | `phone-decode-route` item 7 | no, §5 |
| P1, P2 | `exact-frame-layout` item 3 | no, §5 |
| the cache's P2, P1 | `cache` | no, §5 |
| cell 1 on a middle-band phone | `phone-decode-route` item 8 | §Middle-band phone; needs a static bench build |
| a cause for the exact frame's 216.5 ms | `phone-decode-route` §8.1 ("no cell asks it") | no, and not in §5 (n1) |

**The window under the series (measured, the variant).** Cell M's loads at budgets 6 and 12 of the pair's 20 frames
(window under 2*G* = 16, the regime PR 446 found defective): every load ok; each fills exactly its window, worker and page
(`worker 6:6, worker 12:12, page 12:12, page 6:6`, twice); steps, cine, drain and `firstPicture` as in the re-run.

**Mutants.** M1 `round.py` relaunching before a `sameRenderer` load: `round_test.py` fails. M2 cell 3's `budget`
dropped: `round.test.mjs` fails. M3 cell M's steps off by one: `round.test.mjs` fails. M4 the page view's
`budget: lab.budget` dropped in `client/viewer/viewer.js`: **every unit test passes, and the re-run's claims would**; the
variant fails it only through its own count (`page 12:20, page 6:20`), while the round's `memory` record still says 12 and
6 and every load is ok (m1).

**Blocker.**

* **B1. Cell M at *w* runs the window PR 446 found defective, and this file does not say so.** WINDOW-WHOLE-GROUPS
  (`claude/window-whole-groups` `e8a52cfe4`, draft PR 446 into `claude/unified`, its status file): "on the tip b059388b6,
  the real downloader behind a stand-in transport (…50 frames, G = 8, W = 15) put 268 frames on the wire for one forward
  pass and 280 for one back"; "a sawtooth 24|23 refetched groups 2 and 3 on every turn". That is cell M's worker and page
  at *w* on `dbts_b1-q8-g8` (15 frames, G = 8, §2). PR 446 changes the window to whole groups ("dbts_b1 16 frames, 260
  MiB against 256"), so cell M's *w* arms measure a window and a memory the product may not keep, and their steps put
  re-fetched groups on the phone's link. Fix: §1's *What landed* names PR 446 as not landed (WINDOW-WHOLE-GROUPS-MEASURE
  and a sync row still owed), and §1 or §2 says what the round does about it: re-merge `origin/claude/unified` (`--no-ff`)
  and re-run `--round2` if a sync row has merged PR 446 before the round, else run as written with cell M's *w* arms
  labelled "before PR 446" in the read and what they cannot answer (the shipped window's memory) said.

**Minor.**

* **m1. The `memory` record's `window` is the URL's, not the store's.** `round-page.js` computes `held` from `?budget`
  or `memoryWindow(meta)`, never from the `Controller`, and `fillFailure` fails only a fill *under* it; so a seam that
  drops the budget is recorded as honoured (M4 above, measured). On the phone a dropped seam shows only where the default
  is smaller (cell M's 2*w* page arm fails its fill), and a cell-3 page load would hold 15 frames while recording 50.
  Fix: record what the store holds (the `Controller`'s window, or the fill's `received` against it), or a check that
  `received` equals `window`, its mutant M4.
* **m2. §0's length.** 72 min for cell 3 (3D) plus 8 loads of about 70 s is about 1 h 21 min, not "about 1 h 15 min".

**Nit.** n1: §5 lists the asks not carried but not the exact frame's 216.5 ms, which `phone-decode-route` §8.1 says no
cell asks; one row there would keep the two in step.

**Verdict.** One blocker (B1): PHONE-ROUND-2-PREP-FIX and its review appended to the queue; PHONE-ROUND-2 waits on the
re-review. Fixtures and limits: the synthetic pair only (no DBT volume, no ultrasound clip opened); the window's size on
`dbts_b1-q8-g8` not exercised (15 frames, *theory*); a fake `adb`, headless Chromium in one container, no phone, no radio.

## Fix (PHONE-ROUND-2-PREP-FIX, 2026-11-25)

By a session that wrote none of this file, its harness or its review (`by:` in its status file), 01:06–01:40 UTC.

* **B1: fixed.** §1's *What landed* names PR 446 (WINDOW-WHOLE-GROUPS) as not landed, open and unmerged at 01:30, with
  WINDOW-WHOLE-GROUPS-MEASURE and a sync row owed; §1 *PR 446 and cell M* says what the round does: re-merge
  `origin/claude/unified` `--no-ff`, take `held` from the store's rule (PR 446's max(*W*, 2*G*)), re-run `--round2`
  and the gate if a sync row has merged it before the round; else run as written with cell M's *w* (and 2*w*) arms
  labelled "before PR 446" and what they cannot answer said.
* **m1: fixed** (`c1a88f1dc`, lab only): `round.mjs` `fillFailure` fails a fill that receives more than the window
  (`received N, past the window of W`), as it failed one short of it; the round page's `memory` record carries
  `received`. A test first: `round.test.mjs` "a fill past the window fails" failed on `5a4532dcf`'s
  `round.mjs` (8/9) and passes with the change (9/9). Mutant M4 (the page view's `budget: lab.budget` dropped in
  `client/viewer/viewer.js`), run through §Review's variant (cell M at budgets 6 and 12 of 20): **killed by the round's
  own verdicts**: "cell M: 4 of 8 loads ok; 6 page 12: received 20, past the window of 12; 7 page 6: received 20, past
  the window of 6; …" (*measured*). Without the mutant the variant holds every claim (worker and page 6:6, 12:12).
  The record still states the window the load expects, not one read from the `Controller`: reading it there would
  touch the product's view interface, and the check makes any disagreement fail the load instead.
* **m2: fixed.** §0: about 1 h 21 min (72 min + 8 × 70 s).
* **n1: fixed.** §5 has a row for the exact frame's 216.5 ms (`phone-decode-route` §8.1).
* **Runs**, one 4-core cloud container, headless Chromium, no GPU, fake `adb`, no phone, the synthetic 10-bit pair
  (64 × 48, 20 frames, Q 8 G 8): `round_headless.sh --round2` at `6b6d1dbe5`, **every claim holds**, 12 loads, 6 min
  12 s; the variant clean, every claim holds, 6 min 3 s; the variant with M4, 3 claims fail (above).
  `scripts/check_links.py` 0 unresolved; `scripts/comment_budget.sh` ok. The gate not re-run (lab only; §6's run cited).
  Logs: `claude/work-ledger:docs/queue/PHONE-ROUND-2-PREP-FIX/`.
* **Limits**: the window on `dbts_b1-q8-g8` still not exercised (15 frames, *theory*); no DBT volume or ultrasound clip
  opened; PR 446's effect on the round is argued from its body, not run here.
