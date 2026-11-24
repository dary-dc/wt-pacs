# The exact frame without a request: its trigger, its bytes, its wait

**Question.** `visually-lossless` item 3 says yes "to the direction" of an exact frame
sent without a request, and leaves "which trigger" to two pages that do not size it (contradiction 1 of
`claude/reviews-2026-11-28:docs/decisions/README.md`). What would a dwell trigger cost in bytes, and how long would a
reader wait from the moment they stop to *✓ Lossless*, per link profile and phone class? Or is item 3 to be answered
no? Pages are `claude/reviews-2026-11-28:docs/decisions/<page>.md` (PR 405), named, not linked.

*Written 2026-11-24 by row EXACT-UNASKED (`claude/work-ledger:docs/queue-2026-11-24.md`). Docs only, nothing run:
every number is **source**, **theory**, or **derived** from rows other runs measured, each named. The arithmetic is
`claude/work-ledger:docs/queue/EXACT-UNASKED/size.py` and its `size-output.txt`; it reproduces the 15 C1 predictions
of `claude/delivery` `b8cd8c71:lab/delivery/predictions.json` to the millisecond before it derives anything.*

## 1 · The answer

**Size it, do not answer no.** One exact frame, the one the reader has stopped on, asked once a dwell of *T*d has
passed (*T*d above the reader's per-step pace of 0.54 s; §2, **theory**) and only after the view's fill has ended,
costs **one frame a dwell** (frame 0's 1.09–2.11 MB, 4.6–15 view frames; 0.86–2.20 MB over every frame) and
arrives **0.2–1.3 s after the dwell's trigger** on every profile whose round trip is short (clean and public Wi-Fi,
LTE and a 1 %-loss link once the fill is over), for every phone class (**derived**, §3; floors, §3.1). Where the
round trip is loaded or far (~0.8 s, LTE during a fill), it arrives **6.2–7.2 s** after the trigger: past the one latency bound a source gives,
so there the view is what the reader reads, and option A's safety argument (`visually-lossless` §6: "a phone's time
from a dwell to *✓ Lossless*") does not hold (**derived**). A whole series behind the view is C2, already a no
(`delivery-per-link` item 3); a window of ±1 triples the bytes for neighbours that come 0.2–7 s later (§3.3).

**The owner's yes or no**, one line for the weekend brief's table: *the exact frame on a dwell — one frame, after the
fill, `T`d a lab lever until a reader's scroll log sets it — built as a draft PR named for the decided approach it
extends?* Recommended **yes**. A yes extends "the exact HTJ2K frame on an explicit Lossless request" (program §Decided
approaches) by one case and queues one build row and its review; a no leaves the exact frame on request only, as
decided, and `visually-lossless` item 3 then reads no.

**How it serves the value statement.** "Every frame the reader asks to see exactly is the original, bit for bit, and
checked" reaches the frame the reader stops on without a press, at 0.05–0.50 of the exact series' bytes added a
session for dwells on 5–50 % of the slices, which stays under the exact series alone until 78–93 % (§3.4). That
share holds only for a *T*d above the step pace: at or below it the trigger fires on ordinary stepping and nothing
bounds it short of the break-even.

## 2 · The trigger

* **What a dwell is.** In the ask model a dwell is "v = 0, no direction" ([`ask-model.md`](ask-model.md) §2). A scroll
  that passes a slice is not one: a DBT reader "scrolled through 3.8 image slices during a single
  fixation" (Aizenman et al. 2017, quoted in [`how-viewers-and-readers-ask.md`](how-viewers-and-readers-ask.md); the
  body not verified, ASK-MODEL-REVIEW m1), so a trigger on every fixation would fetch slices the reader is passing.
* ***T*d, the dwell before the ask.** No source found gives a dwell threshold, for DBT or any modality. The one
  eye-tracking source found is CT's (Beard et al., J Digit Imaging 1994;7(4):189, abstract, fetched 2026-11-24 by NCBI
  efetch, PMID 7858015, **source**), and neither of its numbers is a dwell: "Adjacent eye movements (+/- 1 image in
  sequence) averaged 0.54 seconds" is the reader's **per-step pace** from one image to the next, and "a stacked
  approach with a 0.2-second image display time" is the **workstation's** time to put up the next image.
  *T*d's lower bound is therefore argued, not sourced (**theory**): a trigger at or below the step pace fires while
  the reader is stepping, which the bullet above rules out, so *T*d > 0.54 s (CT's pace carried to DBT, which no row
  tests). Beard gives a mean, not a spread, so this file sizes *T*d at 1.0 s (about twice the mean step) and 2.0 s, a
  lab lever until a reader's scroll log sets it.
* **The bound.** "It should not take more than 3 seconds to retrieve an image from online local storage and display it
  on a workstation" ("ACR–AAPM–SIIM Practice Parameter for Determinants of Image Quality in Mammography", "Revised
2022 (Resolution 46), Amended 2023 (Resolution 2c)", §V.C.1, the PDF at
  `https://gravitas.acr.org/PPTS/DownloadPreviewDocument?DocId=140`, fetched 2026-11-24, **source**). It bounds a
  retrieval, not an upgrade from a view; it is used here as the only latency a source names (**theory**).
* **After the fill only.** The exact frame goes on its own session, dialled at load and idle until asked
  (`client/viewer/viewer.js` `connectExact`). During the view's fill the two share the bottleneck, and on LTE the round
trip an ask pays is the loaded one, ~0.8 s median
  ([`../../transport/link-profiles.md`](../../transport/link-profiles.md)
  §2), which is the CR form below (**theory**). A dwell during the fill waits for its end or pays CR's time.
* **What a dwell that ends early costs.** An asked frame is sent whole: the server has no cancel
  ([`../../adr/reject-server-cancel.md`](../../adr/reject-server-cancel.md)). A dwell that ends between *T*d and the
  frame's arrival spends one frame's bytes on nothing shown exact. How often that happens needs a reader's scroll log;
  telemetry is off, so no row here can give it.

## 3 · The numbers

### 3.1 · Ask to painted, per link and class

The delivery run's C1 is exactly this ask: one exact frame on the idle exact session, 1 s after the view's fill,
press → *✓ Lossless* (`claude/delivery:docs/client/evidence/delivery-comparison.md` §4.1, §Results). Its medians are
**measured** (cloud host, 4 cores, software HTJ2K, one decoder: 14.7, 41.8, 14.5 ms a frame on `dbts_a1`, `dbts_b1`,
`dbts_c1`). Per class, the cloud's decode is swapped for the device model's
(`claude/device-theory:docs/decode/mobile/device-model.md`
§4, HTJ2K a `dbts_b1` frame on a fast core: entry 100–143, middle 46–94, premium 37–59 ms, **derived** there; `dbts_a1`
and `dbts_c1` scaled by the cloud's ratio 0.351 and 0.347). Seconds, the three volumes' range (**derived**):

| form (scaled from) | the cloud host, measured | entry | middle | premium | the model held? |
| --- | --- | --- | --- | --- | --- |
| CLEAN, 1 ms, 90 Mbit (home Wi-Fi) | 0.19–0.34 | 0.21–0.44 | 0.19–0.39 | 0.18–0.36 | `a1`, `b1` MISSES in, `c1` MISSES above (×1.29–1.38) |
| PUB, 10 ms (public Wi-Fi) | 0.28–0.46 | 0.30–0.56 | 0.28–0.51 | 0.28–0.47 | `a1` CANNOT HOLD (4 VOID), `b1` MISSES above, `c1` HOLDS (×1.25–1.35) |
| LTE, 19 ms, 0.1 %, blackouts (after the fill) | 0.46–0.69 | 0.48–0.79 | 0.46–0.74 | 0.46–0.71 | `a1`, `b1` MISSES below, `c1` CANNOT HOLD (3 VOID) (×0.41–0.50) |
| LOSS, 20 ms, 20 Mbit, 1 % | 0.68–1.17 | 0.70–1.27 | 0.68–1.22 | 0.68–1.19 | MISSES below, all three (×0.32–0.35) |
| CR, 400 ms one way (LTE's loaded round trip) | 6.22–7.14 | 6.24–7.24 | 6.22–7.19 | 6.22–7.16 | HOLDS, all three (×1.08–1.11) |

The last column quotes `lab/delivery/rows/judged/<CELL>.txt`'s C1 latency verdicts as judged. The class columns are
**floors**: only the decode is swapped; the check, the hops and the paint stay at the cloud's speed, and on the one
phone the exact frame ran over its prediction (below), so `phone-decode-route` §4 calls every latency built on it a
floor.

On a link faster than the relay's 90 Mbit, the one phone measured (premium, home Wi-Fi ≥ 568 Mbit/s, cell 2 of
`claude/phone-run:docs/phone-rows/next-round-results.md`) took **216.5 ms** on `dbts_b1` and 126.5 ms on `dbts_a1`
(**measured**), 0.10–0.12 s over its prediction, unexplained (`phone-decode-route` §4). Swapping its 40.4 ms decode
for each class's: entry 0.28–0.32, middle 0.22–0.27, premium 0.21–0.24 s on `dbts_b1` (**derived**, one phone).

### 3.2 · Dwell to *✓ Lossless*

*T*d plus §3.1, seconds, every class and volume, at *T*d's two sized points above the step pace (§2; **derived**
from a **theory** *T*d; `size-output.txt` §3). Floors, as §3.1's class columns are:

| form | *T*d 1.0 s | *T*d 2.0 s | under ACR's 3 s? |
| --- | --- | --- | --- |
| CLEAN | 1.18–1.44 | 2.18–2.44 | yes |
| PUB | 1.28–1.56 | 2.28–2.56 | yes |
| LTE, after the fill | 1.46–1.79 | 2.46–2.79 | yes |
| LOSS | 1.68–2.27 | 2.68–3.27 | at 1.0 s yes; at 2.0 s not for every volume |
| CR (a loaded or far round trip) | 7.22–8.24 | 8.22–9.24 | **no**, 2.4–3.1× over |

ACR's bound is on a retrieval; *T*d is the reader's own stop, so the share of these seconds the system adds is §3.1's
alone, under 3 s on every form but CR.

### 3.3 · A window of ±1 instead of one frame

The centre goes first on the session, so its wait is §3.2's; each neighbour comes after it. By §4.1's model on the
same idle session (**theory**), both neighbours add +0.23–0.47 s on CLEAN and PUB, +1.6–1.7 s on CR, up to +3.1 s on
LTE and +7.2 s on LOSS, for three frames' bytes a dwell. The bound's direction is the form's: on CLEAN and PUB the
model ran ×1.25–1.38 below measured, so those increments are **lower** bounds; on LTE and LOSS it ran 2–3× slow, so
those are **upper** bounds; on CR it held. After the trigger, with §3.1's class centre, the first neighbour is ready
0.30–0.68 s later on CLEAN, 0.39–0.79 s on PUB, 1.3–2.4 s on LTE, 2.5–4.9 s on LOSS and 7.1–8.2 s on CR
(`size-output.txt` §6). When the reader steps on after a dwell is not known: no source gives a dwell's length (§2),
and Beard's 0.54 s is the pace between steps, not the time after a stop. A step taken within about 0.7 s of the
trigger can find the neighbour not yet there even on CLEAN (`dbts_b1` on an entry phone).

### 3.4 · Bytes

A session's bytes against the exact series alone (B) are the view's share *r*A plus the share *d* of distinct slices
dwelt on (**derived**: frame bytes from `predictions.json`, K1; `size-output.txt` §5):

| volume | *r*A (Q 8 G 8) | *d* 0.05 | 0.10 | 0.25 | 0.50 | equal to B at *d* = | frame 0, exact |
| --- | --- | --- | --- | --- | --- | --- | --- |
| `dbts_a1` | 0.068 | 0.118 | 0.168 | 0.318 | 0.568 | 0.93 | 1.26 MB, 15.2 view frames |
| `dbts_b1` | 0.216 | 0.266 | 0.316 | 0.466 | 0.716 | 0.78 | 2.11 MB, 4.6 view frames |
| `dbts_c1` | 0.088 | 0.138 | 0.188 | 0.338 | 0.588 | 0.91 | 1.09 MB, 12.1 view frames |

At *d* 0.10 that is 1.5–2.5× the view's bytes. `visually-lossless` §3's A row says 4.2–14 view frames and
1.4–2.4×: it takes the view's bytes from `vl-criterion.md` §3 (Q 8 at G 1 over the 19 volumes, 0.07–0.24 of HTJ2K's),
this file from the delivery run's view at Q 8 G 8 on the three timed volumes (0.068–0.216); the same derivation on
different view bytes. Early-ended dwells add one
frame each (§2), unbounded until a scroll log counts them. Every *d* in this table assumes a *T*d above the step pace (§2): at or
below 0.54 s the trigger fires on stepping, and *d* can reach the break-even. The server reads and sends one more frame a dwell; what that
costs per session is SESSION-COST's (`claude/session-cost`), not measured here.

## 4 · Where it holds

**Fixtures.** Three DBT volumes of one dataset (`dbts_a1`, `dbts_b1`, `dbts_c1`; 56, 50, 69 frames), the view at Q 8
G 8; one 4-core cloud container without a GPU, software decode, Chromium 153; a userspace relay at ≤ 90 Mbit,
its forms scaled from the profiles, not a radio; one premium phone on one home link, one evening. No breast ultrasound
clip (`usb_cine` is lossy-sourced, `docs/FIXTURES.md`), no reader.

**Where the link, not the decode, binds** (amendment 28): the exact frame on demand is round trips and slow start on
every profile; the decode is 14–143 ms of it. Only for an entry phone does the decode reach a quarter to a third: on a
fast home link (100–143 of 276–319 ms, **derived**, one phone's wire) and on the relay's CLEAN form for `dbts_b1`
(100–143 of 397–440 ms, 0.25–0.33, **derived**).

**Ultrasound stacks.** A clip is played as cine, so a dwell is a pause on a frame. Its exact frame's bytes are not
known: `usb_cine` is lossy-sourced, so no row may quote them, and an 8-bit grey frame decoded is 0.26 MB
([`ask-model.md`](ask-model.md) §3.3: 64 × 512², 17 MB, **derived**). If its exact frame is 0.1–0.26 MB (an
assumption: at most the decoded size), §4.1's model sends it in the ask's round trip plus 3–4
round trips of slow start, so the wait is round trips alone: tens of ms on CLEAN, 3.2–4.0 s at CR's ~0.8 s
(`size-output.txt` §7; **theory**, not yet known).

**Each limitation, with what found it:**

* C1's short-round-trip latency missed its model above by +43 to +117 ms, growing with the frame's bytes and the
  round trip (DELIVERY-VERDICT-REVIEW m2); the ask → last byte was not recorded, so wire and decode cannot be split
  (DELIVERY-PAGE, `delivery-per-link` §4). §3.1 uses the measured medians, so it carries the excess.
* LTE's and LOSS's C1 ran 0.32–0.50 of the model (DELIVERY-RUN amendment A2's foreseen direction): measured medians
  are used; the window's increments (§3.3) on those forms come from the model and overstate.
* The phone's exact frame ran 0.10–0.12 s over its prediction, unexplained (the phone round's read,
  `phone-decode-route` §4).
* The class decode is the device model's, tested on one phone; HTJ2K's bands held there (`phone-decode-route` §4).
* *T*d has no source: its lower bound is argued above CT's per-step pace, from one eye-tracking abstract, not from
  DBT readers, and the abstract's 0.2 s is a workstation's display time, not a dwell (EXACT-UNASKED-REVIEW B1;
  ASK-MODEL-REVIEW m1 for the DBT source's body).
* The class latencies are floors: only the decode is swapped for a class (EXACT-UNASKED-REVIEW m2).
* The share of dwells ended before the frame arrives, and *d* itself, have no measurement: telemetry is off
  (`asking` §6).
* A dwell during the fill is sized by CR alone; the two sessions' share of a bottleneck is theory (this row).

## 5 · What would change it

* **DELIVERY-RUN-2** records C1's ask → last byte (`delivery-comparison.md` §Amendment 2, A2.5): it splits §3.1 into
  wire and decode and tests the CR line on more than one form.
* **A reader's scroll log**: *d*, the dwell lengths and how many end before the frame, which set *T*d and the waste.
* **DELIVERY-FIT-ARM** (the same amendment): if the HTJ2K-only arm fills as fast as the view on wire-bound links, the
  frame on screen is exact at its level already and this trigger matters only past the fitted level.
* **The cache** (CACHE-DESIGN-1124): an exact frame already held is painted with no wire time at all.

## 6 · What it would reopen

"The exact HTJ2K frame on an explicit Lossless request" (program §Decided approaches), by one case: a dwell. It is not
built here. Nothing else; the other unasked case, the exact frame for a view frame that fails its check, is
`frame-integrity` §3.2 (c)'s and costs the same wait.
