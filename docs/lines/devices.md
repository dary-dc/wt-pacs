# Devices: runs on real phones and machines

Last verified 2026-11-15 against `claude/work-ledger` `3db8116a` (the queue files and status files named below),
`claude/phone-protocol` `04797972`, `claude/hw-probe` `af4b6aeb`, `claude/phone-rows` `1354e67f` and
`claude/docs-client`. The product: [`../ARCHITECTURE.md`](../ARCHITECTURE.md) §The product. The plan and every
reading of a device run: [`../devices.md`](../devices.md). The device kit: `lab/devices/` (its README).

## Goal

Measure on real devices what containers cannot (a phone's decode, its hardware paths, a radio link), with one press
from the owner and no hands after, so every run is comparable and no valid load is lost.

## Who does what

* **Coordination** (what to test, rows commissioned, results read into the subject docs): the device coordination
  session, from this file; any session can take it over from here.
* **Protocols**: written by a cloud session that will not run them, then reviewed by another.
* **Builds** (the runner, the lab levers): cloud rows, tested headless in the container, then reviewed.
* **Runs on the owner's phone and laptop**: a local session, briefed narrowly (PHONE-PROBE-RUN, PHONE-DRY-RUN, the
  round). The probe's local session `phone-tests` has ended: the probe is built and reviewed.

## In flight

**2026-11-22, the round read** ([`../phone-rows/next-round-results.md`](../phone-rows/next-round-results.md), PHONE-READ):
cell 1 HTJ2K 18.9 ms effective at three decoders (DEVICE-THEORY's bands held, the protocol's missed), the view
saturating at three; cell 2 *B faster* than A, 15 of 15, median 0.705 (DEVICE-THEORY predicted a tie); cell 3 not
decided (no end batch arrived; BEACON-LOSS); cell 4 the hardware AV1 decoder allocated, full range back as `RGBA`.
Reviewed 2026-11-22 (PHONE-READ-REVIEW, the file's §Review): every number recomputed; two blockers, B1 M4's HEVC and
VP9 limits read from a vendor file without AV1 (the AV1-listing files declare 8192 × 8192 and 4096 × 4096), B2 C2's
0.36–1.65 s ask gap (end to end, *C2 slower*). B faster and cell 1 unchanged.
Fixed 2026-11-22 (PHONE-READ-FIX, the file's §Fix): B1, B2, m1–m5 and the nits corrected in place; C2 now read both
ways (*no difference* summed, *C2 slower* end to end). Re-reviewed 2026-11-22 (PHONE-READ-FIX-REVIEW, the file's
§Re-review): both blockers closed against the raw rows, no blocker open; MOBILE-DECODE-REJUDGE next.

**2026-11-23, cell 3 read** (PHONE-READ-3D, the results file's §Cell 3, from `raw/2026-11-22-cell3d/` at
`f96e38a9`): all 48 loads ran the fixed beacon (a `drain` record, path `post`, each). The worker view is *faster* on
busy cine, 24 of 24 pairs: 0 against a median of 7 of 100 dropped, difference −7 [−11, −5]. Busy frame-change shows
*no difference* (10 of 24), and so does everything else. Guard (a) does not bind; it is an *assumption*. It was read
with a fresh Chrome per load, at lab-only `f5252051`, restarted at K=16. A review (by another session) is owed.

**2026-11-23, the beacon's loss** (BEACON-LOSS, `claude/beacon-loss`, a draft PR into this branch): Chrome refuses a
keepalive body once 64 KiB would be in flight (*source*: the Fetch standard; Chromium's `resource_fetcher.h`), and
headless Chromium 157 does the same (*measured*: 65 536 B taken, 65 537 refused). `f5252051`'s awaited post is
reviewed and kept. Its fallback now sends the `drain` record (which counts the batch) first, then the batch newest
first in 16 KiB beacons until one is refused. `round_headless.sh` shows it on Chromium: a cell-3 load with the round's
10 s cine has an 80.8 KB end batch, which arrives whole by the post. The pre-fix `flush` lost all of it, verdict
included; a forced fallback keeps the verdict and lands 118 of 231 records. `resources.sh` is now in the kit. The
product sends nothing at unload (`claude/unified`: no `sendBeacon` or `keepalive` in `client/`). A review is owed.

The next round's path, in order:

```text
PHONE-NEXT-PROTOCOL-FIX ─▶ RUNNER-AUTO ─▶ PHONE-LEVERS ─▶ PHONE-DRY-RUN ─▶ the round
  (+ re-review)            (+ review)      (+ review)       (local)          (owner's press)
PHONE-PROBE-RUN (local) and the MOBILE-DECODE rows run beside it; the latter may add cells to the round.
```

| item | where | state |
| --- | --- | --- |
| the protocol's review fixes: nine findings, one blocker (the wake lock is released at each load's navigation; the fix keeps the screen on through Android's stay-on setting, from the laptop) | `claude/phone-protocol:docs/phone-rows/next-round.md` (PR 359), PHONE-NEXT-PROTOCOL-FIX, then its re-review | queued |
| the one-press runner (§10 items 1–5): `GET /next`, failures recorded and passed, the wake lock recorded, the laptop's script, the beacon's new fields, the busy lever; the 11-11 pieces carried by hand | `claude/phone-round` from `claude/hw-probe`, RUNNER-AUTO, then its review | queued, after the fix |
| the levers the client lacks (§10 item 6): arm C2, the decoder count per load, cell 1's in-memory decode bench | `claude/phone-round`, PHONE-LEVERS, then its review | queued, after the runner's review |
| the probe on the phone, the phone's AV1 codec list, whether `logcat` names the component and `adb` reads Chrome's `/proc` | local, PHONE-PROBE-RUN; the probe `claude/hw-probe:lab/devices/` (PR 393) | waits for the phone on the laptop |
| the web's mobile decode options (amendments 19, 20), which may add cells to the round | `claude/mobile-decode`, MOBILE-DECODE-OPTIONS (claimed 2026-11-15), five MOBILE-OPT rows, the comparison and its review | running |

**The 2026-11-21 round's run branch** (PHONE-RUN-OWNER, 2026-11-19): `claude/phone-run`, draft PR into
`claude/unified` "do not merge: phone run 2026-11-21": `claude/unified` + PR 378 + `claude/phone-round` by `--no-ff`
merges, and `lab/devices/round_plan.mjs` (the round's 144-load plan, run whole in quick mode headless by
`round_headless.sh --plan`). The evening: [`../phone-rows/SATURDAY.md`](../phone-rows/SATURDAY.md). Not run: cell 5,
the report cells, M1–M22 (each named there). PHONE-RUN-REVIEW (2026-11-19, PR 409's body): two
blockers, an empty `--dial` taken (B1) and identifying lines in the raw rows' commit (B2). PHONE-RUN-FIX (2026-11-19):
`round_plan.mjs` refuses a missing or empty `--dial`, and `lab/devices/raw_rows.py` commits only what a cell reads,
refusing a MAC or an SSID left. PHONE-RUN-FIX-REVIEW (2026-11-19, PR 409's body §Re-review): both blockers
closed (each fix reverted, its test fails), nothing else changed, the fake-`adb` commit step leaves no SSID, BSSID
or account line; no blocker open, two minors.

Rows and their briefs: `claude/work-ledger:docs/queue-client-2026-11-14.md` (§The device round's rows; amendments 5,
7, 10, 11, 14–20 bind device work); status files `claude/work-ledger:docs/queue/<ROW>.md`.

**Landed since 2026-11-14**, each read into its subject doc: the hardware decode sources re-checked (PR 387); the
depth cut to 8 bits, theory and measured (`claude/depth8`); the 10-bit hardware routes and their review (PR 392,
[`../decode/hardware-10bit.md`](../decode/hardware-10bit.md)); the probe, built and reviewed headless, software only
(PR 393). The probe review's finding, *measured, cause not traced*: every RGB `copyTo` and WebGL2 read fits
studio-range expansion even where the frame says full range, so the probe's RGB and paint "exact" counts measure
range, not precision.

## Rules for a device run

* One press at the start, nothing after; the screen kept on and the page visible; counted cells only where no hand
  is needed (Wi-Fi with the server wired; the tether only if its switch is scripted).
* Never toggle USB debugging or tethering during a round (the tether comes back on a new address); start the `adb`
  server once per round (each start asks the phone's authorisation again).
* The run's commit is the tip of the branch under review, pinned and checked before the first load.
* A stopping rule counts wall-clock time; no load that ran under the protocol's conditions is excluded.
* Every outcome recorded as it is (an error's name and message, the route taken), never "did not work".

## Open, for the owner

* **Cell 3's guard** (the protocol review's finding 2): whether the worker view is worse only past a stated
  first-picture cost, or whether the first picture alone may reject it. Chosen before the round starts.
* **The run commit's merges**: PRs 376 and 378 (the two 11-11 phone failures) and `claude/phone-round` into the
  unified client. Without 376 and 378 their failure modes are excluded by name (`next-round.md` §1).
* **`lab/phone/`**: merge `claude/phone-rows` into the runner's branch to keep its history, or carry its pieces by
  hand (the default until a word; RUNNER-AUTO does so).
* **A dedicated row for 10-bit hardware routes**, proposed, not queued: every route to a checked 10-bit hardware
  frame, sourced and ranked, each with a probe cell (WebGPU multi-planar import with a GPU-side hash, the `copyTo`
  re-layout, the native client's planes). *Corrected 2026-11-17:* queued by the owner 2026-11-14 (10 bits on hardware
  the goal, 8 bits the fallback), done and reviewed 2026-11-15 (`claude/hw10-routes:docs/decode/hardware-10bit.md`,
  #392): no shipped browser route serves it; its first ask, the phone codec's `P010`, is the probe run's.
* **The one-press runner's third fix round**: the owner's yes, 2026-11-16; its blocker closed 2026-11-17 (#400), so the
  client's levers (PHONE-LEVERS) come next, then the dry run.
* **The 220-level checked hardware view** (studio range, 16 to 235) may be explored further (the owner, 2026-11-16):
  its cells are asks in `claude/phone-protocol:docs/phone-rows/next-round.md`.
* **The 11-11 run's reading**: the six-octet reading is of record (the owner, 2026-11-14); whether the two failures
  under `bbr` withdraw it.
* **A cellular arm** only if a server the phone reaches over the Internet is in scope.

Answered 2026-11-15: a native client as the 10-bit hardware route is paused; the web's mobile options come first
(amendments 18, 19).

## Pointers

The last run: `claude/phone-rows:docs/phone-rows/README.md`, `claude/phone-rows:docs/reviews/phone-blind-read.md`;
its state and lessons: `claude/work-ledger:docs/queue/PHONE-RUN.md`. The next round:
`claude/phone-protocol:docs/phone-rows/next-round.md`. The link it measured:
[`../transport/transport-conclusions.md`](../transport/transport-conclusions.md) §1. What bounds a phone's fill:
`claude/fill-split:docs/phone-rows/README.md` *What bounds a fill*. Hardware decode:
[`../decode/hardware.md`](../decode/hardware.md), [`../decode/hardware-10bit.md`](../decode/hardware-10bit.md).
Target links: [`../client/evidence/which-links-a-phone-meets.md`](../client/evidence/which-links-a-phone-meets.md),
[`../transport/link-profiles.md`](../transport/link-profiles.md).
