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
Target links: `claude/link-targets:docs/transport/link-profiles.md` (PR 386).
