# PHONE-ROUND-2: the plan

Written 2026-11-24 by PHONE-ROUND-2-PREP (`claude/work-ledger:docs/queue-2026-11-24.md`), in the cloud, no phone. Run
by the owner's local phone session once PHONE-ROUND-2-PREP-REVIEW is done with no blocker open. Its rules are
[`next-round.md`](next-round.md)'s unless this file says otherwise; its read is [`next-round-results.md`](next-round-results.md)'s
§Cell 3 *Reductions*. Times are UTC.

## 0 · On one screen

* **What runs:** cell 3 again, all 48 loads under one condition, then cell M (eight loads on one renderer). One press,
  then nothing until "round done". Length about **1 h 15 min** (*derived*: PHONE-ROUND-3D ran cell 3's 48 loads with a
  fresh Chrome before each in 72 min of wall clock, a restart included; cell M adds 8 loads of about 70 s).
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
* **Every load** records `memory`: `budget`, `window` (what the store holds), `deviceMemory`, `maxTextureSize`; and
  `firstPicture`, `ms` from the navigation's start to the first quality label (the reading 11-22 had to derive).

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

## 6 · Results of the preparation

*(filled in below as each check ran)*

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
