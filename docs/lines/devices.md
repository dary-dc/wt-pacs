# Devices: runs on real phones and machines

Last verified 2026-11-15 (HW10-ROUTES reviewed) against `claude/work-ledger` (the queue files and status files named below),
`claude/phone-rows` `4e492c92` and `claude/docs-client`. The product: [`../ARCHITECTURE.md`](../ARCHITECTURE.md)
§The product. The plan and every reading of a device run: [`../devices.md`](../devices.md). The device kit:
`lab/devices/` (its README).

## Goal

Measure on real devices what containers cannot (a phone's decode, its hardware paths, a radio link), with one press
from the owner and no hands after, so every run is comparable and no valid load is lost.

## Who does what

* **Coordination** (what to test, protocols commissioned, results read into the subject docs): the client
  coordination session for now; any session can take it over from this file.
* **Protocols**: written by a cloud session that will not run them, then reviewed by another.
* **Implementation and runs** on the owner's phone and laptop: a local session per task, briefed narrowly. The probe
  and the one-press runner are the local session `phone-tests`'s, which stops when both are done.

## In flight

| item | where | state |
| --- | --- | --- |
| the hardware decode probe, inside the kit (`caps.js` gains the matrix: every AV1 form × hardware preference, each outcome recorded exactly, `copyTo` per format hashed, GPU paint precision on a 10-bit ramp) | `claude/hw-probe` (local session); its draft PR opened by the cloud review row | building; then run on the phone |
| the one-press runner, grown from the kit's runner; the 11-11 run's pieces (`claude/phone-rows:lab/phone/`) carried by hand with their source commit cited | `claude/hw-probe` or its own branch (local session) | building |
| the next round's protocol: decode per frame for HTJ2K and the optimal-quality view on the phone, the delivery arms A, B, C1, C2, the probe, the cache's cold read, the view comparison by frame-change and exact-frame latency | `claude/phone-protocol:docs/phone-rows/next-round.md` (PHONE-NEXT-PROTOCOL, then its review) | queued |
| the hardware decode sources re-checked: every frame checked, `prefer-software`'s reason, 4:2:0 grey for hardware, `P010` to `I420P10` | PR 387 (`claude/hw-decode`), HW-DECODE-DEEP-REVIEW | running |
| the depth cut to 8 bits, the fallback if no 10-bit hardware route exists | `claude/depth8` (DEPTH8-THEORY, then DEPTH8-MEASURE) | running |

Rows and their briefs: `claude/work-ledger:docs/queue-client-2026-11-14.md` (amendments 5, 7, 10, 11, 14, 15 bind
device work); status files `claude/work-ledger:docs/queue/<ROW>.md`.

## Rules for a device run

* One press at the start, nothing after; the screen kept on and the page visible; counted cells only where no hand
  is needed (Wi-Fi with the server wired; the tether only if its switch is scripted).
* The run's commit is the tip of the branch under review, pinned and checked before the first load.
* A stopping rule counts wall-clock time; no load that ran under the protocol's conditions is excluded.
* Every outcome recorded as it is (an error's name and message, the route taken), never "did not work".

## Open, for the owner

* **`lab/phone/`**: merge `claude/phone-rows` into the runner's branch to keep its history, or carry its pieces by
  hand (the default until a word).
* **10-bit hardware routes** (HW10-ROUTES, 2026-11-14, theory; [`../decode/hardware-10bit.md`](../decode/hardware-10bit.md),
  PR on `claude/hw10-routes`): no browser route serves a checked 10-bit hardware frame, behind a flag or not; native
  MediaCodec to `P010` ranks first for the phone. Reviewed 2026-11-15 (PR 392's body: 16 sources hold; on Ozone WebGL2's 8 bits is unproven, still converted and closed; ranking holds). Owed: the probe cells it asks of
  `lab/devices/README.md`, and the owner's word on whether a native client is the 10-bit hardware route.
* **The 11-11 run's reading**: the six-octet reading is of record (the owner, 2026-11-14); whether the two failures
  under `bbr` withdraw it.
* **A cellular arm** only if a server the phone reaches over the Internet is in scope.
* **A coordinator session of its own** for device work, started from this file, when the client coordination
  session's context grows heavy.

## Pointers

The last run: `claude/phone-rows:docs/phone-rows/README.md`, `claude/phone-rows:docs/reviews/phone-blind-read.md`; its state and lessons:
`claude/work-ledger:docs/queue/PHONE-RUN.md`. The link it measured: [`../transport/transport-conclusions.md`](../transport/transport-conclusions.md)
§1. What bounds a phone's fill: `claude/fill-split:docs/phone-rows/README.md` *What bounds a fill*. Hardware decode:
[`../decode/hardware.md`](../decode/hardware.md), [`../decode/hardware-10bit.md`](../decode/hardware-10bit.md). Target links: [`../client/evidence/which-links-a-phone-meets.md`](../client/evidence/which-links-a-phone-meets.md); PR 386's branch carries its transport copy.
