# What a reading session costs the server and the network

*Pre-registered 2026-11-24 by SESSION-COST-PROTOCOL (`claude/work-ledger:docs/queue-2026-11-24.md`), a session that
will run none of it. Nothing here is measured by this file: every number is **source** (quoted from the file or
standard named), **theory**, **derived** (arithmetic on rows named, with their fixtures), or, in §3, frames counted
on the product's code under a stand-in harness. SESSION-COST-RUN follows it
as written; a departure the host forces is an amendment in §9, dated, before any counted row.*

**The question.** The value statement (`README.md`) promises "the lowest server and network cost per reading session".
No row stood behind it (amendment 28 item 3.6). This file defines a reading session, predicts its server CPU, the
server's peak memory and its bytes on the wire per arm, and names the reference it is compared with. "Lowest" is
claimed after the run only against what the run measured; against the reference only as theory (§5).

## 1 · A reading session

One reader, one series, one tab, from the page's load to the last dwell. The motions are `asking`'s
(`claude/reviews-2026-11-28:docs/decisions/asking.md` §4: open, scroll, dwell, jump; "a type of vigorous drilling
strategy", its S6). For a series of *n* frames, in order:

1. **Open** at frame 0; the view fills as the product does.
2. **Drill**: three strokes from frame 1 to ⌊*n*/3⌋ and back to 0, one frame a step.
3. **Pass**: frame 1 to *n* − 1, one frame a step.
4. **Dwell** 3 s at *n* − 1, then **jump** to ⌊*n*/2⌋ and dwell 3 s, then jump to ⌊*n*/4⌋ and dwell 3 s.

A step is the viewer's own `ArrowRight` or `ArrowLeft` (`client/viewer/viewer.js`), pressed when the frame shown is
painted and no sooner than 100 ms after the last press: a reader no faster than 10 frames a second, never skipping a
slice (`asking` item 2). A jump sets the slider to its frame through its own `input` event (`asking` item 2b, a jump).
Steps per session: 165 on `dbts_a1`, 147 on `dbts_b1`, 208 on `dbts_c1`, 191 on `usb_cine` (*derived*).

The trace is an *assumption*: no reader's scroll log exists (`asking` §6). It is chosen to exercise the window, not to
be typical; a reader who never drills asks less on every arm.

## 2 · Arms

The product's viewer, the page view, `cubic-restart`, `decoders=2`, as the delivery comparison's §1
(`claude/delivery:docs/client/evidence/delivery-comparison.md`), the 256 MiB view bound as built (VIEW-MEMORY-BOUND,
PR 435, merged into `claude/unified`).

| arm | what the session loads | at each dwell |
| --- | --- | --- |
| **A** | the view, `<stem>-q8-g8[-cut].sbnd` | nothing |
| **A+C1** | as A | `l`: the exact frame on screen (C1's press) |
| **B** | the exact series only | nothing |
| **FIT** | the exact series, each frame first at the level that fits (§A2.2 of the comparison) | a zoom past the fit |

FIT is B on `dbts_a1`, `dbts_c1` and `usb_cine` (the fit is level 0 there, §A2.2), so those cells are a control:
predicted ×1.00 of B. FIT exists only once FIT-ARM-BUILD has merged into `claude/delivery`; until then the run has
three arms and says so. `usb_cine` runs B only: the view is not coded for it by `claude/delivery:lab/delivery/series.sh`.

## 3 · What a session asks (measured on the product's code, frames only)

The counts come from the product's own `Controller` and `downloader.js`, driven over §1's trace by
`client/view/window.test.mjs`'s harness (a stand-in transport and decoders, each step's frame here before the next):
`claude/work-ledger:docs/queue/SESSION-COST-PROTOCOL-FIX/` (scripts, raw output, README), which reproduces
`SESSION-COST-PROTOCOL-REVIEW`'s counts. `model.py` (`143ed5756`) is retired: its eviction breaks ties toward the later
frame and evicts once a step, where `store.js` breaks them toward the earlier and evicts at each `put` (PR 441's review,
B1). Inputs: the frame bytes of `claude/delivery:lab/delivery/inputs.json`. *W* is 256 MiB over one decoded frame
(2 bytes a sample above 8 bits): 56 on `dbts_a1` (all), **15 on `dbts_b1`**, 54 on `dbts_c1`, 64 on `usb_cine` (all).

**Two tables, both pre-registered.** The run takes the table of the `claude/unified` commit it pins: **T1** for
`b059388b6` or any commit without PR 446 (`claude/window-whole-groups`), **T2** for one with it. If the pinned commit's
`client/view/` or `client/transport/` differs from both, the harness is run on it and its table written in §9 before
any counted row; that is a mechanical rerun, not a new prediction.

A+C1 is A plus the exact frame at each of the three dwells (three asks). FIT is B's asks on level-1 pictures (the
prefix share 0.271 of `dbts_b1`'s exact bytes, RESLEVEL, `delivery-comparison.md` §A2.7, *source*) plus the rest of
each dwell frame on its zoom (three asks). **FIT's *W*** is not set by §A2.2: `memoryWindow` reads the series' full-frame
metadata, which gives 15; a store that counts the level-1 pictures it holds gives 63 ≥ 50, so the series is asked once.
FIT-ARM-BUILD sets which; the run records the store's window each session and takes the FIT row of that *W*.

**T1, `b059388b6`** (frames asked, MB asked):

| volume | *n* | A | A+C1 | B | FIT | the series once: view, exact |
| --- | --: | --- | --- | --- | --- | --- |
| `dbts_a1` | 56 | 56, 4.64 | 59, 8.21 | 56, 67.81 | = B | 4.64, 67.81 |
| `dbts_b1` | 50 | **796, 370.54** | 799, 376.97 | 132, 284.63 | *W* 15: 135, 81.82 · *W* 63: 53, 33.79 | 23.21, 107.41 |
| `dbts_c1` | 69 | 177, 15.40 | 180, 18.41 | 84, 87.12 | = B | 6.24, 70.66 |
| `usb_cine` | 64 | — | — | 64, 4.99 | = B | —, 4.99 |

**T2, PR 446 at `e8a52cfe4`**: as T1 but `dbts_b1` A **130, 60.61**, A+C1 133, 67.04; `dbts_c1` A **85, 7.74**, A+C1
88, 10.75. B and FIT do not change (groups of one).

**What they say.** On T1 the view thrashes on `dbts_b1`: with *W* = 15 and groups of 8 a miss asks its whole group and
the window lets go of frames of groups it asks again; A asks each frame 16 times on average and more bytes than B. With PR 446
A asks each 2.6 times. `dbts_c1`'s A asks 2.6× its series on T1,
1.2× on T2. `usb_cine`'s count is *theory* (*W* ≥ *n*: the series once, as the harness gives `dbts_a1`).

The harness's pipeline is instant: a slower decode leaves misses pending when the window moves on. The run records
every ask, so the count is checked directly, apart from its bytes.

## 4 · The predictions (derived)

Three quantities a session, each from rows named; every cell's prediction is a range.

* **Bytes on the wire**, server → client, the series servers' UDP flows in the relay's tally: MB asked × **1.037** for
  exact frames, × **1.04** for the view (wire ÷ payload on the 2026-11-23 delivery rows, CLEAN and CR, every arm:
  1.037 for B, 1.038–1.041 for A, *derived*). The page's own assets over TCP are counted apart: 0.53 MB for B, 1.23 MB
  for a view arm, once a session with a fresh profile (*derived*, the same rows). Client → server bytes (asks, ACKs,
  C1's presses) are recorded per flow and reported beside, not predicted.
* **Server CPU**, both series servers' threads summed: MB asked × the arm's rate, plus a per-session intercept and the
  hold. Rates from the 2026-11-23 delivery rows' `serverTicks`, CLEAN medians (*derived*): **exact frames 4.8–5.3 ms a
  MB** (B's 4.87–5.17), **view 5.5–6.6** (A's 5.60–6.46); A+C1 and FIT at those rates by form. The intercept: **0–10 ms**
  a session (A's rate falling from 6.46 on 4.64 MB to 5.60 on 23.2 MB is about 5 ms a fill, *derived*) plus the two
  held sessions at **0.05 ms a second each** (`docs/adr/transport-idle-sessions.md`, *source* there) over the session's
  length below. The other host's 2.0–3.1 ms a MB (`docs/transport/transport-conclusions.md` §4, native clients) is not
  this host's and is not used. CR is predicted at ×1.05–1.7 CLEAN's CPU (CR ÷ CLEAN medians, B 1.06–1.20, A 1.39–1.75).
* **Server peak memory**, `VmRSS`'s peak less its value before the load: **0–5 MB, whatever the arm and the volume**.
  *Theory*: what the server holds a session is bounded by quinn's 10 MB send window, not by the series; the measured
  single paced session is 1 MB over warm, a concurrently filling one 3.7–4.8 MB (`transport-conclusions.md` §4, the
  other host), an idle one ~75 KB (`transport-idle-sessions.md`). The floor is 0, not 1: one server pair serves the
  whole run (§6), so pages its allocator kept from an earlier session can absorb a later one. A peak that grows with
  a session's bytes is a miss.
* **A session's length** (*derived*, for the rig's budget, not a result): steps × 0.1 s + 9 s of dwell + wire bytes at
  the form's WT-TS goodput (CLEAN 86.8, CR 26.4 Mbit/s, `stacks.md` §6.1), up to one round trip (CLEAN 2 ms, CR 0.8 s)
  per ask round on top.

**T1** (`b059388b6`):

| volume | arm | MB on the wire | server CPU, s, CLEAN | length, s: CLEAN · CR |
| --- | --- | --: | --- | --- |
| `dbts_a1` | A | 4.83 | 0.028–0.043 | 26–28 · 27–33 |
| | A+C1 | 8.53 | 0.045–0.062 | 26–28 · 28–36 |
| | B, FIT | 70.32 | 0.33–0.37 | 32–34 · 47–92 |
| `dbts_b1` | A | 385.4 | 2.04–2.46 | 59–61 · 140–220 |
| | A+C1 | 392.0 | 2.08–2.50 | 60–62 · 142–225 |
| | B | 295.2 | 1.37–1.52 | 51–53 · 113–219 |
| | FIT, *W* 15 | 84.85 | 0.40–0.45 | 32–34 · 49–157 |
| | FIT, *W* 63 | 35.04 | 0.17–0.19 | 27–29 · 34–77 |
| `dbts_c1` | A | 16.02 | 0.088–0.115 | 31–33 · 35–53 |
| | A+C1 | 19.14 | 0.10–0.13 | 32–34 · 36–56 |
| | B, FIT | 90.34 | 0.42–0.48 | 38–40 · 57–124 |
| `usb_cine` | B | 5.17 | 0.027–0.040 | 29–31 · 30–32 |

**T2** (PR 446), the cells that differ:

| volume | arm | MB on the wire | server CPU, s, CLEAN | length, s: CLEAN · CR |
| --- | --- | --: | --- | --- |
| `dbts_b1` | A | 63.03 | 0.34–0.41 | 30–32 · 43–56 |
| | A+C1 | 69.70 | 0.37–0.45 | 30–32 · 45–61 |
| `dbts_c1` | A | 8.05 | 0.046–0.064 | 31–33 · 32–41 |
| | A+C1 | 11.17 | 0.060–0.080 | 31–33 · 33–44 |

Bytes are predicted within ±3 % of the table; CPU within the range; `serverTicks` is 10 ms a tick, so CPU below 0.1 s
is read from `schedstat` (§6), not ticks. **What each table says** (*derived*):

* **T1**: A is cheapest on `dbts_a1` (×14.6 fewer bytes than B) and `dbts_c1` (×5.6); on `dbts_b1` **FIT is cheapest
  at either *W*** (×3.5 at 15, ×8.4 at 63) and A and A+C1 the dearest, above B, by the thrash of §3.
* **T2**: A is cheapest on `dbts_a1` and `dbts_c1` (×11.2); on `dbts_b1` **FIT at *W* 63 is cheapest (35.0 MB), then A
  (63.0, ×4.7 under B); FIT at *W* 15 (84.9) comes after A**, so the `dbts_b1` order turns on FIT's *W*.
* On both, `usb_cine` costs one series of bytes; peak memory sets no arm apart.

## 5 · The reference: a DICOMweb fetch of the same frames (theory)

The reference is the standard's frame retrieve, not a server we run. PS3.18 2026e, §10.4.1.1.6: "Frame Pixel Data
/studies/{study}/series/{series}/instances/{instance}/frames/{frames}", and §10.4.3.3.6: "The payload for a Pixel Data
Resource (see Section 10.4.1.1.6) shall contain all the Pixel Data of the resource. Pixel Data in a multipart response
shall have a Content-Location Header Field that corresponds to the URI contained in the corresponding Element in the
Metadata." Its framing, §8.6.1.2: "Each part in a multipart payload shall start with a boundary string, followed by a
Content-Type Header Field with a single part Media Type (see Section 8.7.3), followed by other fields as specified in
Table 8.6.1-1." The HTJ2K transfer syntax is in its media types, Table 8.7.3-5's row "image/jphc 1.2.840.10008.1.2.4.201
High-Throughput JPEG 2000 Image Compression (Lossless Only)".

*Theory*: a viewer asking B's frames this way, with the same window, asks B's bytes plus a part's headers a frame
(a boundary, `Content-Type`, `Content-Location` with three UIDs: some 300 B, *assumption*), over HTTP/2 on TLS: wire
÷ payload 1.039 (`claude/transport-arms` H2-frame on `dbts_b1`, CLEAN, *derived*). **Its bytes are B's within 1 %; it
does not have the view, so against it A's and FIT's savings are the whole difference in bytes.** Its server CPU, if it served as
the lab's HTTP/2 path does, is 0.84 ms a MB of process time (H2-frame, 90 ms for 107.4 MB, against WT-TS's 615 ms on
the same rows, *derived*): **by process CPU at equal bytes, HTTP/2 costs about a seventh of WebTransport here.** Part
of TCP's send work runs in softirq, which a process's ticks do not count, so the run records the host's softirq
(§6); the seventh is an upper bound on the gap's favour to HTTP/2 until it does. **Rendered frames, the standard's screen-sized retrieve.** PS3.18 2026e, Table 10.4.1-3: "Rendered Frames
/studies/{study}/series/{series}/instances/{instance}/frames/{frames}/rendered"; §10.4.1.1.3: "Its primary use case is
to provide user agents with a simple means to display medical images and related documents, without requiring deep
knowledge of DICOM data structures and encodings."; §8.3.5.1.3: "The "viewport" parameter specifies a rectangular region
of the source image(s) or video to be cropped, and a rectangular region corresponding to the size of the user agent's
viewport to which the cropped image or video should be scaled."; §8.3.5.1.4: "The "window" parameter controls the
windowing of the images or video"; Table 8.7.4-1 lists `image/jpeg` as the Single Frame Image default, and "When an
image/jpeg Media Type is returned, the image shall be encoded using the JPEG baseline lossy 8-bit Huffman encoded
non-hierarchical non-sequential process". *Theory*: a viewer asking each frame once at the fitted size (`dbts_a1` level 0,
`dbts_b1` level 1, `dbts_c1` level 0: 2.0–2.5 Mpx) as baseline JPEG at 0.5–1.5 bits a pixel (*assumption*, no row)
asks about 7–21 MB on `dbts_a1`, 7–20 on `dbts_b1`, 11–32 on `dbts_c1`: of the order of A's and FIT's bytes: above A's on
`dbts_a1`, overlapping it on `dbts_c1`, below every arm on `dbts_b1`. **It is not the view**: it is windowed on the server to 8 bits, so every window or level change is a
new ask, the client holds neither the full bit depth nor the exact frame, and the server decodes, scales and encodes
each frame, which no arm here does; its server CPU is not predicted (no row). So the run claims nothing against it.

Hence the claims the run can make, each **against the frame retrieve only**, never against rendered frames (§7):
"lowest bytes a session" where an arm asks fewer bytes than B's (the frame retrieve's within 1 %); "lowest server CPU"
only where the bytes saved outweigh WebTransport's CPU a MB, ×5.7–6.3 HTTP/2's for exact frames and ×6.5–7.9 for the
view (§4's rates over 0.84). By §4 that is `dbts_a1`'s A (×14.6) on both tables, `dbts_c1`'s A on T2 (×11.2, not T1's
×5.6), and `dbts_b1`'s FIT at *W* 63 (×8.4, not *W* 15's ×3.5); never B, nor `dbts_b1`'s A.

## 6 · Rig, records, order

* **Rig**: `claude/delivery:lab/delivery/run.mjs` as the comparison's §2 and §A2.6 (one 4-core container, the
  relay's TUN in `unshare -rn`, its guard, the relay on core 0, the two series servers on core 1, the browser on 2–3),
  with one lever added, `--session`: after the load, the trace of §1 is driven by key presses; at each dwell the arm's
  action; a session over **300 s** (the rig's `--fill-s` default) is `VOID`, named. One fresh browser profile a
  session, one session at a time, 10 s idle between.
* **Server lifetime**: one series-server pair for the whole run of a form, started before it and warmed by one
  uncounted session, `dbts_b1` B (the largest exact cell); every counted session's CPU and memory are deltas over its
  own before-the-load values.
* **Records, per session**, beside the comparison's §5: each series server's CPU from the sum over
  `/proc/<pid>/task/*/schedstat`'s first field (ns) and `utime + stime` ticks, before the load and after the last
  dwell; its `VmRSS` sampled every 50 ms from `/proc/<pid>/status`, the peak less the value before the load; the
  host's softirq per core (`/proc/stat`); the relay's bytes by flow; every ask (frame, form, bytes) and every step's
  paint time from the page's records; the trace's step count (§1's counts include its two jumps); the store's window *W*.
* **Forms**: CLEAN and CR of the comparison's §3. Bytes are predicted equal on both (±2 %); the link binds a session's
  time, not its cost, and the time is not a result here.
* **Order**: a Williams square over the arms (`lab/order.mjs` `order`), volumes rotated by one each round. With FIT,
  four arms, a period of 4 rounds: **8 rounds on CLEAN, 4 on CR**, 144 sessions. Without it (A, A+C1, B), three arms:
  `williams(3)` is its 3 rows and their mirrors, a period of **6 rounds**: **6 on CLEAN, 6 on CR**, 108 sessions.
  Then `usb_cine` B three times on CLEAN, as a function check. By §4's lengths (+10 s idle each): four arms about 75 min
  on CLEAN and 70–140 min on CR, three arms about 45 and 75–150 min; two jobs (CLEAN, CR), rows pushed as they land.
* **`VOID`**, kept with its reason: the relay's guard p99 over 1 ms; a browser process allowed outside cores 2–3; the
  series servers' core over 95 % busy (the host saturating: said, and nothing claimed for that cell). A frame that
  fails its check stops the run and is reported, never voided.
* **Mutants**, each run once before the counted rows and failing as named: the sampler on the relay's pid (CPU zero
  flagged); a trace that skips one step (step count ≠ §1's); the relay's tally dropped (bytes zero flagged).

## 7 · The rule, stated before any data

The table is T1 or T2 by the pinned commit (§3), and FIT's row is that of the *W* recorded. Each cell (form × volume
× arm) is held when its median lies in its range of §4 (bytes ±3 %, CPU in range, peak RSS 0–5 MB) and the median ask
count (frames asked, §3's table, A+C1 and FIT with their three dwell asks) is within 3 % of §3's; else it is a miss,
named with its measured value. A miss in the
ask count is the model's (§3's pipeline assumption), reported before any byte or CPU cell is read. "Lowest" is
written only for the cells where an arm's median is below every other measured arm's in that form and volume, and
against the reference only as §5's theory and only against the frame retrieve: no claim is made against rendered
frames. A/A: the comparison's 2026-11-23 A and A′ medians matched in ticks on
every cell; no A/A arm here, and the spread over rounds is reported per cell.

## 8 · What the run cannot decide

Many sessions at once (one at a time here; `transport-conclusions.md` §4 is the concurrent evidence, the other host);
the cost on a phone's link beyond CR (bytes are link-independent by §4, time is not measured); a reader's real trace
(§1); a DICOMweb server measured (§5 is theory); the page assets once cached. How it serves the value statement: it is
the first row behind "the lowest server and network cost per reading session", and it says where that holds.

## 9 · Amendments

**2026-11-24, SESSION-COST-PROTOCOL-FIX** (before any row; PR 441's §SESSION-COST-PROTOCOL-REVIEW). §3's counts
from the product's code, not `model.py` (B1); T1 and T2 both pre-registered with what each concludes (B2); FIT's *W*
stated as FIT-ARM-BUILD's and both rows predicted (B3); §5 names rendered frames with `viewport` and restricts every
claim to the frame retrieve (B4); per-arm CPU rates (m1), an intercept and the hold (m2), each cell's length, the
300 s limit and the job count (m3), one warmed server pair a form and the memory floor at 0 (m4), the three-arm
order (m5), ask counts for A+C1 and FIT and the jumps in §1's counts (m6), client → server bytes recorded (nit).
Corrected in place: §5's former "lowest server CPU … on `dbts_b1` for FIT (×3.5)", which fell under HTTP/2's ×6–8.

**2026-11-24, SESSION-COST-RUN** (before any counted row; departures the rig forces, none changing a prediction).

* **The run's tree.** `claude/session-cost-rig`: this branch at `b059388b6` + the protocol, with as files, no merge,
  `claude/delivery`'s `lab/delivery/` (at `854372707`, FIT-ARM-BUILD's), `claude/phone-run-2`'s `lab/devices/`,
  `lab/viewer/`, `client/viewer/head.js` and `server/dev-server.py` (the round page and its beacon, built on this tip),
  and `claude/delivery`'s window read-back in `client/paint/` (FIT's check, lab-only). `client/view/` and
  `client/transport/` are `b059388b6`'s byte for byte, so **T1** is the table (§3) and the harness is not rerun.
* **The lever.** `--session` drives §1's trace in the page (`lab/delivery/session-page.js`): each step a `keydown` of
  `ArrowRight` or `ArrowLeft` on the viewer's window, the next no sooner than 100 ms after it and only once `shown`
  names its frame; a jump sets `#slice` and fires its `input`; A+C1's dwell is the viewer's `l`; FIT's is A2.5's zoom
  (×2, the rest asked on the fill's session), the pose reset before the next jump. The trace starts at the fill's end
  (the round page's `finished`: the window filled). Asks are counted as the frames off the wire: the fill's, every
  `FrameStore.put` after it, and the exact asks at the dwells. *Corrected 2026-11-24 19:20, rows already running, no
  prediction moved:* this said the controller's `received`, which skips a frame delivered while a copy is held
  (`store.js` `put`): on CLEAN `dbts_b1` A it read 157 where 299 frames came off the wire (148.75 MB at 0.464 MB a
  view frame, ×1.04: about 308). Both are in every row (`session.asked`, `session.arrivals`).
* **Server lifetime: one pair a session, not one a form** (§6). The rig starts the relay, both series servers and the
  page servers per load, in the relay's namespace, and each server serves one series; one pair for a form's three
  volumes and four series would need a server serving many series and a relay counting by session, neither of which
  the rig has. The 2026-11-23 rows that gave §4's rates and intercept ran the same way, a fresh pair a load, so the
  predictions stand. The warm-up session (`dbts_b1` B, uncounted) is kept, to warm the page cache. Each session's CPU
  and memory are taken from its pair's values before the page's load, after both servers have printed their banner.
* **The relay's guard VOIDs no session here** (§6's first `VOID` reason, *measured* on the smoke below). Every
  session that asks after an idle gap tripped it: A+C1 on `dbts_a1` (8 840 packets, p99 2.58 ms), B on `dbts_c1`
  (p99 1.64 ms), every `dbts_b1` arm (p99 1.98–4.02 ms); sessions that ask nothing after the fill did not (A and B on
  `dbts_a1`, p99 0.25–0.34 ms), and plain delivery loads on this host stayed under it (`dbts_b1` A and B, 0.44 and
  0.35 ms). *Hypothesis, not checked*: the userspace relay wakes late from idle, which a fill never meets and a
  session meets at every step. The guard protects a load's *time*, which is no result here (§6 *Forms*); the cost
  cells are bytes, CPU and memory. So a tripped guard is recorded (`guardLate`) and counted per cell beside its
  medians, and a byte cell outside ±3 % would show any retransmission it caused. The other `VOID` reasons stand.
* **FIT's *W* is 15** on `dbts_b1` (the store reads the series' full-frame metadata, `memoryWindow`; recorded each
  session), so FIT's row is §3's and §4's *W* 15.
* **The mutants** (§6), each run once on CLEAN `dbts_a1` A and flagged as named (`lab/delivery/rows/session-mutant-*.jsonl`
  on `claude/session-cost-rig`): the sampler on the relay's pid, "sampler: not a series server, or CPU zero"; a trace
  one step short (the pass's last step dropped), "trace: 164 steps, §1 says 165"; the relay's tally dropped, "tally:
  no bytes". A flag on a counted session stops the run.
* **The smoke** (`session-smoke.jsonl`, not counted): CLEAN `dbts_a1` A 56 asks, 4.83 MB, 0.036 s; `dbts_b1` A and A+C1
  *W* 15, FIT 132 + 3 asks, B 131.
* **`usb_cine`** is coded by `lab/av1/tools/ingest_coded.py --codec htj2k` beside `series.sh`'s output, which does not
  code it; B only, three sessions on CLEAN, as §6.

## Results

SESSION-COST-RUN, 2026-11-24 19:01–21:28 UTC, by a session that wrote none of this protocol, its review or its fix,
as amended in §9 before any counted row. **Measured** unless labelled. Rig `claude/session-cost-rig` `8dcc345f5`
(`client/view/`, `client/transport/` = `b059388b6`'s, so **T1**); raw rows there, `lab/delivery/rows/session-CLEAN.jsonl`
(97: the warm-up and 96), `session-CR.jsonl` and `session-CR-rest.jsonl` (31 and 18: the first job stopped at its 2 h
limit after step 30, `--skip 31` ran the rest without a second warm-up), `session-CLEAN-usb_cine.jsonl` (3); the
smoke and the mutants beside them. 147 counted, 0 `VOID`, 0 flagged; Chromium 158.0.8127.36; the servers' core at
most 46 % busy, so the host did not saturate on any cell. `claude/session-cost-rig:lab/delivery/session-summary.mjs` reads the table below off
the rows. Medians; asks are frames off the wire (§9's correction), MB server → client UDP **as the relay delivered it**
(packets its queue dropped are not counted: *What held* below; m1, *corrected 2026-11-25, SESSION-COST-VERDICT-FIX*), CPU both series servers'
schedstat, RSS the larger server's peak over its value before the load. Predictions in brackets (§3, §4, T1).

| form | volume | arm | n | guard late | asks | MB | CPU s | peak RSS MB | §7 |
| --- | --- | --- | --: | --: | --- | --- | --- | --: | --- |
| CLEAN | `dbts_a1` | A+C1 | 8 | 8 | 59 (59) | 8.54 (8.53) | 0.060 (0.045–0.062) | 5.24 | MISS rss |
| CLEAN | `dbts_a1` | A | 8 | 4 | 56 (56) | 4.83 (4.83) | 0.034 (0.028–0.043) | 5.30 | MISS rss |
| CLEAN | `dbts_a1` | B | 8 | 1 | 56 (56) | 70.34 (70.32) | 0.410 (0.330–0.370) | 10.37 | MISS cpu, rss |
| CLEAN | `dbts_a1` | FIT | 8 | 0 | 56 (56) | 70.34 (70.32) | 0.398 (0.330–0.370) | 10.49 | MISS cpu, rss |
| CLEAN | `dbts_b1` | A+C1 | 8 | 8 | 307.5 (799) | 158.10 (392) | 0.836 (2.080–2.500) | 7.70 | MISS asks, bytes, cpu, rss |
| CLEAN | `dbts_b1` | A | 8 | 8 | 305.5 (796) | 149.68 (385.4) | 0.817 (2.040–2.460) | 7.87 | MISS asks, bytes, cpu, rss |
| CLEAN | `dbts_b1` | B | 8 | 8 | 130.5 (132) | 291.87 (295.2) | 1.544 (1.370–1.520) | 11.32 | MISS cpu, rss |
| CLEAN | `dbts_b1` | FIT/15 | 8 | 8 | 135 (135) | 84.98 (84.85) | 0.481 (0.400–0.450) | 9.83 | MISS cpu, rss |
| CLEAN | `dbts_c1` | A+C1 | 8 | 8 | 121 (180) | 14.11 (19.14) | 0.095 (0.100–0.130) | 6.24 | MISS asks, bytes, cpu, rss |
| CLEAN | `dbts_c1` | A | 8 | 8 | 119 (177) | 11.12 (16.02) | 0.072 (0.088–0.115) | 6.21 | MISS asks, bytes, cpu, rss |
| CLEAN | `dbts_c1` | B | 8 | 8 | 84 (84) | 90.37 (90.34) | 0.516 (0.420–0.480) | 10.36 | MISS cpu, rss |
| CLEAN | `dbts_c1` | FIT | 8 | 8 | 84 (84) | 90.37 (90.34) | 0.523 (0.420–0.480) | 10.26 | MISS cpu, rss |
| CLEAN | `usb_cine` | B | 3 | 2 | 64 (64) | 5.19 (5.17) | 0.034 (0.027–0.040) | 5.66 | MISS rss |
| CR | `dbts_a1` | A+C1 | 4 | 0 | 59 (59) | 8.54 (8.53) | 0.111 (0.063–0.102) | 5.40 | MISS cpu, rss |
| CR | `dbts_a1` | A | 4 | 0 | 56 (56) | 4.83 (4.83) | 0.060 (0.036–0.059) | 5.42 | MISS cpu, rss |
| CR | `dbts_a1` | B | 4 | 0 | 56 (56) | 70.35 (70.32) | 0.419 (0.431–0.698) | 11.02 | MISS cpu, rss |
| CR | `dbts_a1` | FIT | 4 | 0 | 56 (56) | 70.35 (70.32) | 0.425 (0.418–0.676) | 11.06 | MISS rss |
| CR | `dbts_b1` | A+C1 | 4 | 4 | 219 (799) | 115.17 (392) | 0.723 (0.877–1.420) | 8.43 | MISS asks, bytes, cpu, rss |
| CR | `dbts_b1` | A | 4 | 4 | 215.5 (796) | 108.74 (385.4) | 0.679 (0.858–1.389) | 8.32 | MISS asks, bytes, cpu, rss |
| CR | `dbts_b1` | B | 4 | 4 | 105 (132) | 252.84 (295.2) | 1.234 (1.621–2.624) | 12.04 | MISS asks, bytes, cpu, rss |
| CR | `dbts_b1` | FIT/15 | 4 | 4 | 114 (135) | 72.27 (84.85) | 0.500 (0.506–0.819) | 10.66 | MISS asks, bytes, cpu, rss |
| CR | `dbts_c1` | A+C1 | 4 | 0 | 97 (180) | 11.97 (19.14) | 0.152 (0.100–0.162) | 6.36 | MISS asks, bytes, rss |
| CR | `dbts_c1` | A | 4 | 0 | 94 (177) | 8.85 (16.02) | 0.104 (0.076–0.123) | 6.36 | MISS asks, bytes, rss |
| CR | `dbts_c1` | B | 4 | 2 | 84 (84) | 90.38 (90.34) | 0.518 (0.542–0.878) | 10.83 | MISS cpu, rss |
| CR | `dbts_c1` | FIT | 4 | 1 | 84 (84) | 90.38 (90.34) | 0.533 (0.549–0.888) | 10.76 | MISS cpu, rss |

**What held and what missed** (§7, every cell, misses named):

* **Asks, the model's first** (§7: read before bytes or CPU). Held on every B and FIT cell on CLEAN, on every
  `dbts_a1` cell on both forms, and on `usb_cine`. **Missed on the view where the window is under the series:**
  `dbts_b1` A asks 305.5 frames on CLEAN and 215.5 on CR, not 796 (−62 %, −73 %); `dbts_c1` A 119 and 94, not 177;
  A+C1 the same plus its three. The view does re-ask (`dbts_b1`: 6.1 asks a frame of the series on CLEAN), but a
  third of T1's thrash: §3's caveat ("a slower decode leaves misses pending when the window moves on") is the
  likely cause, *not checked*. On CR the exact series miss too (`dbts_b1` B 105 for 132, FIT 114 for 135): that the round
  trip leaves fewer frames asked ahead to be let go is the likely cause, *not checked* (m4; it was written as fact
  before, *corrected 2026-11-25, SESSION-COST-VERDICT-FIX*).
* **Bytes follow the asks**: within ±0.1 % of the table wherever the asks held (`dbts_a1` 4.83, 8.54, 70.34;
  `dbts_c1` B 90.37; `dbts_b1` FIT 84.98, B 291.87 at −1.1 %; `usb_cine` 5.19), so wire ÷ payload stood at 1.037–1.04;
  a miss in asks is a miss in bytes by the same share. CR's bytes equal CLEAN's (±2 %) only where the asks did.
* **The bytes are delivered bytes, not the server's egress** (m1, *corrected 2026-11-25, SESSION-COST-VERDICT-FIX*). `link_impair.py` drops a packet on
  its queue's overflow before it counts the flow, so a dropped packet's bytes are in no flow. CLEAN's 300-packet
  queue overflowed in every session; CR's 1 875-packet queue in 7 of 48 (11–1 800 packets, all on `dbts_b1`: A+C1 3, B 4).
  The overflow counter also holds the page's TCP packets, so per cell it is an **upper bound** on server egress
  unseen (*measured* median dropped packets ÷ the server's delivered UDP packets, × its 1 469–1 480 B a packet):
  CLEAN `dbts_a1` A 15.1 % (≤ 0.73 MB), A+C1 13.2 % (≤ 1.13), B and FIT 1.0 % (≤ 0.68); `dbts_b1` A 1.3 % (≤ 2.04),
  A+C1 1.8 % (≤ 2.84), B 0.6 % (≤ 1.61), FIT/15 1.1 % (≤ 0.96); `dbts_c1` A 9.0 % (≤ 1.01), A+C1 11.4 % (≤ 1.62),
  B and FIT 1.3 % (≤ 1.19); `usb_cine` 13.0 % (≤ 0.67); CR every cell ≤ 0.2 % by median (`dbts_b1` B one session
  ≤ 2.65 MB). At the bound no lowest arm and no order below changes (*derived*: `dbts_a1` A ≤ 5.56 against B's
  70.34; `dbts_c1` A ≤ 12.13 against 90.37).
* **Server CPU, exact frames: missed high on CLEAN**, 5.3–5.8 ms a wire MB against 4.6–5.1 (§4's 4.8–5.3 a MB
  asked): `dbts_a1` B 0.410 s (0.33–0.37), `dbts_b1` B 1.544 (1.37–1.52), FIT 0.481 (0.40–0.45), `dbts_c1` 0.516–0.523
  (0.42–0.48). The view's held on `dbts_a1` (A 0.034, A+C1 0.060) and, at its measured bytes, sits at 5.3–7.0 ms a
  MB (§4: 5.5–6.6; `dbts_b1` 5.3–5.5, `dbts_a1` and `dbts_c1` 6.5–7.0; m5, *corrected 2026-11-25, SESSION-COST-VERDICT-FIX*).
* **CPU on CR** (m2, *corrected 2026-11-25, SESSION-COST-VERDICT-FIX*). The reading used: each CR cell against ×1.05–1.7 of *its own* measured CLEAN
  median, one range for every arm (`session-summary.mjs`'s `CR_CPU`); PR 441's re-review r-m1 asked per form, exact
  ×1.05–1.2 and view ×1.35–1.8, and it was neither applied nor said in §9 before the first CR row. Both readings, on
  the cells whose asks held on CR (*measured* CR ÷ CLEAN): `dbts_a1` A ×1.75 held by both; A+C1 ×1.85 missed by both;
  B ×1.02 missed low by both; FIT ×1.07 held by both; `dbts_c1` B ×1.00 and FIT ×1.02 missed low by both. So the
  exact series' CPU on CR is CLEAN's (×1.00–1.07) on `dbts_a1` and `dbts_c1`, not the ×1.05–1.2 predicted, and the
  view's rises ×1.75–1.85 on `dbts_a1`. Where CR's asks missed (`dbts_b1` every arm, ×0.80–1.04; `dbts_c1` A ×1.43
  and A+C1 ×1.60) a CPU ratio mixes fewer asks with the rate and decides nothing, under either reading. This
  replaces "CR's ×1.05–1.7 missed for the exact series (×0.80–1.07 of CLEAN)", which `dbts_a1` FIT's held ×1.07
  contradicted.
* **Peak memory: missed on every cell**, 5.0–12.1 MB against 0–5. It is bounded, not growing with bytes (*derived*):
  the exact series' sessions sit at 10.1–12.1 MB whether they move 70 or 292 MB, `dbts_b1` FIT/15's at 9.3–10.8, the
  view's at 5.1–8.7 (*measured*, per session; m3, *corrected 2026-11-25, SESSION-COST-VERDICT-FIX*: the range left out FIT/15). Two explanations fit, both
  *not checked*: §4's own theory, quinn's 10 MB send window, with its number taken from the other host's 1–4.8 MB
  rows; and §9's fresh server pair a session, so each peak over its before-the-load value holds a new process's
  first-session growth (quinn's endpoint and buffers, the allocator's first arenas), which §4's floor, reasoned for
  one pair a run, did not include.
* **The guard** tripped in 98 of 147 sessions (§9). What it did to the bytes is not shown: delivered bytes carry one
  copy of each packet whatever was dropped or late before it, so the bytes' ±1.1 % is not evidence either way (m1,
  *corrected 2026-11-25, SESSION-COST-VERDICT-FIX*; the line said "so no retransmission it caused shows in the bytes").

**Lowest** (§7: below every other measured arm in its form and volume, bytes and CPU alike, *measured*): on
`dbts_a1` **A** (4.83 MB, ×14.6 under B; CPU 0.034 s CLEAN, 0.060 CR); on `dbts_b1` **FIT** (84.98 MB CLEAN, ×3.4
under B; 72.27 CR, ×3.5; CPU 0.481 and 0.500); on `dbts_c1` **A** (11.12 MB CLEAN, ×8.1 under B; 8.85 CR, ×10.2).
**T1's `dbts_b1` conclusion does not hold**: A and A+C1 are not the dearest there; **B, and FIT where it is B
(`dbts_a1`, `dbts_c1`), is the dearest arm on every volume and form** (n1, *corrected 2026-11-25, SESSION-COST-VERDICT-FIX*: the two tie in bytes there,
and FIT's CPU is B's within its spread, 0.523 against 0.516 s on CLEAN `dbts_c1`), A ×1.9–2.3 under B on `dbts_b1`. The order on `dbts_b1` is FIT, A, A+C1, B on both forms.
Against the frame retrieve (§5, *theory*, its bytes B's within 1 %): "lowest bytes a session" holds for each lowest
arm above. "Lowest server CPU" needs the bytes saved to outweigh WebTransport's CPU a MB over HTTP/2's 0.84; at the
rates measured on CLEAN (view 5.3–7.0, exact 5.3–5.8 ms a MB, ×6.3–8.4), **on CLEAN only `dbts_a1`'s A** clears it
(×14.6 against ×8.4). On CR it does not: `dbts_a1` A spends 0.060 s for 4.83 MB, 12.4 ms a wire MB, ×14.8 HTTP/2's
0.84 against bytes saved ×14.6 (*derived*: 60 ms against 67.81 MB × 0.84 = 57 ms for B's frames by HTTP/2), and the
0.84 is itself a CLEAN rate, so on CR the comparison has no HTTP/2 row at all (B1, *corrected 2026-11-25, SESSION-COST-VERDICT-FIX*; the line gave the
CLEAN result without its form). `dbts_c1`'s A on CLEAN is a tie within the rates' spread (×8.1 against ×7.7–8.5), on CR not met (×10.2
against ×14); `dbts_b1`'s FIT does not (×3.4 against ×6.7). Nothing is claimed against rendered frames.

**Not recorded as §6 asked** (each found by this run): client → server bytes (the relay's tally counts that
direction's packets, 1.5–24 k a session, not its bytes by flow); the host's softirq is recorded per core
(`softirqJiffies`, 1.0–3.5 s a session over all four cores) but includes the relay's TUN and the browser, so it
does not bound HTTP/2's seventh (§5) either way. The idle series server's schedstat delta is negative in 77 rows
(75 counted; −34 to −168 µs, *measured*): the sum over `/proc/<pid>/task/*` loses an exited thread's time, so a
session's CPU is a lower bound by up to that; on the busy server ticks ÷ schedstat is 0.971–1.005 over 96 sessions
above 0.2 s (SESSION-COST-VERDICT), so no CPU cell moves (n2, *corrected 2026-11-25, SESSION-COST-VERDICT-FIX*). The session's length is not a result (§6 *Forms*).

**How it serves the value statement.** The first measured row behind "the lowest server and network cost per reading
session": on this trace and these three volumes the view (A) is cheapest where its window holds the series or most
of it, FIT where it does not (`dbts_b1`), and the exact series alone (B) is dearest everywhere; against a DICOMweb
frame retrieve, lower server CPU is shown (by theory) on CLEAN `dbts_a1` only; on CR it is not met (×14.8 against
×14.6), and no HTTP/2 rate was measured on CR (B1, *corrected 2026-11-25, SESSION-COST-VERDICT-FIX*). The network's cost is delivered bytes, server egress
up to the overflow bound above. The link, not the decode, bound none of
these cells' costs: bytes and CPU are link-independent where the asks are (§6), and CR moved the asks, not the rates.

## Verdict review

SESSION-COST-VERDICT, 2026-11-25 07:20–08:10 UTC, by a session that wrote none of this protocol, its review, its fix
or its run (`by: U76e2gcA` in `claude/work-ledger:docs/queue/SESSION-COST-VERDICT.md`). Read: this file at `9eb07fb67`,
PR 441's body (the review, the fix, the re-review), `claude/session-cost-rig` at `8dcc345f5`: every row file under
`lab/delivery/rows/session-*.jsonl`, `session-summary.mjs`, `run.mjs`, `plan.mjs` and `lab/scripts/link_impair.py`.

**Recomputed, *measured*.** `session-summary.mjs` over the four counted row files reproduces §Results' table cell for
cell (149 rows, 147 counted, 0 `VOID`), and my own reading of the rows agrees: every session's steps equal §1's,
every A+C1 session asked its three exact frames, the three mutants flagged as §9 names, the guard tripped in 98
sessions (79 CLEAN, 19 CR), the servers' core at most 46 % busy (the relay's at 53 %, the browser's at 77 %).
`git diff b059388b6 8dcc345f5 -- client/view client/transport` is empty, so T1 is the right table. The ratios hold:
`dbts_a1` B ÷ A 14.56; `dbts_b1` B ÷ FIT 3.43 and 3.50, B ÷ A 1.95 and 2.33; `dbts_c1` B ÷ A 8.13 and 10.21. The
rates a wire MB: exact 5.29–5.83 ms (CLEAN), view 5.29–7.04. The order within each round blocks a volume's four arms
and Williams-orders them, volumes rotated, as §6 says.

**What stands.** The cells' held and missed lists of §Results, the asks read first, the bytes following the asks,
"B is the dearest" in bytes, and the lowest arms per form and volume: A on `dbts_a1` and `dbts_c1`, FIT on `dbts_b1`,
on both forms. "Lowest bytes a session" against the frame retrieve stands for each of them.

**Blocker.**

* **B1. "Lower server CPU than the frame retrieve on `dbts_a1`" is a CLEAN result, written without its form.** On CR,
  `dbts_a1` A spends 0.060 s for 4.83 MB, 12.4 ms a wire MB, ×14.8 HTTP/2's 0.84, against bytes saved ×14.6: it does
  not clear the bar (*derived*: 60 ms against 67.81 MB × 0.84 = 57 ms for B's frames by HTTP/2), and the 0.84 itself is
  a CLEAN rate, so on CR the comparison has no HTTP/2 row at all. §Results' *Lowest* says "only `dbts_a1`'s A clears it
  (×14.6 against ×8.5)", and *How it serves the value statement* and the status file's Result say "lower server CPU is
  shown (by theory) on `dbts_a1` only", with no form. It is the one claim behind "the lowest server … cost" against a
  standard reference, so it must carry its scope. Fix: both places say CLEAN; CR's cell named (×14.8 against ×14.6,
  not met, and no HTTP/2 rate on CR); the status file's Result the same.

**Minor.**

* **m1. "MB on the wire" is bytes the relay delivered, not bytes the server sent, and the guard paragraph's inference
  does not follow.** `link_impair.py` drops a packet on overflow before `link.count(flow, …)`, so the flows' bytes
  leave out every packet CLEAN's 300-packet FIFO dropped. CLEAN overflowed in every session: a median 457–1 924
  packets a session, 0.6–1.8 % of the server's UDP packets on the exact and `dbts_b1` cells but 8–13 % on `dbts_a1`
  and `dbts_c1`'s view cells (the count includes the page's TCP packets, so this is an upper bound); CR's 1 875-packet
  queue overflowed in 3 of 48. At ~1.47 KB a packet that is up to ~0.7 MB a session unseen on `dbts_a1` A (≤ 15 % of
  its 4.83 MB) and ~1.0 MB on `dbts_c1` A (≤ 9 %); no lowest arm and no order changes (*derived*). So "no byte cell
  whose asks held moved past ±1.1 %, so no retransmission it caused shows in the bytes" is not evidence: delivered
  bytes carry one copy of each packet whatever was dropped before it. Fix: say the bytes are delivered bytes, give the
  overflow per cell as an upper bound on server egress unseen, and drop the inference.
* **m2. The re-review's r-m1 was not applied, nor said.** PR 441's §Re-review asked CR's CPU multiplier per form
  (exact ×1.05–1.2, view ×1.35–1.8) "or §9 should say so before the first CR row"; §9 is silent and
  `session-summary.mjs` uses ×1.05–1.7 of each cell's *measured* CLEAN median for every arm, a reading §Results does
  not state. Per form, CR `dbts_a1` A (×1.76) holds and A+C1 (×1.85) misses; the exact cells are unchanged (`dbts_a1`
  FIT ×1.07 holds, as the table has it, which the bullet's "missed for the exact series (×0.80–1.07)" contradicts).
  Where CR's asks missed (`dbts_b1` every arm, `dbts_c1` A and A+C1) a CPU ratio mixes fewer asks with the rate and
  decides nothing. Fix: state the reading used, give both, correct the bullet.
* **m3. The memory miss has a second explanation, not named.** §4's floor reasoning assumed one server pair a run;
  §9 runs a fresh pair a session, so each session's peak over its before-the-load value includes a new process's
  first-session growth (quinn's endpoint and buffers, the allocator's first arenas). The bounded 5–12 MB fits it as
  well as the send window. Also "the exact series' sessions sit at 10.3–12.1 MB" leaves out `dbts_b1` FIT (9.3–10.8).
  Fix: name both explanations as *not checked* and the range as measured.
* **m4. Causes written as fact.** "The round trip leaves fewer frames asked ahead to be let go" (CR's fewer asks) is
  a hypothesis; label it *not checked*, as the view's ask miss already is.
* **m5.** The view's rate is "5.3–7.1 ms a MB" in one bullet and "6.5–7.1" in *Lowest*; `dbts_b1` A is 5.46. One range.

**Nits.** n1: "B is the dearest arm on every volume" ties FIT in bytes on `dbts_a1` and `dbts_c1`, where FIT is B,
and FIT's CPU is above B's on CLEAN `dbts_c1` (0.523 against 0.516): say "B, and FIT where it is B". n2: the idle
server's schedstat delta is negative in 77 rows (−34 to −83 µs): the sum over `/proc/<pid>/task/*` loses an exited
thread's time; on the busy server ticks ÷ schedstat is 0.971–1.005 over 96 sessions above 0.2 s, so no CPU cell moves,
but the sampler should say so.

**Verdict.** One blocker (B1), five minor, two nits; the measured table and every lowest arm stand. By amendment 17,
SESSION-COST-VERDICT-FIX and -FIX-REVIEW are appended to `claude/work-ledger:docs/queue-2026-11-24.md`, and
PAGES-AFTER-RUNS waits on the re-review. How it serves the value statement: it keeps the first measured row behind
"the lowest server and network cost" to what was measured, CLEAN for the CPU claim, delivered bytes for the network's.
Fixtures and limits of this review: recomputation and reading of SESSION-COST-RUN's rows (three timed DBT volumes of
one dataset; `usb_cine` lossy-sourced, a function check; one 4-core cloud host, headless Chromium 158, software
decode; a userspace relay, CLEAN and CR, one session at a time on an assumed trace); nothing rerun in a browser; the
HTTP/2 rate is the frame retrieve's *theory* from `claude/transport-arms`' CLEAN rows. Gate not run (docs only).

## Verdict fix

SESSION-COST-VERDICT-FIX, 2026-11-25 09:05–09:40 UTC, by a session that wrote none of this protocol, its run or its
verdict review (`by: dMbLdL4P` in `claude/work-ledger:docs/queue/SESSION-COST-VERDICT-FIX.md`). Docs only, §Results in
place, each changed line marked with the finding. Recomputed from `claude/session-cost-rig` `8dcc345f5`'s four counted
row files (147 sessions): the overflow per cell, CR ÷ CLEAN per cell, the memory ranges per session, the negative
schedstat rows.

* **B1: fixed.** *Lowest* and *How it serves the value statement* scope the CPU claim to CLEAN, CR's `dbts_a1` A named
  (×14.8 against ×14.6, not met, no HTTP/2 rate on CR); the status file's Result the same.
* **m1: fixed.** The bytes are named delivered bytes; a bullet gives the overflow per cell as an upper bound on egress
  unseen; the guard's inference is withdrawn. Two counts differ from the review's: CR overflowed in 7 of 48 sessions,
  not 3 (all on `dbts_b1`, four of them under 120 packets), and the view cells' bound is 9.0–15.1 %, not 8–13 %
  (`dbts_a1` A is 15.1 %, as the review's own "≤ 15 %" has it). No lowest arm moves.
* **m2: fixed.** The reading used is stated, both readings given per cell, the bullet corrected.
* **m3: fixed.** Both explanations, *not checked*; the ranges per session, FIT/15 among them.
* **m4: fixed.** **m5: fixed**: one range, 5.3–7.0 ms a MB, with its split per volume.
* **n1: fixed.** **n2: fixed**, in *Not recorded*: 77 rows, −34 to −168 µs (the review's −83 is not the minimum).

## Verdict re-review

SESSION-COST-VERDICT-FIX-REVIEW, 2026-11-25 09:50–10:20 UTC, by a session that wrote none of this file, its run, its
verdict review or its fix (`by: wJ8nwiav` in `claude/work-ledger:docs/queue/SESSION-COST-VERDICT-FIX-REVIEW.md`).
Read: §Results and §Verdict fix at `7baa78b6a` (`git diff 9b918f790 7baa78b6a`), `claude/work-ledger:docs/queue/SESSION-COST-RUN.md`'s
Result. Recomputed, *measured*, by a script of my own (not `session-summary.mjs`) over `claude/session-cost-rig`
`8dcc345f5`'s four counted row files: 149 rows, 147 counted; per cell the median server → client UDP bytes and packets
of the series servers' flows, the relay's `down.overflowed`, both servers' schedstat sum, each session's peak RSS over
its before-the-load value, and every negative `cpuNs`.

* **B1: closed.** *Lowest*, *How it serves the value statement* and the status file's Result each scope the CPU claim
  to CLEAN and name CR's `dbts_a1` A as not met with no HTTP/2 rate on CR. CR `dbts_a1` A: 0.0603 s for 4.829 MB,
  12.48 ms a wire MB, ×14.86 of 0.84, against B ÷ A 70.35 ÷ 4.83 = ×14.57: not met, as written (r-n1 for the rounding).
* **m1: closed.** Every overflow share and bound in the bullet reproduces to the stated digit (CLEAN `dbts_a1` A
  15.1 %, ≤ 0.73 MB … `usb_cine` 13.0 %, ≤ 0.67; CR ≤ 0.2 % by median); CR overflowed in 7 of 48 sessions (4, 11, 17,
  117, 277, 469, 1 800 packets; A+C1 3, B 4, all `dbts_b1`), as the fix says against the review's 3; `down.lost` is 0
  in every counted row, so the overflow is the only egress the flows miss. The guard inference is withdrawn.
* **m2: open, R-B1 below.** The reading used is stated and both are given; one of the six verdicts is wrong.
* **m3: closed.** Per session: exact series 10.09–12.12 MB, `dbts_b1` FIT/15 9.27–10.78, the view 5.06–8.74; both
  explanations *not checked*.
* **m4: closed.** **m5: open, r-m1 below.** **n1: closed.** **n2: closed** (75 counted rows and 77 in all, −33.4 to
  −167.6 µs; r-n2).

**Blocker.**

* **R-B1. A miss is reported as held.** The CPU-on-CR bullet says "`dbts_a1` A ×1.75 held by both". On the reading
  used (×1.05–1.7 of the cell's CLEAN median, `session-summary.mjs`'s `CR_CPU`) it misses: 0.0603 ÷ 0.0345 = ×1.748,
  over 1.7, and the table's own row reads 0.060 (0.036–0.059) MISS cpu. It holds only per form (view ×1.35–1.8). A
  cell's verdict against its prediction is the thing this section exists to record (§7; phase 2's measurement rule,
  misses included), and the corrected bullet now contradicts the table. Fix: "`dbts_a1` A ×1.75 missed on the reading
  used, held per form"; the rest of the bullet stands (A+C1 ×1.85, B ×1.02, FIT ×1.07, `dbts_c1` B ×1.00, FIT ×1.02
  each reproduce, with their verdicts).

**Minor.**

* **r-m1. m5's one range is wrong at its top.** The fix changed "5.3–7.1" to "5.3–7.0", "6.5–7.1" to "6.5–7.0" and
  "×6.3–8.5", "×8.5" to "×6.3–8.4", "×8.4". The rows give CLEAN `dbts_a1` A 0.03448 s for 4.8293 MB, **7.14 ms a MB,
  ×8.50** (A+C1 7.04, `dbts_c1` 6.51–6.74, `dbts_b1` 5.29–5.46): the review's 7.1 and ×8.5 were right, and the 7.0
  looks taken from the rounded 0.034 s. No conclusion moves (×14.6 against ×8.5 still clears). Fix: 5.3–7.1, 6.5–7.1,
  ×6.3–8.5, ×8.5, in the two bullets and §Verdict fix.

**Nits.** r-n1: CR `dbts_a1` A is 12.48 ms a wire MB and ×14.86, so "12.4" and "×14.8" are truncated (12.5, ×14.9);
the verdict, not met, only strengthens. r-n2: the negative schedstat deltas start at −33.4 µs, not −34; the peak-RSS
floor in the bullet's "5.0–12.1" and the status file's Result is 5.06 MB per session (5.1). r-n3: the bar is read two
ways with different megabytes: as ratios of wire MB (×14.6 against ×8.5) and, in B1's *derived*, as ms against B's
payload (67.81 MB × 0.84), 3.7 % apart. It decides nothing written here, but on CLEAN `dbts_c1` A's own rate is ×7.75
against ×8.13 saved (clears by the ratio) and 72.3 ms against 73.2 (payload, 1.2 %): "a tie" stands as the cautious
word, while its spread ×7.7–8.5 is borrowed from `dbts_a1`'s cells; say which megabyte the 0.84 is.

**Verdict.** One blocker (R-B1), one minor, three nits; B1, m1, m3, m4, n1 and n2 closed; the table, every lowest arm
and the CLEAN-only CPU claim stand. By amendment 17, round two: SESSION-COST-VERDICT-FIX-2 and -FIX-2-REVIEW are
appended to `claude/work-ledger:docs/queue-2026-11-24.md`, and PAGES-AFTER-RUNS waits on the second re-review. How it
serves the value statement: it keeps every cell behind "the lowest server and network cost" reported against its
prediction as measured, misses included. Fixtures and limits of this re-review: recomputation of SESSION-COST-RUN's
rows only (`dbts_a1`, `dbts_b1`, `dbts_c1` of one dataset; `usb_cine` lossy-sourced, a function check; one 4-core
cloud host, headless Chromium 158, software decode; a userspace relay, CLEAN and CR, one session at a time on an
assumed trace); nothing rerun; HTTP/2's 0.84 ms a MB is the frame retrieve's *theory* from `claude/transport-arms`'
CLEAN rows. Gate not run (docs only).

## Fixtures and limits

Three timed DBT volumes of one dataset (`dbts_a1`, `dbts_b1`, `dbts_c1`, as `claude/delivery:lab/delivery/series.sh` codes them);
`usb_cine`, 64 frames, **lossy-sourced** (`docs/FIXTURES.md`): a function check, its bytes and CPU not results. One
4-core cloud host without a GPU, headless Chromium, software WebCodecs; a userspace relay, not a radio; one session at a
time. Every input above is from those rows and fixtures, the `transport-conclusions.md` §4 figures from another host.
Limits found: the thrash on `dbts_b1` by the product's code under the stand-in harness (§3, PR 441's review), measured
by SESSION-COST-RUN at a third of its size (§Results); T2's cure by the same harness on PR 446; HTTP/2's CPU a MB by
`claude/transport-arms`' CLEAN rows, process time only.
